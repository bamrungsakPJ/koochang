-- Communications and incident records contain no tenant business payloads.
CREATE TABLE platform.announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version integer NOT NULL DEFAULT 1,
 title_th text NOT NULL,title_en text NOT NULL,body_th text NOT NULL,body_en text NOT NULL,
 audience text NOT NULL CHECK(audience IN ('all','trial','paid','shops')),organization_ids uuid[] NOT NULL DEFAULT '{}',
 status text NOT NULL CHECK(status IN ('draft','scheduled','published','cancelled')),
 publish_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>publish_at),
 created_by uuid NOT NULL REFERENCES platform.accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform.incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version integer NOT NULL DEFAULT 1,title text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 status text NOT NULL CHECK(status IN ('investigating','identified','monitoring','resolved')),
 services text[] NOT NULL,timeline jsonb NOT NULL DEFAULT '[]',
 created_by uuid NOT NULL REFERENCES platform.accounts(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform.operation_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('backup','restore','api','storage','ocr','webhook')),
 result text NOT NULL CHECK(result IN ('passed','failed')),evidence text NOT NULL,checked_at timestamptz NOT NULL,
 recorded_by uuid NOT NULL REFERENCES platform.accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION padmin.communications(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'communications.manage');
 RETURN jsonb_build_object('announcements',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM platform.announcements ORDER BY created_at DESC LIMIT 200) x),
 'incidents',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT * FROM platform.incidents ORDER BY (status<>'resolved') DESC,updated_at DESC LIMIT 200) x));
END $$;
CREATE FUNCTION padmin.save_announcement(p_actor uuid,p_id uuid,p_version integer,p_payload jsonb,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a platform.announcements%ROWTYPE;target uuid;ids uuid[];
BEGIN
 PERFORM padmin.require(p_actor,'communications.manage');
 SELECT coalesce(array_agg(x::uuid),'{}') INTO ids FROM jsonb_array_elements_text(p_payload->'organization_ids') x;
 IF EXISTS(SELECT 1 FROM unnest(ids) x WHERE NOT EXISTS(SELECT 1 FROM core.organizations WHERE id=x)) THEN RETURN 'invalid'; END IF;
 IF p_payload->>'audience'='shops' AND cardinality(ids)=0 THEN RETURN 'invalid'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO platform.announcements(title_th,title_en,body_th,body_en,audience,organization_ids,status,publish_at,expires_at,created_by)
  VALUES(p_payload->>'title_th',p_payload->>'title_en',p_payload->>'body_th',p_payload->>'body_en',p_payload->>'audience',ids,
   p_payload->>'status',(p_payload->>'publish_at')::timestamptz,(p_payload->>'expires_at')::timestamptz,p_actor) RETURNING id INTO target;
 ELSE
  SELECT * INTO a FROM platform.announcements WHERE id=p_id FOR UPDATE;
  IF a.id IS NULL THEN RETURN 'not_found'; END IF;
  IF a.version<>p_version THEN RETURN 'conflict'; END IF;
  -- Published content is immutable; it can only be withdrawn.
  IF a.status IN ('published','cancelled') AND p_payload->>'status'<>'cancelled' THEN RETURN 'invalid'; END IF;
  IF p_payload->>'status'='cancelled' THEN UPDATE platform.announcements SET status='cancelled',version=version+1 WHERE id=p_id;
  ELSE UPDATE platform.announcements SET title_th=p_payload->>'title_th',title_en=p_payload->>'title_en',body_th=p_payload->>'body_th',body_en=p_payload->>'body_en',
   audience=p_payload->>'audience',organization_ids=ids,status=p_payload->>'status',publish_at=(p_payload->>'publish_at')::timestamptz,expires_at=(p_payload->>'expires_at')::timestamptz,version=version+1 WHERE id=p_id; END IF;
  target=p_id;
 END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,details,request_id) VALUES(p_actor,'announcement.saved','announcement',target,jsonb_build_object('status',p_payload->>'status','audience',p_payload->>'audience'),p_request);
 RETURN 'ok';
