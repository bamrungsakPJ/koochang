-- A03 subscription rules: trial, periods with plan/price snapshots, grace, grants, effective
-- entitlement from server time, seat limit from the plan, usage reservations.
-- PostgreSQL 16 target. Apply as fs_migrator.
--
-- Entitlement is computed from periods and grants at the moment of each request;
-- billing.subscriptions.status is only a cache for listing. Paid periods are created by
-- billing.apply_paid_period, which only the platform/worker side may call (no grant to fs_api).

CREATE POLICY entitlement_functions ON billing.subscription_periods TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY entitlement_functions_write ON billing.subscriptions TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY entitlement_functions ON billing.entitlement_grants TO fs_migrator USING (true);
CREATE POLICY entitlement_functions ON billing.usage_counters TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY entitlement_functions ON billing.usage_reservations TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY entitlement_functions ON billing.invoices TO fs_migrator USING (true);

-- catalog ----------------------------------------------------------------------------------
-- The trial is a plan of kind 'trial' (price 0) so a trial period has the same snapshot shape.
ALTER TABLE billing.plans ADD COLUMN kind text NOT NULL DEFAULT 'paid' CHECK (kind IN ('trial','paid'));
CREATE UNIQUE INDEX one_active_trial_plan ON billing.plans(kind) WHERE kind = 'trial' AND status = 'active';

-- subscriptions ----------------------------------------------------------------------------
ALTER TABLE billing.subscriptions
  ADD COLUMN trial_consumed_at timestamptz,
  ADD COLUMN billing_anchor_at timestamptz,
  ADD COLUMN current_period_id uuid;

-- periods: one row per trial / paid / complimentary period with what was sold at that time.
ALTER TABLE billing.subscription_periods
  ADD COLUMN source text NOT NULL DEFAULT 'paid' CHECK (source IN ('trial','paid','complimentary')),
  ADD COLUMN plan_version_id uuid NOT NULL REFERENCES billing.plan_versions(id),
  ADD COLUMN plan_snapshot jsonb NOT NULL,
  ADD COLUMN price_snapshot jsonb NOT NULL,
  ADD CONSTRAINT periods_paid_has_invoice CHECK (source <> 'paid' OR invoice_id IS NOT NULL);
ALTER TABLE billing.subscriptions ADD FOREIGN KEY (organization_id, current_period_id) REFERENCES billing.subscription_periods(organization_id, id);
CREATE UNIQUE INDEX one_trial_period ON billing.subscription_periods(organization_id) WHERE source = 'trial';
CREATE INDEX periods_by_time ON billing.subscription_periods(organization_id, start_at, end_at);

