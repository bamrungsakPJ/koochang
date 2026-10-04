-- C02 platform administration: shops overview, suspend/restore, temporary grants, support tickets,
-- owner-consented time-limited read access, audit view, system health and data requests.
-- PostgreSQL 16 target. Apply as fs_migrator.
--
-- Platform staff see shop metadata, never customer content, unless a support access grant is
-- active: requested for a ticket by a support agent, consented by the shop owner, approved by a
-- platform approver, read-only, at most 60 minutes, revocable by the owner, every read audited.

CREATE POLICY platform_functions ON platform.support_tickets TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY platform_functions ON platform.support_access_grants TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY platform_functions ON platform.data_requests TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY platform_functions ON core.service_events TO fs_migrator USING (true);
CREATE POLICY platform_functions ON core.service_event_equipment TO fs_migrator USING (true);

INSERT INTO platform.permissions(code) VALUES ('data.manage') ON CONFLICT (code) DO NOTHING;
INSERT INTO platform.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM platform.roles r JOIN platform.permissions p ON (r.code, p.code) IN
  (('platform_admin','access.approve'), ('super_admin','access.approve'), ('platform_admin','data.manage'), ('auditor','support.read'))
ON CONFLICT DO NOTHING;

-- support ----------------------------------------------------------------------------------------
ALTER TABLE platform.support_tickets
  ADD COLUMN last_message_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN closed_at timestamptz,
  ADD CONSTRAINT tickets_subject CHECK (length(trim(subject)) BETWEEN 1 AND 200);
CREATE INDEX tickets_queue ON platform.support_tickets(status, last_message_at DESC);

CREATE TABLE platform.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  ticket_id uuid NOT NULL,
  author_user_id uuid REFERENCES core.users(id),
  author_account_id uuid REFERENCES platform.accounts(id),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  internal boolean NOT NULL DEFAULT false,
  FOREIGN KEY (organization_id, ticket_id) REFERENCES platform.support_tickets(organization_id, id),
  CHECK ((author_user_id IS NOT NULL)::integer + (author_account_id IS NOT NULL)::integer = 1),
  CHECK (NOT internal OR author_account_id IS NOT NULL)
);
CREATE INDEX support_messages_by_ticket ON platform.support_messages(ticket_id, created_at);
ALTER TABLE platform.support_messages ENABLE ROW LEVEL SECURITY; ALTER TABLE platform.support_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_functions ON platform.support_messages TO fs_migrator USING (true) WITH CHECK (true);

ALTER TABLE platform.support_access_grants
  ADD COLUMN duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 60),
  ADD COLUMN consented_at timestamptz,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN end_reason text;
CREATE INDEX access_grants_by_org ON platform.support_access_grants(organization_id, created_at DESC);

ALTER TABLE platform.data_requests
  ADD COLUMN decided_by uuid REFERENCES platform.accounts(id),
  ADD COLUMN decision_note text;

ALTER TABLE billing.entitlement_grants ADD COLUMN ended_at timestamptz, ADD COLUMN end_reason text;