END $$;
CREATE FUNCTION padmin.save_incident(p_actor uuid,p_id uuid,p_version integer,p_title text,p_severity text,p_status text,p_services text[],p_note text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target uuid;entry jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'communications.manage');
 entry=jsonb_build_array(jsonb_build_object('at',now(),'by',p_actor,'status',p_status,'note',p_note));
 IF p_id IS NULL THEN INSERT INTO platform.incidents(title,severity,status,services,timeline,created_by) VALUES(p_title,p_severity,p_status,p_services,entry,p_actor) RETURNING id INTO target;
 ELSE UPDATE platform.incidents SET title=p_title,severity=p_severity,status=p_status,services=p_services,timeline=timeline||entry,version=version+1,updated_at=now() WHERE id=p_id AND version=p_version RETURNING id INTO target;
 IF NOT FOUND THEN RETURN 'conflict'; END IF; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,details,request_id) VALUES(p_actor,'incident.updated','incident',target,p_note,jsonb_build_object('status',p_status),p_request);
 RETURN 'ok';
END $$;
-- Read-only owner feed evaluates scheduling in the database, even when the worker is stopped.
CREATE FUNCTION auth.announcements(p_user uuid,p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;e record;
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO e FROM billing.entitlement(p_org);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title_th',a.title_th,'title_en',a.title_en,'body_th',a.body_th,'body_en',a.body_en,'publish_at',a.publish_at) ORDER BY a.publish_at DESC),'[]') INTO v
 FROM platform.announcements a WHERE a.status IN ('scheduled','published') AND a.publish_at<=now() AND a.expires_at>now()
 AND (a.audience='all' OR (a.audience='shops' AND p_org=ANY(a.organization_ids)) OR (a.audience='trial' AND e.state='trialing') OR (a.audience='paid' AND e.source='paid'));
 RETURN v;
END $$;
CREATE FUNCTION padmin.operations(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'system.read');
 RETURN jsonb_build_object('checks',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT c.*,a.display_name AS recorded_by_name FROM platform.operation_checks c JOIN platform.accounts a ON a.id=c.recorded_by ORDER BY checked_at DESC LIMIT 100) x),
 'deliveries',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,version,organization_id,status,attempts,created_at,updated_at FROM ops.notification_deliveries WHERE status IN ('failed','sending','queued') ORDER BY (status='failed') DESC,created_at LIMIT 100) x),
 'ocr',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,version,organization_id,status,attempts,created_at,updated_at FROM core.ocr_requests WHERE status IN ('failed','queued','running') ORDER BY (status='failed') DESC,created_at LIMIT 100) x),
 'outbox',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,organization_id,event_type,attempts,created_at FROM ops.outbox_events WHERE processed_at IS NULL ORDER BY created_at LIMIT 100) x),
 'webhooks',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,status,created_at FROM billing.stripe_checkouts WHERE status IN ('manual_review','failed','creating') ORDER BY created_at DESC LIMIT 100) x));
