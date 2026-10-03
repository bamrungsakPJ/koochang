-- A04 files, OCR queue, notifications and background work.
-- PostgreSQL 16 target. Apply as fs_migrator. Requires role fs_worker (infra/postgres/00-roles.sql).
--
-- Tenant data (media, OCR requests, notifications) stays under RLS for fs_api. The worker runs as
-- fs_worker and reaches rows across shops only through worker.* SECURITY DEFINER functions.

CREATE SCHEMA worker;
REVOKE ALL ON SCHEMA worker FROM PUBLIC;
GRANT USAGE ON SCHEMA worker TO fs_worker;

CREATE POLICY background_functions ON core.media_assets TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY background_functions ON core.ocr_requests TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY background_functions ON core.notifications TO fs_migrator USING (true) WITH CHECK (true);

-- media ------------------------------------------------------------------------------------
-- object_key / thumbnail_key are private storage keys, never public URLs. size_bytes is the
-- stored size after processing (image + thumbnail), which is what the storage quota counts.
ALTER TABLE core.media_assets
  ADD COLUMN request_key uuid,
  ADD COLUMN purpose text NOT NULL DEFAULT 'other' CHECK (purpose IN ('equipment','nameplate','service','other')),
  ADD COLUMN declared_bytes bigint CHECK (declared_bytes > 0),
  ADD COLUMN thumbnail_key text UNIQUE,
  ADD COLUMN checksum text CHECK (checksum IS NULL OR length(checksum) = 64),
  ADD COLUMN width integer CHECK (width > 0),
  ADD COLUMN height integer CHECK (height > 0),
  ADD COLUMN gps_metadata_stripped_at timestamptz,
  ADD COLUMN failure_code text,
  ADD CONSTRAINT media_request_key UNIQUE (organization_id, request_key),
  ADD CONSTRAINT media_ready_processed CHECK (status <> 'ready' OR (checksum IS NOT NULL AND thumbnail_key IS NOT NULL AND gps_metadata_stripped_at IS NOT NULL));

-- OCR --------------------------------------------------------------------------------------
-- result = suggested fields from the provider. Suggestions never overwrite equipment data;
-- accepted_fields is what a person confirmed (equipment screens, B02).
ALTER TABLE core.ocr_requests
  ADD COLUMN provider text,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN error_code text,
  ADD COLUMN accepted_fields jsonb,
  ADD COLUMN completed_at timestamptz;
CREATE INDEX ocr_queue ON core.ocr_requests(next_attempt_at) WHERE status = 'queued';

-- notifications ----------------------------------------------------------------------------
-- Text is not stored: template_key + parameters are rendered in the recipient's language by the
-- app. event_key is the dedupe key (unique per shop and recipient).
ALTER TABLE core.notifications
  ADD COLUMN target_type text,
  ADD COLUMN target_id uuid;
CREATE INDEX notifications_inbox ON core.notifications(organization_id, recipient_user_id, created_at DESC);
-- A member reads and marks only their own notifications.
CREATE POLICY own_notifications ON core.notifications AS RESTRICTIVE TO fs_api
  USING (recipient_user_id = core.context_user_id()) WITH CHECK (recipient_user_id = core.context_user_id());

CREATE TABLE auth.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES core.users(id),
  token text NOT NULL UNIQUE CHECK (length(token) BETWEEN 10 AND 512),
  platform text NOT NULL CHECK (platform IN ('ios','android','web')),
  revoked_at timestamptz
);
ALTER TABLE auth.device_tokens ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.device_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_functions ON auth.device_tokens TO fs_migrator USING (true) WITH CHECK (true);

CREATE TABLE ops.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  notification_id uuid NOT NULL,
  device_token_id uuid NOT NULL REFERENCES auth.device_tokens(id),
  channel text NOT NULL DEFAULT 'push' CHECK (channel IN ('push')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  FOREIGN KEY (organization_id, notification_id) REFERENCES core.notifications(organization_id, id),
  UNIQUE (organization_id, notification_id, device_token_id),
  UNIQUE (organization_id, id)
);
CREATE INDEX delivery_queue ON ops.notification_deliveries(next_attempt_at) WHERE status = 'queued';
CREATE TRIGGER touch_version BEFORE UPDATE ON ops.notification_deliveries FOR EACH ROW EXECUTE FUNCTION core.touch_version();
ALTER TABLE ops.notification_deliveries ENABLE ROW LEVEL SECURITY; ALTER TABLE ops.notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY background_functions ON ops.notification_deliveries TO fs_migrator USING (true) WITH CHECK (true);

