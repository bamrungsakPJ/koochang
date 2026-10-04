-- Owner-requested exports, closure and retention-gated business-content erasure.
INSERT INTO platform.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p WHERE r.code='super_admin' AND p.code='data.manage' ON CONFLICT DO NOTHING;
ALTER TABLE platform.data_requests ADD COLUMN executed_by uuid REFERENCES platform.accounts(id),ADD COLUMN execution_note text;
CREATE TABLE platform.export_artifacts (
 request_id uuid PRIMARY KEY REFERENCES platform.data_requests(id),body_sealed text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',byte_count integer NOT NULL
);
CREATE TABLE platform.legal_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES core.organizations(id),reason text NOT NULL,
 placed_by uuid NOT NULL REFERENCES platform.accounts(id),created_at timestamptz NOT NULL DEFAULT now(),released_at timestamptz,released_by uuid REFERENCES platform.accounts(id),release_reason text
);
CREATE TABLE platform.deletion_tombstones (
 organization_id uuid PRIMARY KEY REFERENCES core.organizations(id),request_id uuid NOT NULL UNIQUE REFERENCES platform.data_requests(id),
 erased_at timestamptz NOT NULL DEFAULT now(),erased_by uuid NOT NULL REFERENCES platform.accounts(id),policy_snapshot jsonb NOT NULL
);
CREATE TABLE platform.media_erasure_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES core.organizations(id),object_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded')),attempts integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION auth.request_privacy(p_user uuid,p_org uuid,p_kind text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v uuid;
BEGIN
 IF auth.support_owner_id(p_user,p_org) IS NULL THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 IF p_kind NOT IN ('export','closure','deletion') THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 PERFORM 1 FROM core.organizations WHERE id=p_org FOR UPDATE;
 SELECT id INTO v FROM platform.data_requests WHERE organization_id=p_org AND request_type=p_kind AND status IN ('pending','approved','running');
 IF v IS NOT NULL THEN RETURN jsonb_build_object('outcome','exists','request_id',v); END IF;
 INSERT INTO platform.data_requests(organization_id,requested_by,request_type,reason) VALUES(p_org,p_user,p_kind,p_reason) RETURNING id INTO v;
 INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES(p_org,p_user,'data_request.created','data_request',v,gen_random_uuid());
 RETURN jsonb_build_object('outcome','ok','request_id',v);
END $$;
CREATE OR REPLACE FUNCTION padmin.update_data_request(p_account_id uuid,p_request_id_row uuid,p_status text,p_note text,p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account_id,'data.manage');SELECT * INTO d FROM platform.data_requests WHERE id=p_request_id_row FOR UPDATE;
 IF d.id IS NULL THEN RETURN 'not_found'; END IF;
 IF NOT ((d.status='pending' AND p_status IN ('approved','rejected')) OR (d.status='approved' AND p_status='cancelled')) THEN RETURN 'invalid_state'; END IF;
 IF p_status='approved' AND auth.support_owner_id(d.requested_by,d.organization_id) IS NULL THEN RETURN 'invalid_state'; END IF;
 UPDATE platform.data_requests SET status=p_status,decided_by=p_account_id,decision_note=p_note,completed_at=CASE WHEN p_status IN ('rejected','cancelled') THEN now() END WHERE id=d.id;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,request_id) VALUES(p_account_id,d.organization_id,'data_request.'||p_status,'data_request',d.id,p_note,p_request_id);RETURN 'ok';