-- shop side (fs_api): tickets, consent and data requests ----------------------------------------
-- Owner of an active or suspended shop: a suspended shop can still talk to support and see
-- what support may access (Functional §22).
CREATE FUNCTION auth.support_owner_id(p_user_id uuid, p_organization_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id FROM core.organization_members m JOIN core.users u ON u.id = m.user_id JOIN core.organizations o ON o.id = m.organization_id
  WHERE m.organization_id = p_organization_id AND m.user_id = p_user_id AND m.role = 'owner' AND m.status = 'active' AND u.status = 'active'
    AND o.status IN ('active','suspended')
$$;
REVOKE EXECUTE ON FUNCTION auth.support_owner_id(uuid, uuid) FROM PUBLIC;

-- outcome: ok | forbidden
CREATE FUNCTION auth.open_ticket(p_user_id uuid, p_organization_id uuid, p_subject text, p_body text)
RETURNS TABLE (outcome text, ticket_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.support_owner_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN; END IF;
  INSERT INTO platform.support_tickets(organization_id, opened_by, subject) VALUES (p_organization_id, p_user_id, trim(p_subject)) RETURNING id INTO v_id;
  INSERT INTO platform.support_messages(organization_id, ticket_id, author_user_id, body) VALUES (p_organization_id, v_id, p_user_id, trim(p_body));
  RETURN QUERY SELECT 'ok'::text, v_id;
END $$;

-- outcome: ok | forbidden | not_found | closed
CREATE FUNCTION auth.reply_ticket(p_user_id uuid, p_organization_id uuid, p_ticket_id uuid, p_body text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF auth.support_owner_id(p_user_id, p_organization_id) IS NULL THEN RETURN 'forbidden'; END IF;
  SELECT t.status INTO v_status FROM platform.support_tickets t WHERE t.organization_id = p_organization_id AND t.id = p_ticket_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN 'not_found'; END IF;
  IF v_status = 'closed' THEN RETURN 'closed'; END IF;
  INSERT INTO platform.support_messages(organization_id, ticket_id, author_user_id, body) VALUES (p_organization_id, p_ticket_id, p_user_id, trim(p_body));
  UPDATE platform.support_tickets SET last_message_at = now(), status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END WHERE id = p_ticket_id;
  RETURN 'ok';
END $$;

-- Owner's view of support: tickets with public messages, access requests and grants, data requests.
CREATE FUNCTION auth.support_overview(p_user_id uuid, p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.support_owner_id(p_user_id, p_organization_id) IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'tickets', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'status', t.status, 'created_at', t.created_at, 'last_message_at', t.last_message_at,
        'messages', (SELECT jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'from_platform', m.author_account_id IS NOT NULL, 'created_at', m.created_at) ORDER BY m.created_at)
          FROM platform.support_messages m WHERE m.ticket_id = t.id AND NOT m.internal)) ORDER BY t.last_message_at DESC)
      FROM platform.support_tickets t WHERE t.organization_id = p_organization_id), '[]'),
    'access', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'ticket_id', g.ticket_id, 'agent', a.display_name, 'scope', g.scope, 'reason', g.reason,
        'duration_minutes', g.duration_minutes, 'consented', g.consented_by IS NOT NULL, 'status', CASE WHEN g.status = 'active' AND g.valid_until <= now() THEN 'expired' ELSE g.status END,
        'valid_until', CASE WHEN g.status = 'active' THEN g.valid_until END, 'created_at', g.created_at,
        'reads', (SELECT count(*) FROM platform.audit_logs l WHERE l.support_grant_id = g.id AND l.action = 'support.read')) ORDER BY g.created_at DESC)
      FROM platform.support_access_grants g JOIN platform.accounts a ON a.id = g.account_id WHERE g.organization_id = p_organization_id), '[]'),
    'data_requests', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'type', d.request_type, 'status', d.status, 'created_at', d.created_at, 'completed_at', d.completed_at,
        'note', d.decision_note) ORDER BY d.created_at DESC)
      FROM platform.data_requests d WHERE d.organization_id = p_organization_id), '[]'));
END $$;