END $$;
CREATE FUNCTION padmin.retry_ocr(p_actor uuid,p_id uuid,p_version integer,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r core.ocr_requests%ROWTYPE;e record;reserved bigint;used bigint;org uuid;
BEGIN
 PERFORM padmin.require(p_actor,'operations.manage');SELECT organization_id INTO org FROM core.ocr_requests WHERE id=p_id;
 IF org IS NULL THEN RETURN 'not_found'; END IF;
 PERFORM 1 FROM core.organizations WHERE id=org FOR UPDATE;
 SELECT * INTO r FROM core.ocr_requests WHERE id=p_id FOR UPDATE;
 IF r.version<>p_version OR r.status<>'failed' OR r.quota_consumed THEN RETURN 'conflict'; END IF;
 SELECT * INTO e FROM billing.entitlement(org);
 IF NOT e.writable OR NOT EXISTS(SELECT 1 FROM core.media_assets WHERE id=r.media_asset_id AND organization_id=org AND status='ready') OR NOT EXISTS(SELECT 1 FROM core.organization_members WHERE organization_id=org AND user_id=r.requested_by AND status='active') THEN RETURN 'invalid'; END IF;
 SELECT coalesce(sum(units),0) INTO reserved FROM billing.usage_reservations WHERE organization_id=org AND metric='ocr' AND status='reserved' AND expires_at>now();
 SELECT coalesce((SELECT u.used FROM billing.usage_counters u WHERE u.organization_id=org AND u.metric='ocr' AND u.window_key=billing.usage_window('ocr',e.period_id)),0) INTO used;
 IF reserved+used+1>e.ocr_per_period THEN RETURN 'invalid'; END IF;
 UPDATE billing.usage_reservations SET status='reserved',expires_at=now()+interval '1 hour' WHERE organization_id=org AND metric='ocr' AND request_key=r.request_key AND status IN ('released','expired');
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 UPDATE core.ocr_requests SET status='queued',attempts=0,next_attempt_at=now(),completed_at=NULL,error_code=NULL WHERE id=r.id;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,org,'ocr.retried','ocr_request',r.id,p_reason,p_request);RETURN 'ok';
END $$;
CREATE FUNCTION padmin.refresh_checkout(p_actor uuid,p_id uuid,p_reason text,p_request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid;
BEGIN
 PERFORM padmin.require(p_actor,'operations.manage');SELECT organization_id INTO org FROM billing.stripe_checkouts WHERE id=p_id AND status IN ('creating','open','failed','manual_review');
 IF org IS NULL THEN RETURN NULL; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,org,'checkout.refreshed','stripe_checkout',p_id,p_reason,p_request);RETURN p_id;
END $$;
CREATE FUNCTION padmin.record_operation(p_actor uuid,p_kind text,p_result text,p_evidence text,p_at timestamptz,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v uuid;
BEGIN
 PERFORM padmin.require(p_actor,'operations.manage');
 IF p_at>now()+interval '1 minute' OR p_at<now()-interval '366 days' THEN RETURN 'invalid'; END IF;
 INSERT INTO platform.operation_checks(kind,result,evidence,checked_at,recorded_by) VALUES(p_kind,p_result,p_evidence,p_at,p_actor) RETURNING id INTO v;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,details,request_id) VALUES(p_actor,'operation.recorded','operation_check',v,p_evidence,jsonb_build_object('kind',p_kind,'result',p_result),p_request);
 RETURN 'ok';
END $$;
-- Retrying a failed delivery keeps its unique notification/device pair; never replay sent rows.
CREATE FUNCTION padmin.retry_delivery(p_actor uuid,p_id uuid,p_version integer,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid;
BEGIN
 PERFORM padmin.require(p_actor,'operations.manage');
 UPDATE ops.notification_deliveries SET status='queued',attempts=0,next_attempt_at=now(),last_error=NULL WHERE id=p_id AND version=p_version AND status='failed' RETURNING organization_id INTO org;
 IF NOT FOUND THEN RETURN 'conflict'; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,org,'delivery.retried','notification_delivery',p_id,p_reason,p_request);
 RETURN 'ok';
END $$;
REVOKE ALL ON platform.announcements,platform.incidents,platform.operation_checks FROM PUBLIC;
REVOKE ALL ON FUNCTION padmin.communications(uuid),padmin.save_announcement(uuid,uuid,integer,jsonb,uuid),padmin.save_incident(uuid,uuid,integer,text,text,text,text[],text,uuid),padmin.operations(uuid),padmin.record_operation(uuid,text,text,text,timestamptz,uuid),padmin.retry_delivery(uuid,uuid,integer,text,uuid),auth.announcements(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.communications(uuid),padmin.save_announcement(uuid,uuid,integer,jsonb,uuid),padmin.save_incident(uuid,uuid,integer,text,text,text,text[],text,uuid),padmin.operations(uuid),padmin.record_operation(uuid,text,text,text,timestamptz,uuid),padmin.retry_delivery(uuid,uuid,integer,text,uuid) TO fs_platform;
GRANT EXECUTE ON FUNCTION auth.announcements(uuid,uuid) TO fs_api;
REVOKE ALL ON FUNCTION padmin.retry_ocr(uuid,uuid,integer,text,uuid),padmin.refresh_checkout(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.retry_ocr(uuid,uuid,integer,text,uuid),padmin.refresh_checkout(uuid,uuid,text,uuid) TO fs_platform;