END $$;
CREATE FUNCTION worker.expire_exports() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ DELETE FROM platform.export_artifacts WHERE expires_at<=now() $$;
CREATE FUNCTION padmin.privacy_preview(p_actor uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;p jsonb;until_at timestamptz;
BEGIN
 PERFORM padmin.require(p_actor,'data.manage');SELECT * INTO d FROM platform.data_requests WHERE id=p_id;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 SELECT payload INTO p FROM platform.policy_versions ORDER BY version DESC LIMIT 1;
 until_at=d.created_at+make_interval(days=>greatest(coalesce((p->>'business_retention_days')::integer,0),coalesce((p->>'deletion_cooling_days')::integer,0)));
 RETURN jsonb_build_object('request',to_jsonb(d),'organization_status',(SELECT status FROM core.organizations WHERE id=d.organization_id),
 'owner_verified',EXISTS(SELECT 1 FROM core.organization_members m JOIN core.users u ON u.id=m.user_id WHERE m.organization_id=d.organization_id AND m.user_id=d.requested_by AND m.role='owner' AND m.status='active' AND u.status='active'),
 'holds',(SELECT coalesce(jsonb_agg(h),'[]') FROM platform.legal_holds h WHERE h.organization_id=d.organization_id AND released_at IS NULL),
 'policy_configured',p->>'business_retention_days' IS NOT NULL AND p->>'deletion_cooling_days' IS NOT NULL,
 'eligible_at',until_at,'policy',p,
 'counts',jsonb_build_object('customers',(SELECT count(*) FROM core.customers WHERE organization_id=d.organization_id),'equipment',(SELECT count(*) FROM core.equipment WHERE organization_id=d.organization_id),'jobs',(SELECT count(*) FROM core.jobs WHERE organization_id=d.organization_id),'media',(SELECT count(*) FROM core.media_assets WHERE organization_id=d.organization_id AND status<>'deleted')),
 'artifact',(SELECT jsonb_build_object('expires_at',expires_at,'byte_count',byte_count) FROM platform.export_artifacts WHERE request_id=d.id AND expires_at>now()),
 'erasure_remaining',(SELECT count(*) FROM platform.media_erasure_jobs WHERE organization_id=d.organization_id AND status<>'succeeded'),
 'unsettled_payments',(SELECT count(*) FROM billing.invoices WHERE organization_id=d.organization_id AND status='open')+(SELECT count(*) FROM billing.refunds WHERE organization_id=d.organization_id AND status IN ('pending','approved'))+(SELECT count(*) FROM billing.stripe_checkouts WHERE organization_id=d.organization_id AND status IN ('creating','open','manual_review')));
END $$;
-- Snapshot can only be built for a currently approved owner request; console callers receive metadata only.
CREATE FUNCTION padmin.export_snapshot(p_actor uuid,p_id uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;v jsonb;section_name text;
BEGIN
 PERFORM padmin.require(p_actor,'data.manage');SELECT * INTO d FROM platform.data_requests WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL OR d.request_type<>'export' OR d.status NOT IN ('approved','running') OR auth.support_owner_id(d.requested_by,d.organization_id) IS NULL THEN RETURN NULL; END IF;
 v=jsonb_build_object('format','field-service-export-v1','generated_at',now(),'organization',(SELECT jsonb_build_object('id',id,'name',name,'timezone',timezone) FROM core.organizations WHERE id=d.organization_id));
 -- Fixed allowlist: no SQL identifiers or tenant scope are taken from a request body.
 FOREACH section_name IN ARRAY ARRAY['customers','customer_locations','equipment','jobs','job_equipment','job_assignments','service_events','service_event_equipment','maintenance_schedules','maintenance_cycles','maintenance_contact_logs'] LOOP
  EXECUTE format('SELECT $1 || jsonb_build_object($2,coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb)) FROM core.%I x WHERE organization_id=$3',section_name) INTO v USING v,section_name,d.organization_id;
 END LOOP;
 -- Images remain private; the JSON includes asset IDs and metadata, never internal storage paths or signed URLs.
 v=v||jsonb_build_object('media',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'mime_type',mime_type,'size_bytes',size_bytes,'purpose',purpose,'status',status)),'[]') FROM core.media_assets WHERE organization_id=d.organization_id AND status='ready'));
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,request_id) VALUES(p_actor,d.organization_id,'export.generated','data_request',d.id,p_request);
 RETURN v;