-- Owner consents to (or refuses) a pending access request, or revokes an active one.
-- outcome: ok | forbidden | not_found | invalid_state
CREATE FUNCTION auth.decide_support_access(p_user_id uuid, p_organization_id uuid, p_grant_id uuid, p_action text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g platform.support_access_grants%ROWTYPE;
BEGIN
  IF auth.support_owner_id(p_user_id, p_organization_id) IS NULL THEN RETURN 'forbidden'; END IF;
  SELECT * INTO g FROM platform.support_access_grants x WHERE x.organization_id = p_organization_id AND x.id = p_grant_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN 'not_found'; END IF;
  IF p_action = 'consent' AND g.status = 'pending' AND g.consented_by IS NULL THEN
    UPDATE platform.support_access_grants SET consented_by = p_user_id, consented_at = now() WHERE id = g.id;
  ELSIF p_action = 'refuse' AND g.status = 'pending' THEN
    UPDATE platform.support_access_grants SET status = 'rejected', ended_at = now(), end_reason = 'owner_refused' WHERE id = g.id;
  ELSIF p_action = 'revoke' AND (g.status = 'active' OR (g.status = 'pending' AND g.consented_by IS NOT NULL)) THEN
    UPDATE platform.support_access_grants SET status = 'revoked', ended_at = now(), end_reason = 'owner_revoked' WHERE id = g.id;
  ELSE RETURN 'invalid_state';
  END IF;
  INSERT INTO platform.audit_logs(organization_id, action, target_type, target_id, details, support_grant_id)
    VALUES (p_organization_id, 'support_access.owner_' || p_action, 'support_grant', g.id, jsonb_build_object('user_id', p_user_id), g.id);
  RETURN 'ok';
END $$;

-- outcome: ok | forbidden | exists
CREATE FUNCTION auth.request_data_export(p_user_id uuid, p_organization_id uuid, p_reason text)
RETURNS TABLE (outcome text, request_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.support_owner_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN; END IF;
  SELECT d.id INTO v_id FROM platform.data_requests d WHERE d.organization_id = p_organization_id AND d.request_type = 'export' AND d.status IN ('pending','approved','running');
  IF v_id IS NOT NULL THEN RETURN QUERY SELECT 'exists'::text, v_id; RETURN; END IF;
  INSERT INTO platform.data_requests(organization_id, requested_by, request_type, reason) VALUES (p_organization_id, p_user_id, 'export', nullif(trim(p_reason), ''))
    RETURNING id INTO v_id;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    VALUES (p_organization_id, p_user_id, 'data_request.created', 'data_request', v_id, gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text, v_id;
END $$;

REVOKE EXECUTE ON FUNCTION auth.open_ticket(uuid, uuid, text, text), auth.reply_ticket(uuid, uuid, uuid, text), auth.support_overview(uuid, uuid),
  auth.decide_support_access(uuid, uuid, uuid, text), auth.request_data_export(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.open_ticket(uuid, uuid, text, text), auth.reply_ticket(uuid, uuid, uuid, text), auth.support_overview(uuid, uuid),
  auth.decide_support_access(uuid, uuid, uuid, text), auth.request_data_export(uuid, uuid, text) TO fs_api;

-- platform side ----------------------------------------------------------------------------------
-- Masked phone: country code and last 4 digits only.
CREATE FUNCTION padmin.mask_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE left(p, 3) || repeat('•', greatest(length(p) - 7, 0)) || right(p, 4) END
$$;

CREATE FUNCTION padmin.overview(p_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.read');
  RETURN jsonb_build_object(
    'shops', (SELECT jsonb_object_agg(state, n) FROM (SELECT e.state, count(*) AS n FROM core.organizations o, LATERAL billing.entitlement(o.id) e GROUP BY e.state) x),
    'proofs_pending', (SELECT count(*) FROM billing.payment_proofs WHERE status = 'pending'),
    'refunds_open', (SELECT count(*) FROM billing.refunds WHERE status IN ('pending','approved')),
    'tickets_open', (SELECT count(*) FROM platform.support_tickets WHERE status IN ('open','in_progress')),
    'access_pending', (SELECT count(*) FROM platform.support_access_grants WHERE status = 'pending'),
    'data_requests_open', (SELECT count(*) FROM platform.data_requests WHERE status IN ('pending','approved','running')));
END $$;

CREATE FUNCTION padmin.organizations(p_account_id uuid, p_query text, p_state text)
RETURNS TABLE (id uuid, name text, status text, created_at timestamptz, state text, plan_code text, period_end timestamptz,
  owner_name text, owner_phone text, active_technicians integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.read');
  RETURN QUERY
  SELECT o.id, o.name, o.status, o.created_at, e.state, e.plan_code, e.period_end, u.display_name, padmin.mask_phone(u.phone_e164),
    (SELECT count(*)::integer FROM core.organization_members m WHERE m.organization_id = o.id AND m.role = 'technician' AND m.status = 'active')
  FROM core.organizations o
  CROSS JOIN LATERAL billing.entitlement(o.id) e
  LEFT JOIN core.organization_members om ON om.organization_id = o.id AND om.role = 'owner' AND om.status = 'active'
  LEFT JOIN core.users u ON u.id = om.user_id
  WHERE (coalesce(p_query, '') = '' OR o.name ILIKE '%' || p_query || '%' OR o.id::text = p_query OR right(u.phone_e164, 4) = right(regexp_replace(p_query, '\D', '', 'g'), 4) AND length(regexp_replace(p_query, '\D', '', 'g')) >= 4)
    AND (coalesce(p_state, '') = '' OR e.state = p_state)
  ORDER BY o.created_at DESC LIMIT 200;
END $$;

-- Shop metadata for the platform: no customers, jobs or photos.
CREATE FUNCTION padmin.organization_detail(p_account_id uuid, p_organization_id uuid, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb; e record;
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.read');
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  SELECT jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status, 'timezone', o.timezone, 'default_language', o.default_language, 'created_at', o.created_at),
    'entitlement', to_jsonb(e),
    'usage', jsonb_build_object(
      'active_technicians', (SELECT count(*) FROM core.organization_members m WHERE m.organization_id = o.id AND m.role = 'technician' AND m.status = 'active'),
      'storage_bytes', coalesce((SELECT uc.used FROM billing.usage_counters uc WHERE uc.organization_id = o.id AND uc.metric = 'storage_bytes' AND uc.window_key = 'all'), 0),
      'ocr', coalesce((SELECT uc.used FROM billing.usage_counters uc WHERE uc.organization_id = o.id AND uc.metric = 'ocr' AND uc.window_key = billing.usage_window('ocr', e.period_id)), 0)),
    'team', coalesce((SELECT jsonb_agg(jsonb_build_object('name', u.display_name, 'role', m.role, 'status', m.status, 'phone', padmin.mask_phone(u.phone_e164), 'joined_at', m.created_at)
        ORDER BY m.role DESC, m.created_at) FROM core.organization_members m JOIN core.users u ON u.id = m.user_id WHERE m.organization_id = o.id), '[]'),
    'periods', coalesce((SELECT jsonb_agg(jsonb_build_object('source', sp.source, 'plan', sp.plan_snapshot->>'plan_code', 'start_at', sp.start_at, 'end_at', sp.end_at,
        'invoice_id', sp.invoice_id) ORDER BY sp.start_at DESC) FROM billing.subscription_periods sp WHERE sp.organization_id = o.id), '[]'),
    'grants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.grant_kind, 'reason', g.reason, 'valid_from', g.valid_from, 'valid_until', g.valid_until,
        'entitlements', g.entitlements, 'granted_by', a.display_name, 'ended_at', g.ended_at) ORDER BY g.created_at DESC)
      FROM billing.entitlement_grants g JOIN platform.accounts a ON a.id = g.granted_by WHERE g.organization_id = o.id), '[]'),
    'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'amount_minor', i.amount_minor, 'status', i.status, 'created_at', i.created_at)
        ORDER BY i.created_at DESC) FROM billing.invoices i WHERE i.organization_id = o.id), '[]'),
    'platform_history', coalesce((SELECT jsonb_agg(jsonb_build_object('action', l.action, 'actor', a.display_name, 'reason', l.reason, 'created_at', l.created_at) ORDER BY l.created_at DESC)
      FROM (SELECT * FROM platform.audit_logs l WHERE l.organization_id = o.id ORDER BY l.created_at DESC LIMIT 50) l LEFT JOIN platform.accounts a ON a.id = l.actor_account_id), '[]'))
  INTO v FROM core.organizations o WHERE o.id = p_organization_id;
  IF v IS NOT NULL THEN
    INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, request_id)
      VALUES (p_account_id, p_organization_id, 'shops.read', 'shop.viewed', 'organization', p_organization_id, p_request_id);
  END IF;
  RETURN v;