-- snapshot of a plan version + price version, frozen into each period.
CREATE FUNCTION billing.snapshot(p_price_version_id uuid)
RETURNS TABLE (plan_version_id uuid, plan_snapshot jsonb, price_snapshot jsonb, interval_unit text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT pv.id,
    jsonb_build_object('plan_code', p.code, 'plan_kind', p.kind, 'name_th', p.name_th, 'name_en', p.name_en,
      'plan_version_id', pv.id, 'version_no', pv.version_no, 'technician_seats', pv.technician_seats,
      'storage_bytes', pv.storage_bytes, 'ocr_per_period', pv.ocr_per_period, 'trial_days', pv.trial_days, 'grace_days', pv.grace_days),
    jsonb_build_object('price_version_id', pr.id, 'amount_minor', pr.amount_minor, 'currency', pr.currency, 'interval_unit', pr.interval_unit),
    pr.interval_unit
  FROM billing.price_versions pr
  JOIN billing.plan_versions pv ON pv.id = pr.plan_version_id
  JOIN billing.plans p ON p.id = pv.plan_id
  WHERE pr.id = p_price_version_id
$$;

-- trial ------------------------------------------------------------------------------------
-- Starts the one trial a shop ever gets. Called by a trigger when the shop is created, so
-- resetting a join link, changing owner or any other path cannot start a second trial.
-- Without a published active trial plan the shop starts in pending_payment.
CREATE FUNCTION billing.start_trial(p_organization_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_price uuid; s record; v_sub uuid; v_period uuid; v_now timestamptz := now();
BEGIN
  IF EXISTS (SELECT 1 FROM billing.subscriptions WHERE organization_id = p_organization_id) THEN RETURN NULL; END IF;
  SELECT pr.id INTO v_price FROM billing.plans p
    JOIN billing.plan_versions pv ON pv.plan_id = p.id AND pv.published_at <= v_now
    JOIN billing.price_versions pr ON pr.plan_version_id = pv.id AND pr.effective_from <= v_now
  WHERE p.kind = 'trial' AND p.status = 'active'
  ORDER BY pv.version_no DESC, pr.effective_from DESC LIMIT 1;
  IF v_price IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM billing.snapshot(v_price);

  INSERT INTO billing.subscriptions(organization_id, plan_version_id, price_version_id, status, trial_started_at, trial_end_at, trial_consumed_at)
    VALUES (p_organization_id, s.plan_version_id, v_price, 'trialing', v_now,
      v_now + make_interval(days => (s.plan_snapshot->>'trial_days')::integer), v_now)
    RETURNING id INTO v_sub;
  INSERT INTO billing.subscription_periods(organization_id, subscription_id, start_at, end_at, source, plan_version_id, plan_snapshot, price_snapshot)
    VALUES (p_organization_id, v_sub, v_now, v_now + make_interval(days => (s.plan_snapshot->>'trial_days')::integer),
      'trial', s.plan_version_id, s.plan_snapshot, s.price_snapshot)
    RETURNING id INTO v_period;
  UPDATE billing.subscriptions SET current_period_id = v_period WHERE id = v_sub;
  RETURN v_sub;
END $$;

CREATE FUNCTION billing.start_trial_on_create() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN PERFORM billing.start_trial(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER start_trial AFTER INSERT ON core.organizations FOR EACH ROW EXECUTE FUNCTION billing.start_trial_on_create();

-- effective entitlement ----------------------------------------------------------------------
-- state: trialing | active | past_due | expired | ended | pending_payment | suspended
-- writable: business mutations allowed (trialing, active, past_due within grace, active grant).
-- Security suspension of the shop wins over every period and grant.
CREATE FUNCTION billing.entitlement(p_organization_id uuid, p_at timestamptz DEFAULT now())
RETURNS TABLE (state text, writable boolean, source text, plan_code text, name_th text, name_en text,
  technician_seats integer, storage_bytes bigint, ocr_per_period integer,
  period_id uuid, period_start timestamptz, period_end timestamptz, grace_until timestamptz, cancel_at_period_end boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_org_status text; sub billing.subscriptions%ROWTYPE; cur billing.subscription_periods%ROWTYPE; last billing.subscription_periods%ROWTYPE;
  v_state text; v_source text; snap jsonb; v_grace timestamptz; g jsonb;
BEGIN
  SELECT o.status INTO v_org_status FROM core.organizations o WHERE o.id = p_organization_id;
  IF v_org_status IS DISTINCT FROM 'active' THEN
    RETURN QUERY SELECT 'suspended'::text, false, NULL::text, NULL::text, NULL::text, NULL::text, 0, 0::bigint, 0,
      NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;
  SELECT * INTO sub FROM billing.subscriptions s WHERE s.organization_id = p_organization_id;
  IF sub.id IS NOT NULL THEN
    -- A paid period wins over a trial that still covers the same moment.
    SELECT * INTO cur FROM billing.subscription_periods sp WHERE sp.organization_id = p_organization_id
      AND sp.start_at <= p_at AND p_at < sp.end_at ORDER BY (sp.source = 'trial'), sp.start_at DESC LIMIT 1;
    IF cur.id IS NOT NULL THEN
      v_state := CASE WHEN cur.source = 'trial' THEN 'trialing' ELSE 'active' END; v_source := cur.source; snap := cur.plan_snapshot;
    ELSE
      SELECT * INTO last FROM billing.subscription_periods sp WHERE sp.organization_id = p_organization_id
        AND sp.end_at <= p_at ORDER BY sp.end_at DESC LIMIT 1;
      IF last.id IS NULL THEN v_state := 'pending_payment';
      ELSIF last.source = 'trial' THEN v_state := 'expired'; cur := last;
      ELSIF sub.cancel_at_period_end THEN v_state := 'ended'; cur := last;
      ELSE
        v_grace := last.end_at + make_interval(days => coalesce((last.plan_snapshot->>'grace_days')::integer, 0));
        cur := last;
        IF p_at < v_grace THEN v_state := 'past_due'; v_source := last.source; snap := last.plan_snapshot;
        ELSE v_state := 'expired'; END IF;
      END IF;
    END IF;
  ELSE
    v_state := 'pending_payment';
  END IF;

  -- Active grants raise limits; a grant also keeps a shop working without a valid period
  -- (e.g. pilot extension after the trial). Values never lower what the period gives.
  SELECT jsonb_object_agg(k, v) INTO g FROM (
    SELECT e.key AS k, max((e.value #>> '{}')::bigint) AS v
    FROM billing.entitlement_grants eg, jsonb_each(eg.entitlements) e
    WHERE eg.organization_id = p_organization_id AND eg.valid_from <= p_at AND p_at < eg.valid_until
      AND e.key IN ('technician_seats','storage_bytes','ocr_per_period') AND jsonb_typeof(e.value) = 'number'
    GROUP BY e.key) x;
  IF g IS NOT NULL AND v_state NOT IN ('trialing','active','past_due') THEN
    v_state := 'active'; v_source := 'grant'; snap := coalesce(snap, '{}'::jsonb);
  END IF;

  RETURN QUERY SELECT v_state, v_state IN ('trialing','active','past_due'), v_source,
    coalesce(snap, cur.plan_snapshot)->>'plan_code', coalesce(snap, cur.plan_snapshot)->>'name_th', coalesce(snap, cur.plan_snapshot)->>'name_en',
    CASE WHEN v_state IN ('trialing','active','past_due') THEN greatest(coalesce((snap->>'technician_seats')::integer, 0), coalesce((g->>'technician_seats')::integer, 0)) ELSE 0 END,
    CASE WHEN v_state IN ('trialing','active','past_due') THEN greatest(coalesce((snap->>'storage_bytes')::bigint, 0), coalesce((g->>'storage_bytes')::bigint, 0)) ELSE 0::bigint END,
    CASE WHEN v_state IN ('trialing','active','past_due') THEN greatest(coalesce((snap->>'ocr_per_period')::integer, 0), coalesce((g->>'ocr_per_period')::integer, 0)) ELSE 0 END,
    cur.id, cur.start_at, cur.end_at, v_grace, coalesce(sub.cancel_at_period_end, false);
END $$;

-- Seat limit now comes from the effective entitlement (replaces the A02 trial fallback).
CREATE OR REPLACE FUNCTION auth.technician_seat_limit(p_organization_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT e.technician_seats FROM billing.entitlement(p_organization_id) e
$$;

-- Same as A02 plus: approving or reactivating needs a writable subscription.
-- outcome adds: subscription_inactive
CREATE OR REPLACE FUNCTION auth.change_member_status(p_user_id uuid, p_organization_id uuid, p_member_id uuid,
  p_action text, p_expected_version integer, p_reason text, p_request_id uuid)
RETURNS TABLE (outcome text, member_id uuid, status text, version integer, active_technicians integer, seat_limit integer, open_jobs integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid; m core.organization_members%ROWTYPE; v_to text; v_active integer; v_limit integer; v_open integer; v_writable boolean;
BEGIN
  v_owner := auth.owner_member_id(p_user_id, p_organization_id);
  IF v_owner IS NULL THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer; RETURN;
  END IF;
  PERFORM 1 FROM core.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  SELECT * INTO m FROM core.organization_members om WHERE om.id = p_member_id AND om.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR m.role <> 'technician' OR (m.status = 'removed' AND p_action <> 'remove') THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer; RETURN;
  END IF;

  SELECT count(*)::integer INTO v_active FROM core.organization_members om
    WHERE om.organization_id = p_organization_id AND om.role = 'technician' AND om.status = 'active';
  SELECT e.technician_seats, e.writable INTO v_limit, v_writable FROM billing.entitlement(p_organization_id) e;
  SELECT count(*)::integer INTO v_open FROM core.jobs j WHERE j.organization_id = p_organization_id
    AND j.current_assignee_id = m.id AND j.status IN ('scheduled','in_progress');

  v_to := CASE p_action WHEN 'approve' THEN 'active' WHEN 'reactivate' THEN 'active' WHEN 'reject' THEN 'rejected'
    WHEN 'suspend' THEN 'suspended' WHEN 'remove' THEN 'removed' END;
  IF m.status = v_to THEN
    RETURN QUERY SELECT 'ok'::text, m.id, m.status, m.version, v_active, v_limit, v_open; RETURN;
  END IF;
  IF p_expected_version IS NULL OR m.version <> p_expected_version THEN
    RETURN QUERY SELECT 'version_conflict'::text, m.id, m.status, m.version, v_active, v_limit, v_open; RETURN;
  END IF;
  v_to := CASE
    WHEN p_action = 'approve' AND m.status = 'pending' THEN 'active'
    WHEN p_action = 'reject' AND m.status = 'pending' THEN 'rejected'
    WHEN p_action = 'suspend' AND m.status = 'active' THEN 'suspended'
    WHEN p_action = 'reactivate' AND m.status = 'suspended' THEN 'active'
    WHEN p_action = 'remove' AND m.status IN ('active','suspended','pending','rejected') THEN 'removed'
  END;
  IF v_to IS NULL THEN
    RETURN QUERY SELECT 'invalid_transition'::text, m.id, m.status, m.version, v_active, v_limit, v_open; RETURN;
  END IF;
  IF v_to = 'active' AND NOT coalesce(v_writable, false) THEN
    RETURN QUERY SELECT 'subscription_inactive'::text, m.id, m.status, m.version, v_active, v_limit, v_open; RETURN;
  END IF;
  IF v_to = 'active' AND v_active >= v_limit THEN
    RETURN QUERY SELECT 'seat_limit_reached'::text, m.id, m.status, m.version, v_active, v_limit, v_open; RETURN;
  END IF;

  UPDATE core.organization_members om SET
    status = v_to, status_changed_at = now(),
    approved_at = CASE WHEN v_to = 'active' THEN now() ELSE om.approved_at END,
    approved_by_member_id = CASE WHEN v_to = 'active' THEN v_owner ELSE om.approved_by_member_id END,
    removed_at = CASE WHEN v_to = 'removed' THEN now() ELSE NULL END
  WHERE om.id = m.id RETURNING * INTO m;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, reason, request_id, details)
    VALUES (p_organization_id, p_user_id, 'member.' || p_action, 'organization_member', m.id,
      nullif(trim(coalesce(p_reason, '')), ''), p_request_id, jsonb_build_object('open_jobs', v_open));
  SELECT count(*)::integer INTO v_active FROM core.organization_members om
    WHERE om.organization_id = p_organization_id AND om.role = 'technician' AND om.status = 'active';
  RETURN QUERY SELECT 'ok'::text, m.id, m.status, m.version, v_active, v_limit, v_open;
END $$;

-- paid periods (platform/worker only) --------------------------------------------------------
-- Monthly periods follow an anchor in Asia/Bangkok: the n-th end is anchor + n months, so a
-- 31st anchor gives the last day of shorter months and returns to the 31st when it exists.
CREATE FUNCTION billing.period_end_after(p_anchor timestamptz, p_after timestamptz, p_interval text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE step integer := CASE WHEN p_interval = 'year' THEN 12 ELSE 1 END; k integer; v_end timestamptz;
BEGIN
  k := greatest(1, ((extract(year FROM age(p_after AT TIME ZONE 'Asia/Bangkok', p_anchor AT TIME ZONE 'Asia/Bangkok')) * 12
    + extract(month FROM age(p_after AT TIME ZONE 'Asia/Bangkok', p_anchor AT TIME ZONE 'Asia/Bangkok')))::integer / step) * step);
  LOOP
    v_end := ((p_anchor AT TIME ZONE 'Asia/Bangkok') + make_interval(months => k)) AT TIME ZONE 'Asia/Bangkok';
    EXIT WHEN v_end > p_after;
    k := k + step;
  END LOOP;
  RETURN v_end;
END $$;

-- Creates the paid period for a verified invoice. Retrying with the same invoice returns the
-- same period. Renewal before expiry or within grace continues from the end of the latest paid
-- period (renewals never overlap); after grace the new period starts when payment was confirmed.
-- outcome: created | existing | not_found
CREATE FUNCTION billing.apply_paid_period(p_organization_id uuid, p_invoice_id uuid, p_price_version_id uuid, p_confirmed_at timestamptz)
RETURNS TABLE (outcome text, period_id uuid, start_at timestamptz, end_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sub billing.subscriptions%ROWTYPE; s record; existing billing.subscription_periods%ROWTYPE; last billing.subscription_periods%ROWTYPE;
  v_start timestamptz; v_end timestamptz; v_anchor timestamptz; v_period uuid;
BEGIN
  SELECT * INTO sub FROM billing.subscriptions WHERE organization_id = p_organization_id FOR UPDATE;
  SELECT * INTO s FROM billing.snapshot(p_price_version_id);
  IF s.plan_version_id IS NULL OR NOT EXISTS (SELECT 1 FROM billing.invoices i WHERE i.organization_id = p_organization_id AND i.id = p_invoice_id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz; RETURN;
  END IF;
  SELECT * INTO existing FROM billing.subscription_periods sp WHERE sp.organization_id = p_organization_id AND sp.invoice_id = p_invoice_id;
  IF existing.id IS NOT NULL THEN
    RETURN QUERY SELECT 'existing'::text, existing.id, existing.start_at, existing.end_at; RETURN;
  END IF;

  SELECT * INTO last FROM billing.subscription_periods sp WHERE sp.organization_id = p_organization_id AND sp.source = 'paid'
    ORDER BY sp.end_at DESC LIMIT 1;
  IF last.id IS NOT NULL AND p_confirmed_at < last.end_at + make_interval(days => coalesce((last.plan_snapshot->>'grace_days')::integer, 0)) THEN
    v_start := last.end_at; v_anchor := coalesce(sub.billing_anchor_at, last.start_at);
  ELSE
    v_start := p_confirmed_at; v_anchor := p_confirmed_at;
  END IF;
  v_end := billing.period_end_after(v_anchor, v_start, s.interval_unit);

  IF sub.id IS NULL THEN
    INSERT INTO billing.subscriptions(organization_id, plan_version_id, price_version_id, status)
      VALUES (p_organization_id, s.plan_version_id, p_price_version_id, 'active') RETURNING * INTO sub;
  END IF;
  INSERT INTO billing.subscription_periods(organization_id, subscription_id, invoice_id, start_at, end_at, source, plan_version_id, plan_snapshot, price_snapshot)
    VALUES (p_organization_id, sub.id, p_invoice_id, v_start, v_end, 'paid', s.plan_version_id, s.plan_snapshot, s.price_snapshot)
    RETURNING id INTO v_period;
  UPDATE billing.subscriptions SET plan_version_id = s.plan_version_id, price_version_id = p_price_version_id,
    billing_anchor_at = v_anchor, status = CASE WHEN v_start <= now() THEN 'active' ELSE status END,
    current_period_id = CASE WHEN v_start <= now() THEN v_period ELSE current_period_id END, cancel_at_period_end = false
  WHERE id = sub.id;
  RETURN QUERY SELECT 'created'::text, v_period, v_start, v_end;
END $$;

-- usage reservations -------------------------------------------------------------------------
-- Storage is counted for the shop's lifetime ('all'); OCR per period (window = period id).
CREATE FUNCTION billing.usage_window(p_metric text, p_period_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_metric = 'storage_bytes' THEN 'all' ELSE coalesce(p_period_id::text, 'none') END $$;

-- Reserve before an upload or OCR request; used + live reservations + request must fit the
-- limit, checked under the shop lock. The same request key returns the same reservation.
-- outcome: reserved | existing | limit_reached | inactive | forbidden
CREATE FUNCTION auth.reserve_usage(p_user_id uuid, p_organization_id uuid, p_metric text, p_request_key uuid, p_units bigint, p_ttl_seconds integer)
RETURNS TABLE (outcome text, reservation_id uuid, used bigint, reserved bigint, quota bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE e record; v_window text; v_used bigint; v_reserved bigint; v_limit bigint; r billing.usage_reservations%ROWTYPE;
BEGIN
  IF p_metric NOT IN ('storage_bytes','ocr') OR p_units <= 0 OR p_ttl_seconds NOT BETWEEN 30 AND 86400 THEN
    RAISE EXCEPTION 'USAGE_REQUEST_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.organization_members m JOIN core.users u ON u.id = m.user_id
      WHERE m.organization_id = p_organization_id AND m.user_id = p_user_id AND m.status = 'active' AND u.status = 'active') THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::bigint, NULL::bigint, NULL::bigint; RETURN;
  END IF;
  PERFORM 1 FROM core.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  SELECT * INTO r FROM billing.usage_reservations ur WHERE ur.organization_id = p_organization_id AND ur.metric = p_metric AND ur.request_key = p_request_key;
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  v_window := billing.usage_window(p_metric, e.period_id);
  v_limit := CASE WHEN p_metric = 'storage_bytes' THEN e.storage_bytes ELSE e.ocr_per_period END;
  SELECT coalesce((SELECT uc.used FROM billing.usage_counters uc WHERE uc.organization_id = p_organization_id AND uc.metric = p_metric AND uc.window_key = v_window), 0) INTO v_used;
  SELECT coalesce(sum(ur.units), 0) INTO v_reserved FROM billing.usage_reservations ur
    WHERE ur.organization_id = p_organization_id AND ur.metric = p_metric AND ur.status = 'reserved' AND ur.expires_at > now();
  IF r.id IS NOT NULL THEN
    RETURN QUERY SELECT 'existing'::text, r.id, v_used, v_reserved, v_limit; RETURN;
  END IF;
  IF NOT e.writable THEN
    RETURN QUERY SELECT 'inactive'::text, NULL::uuid, v_used, v_reserved, v_limit; RETURN;
  END IF;
  IF v_used + v_reserved + p_units > v_limit THEN
    RETURN QUERY SELECT 'limit_reached'::text, NULL::uuid, v_used, v_reserved, v_limit; RETURN;
  END IF;
  INSERT INTO billing.usage_reservations(organization_id, metric, request_key, units, expires_at)
    VALUES (p_organization_id, p_metric, p_request_key, p_units, now() + make_interval(secs => p_ttl_seconds))
    RETURNING * INTO r;
  RETURN QUERY SELECT 'reserved'::text, r.id, v_used, v_reserved + p_units, v_limit;
END $$;

-- Finish a reservation once: consume adds it to the counter, release returns it.
-- outcome: consumed | released | already_consumed | already_released | expired | not_found
CREATE FUNCTION auth.settle_usage(p_organization_id uuid, p_metric text, p_request_key uuid, p_consume boolean)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.usage_reservations%ROWTYPE; e record; v_window text;
BEGIN
  SELECT * INTO r FROM billing.usage_reservations ur WHERE ur.organization_id = p_organization_id AND ur.metric = p_metric AND ur.request_key = p_request_key FOR UPDATE;
  IF r.id IS NULL THEN RETURN QUERY SELECT 'not_found'::text; RETURN; END IF;
  IF r.status = 'consumed' THEN RETURN QUERY SELECT 'already_consumed'::text; RETURN; END IF;
  IF r.status IN ('released','expired') THEN RETURN QUERY SELECT 'already_released'::text; RETURN; END IF;
  IF NOT p_consume THEN
    UPDATE billing.usage_reservations SET status = 'released' WHERE id = r.id;
    RETURN QUERY SELECT 'released'::text; RETURN;
  END IF;
  IF r.expires_at <= now() THEN
    UPDATE billing.usage_reservations SET status = 'expired' WHERE id = r.id;
    RETURN QUERY SELECT 'expired'::text; RETURN;
  END IF;
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  v_window := billing.usage_window(p_metric, e.period_id);
  INSERT INTO billing.usage_counters(organization_id, metric, window_key, used) VALUES (p_organization_id, p_metric, v_window, r.units)
    ON CONFLICT ON CONSTRAINT usage_counters_organization_id_metric_window_key_key DO UPDATE SET used = billing.usage_counters.used + EXCLUDED.used;
  UPDATE billing.usage_reservations SET status = 'consumed' WHERE id = r.id;
  RETURN QUERY SELECT 'consumed'::text;
END $$;

-- owner / member views -----------------------------------------------------------------------
-- Owners see the plan, period and limits; technicians only whether work can be saved.
CREATE FUNCTION auth.subscription_summary(p_user_id uuid, p_organization_id uuid)
RETURNS TABLE (role text, state text, writable boolean, source text, plan_code text, name_th text, name_en text,
  technician_seats integer, storage_bytes bigint, ocr_per_period integer, period_end timestamptz, grace_until timestamptz,
  cancel_at_period_end boolean, active_technicians integer, storage_used bigint, ocr_used bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_role text; e record;
BEGIN
  SELECT m.role INTO v_role FROM core.organization_members m JOIN core.users u ON u.id = m.user_id
    WHERE m.organization_id = p_organization_id AND m.user_id = p_user_id AND m.status = 'active' AND u.status = 'active';
  IF v_role IS NULL THEN RETURN; END IF;
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  IF v_role <> 'owner' THEN
    RETURN QUERY SELECT v_role, e.state, e.writable, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::bigint, NULL::integer,
      NULL::timestamptz, NULL::timestamptz, NULL::boolean, NULL::integer, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  RETURN QUERY SELECT v_role, e.state, e.writable, e.source, e.plan_code, e.name_th, e.name_en, e.technician_seats, e.storage_bytes, e.ocr_per_period,
    e.period_end, e.grace_until, e.cancel_at_period_end,
    (SELECT count(*)::integer FROM core.organization_members m WHERE m.organization_id = p_organization_id AND m.role = 'technician' AND m.status = 'active'),
    coalesce((SELECT uc.used FROM billing.usage_counters uc WHERE uc.organization_id = p_organization_id AND uc.metric = 'storage_bytes' AND uc.window_key = 'all'), 0),
    coalesce((SELECT uc.used FROM billing.usage_counters uc WHERE uc.organization_id = p_organization_id AND uc.metric = 'ocr' AND uc.window_key = billing.usage_window('ocr', e.period_id)), 0);
END $$;

-- Owner stops or resumes renewal at the end of the paid period. A cancelled subscription ends
-- without grace. outcome: ok | forbidden | not_found
CREATE FUNCTION auth.set_cancel_at_period_end(p_user_id uuid, p_organization_id uuid, p_cancel boolean, p_request_id uuid)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.owner_member_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text; RETURN; END IF;
  UPDATE billing.subscriptions SET cancel_at_period_end = p_cancel WHERE organization_id = p_organization_id;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text; RETURN; END IF;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, request_id)
    VALUES (p_organization_id, p_user_id, CASE WHEN p_cancel THEN 'subscription.cancel_renewal' ELSE 'subscription.resume_renewal' END, 'subscription', p_request_id);
  RETURN QUERY SELECT 'ok'::text;
END $$;

-- Gate for business mutations (B modules): active member of an active shop whose
-- subscription is writable. outcome: ok | forbidden | suspended | inactive
CREATE FUNCTION auth.require_writable(p_user_id uuid, p_organization_id uuid)
RETURNS TABLE (outcome text, state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE e record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.organization_members m JOIN core.users u ON u.id = m.user_id
      WHERE m.organization_id = p_organization_id AND m.user_id = p_user_id AND m.status = 'active' AND u.status = 'active') THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::text; RETURN;
  END IF;
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  RETURN QUERY SELECT CASE WHEN e.state = 'suspended' THEN 'suspended' WHEN e.writable THEN 'ok' ELSE 'inactive' END, e.state;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA billing FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth.reserve_usage(uuid, uuid, text, uuid, bigint, integer), auth.settle_usage(uuid, text, uuid, boolean),
  auth.subscription_summary(uuid, uuid), auth.set_cancel_at_period_end(uuid, uuid, boolean, uuid), auth.require_writable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.reserve_usage(uuid, uuid, text, uuid, bigint, integer), auth.settle_usage(uuid, text, uuid, boolean),
  auth.subscription_summary(uuid, uuid), auth.set_cancel_at_period_end(uuid, uuid, boolean, uuid), auth.require_writable(uuid, uuid) TO fs_api;
