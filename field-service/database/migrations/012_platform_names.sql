-- C02 follow-up: people who never set a name show their phone number as display name. Platform
-- views must not reveal it, so names that look like phone numbers are masked like phones.
-- PostgreSQL 16 target. Apply as fs_migrator.

CREATE FUNCTION padmin.person_name(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN p ~ '^\+?[0-9 ()-]{8,}$' THEN padmin.mask_phone(regexp_replace(p, '[^0-9+]', '', 'g')) ELSE p END
$$;

CREATE OR REPLACE FUNCTION padmin.organizations(p_account_id uuid, p_query text, p_state text)
RETURNS TABLE (id uuid, name text, status text, created_at timestamptz, state text, plan_code text, period_end timestamptz,
  owner_name text, owner_phone text, active_technicians integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.read');
  RETURN QUERY
  SELECT o.id, o.name, o.status, o.created_at, e.state, e.plan_code, e.period_end, padmin.person_name(u.display_name), padmin.mask_phone(u.phone_e164),
    (SELECT count(*)::integer FROM core.organization_members m WHERE m.organization_id = o.id AND m.role = 'technician' AND m.status = 'active')
  FROM core.organizations o
  CROSS JOIN LATERAL billing.entitlement(o.id) e
  LEFT JOIN core.organization_members om ON om.organization_id = o.id AND om.role = 'owner' AND om.status = 'active'
  LEFT JOIN core.users u ON u.id = om.user_id
  WHERE (coalesce(p_query, '') = '' OR o.name ILIKE '%' || p_query || '%' OR o.id::text = p_query OR right(u.phone_e164, 4) = right(regexp_replace(p_query, '\D', '', 'g'), 4) AND length(regexp_replace(p_query, '\D', '', 'g')) >= 4)
    AND (coalesce(p_state, '') = '' OR e.state = p_state)
  ORDER BY o.created_at DESC LIMIT 200;
END $$;

CREATE OR REPLACE FUNCTION padmin.organization_detail(p_account_id uuid, p_organization_id uuid, p_request_id uuid) RETURNS jsonb
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
    'team', coalesce((SELECT jsonb_agg(jsonb_build_object('name', padmin.person_name(u.display_name), 'role', m.role, 'status', m.status, 'phone', padmin.mask_phone(u.phone_e164), 'joined_at', m.created_at)
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

CREATE OR REPLACE FUNCTION padmin.ticket_detail(p_account_id uuid, p_ticket_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'support.read');
  RETURN (SELECT jsonb_build_object(
    'ticket', jsonb_build_object('id', t.id, 'organization_id', t.organization_id, 'organization_name', o.name, 'subject', t.subject, 'status', t.status,
      'assigned_account_id', t.assigned_account_id, 'created_at', t.created_at, 'opened_by', padmin.person_name(u.display_name)),
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'internal', m.internal, 'created_at', m.created_at,
        'author', coalesce(a.display_name, padmin.person_name(mu.display_name)), 'from_platform', m.author_account_id IS NOT NULL) ORDER BY m.created_at)
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

CREATE OR REPLACE FUNCTION padmin.data_requests(p_account_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, organization_name text, request_type text, status text, reason text, requested_by text, created_at timestamptz, decision_note text, completed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'data.manage');
  RETURN QUERY SELECT d.id, d.organization_id, o.name, d.request_type, d.status, d.reason, padmin.person_name(u.display_name), d.created_at, d.decision_note, d.completed_at
  FROM platform.data_requests d JOIN core.organizations o ON o.id = d.organization_id JOIN core.users u ON u.id = d.requested_by
  ORDER BY (d.status IN ('pending','approved','running')) DESC, d.created_at DESC LIMIT 200;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA padmin FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA padmin TO fs_platform;