END $$;

-- Security suspension wins over every period and grant; restore returns to the existing
-- subscription (no new period). outcome: ok | not_found | unchanged
CREATE FUNCTION padmin.set_organization_status(p_account_id uuid, p_organization_id uuid, p_status text, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_old text;
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.suspend');
  IF p_status NOT IN ('active','suspended') THEN RETURN 'unchanged'; END IF;
  SELECT o.status INTO v_old FROM core.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF v_old IS NULL THEN RETURN 'not_found'; END IF;
  IF v_old = p_status OR v_old = 'closed' THEN RETURN 'unchanged'; END IF;
  UPDATE core.organizations SET status = p_status WHERE id = p_organization_id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id)
    VALUES (p_account_id, p_organization_id, 'shops.suspend', CASE WHEN p_status = 'suspended' THEN 'shop.suspended' ELSE 'shop.restored' END,
      'organization', p_organization_id, trim(p_reason), jsonb_build_object('from', v_old, 'to', p_status), p_request_id);
  RETURN 'ok';
END $$;

-- Temporary grant (pilot, compensation, temporary upgrade) with an end date of at most 180 days.
-- outcome: ok | not_found | invalid
CREATE FUNCTION padmin.create_grant(p_account_id uuid, p_organization_id uuid, p_kind text, p_reason text, p_valid_until timestamptz,
  p_entitlements jsonb, p_request_id uuid) RETURNS TABLE (outcome text, grant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'grants.manage');
  IF NOT EXISTS (SELECT 1 FROM core.organizations WHERE id = p_organization_id) THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF p_kind NOT IN ('pilot','compensation','temporary_upgrade') OR p_valid_until <= now() OR p_valid_until > now() + interval '180 days'
     OR jsonb_typeof(p_entitlements) <> 'object' OR p_entitlements = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_each(p_entitlements) x WHERE x.key NOT IN ('technician_seats','storage_bytes','ocr_per_period') OR jsonb_typeof(x.value) <> 'number' OR (x.value #>> '{}')::numeric <= 0) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  INSERT INTO billing.entitlement_grants(organization_id, reason, grant_kind, valid_from, valid_until, entitlements, granted_by)
    VALUES (p_organization_id, trim(p_reason), p_kind, now(), p_valid_until, p_entitlements, p_account_id) RETURNING id INTO v_id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id)
    VALUES (p_account_id, p_organization_id, 'grants.manage', 'grant.created', 'entitlement_grant', v_id, trim(p_reason),
      jsonb_build_object('kind', p_kind, 'valid_until', p_valid_until, 'entitlements', p_entitlements), p_request_id);
  RETURN QUERY SELECT 'ok'::text, v_id;