END $$;
CREATE FUNCTION padmin.store_export(p_actor uuid,p_id uuid,p_body text,p_bytes integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_actor,'data.manage');SELECT * INTO d FROM platform.data_requests WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL OR d.request_type<>'export' OR d.status NOT IN ('approved','running') OR auth.support_owner_id(d.requested_by,d.organization_id) IS NULL THEN RETURN 'invalid'; END IF;
 INSERT INTO platform.export_artifacts(request_id,body_sealed,byte_count) VALUES(d.id,p_body,p_bytes) ON CONFLICT(request_id) DO UPDATE SET body_sealed=excluded.body_sealed,byte_count=excluded.byte_count,created_at=now(),expires_at=now()+interval '24 hours';
 UPDATE platform.data_requests SET status='succeeded',completed_at=now(),executed_by=p_actor WHERE id=d.id;RETURN 'ok';
END $$;
CREATE FUNCTION auth.download_export(p_user uuid,p_org uuid,p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v text;
BEGIN
 IF auth.support_owner_id(p_user,p_org) IS NULL THEN RETURN NULL; END IF;
 SELECT a.body_sealed INTO v FROM platform.export_artifacts a JOIN platform.data_requests d ON d.id=a.request_id WHERE d.id=p_id AND d.organization_id=p_org AND d.requested_by=p_user AND d.status='succeeded' AND a.expires_at>now();
 IF v IS NOT NULL THEN INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES(p_org,p_user,'export.downloaded','data_request',p_id,gen_random_uuid()); END IF;
 RETURN v;
END $$;
CREATE FUNCTION padmin.legal_hold(p_actor uuid,p_org uuid,p_release uuid,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'data.manage');PERFORM 1 FROM core.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 IF p_release IS NULL THEN INSERT INTO platform.legal_holds(organization_id,reason,placed_by) VALUES(p_org,p_reason,p_actor);
 ELSE UPDATE platform.legal_holds SET released_at=now(),released_by=p_actor,release_reason=p_reason WHERE id=p_release AND organization_id=p_org AND released_at IS NULL;IF NOT FOUND THEN RETURN 'invalid'; END IF; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,reason,request_id) VALUES(p_actor,p_org,CASE WHEN p_release IS NULL THEN 'legal_hold.placed' ELSE 'legal_hold.released' END,p_reason,p_request);RETURN 'ok';
