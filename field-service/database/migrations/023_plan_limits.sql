-- Plans limit only technician seats and photo storage.
-- * A plan may have no technician seats: the owner works alone (owners never use a seat).
-- * OCR is part of every plan, not a metered limit. Reservations still go through
--   auth.reserve_usage so the console keeps counting reads per period for cost monitoring;
--   plan_versions.ocr_per_period stays for history and is no longer enforced.

ALTER TABLE billing.plan_versions DROP CONSTRAINT plan_versions_technician_seats_check,
  ADD CONSTRAINT plan_versions_technician_seats_check CHECK (technician_seats >= 0);

-- Same as 003 except that only storage_bytes is checked against a limit (quota is NULL for ocr).
CREATE OR REPLACE FUNCTION auth.reserve_usage(p_user_id uuid, p_organization_id uuid, p_metric text, p_request_key uuid, p_units bigint, p_ttl_seconds integer)
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
  v_limit := CASE WHEN p_metric = 'storage_bytes' THEN e.storage_bytes END;
  SELECT coalesce((SELECT uc.used FROM billing.usage_counters uc WHERE uc.organization_id = p_organization_id AND uc.metric = p_metric AND uc.window_key = v_window), 0) INTO v_used;
  SELECT coalesce(sum(ur.units), 0) INTO v_reserved FROM billing.usage_reservations ur
    WHERE ur.organization_id = p_organization_id AND ur.metric = p_metric AND ur.status = 'reserved' AND ur.expires_at > now();
  IF r.id IS NOT NULL THEN
    RETURN QUERY SELECT 'existing'::text, r.id, v_used, v_reserved, v_limit; RETURN;
  END IF;
  IF NOT e.writable THEN
    RETURN QUERY SELECT 'inactive'::text, NULL::uuid, v_used, v_reserved, v_limit; RETURN;
  END IF;
  IF v_limit IS NOT NULL AND v_used + v_reserved + p_units > v_limit THEN
    RETURN QUERY SELECT 'limit_reached'::text, NULL::uuid, v_used, v_reserved, v_limit; RETURN;
  END IF;
  INSERT INTO billing.usage_reservations(organization_id, metric, request_key, units, expires_at)
    VALUES (p_organization_id, p_metric, p_request_key, p_units, now() + make_interval(secs => p_ttl_seconds))
    RETURNING * INTO r;
  RETURN QUERY SELECT 'reserved'::text, r.id, v_used, v_reserved + p_units, v_limit;
END $$;
REVOKE EXECUTE ON FUNCTION auth.reserve_usage(uuid, uuid, text, uuid, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.reserve_usage(uuid, uuid, text, uuid, bigint, integer) TO fs_api;

-- Console retry of a failed OCR read: same as 018 without the per-period quota check.
CREATE OR REPLACE FUNCTION padmin.retry_ocr(p_actor uuid,p_id uuid,p_version integer,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r core.ocr_requests%ROWTYPE;e record;org uuid;
BEGIN
 PERFORM padmin.require(p_actor,'operations.manage');SELECT organization_id INTO org FROM core.ocr_requests WHERE id=p_id;
 IF org IS NULL THEN RETURN 'not_found'; END IF;
 PERFORM 1 FROM core.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO r FROM core.ocr_requests WHERE id=p_id FOR UPDATE;
 IF r.version<>p_version OR r.status<>'failed' OR r.quota_consumed THEN RETURN 'conflict'; END IF;
 SELECT * INTO e FROM billing.entitlement(org);
 IF NOT e.writable OR NOT EXISTS(SELECT 1 FROM core.media_assets WHERE id=r.media_asset_id AND organization_id=org AND status='ready') OR NOT EXISTS(SELECT 1 FROM core.organization_members WHERE organization_id=org AND user_id=r.requested_by AND status='active') THEN RETURN 'invalid'; END IF;
 UPDATE billing.usage_reservations SET status='reserved',expires_at=now()+interval '1 hour' WHERE organization_id=org AND metric='ocr' AND request_key=r.request_key AND status IN ('released','expired');
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 UPDATE core.ocr_requests SET status='queued',attempts=0,next_attempt_at=now(),completed_at=NULL,error_code=NULL WHERE id=r.id;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,org,'ocr.retried','ocr_request',r.id,p_reason,p_request);RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION padmin.retry_ocr(uuid,uuid,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.retry_ocr(uuid,uuid,integer,text,uuid) TO fs_platform;