END $$;

-- outcome: ok | not_found | ended
CREATE FUNCTION padmin.end_grant(p_account_id uuid, p_grant_id uuid, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g billing.entitlement_grants%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'grants.manage');
  SELECT * INTO g FROM billing.entitlement_grants x WHERE x.id = p_grant_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN 'not_found'; END IF;
  IF g.valid_until <= now() THEN RETURN 'ended'; END IF;
  UPDATE billing.entitlement_grants SET valid_until = now(), ended_at = now(), end_reason = trim(p_reason) WHERE id = g.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, request_id)
    VALUES (p_account_id, g.organization_id, 'grants.manage', 'grant.ended', 'entitlement_grant', g.id, trim(p_reason), p_request_id);
  RETURN 'ok';
END $$;

CREATE FUNCTION padmin.tickets(p_account_id uuid, p_status text)
RETURNS TABLE (id uuid, organization_id uuid, organization_name text, subject text, status text, assigned_to text, created_at timestamptz, last_message_at timestamptz, last_from_shop boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'support.read');
  RETURN QUERY SELECT t.id, t.organization_id, o.name, t.subject, t.status, a.display_name, t.created_at, t.last_message_at,
    (SELECT m.author_user_id IS NOT NULL FROM platform.support_messages m WHERE m.ticket_id = t.id AND NOT m.internal ORDER BY m.created_at DESC LIMIT 1)
  FROM platform.support_tickets t JOIN core.organizations o ON o.id = t.organization_id LEFT JOIN platform.accounts a ON a.id = t.assigned_account_id
  WHERE (p_status = 'open' AND t.status IN ('open','in_progress')) OR (p_status = 'all') OR t.status = p_status
  ORDER BY t.last_message_at DESC LIMIT 200;
END $$;

CREATE FUNCTION padmin.ticket_detail(p_account_id uuid, p_ticket_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'support.read');
  RETURN (SELECT jsonb_build_object(
    'ticket', jsonb_build_object('id', t.id, 'organization_id', t.organization_id, 'organization_name', o.name, 'subject', t.subject, 'status', t.status,
      'assigned_account_id', t.assigned_account_id, 'created_at', t.created_at, 'opened_by', u.display_name),
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'internal', m.internal, 'created_at', m.created_at,
        'author', coalesce(a.display_name, mu.display_name), 'from_platform', m.author_account_id IS NOT NULL) ORDER BY m.created_at)
      FROM platform.support_messages m LEFT JOIN platform.accounts a ON a.id = m.author_account_id LEFT JOIN core.users mu ON mu.id = m.author_user_id
      WHERE m.ticket_id = t.id), '[]'),
    'access', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'status', CASE WHEN g.status = 'active' AND g.valid_until <= now() THEN 'expired' ELSE g.status END,
        'scope', g.scope, 'reason', g.reason, 'duration_minutes', g.duration_minutes, 'requested_by', ra.display_name, 'account_id', g.account_id,
        'consented', g.consented_by IS NOT NULL, 'approved_by', aa.display_name, 'valid_until', CASE WHEN g.status = 'active' THEN g.valid_until END, 'created_at', g.created_at)
        ORDER BY g.created_at DESC)
      FROM platform.support_access_grants g JOIN platform.accounts ra ON ra.id = g.account_id LEFT JOIN platform.accounts aa ON aa.id = g.approved_by
      WHERE g.ticket_id = t.id), '[]'))
  FROM platform.support_tickets t JOIN core.organizations o ON o.id = t.organization_id JOIN core.users u ON u.id = t.opened_by WHERE t.id = p_ticket_id);
END $$;