END $$;
-- Private helper retains record IDs, financial documents, shared user identities and structural history.
-- It removes business content and disables access immediately; the worker subsequently removes image bytes.
CREATE FUNCTION padmin.erase_business_content(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 INSERT INTO platform.media_erasure_jobs(organization_id,object_key) SELECT p_org,object_key FROM core.media_assets WHERE organization_id=p_org UNION SELECT p_org,thumbnail_key FROM core.media_assets WHERE organization_id=p_org AND thumbnail_key IS NOT NULL ON CONFLICT(object_key) DO NOTHING;
 UPDATE core.organizations SET status='closed',name='Deleted shop',contact_phone=NULL WHERE id=p_org;
 UPDATE core.customers SET name='Deleted customer',phone=NULL,phone_normalized=NULL,note=NULL,archived_at=now() WHERE organization_id=p_org;
 UPDATE core.customer_locations SET name='Deleted location',address=NULL,travel_note=NULL,latitude=NULL,longitude=NULL,accuracy_meters=NULL,capture_method=NULL,location_captured_at=NULL,location_captured_by=NULL,archived_at=now() WHERE organization_id=p_org;
 UPDATE core.equipment SET name=NULL,brand=NULL,model=NULL,serial_number=NULL,serial_normalized=NULL,note=NULL,installation_note=NULL,qr_code=NULL,status='archived' WHERE organization_id=p_org;
 UPDATE core.jobs SET title='Deleted job',description=NULL,cancellation_reason=CASE WHEN status='cancelled' THEN 'Deleted' ELSE NULL END WHERE organization_id=p_org;
 UPDATE core.job_equipment SET request_note=NULL WHERE organization_id=p_org;
 UPDATE core.service_events SET note=NULL WHERE organization_id=p_org;
 UPDATE core.service_event_equipment SET note=NULL,work_note=NULL,problem_note=NULL,not_done_reason=CASE WHEN outcome<>'done' THEN 'Deleted' END,equipment_snapshot='{}' WHERE organization_id=p_org;
 UPDATE core.equipment_photos SET caption=NULL WHERE organization_id=p_org;
 UPDATE core.ocr_requests SET result=NULL,status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END WHERE organization_id=p_org;
 UPDATE core.organization_members SET display_name='Deleted member' WHERE organization_id=p_org;
 UPDATE core.job_assignments SET reason=NULL WHERE organization_id=p_org;
 UPDATE core.job_state_changes SET reason=NULL WHERE organization_id=p_org;
 UPDATE ops.audit_logs SET reason=NULL,details='{}' WHERE organization_id=p_org;
 UPDATE core.media_assets SET status='deleted' WHERE organization_id=p_org;
 UPDATE core.notifications SET parameters='{}' WHERE organization_id=p_org;
 UPDATE ops.notification_deliveries SET status='skipped' WHERE organization_id=p_org AND status IN ('queued','sending','failed');
 UPDATE core.maintenance_contact_logs SET note=NULL WHERE organization_id=p_org;
 UPDATE platform.support_messages SET body='Deleted' WHERE organization_id=p_org;
 UPDATE platform.support_tickets SET subject='Deleted ticket',status='closed' WHERE organization_id=p_org;
 UPDATE platform.support_access_grants SET status='revoked',ended_at=now() WHERE organization_id=p_org AND status IN ('pending','active');
 UPDATE ops.outbox_events SET payload='{}',processed_at=now() WHERE organization_id=p_org;
 UPDATE ops.idempotency_keys SET response=NULL WHERE organization_id=p_org;
 DELETE FROM platform.export_artifacts a USING platform.data_requests d WHERE a.request_id=d.id AND d.organization_id=p_org;
END $$;
-- Policies needed for this restricted helper; runtime roles gain no new direct table privileges.
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['customers','customer_locations','equipment','jobs','job_equipment','job_assignments','job_state_changes','service_events','service_event_equipment','equipment_photos','maintenance_contact_logs','maintenance_schedules'] LOOP
 EXECUTE format('CREATE POLICY privacy_functions ON core.%I TO fs_migrator USING (true) WITH CHECK (true)',n);END LOOP; END $$;
CREATE POLICY privacy_functions ON ops.outbox_events TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY privacy_functions ON ops.idempotency_keys TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY privacy_functions ON ops.audit_logs TO fs_migrator USING (true) WITH CHECK (true);
CREATE FUNCTION padmin.execute_privacy(p_actor uuid,p_id uuid,p_version integer,p_note text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'data.manage');SELECT * INTO d FROM platform.data_requests WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL THEN RETURN 'not_found'; END IF;
 IF d.version<>p_version OR d.status<>'approved' OR d.request_type NOT IN ('closure','deletion') THEN RETURN 'conflict'; END IF;
 IF d.decided_by=p_actor THEN RETURN 'self'; END IF;
 PERFORM 1 FROM core.organizations WHERE id=d.organization_id FOR UPDATE;
 v=padmin.privacy_preview(p_actor,p_id);
 IF NOT (v->>'owner_verified')::boolean OR jsonb_array_length(v->'holds')>0 THEN RETURN 'blocked'; END IF;
 IF EXISTS(SELECT 1 FROM billing.invoices WHERE organization_id=d.organization_id AND status='open') OR EXISTS(SELECT 1 FROM billing.refunds WHERE organization_id=d.organization_id AND status IN ('pending','approved')) OR EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE organization_id=d.organization_id AND status IN ('creating','open','manual_review')) THEN RETURN 'blocked'; END IF;
 IF d.request_type='deletion' THEN
  IF NOT coalesce((v->>'policy_configured')::boolean,false) OR (v->>'eligible_at')::timestamptz>now() THEN RETURN 'blocked'; END IF;
  INSERT INTO platform.deletion_tombstones(organization_id,request_id,erased_by,policy_snapshot) VALUES(d.organization_id,d.id,p_actor,v->'policy');
  PERFORM padmin.erase_business_content(d.organization_id);
 ELSE UPDATE core.organizations SET status='closed' WHERE id=d.organization_id; END IF;
 UPDATE core.organization_join_links SET status='revoked',revoked_at=now() WHERE organization_id=d.organization_id AND status IN ('active','closed');
 UPDATE billing.subscriptions SET cancel_at_period_end=true WHERE organization_id=d.organization_id;
 UPDATE platform.data_requests SET status=CASE WHEN d.request_type='deletion' AND EXISTS(SELECT 1 FROM platform.media_erasure_jobs WHERE organization_id=d.organization_id AND status<>'succeeded') THEN 'running' ELSE 'succeeded' END,executed_by=p_actor,execution_note=p_note,completed_at=CASE WHEN d.request_type='closure' OR NOT EXISTS(SELECT 1 FROM platform.media_erasure_jobs WHERE organization_id=d.organization_id AND status<>'succeeded') THEN now() END WHERE id=d.id;
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,d.organization_id,'privacy.executed','data_request',d.id,p_note,p_request);RETURN 'ok';
END $$;
CREATE FUNCTION worker.claim_erasure(p_limit integer) RETURNS TABLE(id uuid,object_key text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH picked AS (SELECT j.id FROM platform.media_erasure_jobs j WHERE (j.status='queued' AND j.updated_at<=now()-interval '30 seconds') OR (j.status='running' AND j.updated_at<now()-interval '10 minutes') ORDER BY j.updated_at FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,1),50))
 UPDATE platform.media_erasure_jobs j SET status='running',attempts=j.attempts+1,updated_at=now() FROM picked WHERE j.id=picked.id RETURNING j.id,j.object_key