-- Creates one notification (deduplicated by event_key) and a queued push per active device.
CREATE FUNCTION core.notify(p_organization_id uuid, p_recipient uuid, p_event_key text, p_template text,
  p_parameters jsonb, p_target_type text, p_target_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid; v_language text;
BEGIN
  SELECT u.preferred_language INTO v_language FROM core.users u WHERE u.id = p_recipient AND u.status = 'active';
  IF v_language IS NULL THEN RETURN NULL; END IF;
  INSERT INTO core.notifications(organization_id, recipient_user_id, event_key, template_key, parameters, sent_language, target_type, target_id)
    VALUES (p_organization_id, p_recipient, p_event_key, p_template, coalesce(p_parameters, '{}'), v_language, p_target_type, p_target_id)
    ON CONFLICT ON CONSTRAINT notifications_organization_id_recipient_user_id_event_key_key DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO ops.notification_deliveries(organization_id, notification_id, device_token_id)
      SELECT p_organization_id, v_id, d.id FROM auth.device_tokens d WHERE d.user_id = p_recipient AND d.revoked_at IS NULL;
  END IF;
  RETURN v_id;
END $$;

-- Notify on membership changes: a new or returning request tells the owner(s); an approval
-- tells the technician. Runs inside the same transaction as the change.
CREATE FUNCTION core.notify_membership_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE o record;
BEGIN
  IF NEW.role = 'technician' AND NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    FOR o IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = NEW.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
      PERFORM core.notify(NEW.organization_id, o.user_id, 'join_request:' || NEW.id || ':' || NEW.version, 'join_request',
        jsonb_build_object('name', NEW.display_name), 'organization_member', NEW.id);
    END LOOP;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'active' AND OLD.status IN ('pending','suspended') THEN
    PERFORM core.notify(NEW.organization_id, NEW.user_id, 'member_active:' || NEW.id || ':' || NEW.version, 'member_approved',
      '{}'::jsonb, 'organization', NEW.organization_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notify_membership AFTER INSERT OR UPDATE OF status ON core.organization_members
  FOR EACH ROW EXECUTE FUNCTION core.notify_membership_change();

-- usage with the real size -------------------------------------------------------------------
-- Consume a reservation for the units actually used (never more than reserved) and warn the
-- owners once at 80% and 95% of storage.
CREATE FUNCTION auth.consume_usage(p_organization_id uuid, p_metric text, p_request_key uuid, p_units bigint)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.usage_reservations%ROWTYPE; e record; v_window text; v_used bigint; v_limit bigint; v_level integer; o record;
BEGIN
  SELECT * INTO r FROM billing.usage_reservations ur WHERE ur.organization_id = p_organization_id AND ur.metric = p_metric AND ur.request_key = p_request_key FOR UPDATE;
  IF r.id IS NULL THEN RETURN QUERY SELECT 'not_found'::text; RETURN; END IF;
  IF r.status = 'consumed' THEN RETURN QUERY SELECT 'already_consumed'::text; RETURN; END IF;
  IF r.status <> 'reserved' THEN RETURN QUERY SELECT 'already_released'::text; RETURN; END IF;
  IF p_units < 0 THEN RAISE EXCEPTION 'USAGE_REQUEST_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  v_window := billing.usage_window(p_metric, e.period_id);
  INSERT INTO billing.usage_counters(organization_id, metric, window_key, used) VALUES (p_organization_id, p_metric, v_window, least(p_units, r.units))
    ON CONFLICT ON CONSTRAINT usage_counters_organization_id_metric_window_key_key DO UPDATE SET used = billing.usage_counters.used + EXCLUDED.used
    RETURNING used INTO v_used;
  UPDATE billing.usage_reservations SET status = 'consumed', units = greatest(least(p_units, r.units), 1) WHERE id = r.id;
  v_limit := CASE WHEN p_metric = 'storage_bytes' THEN e.storage_bytes ELSE e.ocr_per_period END;
  IF p_metric = 'storage_bytes' AND v_limit > 0 THEN
    v_level := CASE WHEN v_used * 100 >= v_limit * 95 THEN 95 WHEN v_used * 100 >= v_limit * 80 THEN 80 END;
    IF v_level IS NOT NULL THEN
      FOR o IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = p_organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
        PERFORM core.notify(p_organization_id, o.user_id, 'storage_' || v_level || ':' || v_limit, 'storage_threshold',
          jsonb_build_object('percent', v_level), 'subscription', NULL);
      END LOOP;
    END IF;
  END IF;
  RETURN QUERY SELECT 'consumed'::text;
END $$;

-- devices ----------------------------------------------------------------------------------
CREATE FUNCTION auth.register_device(p_user_id uuid, p_token text, p_platform text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO auth.device_tokens(user_id, token, platform) VALUES (p_user_id, p_token, p_platform)
  ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now(), revoked_at = NULL
  RETURNING id
$$;
CREATE FUNCTION auth.revoke_device(p_user_id uuid, p_token text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH r AS (UPDATE auth.device_tokens SET revoked_at = now() WHERE user_id = p_user_id AND token = p_token AND revoked_at IS NULL RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM r)
$$;

-- worker -----------------------------------------------------------------------------------
-- OCR: claim queued requests with SKIP LOCKED so several workers never take the same one.
CREATE FUNCTION worker.claim_ocr(p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid, request_key uuid, object_key text, attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH picked AS (
    SELECT r.id FROM core.ocr_requests r WHERE r.status = 'queued' AND r.next_attempt_at <= now()
    ORDER BY r.next_attempt_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  UPDATE core.ocr_requests r SET status = 'running', attempts = r.attempts + 1
  FROM picked, core.media_assets m
  WHERE r.id = picked.id AND m.organization_id = r.organization_id AND m.id = r.media_asset_id
  RETURNING r.id, r.organization_id, r.request_key, m.object_key, r.attempts
$$;

-- outcome: succeeded (counts 1 OCR) | retry (temporary error, not counted) | failed (not counted)
CREATE FUNCTION worker.finish_ocr(p_id uuid, p_outcome text, p_provider text, p_result jsonb, p_error text, p_retry_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r core.ocr_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM core.ocr_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'running' THEN RETURN 'ignored'; END IF;
  IF p_outcome = 'succeeded' THEN
    UPDATE core.ocr_requests SET status = 'succeeded', provider = p_provider, result = coalesce(p_result, '{}'), completed_at = now(), quota_consumed = true, error_code = NULL WHERE id = p_id;
    PERFORM auth.consume_usage(r.organization_id, 'ocr', r.request_key, 1);
  ELSIF p_outcome = 'retry' AND r.attempts < 3 THEN
    UPDATE core.ocr_requests SET status = 'queued', error_code = p_error, next_attempt_at = now() + make_interval(secs => greatest(p_retry_seconds, 5)) WHERE id = p_id;
  ELSE
    UPDATE core.ocr_requests SET status = 'failed', provider = p_provider, error_code = coalesce(p_error, 'OCR_FAILED'), completed_at = now() WHERE id = p_id;
    PERFORM auth.settle_usage(r.organization_id, 'ocr', r.request_key, false);
  END IF;
  RETURN p_outcome;
END $$;

-- Requests left running by a crashed worker go back to the queue.
CREATE FUNCTION worker.requeue_stale_ocr(p_older_than_seconds integer) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH r AS (UPDATE core.ocr_requests SET status = 'queued', next_attempt_at = now()
    WHERE status = 'running' AND updated_at < now() - make_interval(secs => p_older_than_seconds) RETURNING 1)
  SELECT count(*)::integer FROM r
$$;

-- Push deliveries.
CREATE FUNCTION worker.claim_deliveries(p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid, token text, platform text, template_key text, parameters jsonb, language text, target_type text, target_id uuid, attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH picked AS (
    SELECT d.id FROM ops.notification_deliveries d WHERE d.status = 'queued' AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  UPDATE ops.notification_deliveries d SET status = 'sending', attempts = d.attempts + 1
  FROM picked, core.notifications n, auth.device_tokens t
  WHERE d.id = picked.id AND n.organization_id = d.organization_id AND n.id = d.notification_id AND t.id = d.device_token_id
  RETURNING d.id, d.organization_id, t.token, t.platform, n.template_key, n.parameters, n.sent_language, n.target_type, n.target_id, d.attempts
$$;

-- outcome: sent | skipped (no provider) | retry | failed | invalid_token (device is revoked)
CREATE FUNCTION worker.finish_delivery(p_id uuid, p_outcome text, p_error text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE d ops.notification_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO d FROM ops.notification_deliveries WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR d.status <> 'sending' THEN RETURN 'ignored'; END IF;
  IF p_outcome = 'retry' AND d.attempts < 5 THEN
    UPDATE ops.notification_deliveries SET status = 'queued', last_error = p_error,
      next_attempt_at = now() + make_interval(secs => (30 * power(2, d.attempts))::integer) WHERE id = p_id;
  ELSE
    UPDATE ops.notification_deliveries SET status = CASE p_outcome WHEN 'sent' THEN 'sent' WHEN 'skipped' THEN 'skipped' ELSE 'failed' END, last_error = p_error WHERE id = p_id;
    IF p_outcome = 'invalid_token' THEN UPDATE auth.device_tokens SET revoked_at = now() WHERE id = d.device_token_id; END IF;
  END IF;
  RETURN p_outcome;
END $$;

-- Subscription reminders to owners: trial ending (3 days), renewal (7 and 3 days), overdue,
-- expired. One notification per period and milestone, so restarts never repeat them.
CREATE FUNCTION worker.scan_subscriptions(p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s record; e record; o record; v_key text; v_template text; v_days integer; v_count integer := 0;
BEGIN
  FOR s IN SELECT sub.organization_id FROM billing.subscriptions sub JOIN core.organizations org ON org.id = sub.organization_id WHERE org.status = 'active' LOOP
    SELECT * INTO e FROM billing.entitlement(s.organization_id, p_at);
    v_key := NULL;
    IF e.state = 'trialing' AND e.period_end - p_at <= interval '3 days' THEN v_key := 'trial_ending:' || e.period_id; v_template := 'trial_ending';
    ELSIF e.state = 'active' AND e.source = 'paid' AND NOT e.cancel_at_period_end AND e.period_end - p_at <= interval '7 days' THEN
      v_days := CASE WHEN e.period_end - p_at <= interval '3 days' THEN 3 ELSE 7 END;
      v_key := 'renewal_' || v_days || ':' || e.period_id; v_template := 'renewal_due';
    ELSIF e.state = 'past_due' THEN v_key := 'payment_overdue:' || e.period_id; v_template := 'payment_overdue';
    ELSIF e.state IN ('expired','ended') AND e.period_id IS NOT NULL THEN v_key := 'subscription_' || e.state || ':' || e.period_id; v_template := 'subscription_' || e.state;
    END IF;
    IF v_key IS NOT NULL THEN
      FOR o IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = s.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
        IF core.notify(s.organization_id, o.user_id, v_key, v_template,
            jsonb_build_object('date', to_char(coalesce(e.grace_until, e.period_end) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')), 'subscription', NULL) IS NOT NULL THEN
          v_count := v_count + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

-- Housekeeping: expire old reservations, purge spent OTP challenges and dead sessions.
CREATE FUNCTION worker.housekeeping() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reservations integer; v_otp integer; v_sessions integer;
BEGIN
  WITH r AS (UPDATE billing.usage_reservations SET status = 'expired' WHERE status = 'reserved' AND expires_at <= now() RETURNING 1)
    SELECT count(*) INTO v_reservations FROM r;
  WITH r AS (DELETE FROM auth.otp_challenges WHERE created_at < now() - interval '2 days' RETURNING 1)
    SELECT count(*) INTO v_otp FROM r;
  WITH r AS (DELETE FROM auth.retired_refresh_tokens t USING auth.sessions s
      WHERE t.session_id = s.id AND (s.refresh_expires_at < now() - interval '30 days' OR s.revoked_at < now() - interval '30 days') RETURNING 1)
    SELECT count(*) INTO v_sessions FROM r;
  WITH r AS (DELETE FROM auth.sessions WHERE (refresh_expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days')
      AND NOT EXISTS (SELECT 1 FROM auth.retired_refresh_tokens t WHERE t.session_id = auth.sessions.id) RETURNING 1)
    SELECT count(*) INTO v_sessions FROM r;
  RETURN jsonb_build_object('reservations_expired', v_reservations, 'otp_deleted', v_otp, 'sessions_deleted', v_sessions);
END $$;

CREATE POLICY background_functions ON billing.usage_reservations TO fs_migrator USING (true) WITH CHECK (true);

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA worker FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA worker TO fs_worker;
REVOKE EXECUTE ON FUNCTION core.notify(uuid, uuid, text, text, jsonb, text, uuid), core.notify_membership_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth.consume_usage(uuid, text, uuid, bigint), auth.register_device(uuid, text, text), auth.revoke_device(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.consume_usage(uuid, text, uuid, bigint), auth.register_device(uuid, text, text), auth.revoke_device(uuid, text) TO fs_api;