-- Reply to the shop or add an internal note; optionally change status/assignee.
-- outcome: ok | not_found
CREATE FUNCTION padmin.update_ticket(p_account_id uuid, p_ticket_id uuid, p_body text, p_internal boolean, p_status text, p_assign_to_me boolean, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t platform.support_tickets%ROWTYPE; v_owner uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'support.manage');
  SELECT * INTO t FROM platform.support_tickets x WHERE x.id = p_ticket_id FOR UPDATE;
  IF t.id IS NULL THEN RETURN 'not_found'; END IF;
  IF nullif(trim(coalesce(p_body, '')), '') IS NOT NULL THEN
    INSERT INTO platform.support_messages(organization_id, ticket_id, author_account_id, body, internal) VALUES (t.organization_id, t.id, p_account_id, trim(p_body), p_internal);
    IF NOT p_internal THEN
      FOR v_owner IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = t.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
        PERFORM core.notify(t.organization_id, v_owner, 'support_reply:' || t.id || ':' || extract(epoch FROM now())::bigint, 'support_reply', '{}'::jsonb, 'support_ticket', t.id);
      END LOOP;
    END IF;
  END IF;
  UPDATE platform.support_tickets SET
    status = CASE WHEN p_status IN ('open','in_progress','resolved','closed') THEN p_status WHEN NOT coalesce(p_internal, false) AND p_body IS NOT NULL AND status = 'open' THEN 'in_progress' ELSE status END,
    assigned_account_id = CASE WHEN p_assign_to_me THEN p_account_id ELSE assigned_account_id END,
    last_message_at = CASE WHEN nullif(trim(coalesce(p_body, '')), '') IS NOT NULL AND NOT p_internal THEN now() ELSE last_message_at END,
    closed_at = CASE WHEN p_status = 'closed' THEN now() ELSE closed_at END
  WHERE id = t.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id)
    VALUES (p_account_id, t.organization_id, 'support.manage', 'ticket.updated', 'support_ticket', t.id,
      jsonb_build_object('internal', p_internal, 'status', p_status, 'replied', nullif(trim(coalesce(p_body, '')), '') IS NOT NULL), p_request_id);
  RETURN 'ok';
END $$;

-- Support agent asks the owner for read access within a ticket.
-- outcome: ok | not_found | invalid
CREATE FUNCTION padmin.request_access(p_account_id uuid, p_ticket_id uuid, p_scope text[], p_minutes integer, p_reason text, p_request_id uuid)
RETURNS TABLE (outcome text, grant_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE t platform.support_tickets%ROWTYPE; v_id uuid; v_owner uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'access.request');
  SELECT * INTO t FROM platform.support_tickets x WHERE x.id = p_ticket_id;
  IF t.id IS NULL OR t.status = 'closed' THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF p_minutes NOT BETWEEN 5 AND 60 OR cardinality(p_scope) = 0 OR NOT (p_scope <@ ARRAY['customers','equipment','jobs','service_history']) OR nullif(trim(p_reason), '') IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  INSERT INTO platform.support_access_grants(organization_id, ticket_id, account_id, scope, reason, valid_from, valid_until, duration_minutes)
    VALUES (t.organization_id, t.id, p_account_id, to_jsonb(p_scope), trim(p_reason), now(), now() + make_interval(mins => p_minutes), p_minutes) RETURNING id INTO v_id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id, support_grant_id)
    VALUES (p_account_id, t.organization_id, 'access.request', 'support_access.requested', 'support_grant', v_id, trim(p_reason),
      jsonb_build_object('scope', p_scope, 'minutes', p_minutes), p_request_id, v_id);
  FOR v_owner IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = t.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
    PERFORM core.notify(t.organization_id, v_owner, 'support_access:' || v_id, 'support_access_requested', jsonb_build_object('minutes', p_minutes), 'support_grant', v_id);
  END LOOP;
  RETURN QUERY SELECT 'ok'::text, v_id;
END $$;

CREATE FUNCTION padmin.access_queue(p_account_id uuid)
RETURNS TABLE (id uuid, organization_name text, ticket_id uuid, subject text, requested_by text, account_id uuid, scope jsonb, reason text, duration_minutes integer, consented boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'access.approve');
  RETURN QUERY SELECT g.id, o.name, t.id, t.subject, a.display_name, g.account_id, g.scope, g.reason, g.duration_minutes, g.consented_by IS NOT NULL, g.created_at
  FROM platform.support_access_grants g JOIN core.organizations o ON o.id = g.organization_id JOIN platform.support_tickets t ON t.id = g.ticket_id
  JOIN platform.accounts a ON a.id = g.account_id WHERE g.status = 'pending' ORDER BY g.created_at;