$$;
CREATE FUNCTION worker.finish_erasure(p_id uuid,p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE org uuid;
BEGIN
 UPDATE platform.media_erasure_jobs SET status=CASE WHEN p_ok THEN 'succeeded' ELSE 'queued' END,updated_at=now() WHERE id=p_id AND status='running' RETURNING organization_id INTO org;
 IF org IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.media_erasure_jobs WHERE organization_id=org AND status<>'succeeded') THEN UPDATE platform.data_requests SET status='succeeded',completed_at=now() WHERE organization_id=org AND request_type='deletion' AND status='running'; END IF;
 DELETE FROM platform.export_artifacts WHERE expires_at<=now();
END $$;
CREATE FUNCTION worker.replay_erasure() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t record;n integer=0;
BEGIN FOR t IN SELECT organization_id FROM platform.deletion_tombstones LOOP PERFORM padmin.erase_business_content(t.organization_id);n=n+1;END LOOP;RETURN n; END $$;
CREATE FUNCTION padmin.tombstones(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM padmin.require(p_actor,'operations.manage');RETURN (SELECT coalesce(jsonb_agg(t),'[]') FROM platform.deletion_tombstones t);END $$;
REVOKE ALL ON platform.export_artifacts,platform.legal_holds,platform.deletion_tombstones,platform.media_erasure_jobs FROM PUBLIC;
REVOKE ALL ON FUNCTION worker.expire_exports(),auth.request_privacy(uuid,uuid,text,text),padmin.privacy_preview(uuid,uuid),padmin.export_snapshot(uuid,uuid,uuid),padmin.store_export(uuid,uuid,text,integer),auth.download_export(uuid,uuid,uuid),padmin.legal_hold(uuid,uuid,uuid,text,uuid),padmin.erase_business_content(uuid),padmin.execute_privacy(uuid,uuid,integer,text,uuid),worker.claim_erasure(integer),worker.finish_erasure(uuid,boolean),worker.replay_erasure(),padmin.tombstones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.request_privacy(uuid,uuid,text,text),auth.download_export(uuid,uuid,uuid) TO fs_api;
GRANT EXECUTE ON FUNCTION padmin.privacy_preview(uuid,uuid),padmin.export_snapshot(uuid,uuid,uuid),padmin.store_export(uuid,uuid,text,integer),padmin.legal_hold(uuid,uuid,uuid,text,uuid),padmin.execute_privacy(uuid,uuid,integer,text,uuid),padmin.tombstones(uuid) TO fs_platform;
GRANT EXECUTE ON FUNCTION worker.expire_exports(),worker.claim_erasure(integer),worker.finish_erasure(uuid,boolean),worker.replay_erasure() TO fs_worker;
