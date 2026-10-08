-- Shop suspension rules (decided 2026-10-08):
-- - A platform suspension is temporary for 14 days. Stripe keeps charging during it.
-- - If the shop is not restored by then, it becomes permanent automatically; owners are warned
--   3 days and 1 day before. A permanent suspension cancels the live Stripe subscription.
-- - Only super_admin can restore a permanent suspension; the owner then subscribes again.
-- Status stays 'suspended' for both kinds, so every existing access check keeps working.

ALTER TABLE core.organizations
 ADD COLUMN suspension_kind text CHECK (suspension_kind IN ('temporary','permanent')),
 ADD COLUMN suspended_at timestamptz, ADD COLUMN suspended_until timestamptz,
 ADD CONSTRAINT suspension_fields CHECK (suspension_kind IS NULL OR status IN ('suspended','closed'));
-- Any write that suspends a shop without saying how starts the 14-day temporary suspension;
-- restoring clears it. A closed (erased) shop keeps the record of how it was suspended.
CREATE FUNCTION core.suspension_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.status='suspended' AND NEW.suspension_kind IS NULL THEN
    NEW.suspension_kind:='temporary'; NEW.suspended_at:=now(); NEW.suspended_until:=now()+interval '14 days';
  ELSIF NEW.status='active' THEN
    NEW.suspension_kind:=NULL; NEW.suspended_at:=NULL; NEW.suspended_until:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER suspension_defaults BEFORE INSERT OR UPDATE OF status, suspension_kind ON core.organizations
 FOR EACH ROW EXECUTE FUNCTION core.suspension_defaults();
-- Shops suspended before this rule start their 14 days now.
UPDATE core.organizations SET suspension_kind='temporary',suspended_at=now(),suspended_until=now()+interval '14 days' WHERE status='suspended';

ALTER TABLE billing.stripe_subscriptions ADD COLUMN canceled_by_platform boolean NOT NULL DEFAULT false;

-- outcome: ok | not_found | unchanged | super_admin_required
CREATE OR REPLACE FUNCTION padmin.set_organization_status(p_account_id uuid, p_organization_id uuid, p_status text, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE o core.organizations%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.suspend');
  IF p_status NOT IN ('active','suspended') THEN RETURN 'unchanged'; END IF;
  SELECT * INTO o FROM core.organizations WHERE id = p_organization_id FOR UPDATE;
  IF o.id IS NULL THEN RETURN 'not_found'; END IF;
  IF o.status = p_status OR o.status = 'closed' THEN RETURN 'unchanged'; END IF;
  IF p_status = 'active' AND o.suspension_kind = 'permanent' AND NOT padmin.is_super_admin(p_account_id) THEN RETURN 'super_admin_required'; END IF;
  IF p_status = 'suspended' THEN
    UPDATE core.organizations SET status='suspended',suspension_kind='temporary',suspended_at=now(),suspended_until=now()+interval '14 days' WHERE id=o.id;
  ELSE
    UPDATE core.organizations SET status='active',suspension_kind=NULL,suspended_at=NULL,suspended_until=NULL WHERE id=o.id;
  END IF;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id)
    VALUES (p_account_id, p_organization_id, 'shops.suspend', CASE WHEN p_status = 'suspended' THEN 'shop.suspended' ELSE 'shop.restored' END,
      'organization', p_organization_id, trim(p_reason),
      jsonb_build_object('from', o.status, 'to', p_status, 'kind', CASE WHEN p_status='suspended' THEN 'temporary' ELSE o.suspension_kind END), p_request_id);
  RETURN 'ok';
END $$;