END $$;

-- Platform approver decides. Approval needs the owner's consent first and a different account
-- from the requester; the window starts at approval. outcome: ok | not_found | not_pending | no_consent | self_approval
CREATE FUNCTION padmin.decide_access(p_account_id uuid, p_grant_id uuid, p_approve boolean, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g platform.support_access_grants%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'access.approve');
  SELECT * INTO g FROM platform.support_access_grants x WHERE x.id = p_grant_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN 'not_found'; END IF;
  IF g.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF g.account_id = p_account_id THEN RETURN 'self_approval'; END IF;
  IF p_approve AND g.consented_by IS NULL THEN RETURN 'no_consent'; END IF;
  IF p_approve THEN
    UPDATE platform.support_access_grants SET status = 'active', approved_by = p_account_id, approved_at = now(),
      valid_from = now(), valid_until = now() + make_interval(mins => duration_minutes) WHERE id = g.id;
  ELSE
    UPDATE platform.support_access_grants SET status = 'rejected', ended_at = now(), end_reason = nullif(trim(p_reason), '') WHERE id = g.id;
  END IF;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, request_id, support_grant_id)
    VALUES (p_account_id, g.organization_id, 'access.approve', CASE WHEN p_approve THEN 'support_access.approved' ELSE 'support_access.rejected' END,
      'support_grant', g.id, nullif(trim(p_reason), ''), p_request_id, g.id);
  RETURN 'ok';
END $$;

-- Read shop content through an active grant: only the requesting agent, only the consented scope,
-- only until it expires or is revoked. Every read is audited with the grant.
-- Returns NULL when the grant does not allow it.
CREATE FUNCTION padmin.support_read(p_account_id uuid, p_grant_id uuid, p_what text, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g platform.support_access_grants%ROWTYPE; v jsonb;
BEGIN
  PERFORM padmin.require(p_account_id, 'support.read');
  SELECT * INTO g FROM platform.support_access_grants x WHERE x.id = p_grant_id;
  IF g.id IS NULL OR g.account_id <> p_account_id OR g.status <> 'active' OR now() < g.valid_from OR now() >= g.valid_until OR NOT (g.scope ? p_what) THEN
    RETURN NULL;
  END IF;
  IF p_what = 'customers' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', padmin.mask_phone(c.phone_normalized),
        'locations', (SELECT jsonb_agg(jsonb_build_object('name', l.name, 'address', l.address, 'has_coordinates', l.latitude IS NOT NULL)) FROM core.customer_locations l
          WHERE l.organization_id = c.organization_id AND l.customer_id = c.id AND l.archived_at IS NULL))), '[]')
      INTO v FROM (SELECT * FROM core.customers c WHERE c.organization_id = g.organization_id AND c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 100) c;
  ELSIF p_what = 'equipment' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'category', e.equipment_type, 'brand', e.brand, 'model', e.model, 'serial_number', e.serial_number,
        'status', e.status, 'location', l.name)), '[]')
      INTO v FROM (SELECT * FROM core.equipment e WHERE e.organization_id = g.organization_id ORDER BY e.created_at DESC LIMIT 100) e
      JOIN core.customer_locations l ON l.organization_id = e.organization_id AND l.id = e.location_id;
  ELSIF p_what = 'jobs' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'type', j.job_type, 'status', j.status, 'scheduled_start', j.scheduled_start, 'location', l.name,
        'assignee', (SELECT u.display_name FROM core.organization_members m JOIN core.users u ON u.id = m.user_id WHERE m.organization_id = j.organization_id AND m.id = j.current_assignee_id))), '[]')
      INTO v FROM (SELECT * FROM core.jobs j WHERE j.organization_id = g.organization_id ORDER BY j.created_at DESC LIMIT 100) j
      JOIN core.customer_locations l ON l.organization_id = j.organization_id AND l.id = j.location_id;
  ELSIF p_what = 'service_history' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'occurred_at', se.occurred_at, 'service_type', i.service_type, 'outcome', i.outcome, 'equipment', e.name,
        'work_note', i.work_note, 'not_done_reason', i.not_done_reason)), '[]')
      INTO v FROM (SELECT * FROM core.service_event_equipment i WHERE i.organization_id = g.organization_id ORDER BY i.created_at DESC LIMIT 100) i
      JOIN core.service_events se ON se.organization_id = i.organization_id AND se.id = i.service_event_id
      JOIN core.equipment e ON e.organization_id = i.organization_id AND e.id = i.equipment_id;
  ELSE RETURN NULL;
  END IF;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id, support_grant_id)
    VALUES (p_account_id, g.organization_id, 'support.read', 'support.read', 'support_grant', g.id, jsonb_build_object('what', p_what, 'rows', jsonb_array_length(v)), p_request_id, g.id);
  RETURN jsonb_build_object('what', p_what, 'valid_until', g.valid_until, 'rows', v);
END $$;

CREATE FUNCTION padmin.audit(p_account_id uuid, p_organization_id uuid, p_action text, p_before timestamptz)
RETURNS TABLE (id uuid, created_at timestamptz, actor text, organization_name text, permission text, action text, target_type text, target_id uuid, reason text, details jsonb, support_grant_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'audit.read');
  RETURN QUERY SELECT l.id, l.created_at, a.display_name, o.name, l.permission, l.action, l.target_type, l.target_id, l.reason, l.details, l.support_grant_id
  FROM platform.audit_logs l LEFT JOIN platform.accounts a ON a.id = l.actor_account_id LEFT JOIN core.organizations o ON o.id = l.organization_id
  WHERE (p_organization_id IS NULL OR l.organization_id = p_organization_id) AND (coalesce(p_action, '') = '' OR l.action LIKE p_action || '%')
    AND (p_before IS NULL OR l.created_at < p_before)
  ORDER BY l.created_at DESC LIMIT 200;
END $$;

CREATE FUNCTION padmin.system_health(p_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'system.read');
  RETURN jsonb_build_object(
    'database_time', now(),
    'ocr', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) AS n FROM core.ocr_requests GROUP BY status) x),
    'ocr_oldest_queued', (SELECT min(created_at) FROM core.ocr_requests WHERE status = 'queued'),
    'deliveries', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) AS n FROM ops.notification_deliveries WHERE created_at > now() - interval '7 days' GROUP BY status) x),
    'uploads_pending', (SELECT count(*) FROM core.media_assets WHERE status = 'pending_upload' AND created_at < now() - interval '1 hour'),
    'reservations_open', (SELECT count(*) FROM billing.usage_reservations WHERE status = 'reserved'),
    'last_scan', (SELECT max(created_at) FROM core.notifications WHERE template_key LIKE 'maintenance_%' OR template_key IN ('trial_ending','renewal_due','payment_overdue')));
END $$;

CREATE FUNCTION padmin.data_requests(p_account_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, organization_name text, request_type text, status text, reason text, requested_by text, created_at timestamptz, decision_note text, completed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'data.manage');
  RETURN QUERY SELECT d.id, d.organization_id, o.name, d.request_type, d.status, d.reason, u.display_name, d.created_at, d.decision_note, d.completed_at
  FROM platform.data_requests d JOIN core.organizations o ON o.id = d.organization_id JOIN core.users u ON u.id = d.requested_by
  ORDER BY (d.status IN ('pending','approved','running')) DESC, d.created_at DESC LIMIT 200;
END $$;

-- Staff follow the runbook and record each step: pending → approved → running → succeeded,
-- or rejected/cancelled. outcome: ok | not_found | invalid_state
CREATE FUNCTION padmin.update_data_request(p_account_id uuid, p_request_id_row uuid, p_status text, p_note text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'data.manage');
  SELECT * INTO d FROM platform.data_requests x WHERE x.id = p_request_id_row FOR UPDATE;
  IF d.id IS NULL THEN RETURN 'not_found'; END IF;
  IF NOT ((d.status = 'pending' AND p_status IN ('approved','rejected')) OR (d.status = 'approved' AND p_status IN ('running','cancelled'))
       OR (d.status = 'running' AND p_status IN ('succeeded','cancelled'))) THEN RETURN 'invalid_state'; END IF;
  UPDATE platform.data_requests SET status = p_status, decided_by = p_account_id, decision_note = coalesce(nullif(trim(p_note), ''), decision_note),
    completed_at = CASE WHEN p_status IN ('succeeded','rejected','cancelled') THEN now() END WHERE id = d.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id)
    VALUES (p_account_id, d.organization_id, 'data.manage', 'data_request.' || p_status, 'data_request', d.id, nullif(trim(p_note), ''),
      jsonb_build_object('from', d.status, 'type', d.request_type), p_request_id);
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA padmin FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA padmin TO fs_platform;