-- Worker: warn owners 3 and 1 days before, then make expired temporary suspensions permanent.
-- One notice per suspension and milestone (event key carries the suspension start).
CREATE FUNCTION worker.scan_suspensions(p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o core.organizations%ROWTYPE; v_owner uuid; v_key text; v_template text; v_count integer := 0;
BEGIN
  FOR o IN SELECT * FROM core.organizations WHERE status='suspended' AND suspension_kind='temporary' AND suspended_until-p_at<=interval '3 days' FOR UPDATE SKIP LOCKED LOOP
    IF o.suspended_until<=p_at THEN
      UPDATE core.organizations SET suspension_kind='permanent',suspended_until=NULL WHERE id=o.id;
      INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
      VALUES(o.id,'shop.suspended_permanently','organization',o.id,jsonb_build_object('suspended_at',o.suspended_at,'temporary_until',o.suspended_until));
      v_key:='suspension_permanent:'||extract(epoch FROM o.suspended_at)::bigint; v_template:='suspension_permanent';
    ELSE
      v_key:='suspension_warning_'||CASE WHEN o.suspended_until-p_at<=interval '1 day' THEN 1 ELSE 3 END||':'||extract(epoch FROM o.suspended_at)::bigint;
      v_template:='suspension_warning';
    END IF;
    FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=o.id AND role='owner' AND status='active' LOOP
      IF core.notify(o.id,v_owner,v_key,v_template,jsonb_build_object('date',to_char(o.suspended_until AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),'support_ticket',NULL) IS NOT NULL THEN
        v_count:=v_count+1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_count;
END $$;

-- Live Stripe subscriptions of permanently suspended shops: the worker cancels them in Stripe.
CREATE FUNCTION worker.subscriptions_to_stop() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('subscription_id',ss.subscription_id,'credential_id',ss.credential_id)
 FROM billing.stripe_subscriptions ss JOIN core.organizations o ON o.id=ss.organization_id
 WHERE o.status='suspended' AND o.suspension_kind='permanent' AND ss.id=billing.live_subscription(ss.organization_id)
 LIMIT 50
$$;
CREATE FUNCTION worker.platform_canceling_subscription(p_sub text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 UPDATE billing.stripe_subscriptions SET canceled_by_platform=true,updated_at=now() WHERE subscription_id=p_sub
$$;

-- No "automatic renewal stopped" notice when the owner or the platform stopped it on purpose.
CREATE OR REPLACE FUNCTION worker.sync_subscription(p_sub text,p_status text,p_cancel boolean,p_period_end timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE; v_owner uuid; v_was_live boolean;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE subscription_id=p_sub FOR UPDATE;
 IF ss.id IS NULL THEN RETURN 'not_found'; END IF;
 v_was_live := ss.status IN ('trialing','active','past_due','unpaid','incomplete','paused');
 UPDATE billing.stripe_subscriptions SET status=p_status,cancel_at_period_end=coalesce(p_cancel,cancel_at_period_end),
   current_period_end=coalesce(p_period_end,current_period_end),updated_at=now() WHERE id=ss.id;
 IF v_was_live AND p_status IN ('canceled','incomplete_expired') AND NOT ss.canceled_by_owner AND NOT ss.canceled_by_platform THEN
   FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=ss.organization_id AND role='owner' AND status='active' LOOP
     PERFORM core.notify(ss.organization_id,v_owner,'autopay_stopped:'||ss.id,'autopay_stopped','{}'::jsonb,'subscription',NULL);
   END LOOP;
 END IF;
 RETURN 'ok';
END $$;

-- Owners see when a temporary suspension becomes permanent.
DROP FUNCTION auth.user_memberships(uuid);
CREATE FUNCTION auth.user_memberships(p_user_id uuid)
RETURNS TABLE (member_id uuid, organization_id uuid, organization_name text, organization_status text,
  role text, status text, display_name text, version integer, suspension_kind text, suspended_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, o.id,
    CASE WHEN m.status IN ('active','pending') THEN o.name END,
    o.status, m.role, m.status, m.display_name, m.version,
    CASE WHEN m.status = 'active' THEN o.suspension_kind END, CASE WHEN m.status = 'active' THEN o.suspended_until END
  FROM core.organization_members m JOIN core.organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id AND m.status <> 'removed'
  ORDER BY m.created_at
$$;
REVOKE ALL ON FUNCTION auth.user_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.user_memberships(uuid) TO fs_api;

-- Console: suspension details on the shop page; Stripe subscription payments needing review in the queue.
CREATE OR REPLACE FUNCTION padmin.organization_detail(p_account_id uuid, p_organization_id uuid, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb; e record;
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.read');
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  SELECT jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status, 'timezone', o.timezone, 'default_language', o.default_language, 'created_at', o.created_at,
      'suspension_kind', o.suspension_kind, 'suspended_at', o.suspended_at, 'suspended_until', o.suspended_until),
    'entitlement', to_jsonb(e),
    'stripe_subscription', (SELECT jsonb_build_object('status', ss.status, 'cancel_at_period_end', ss.cancel_at_period_end, 'current_period_end', ss.current_period_end, 'subscription_id', ss.subscription_id)
      FROM billing.stripe_subscriptions ss WHERE ss.organization_id = o.id ORDER BY ss.created_at DESC LIMIT 1),
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

CREATE OR REPLACE FUNCTION padmin.payment_queue(p_account_id uuid,p_status text,p_offset integer)
RETURNS TABLE (invoice_id uuid,number text,organization_id uuid,organization_name text,amount_minor bigint,status text,plan_name_th text,plan_name_en text,
 created_at timestamptz,proof_id uuid,proof_status text,proof_submitted_at timestamptz,proof_reason text,paid_at timestamptz,bank_reference text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_account_id,'billing.read');
 RETURN QUERY
 SELECT i.id,i.number,i.organization_id,o.name,i.amount_minor,i.status,i.plan_snapshot->>'name_th',i.plan_snapshot->>'name_en',i.created_at,
  pp.id,pp.status,pp.created_at,pp.reason,i.paid_at,pay.bank_reference
 FROM billing.invoices i JOIN core.organizations o ON o.id=i.organization_id
 LEFT JOIN LATERAL (SELECT * FROM billing.payment_proofs x WHERE x.organization_id=i.organization_id AND x.invoice_id=i.id ORDER BY x.created_at DESC LIMIT 1) pp ON true
 LEFT JOIN billing.payments pay ON pay.organization_id=i.organization_id AND pay.invoice_id=i.id
 WHERE (p_status='pending' AND ((i.status='open' AND pp.status='pending') OR EXISTS(SELECT 1 FROM billing.stripe_checkouts sc WHERE sc.invoice_id=i.id AND sc.status='manual_review')
    OR EXISTS(SELECT 1 FROM billing.stripe_subscription_invoices sx WHERE sx.invoice_id=i.id AND sx.status='manual_review')))
  OR (p_status='open' AND i.status='open') OR (p_status='paid' AND i.status='paid') OR (p_status='all')
 ORDER BY CASE WHEN pp.status='pending' THEN pp.created_at END NULLS LAST,i.created_at DESC,i.id
 LIMIT 51 OFFSET greatest(p_offset,0);
END $$;

-- Invoice detail also lists Stripe subscription payments (incl. ones needing review).
CREATE OR REPLACE FUNCTION padmin.invoice_detail(p_account_id uuid, p_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  SELECT jsonb_build_object(
    'invoice', to_jsonb(i) - 'buyer_snapshot' || jsonb_build_object('organization_name', o.name, 'buyer', i.buyer_snapshot),
    'proofs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pp.id, 'status', pp.status, 'reason', pp.reason, 'created_at', pp.created_at,
        'reviewed_at', pp.reviewed_at, 'size_bytes', pp.size_bytes, 'verification_code', pp.verification_code, 'verification_at', pp.verification_at) ORDER BY pp.created_at DESC)
      FROM billing.payment_proofs pp WHERE pp.organization_id = i.organization_id AND pp.invoice_id = i.id), '[]'),
    'payment', (SELECT jsonb_build_object('id', p.id, 'amount_minor', p.amount_minor, 'bank_reference', p.bank_reference, 'received_at', p.received_at,
        'verified_at', p.verified_at, 'verified_by', coalesce(a.display_name, CASE WHEN p.verification_source='stripe' THEN 'Stripe' ELSE 'EasySlip' END), 'verification_source', p.verification_source, 'note', p.note,
        'refunded_minor', coalesce((SELECT sum(r.amount_minor) FROM billing.refunds r WHERE r.organization_id = p.organization_id AND r.payment_id = p.id AND r.status = 'succeeded'), 0))
      FROM billing.payments p LEFT JOIN platform.accounts a ON a.id = p.verified_by WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id),
    'checkouts',coalesce((SELECT jsonb_agg(to_jsonb(sc)-'credential_id'-'checkout_url'-'request_key') FROM billing.stripe_checkouts sc WHERE sc.invoice_id=i.id),'[]'),
    'subscription_payments',coalesce((SELECT jsonb_agg(jsonb_build_object('stripe_invoice_id',sx.stripe_invoice_id,'amount_minor',sx.amount_minor,'status',sx.status,'reason',sx.reason,'created_at',sx.created_at) ORDER BY sx.created_at)
      FROM billing.stripe_subscription_invoices sx WHERE sx.invoice_id=i.id),'[]'),
    'refunds', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'amount_minor', r.amount_minor, 'status', r.status, 'reason', r.reason,
        'requested_by', ra.display_name, 'requested_by_id', r.requested_by, 'approved_by', aa.display_name, 'bank_reference', r.bank_reference,
        'decision_reason', r.decision_reason, 'created_at', r.created_at) ORDER BY r.created_at)
      FROM billing.payments p JOIN billing.refunds r ON r.organization_id = p.organization_id AND r.payment_id = p.id
      JOIN platform.accounts ra ON ra.id = r.requested_by LEFT JOIN platform.accounts aa ON aa.id = r.approved_by
      WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id), '[]'),
    'period', (SELECT jsonb_build_object('start_at', sp.start_at, 'end_at', sp.end_at) FROM billing.subscription_periods sp
      WHERE sp.organization_id = i.organization_id AND sp.invoice_id = i.id))
  INTO v FROM billing.invoices i JOIN core.organizations o ON o.id = i.organization_id WHERE i.id = p_invoice_id;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION worker.scan_suspensions(timestamptz), worker.subscriptions_to_stop(), worker.platform_canceling_subscription(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.scan_suspensions(timestamptz), worker.subscriptions_to_stop(), worker.platform_canceling_subscription(text) TO fs_worker;
