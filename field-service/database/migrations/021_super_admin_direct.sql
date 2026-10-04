-- Owner decision (2026-10-04): a super admin may do everything and needs no second approver.
-- Other roles keep the two-person rule. Every direct action is still audited with the actor.
-- Not changed: shop-owner consent before support reads shop data, and nobody disables their own account.
-- PostgreSQL 16 target. Apply as fs_migrator.

CREATE FUNCTION padmin.is_super_admin(p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM platform.accounts a JOIN platform.account_roles ar ON ar.account_id=a.id JOIN platform.roles r ON r.id=ar.role_id
  WHERE a.id=p_account AND a.status='active' AND r.code='super_admin')
$$;

-- Every current permission for super_admin (menus and the API guard read this list) ...
INSERT INTO platform.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p WHERE r.code='super_admin' ON CONFLICT DO NOTHING;

-- ... and any permission added later.
CREATE OR REPLACE FUNCTION padmin.require(p_account_id uuid, p_permission text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF padmin.is_super_admin(p_account_id) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.accounts a JOIN platform.account_roles ar ON ar.account_id = a.id
      JOIN platform.role_permissions rp ON rp.role_id = ar.role_id JOIN platform.permissions p ON p.id = rp.permission_id
      WHERE a.id = p_account_id AND a.status = 'active' AND p.code = p_permission) THEN
    RAISE EXCEPTION 'permission % required', p_permission USING ERRCODE = '42501';
  END IF;
END $$;

-- Change requests: a super admin may decide their own requests (017 refused 'self').
CREATE OR REPLACE FUNCTION padmin.decide_change(p_actor uuid,p_id uuid,p_approve boolean,p_note text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c platform.change_requests%ROWTYPE;d platform.plan_drafts%ROWTYPE;pl uuid;pv uuid;payload jsonb;item jsonb;v integer;
BEGIN
 PERFORM pg_advisory_xact_lock(17017);
 SELECT * INTO c FROM platform.change_requests WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL THEN RETURN 'not_found'; END IF;
 PERFORM padmin.require(p_actor,CASE WHEN c.kind IN ('roles','recovery') THEN 'accounts.approve' WHEN c.kind='plan' THEN 'plans.publish' ELSE 'policy.approve' END);
 IF (c.requested_by=p_actor OR (c.kind IN ('roles','recovery') AND c.target_id=p_actor)) AND NOT padmin.is_super_admin(p_actor) THEN RETURN 'self'; END IF;
 IF c.status<>'pending' THEN RETURN 'invalid'; END IF;
 IF p_approve AND NOT EXISTS(SELECT 1 FROM platform.accounts WHERE id=c.requested_by AND status='active') THEN UPDATE platform.change_requests SET status='obsolete' WHERE id=c.id;RETURN 'conflict'; END IF;
 IF p_approve AND c.kind='roles' THEN
   IF NOT EXISTS(SELECT 1 FROM platform.accounts WHERE id=c.target_id AND version=c.target_version AND status<>'disabled') THEN UPDATE platform.change_requests SET status='obsolete' WHERE id=c.id;RETURN 'conflict'; END IF;
   IF NOT ((c.payload->'roles') ? 'super_admin') AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.roles r ON r.id=ar.role_id WHERE ar.account_id=c.target_id AND r.code='super_admin')
   AND NOT EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.roles r ON r.id=ar.role_id JOIN platform.accounts a ON a.id=ar.account_id WHERE a.id<>c.target_id AND a.status='active' AND r.code='super_admin') THEN RETURN 'last_admin'; END IF;
   DELETE FROM platform.account_roles WHERE account_id=c.target_id;
   INSERT INTO platform.account_roles(account_id,role_id) SELECT c.target_id,r.id FROM platform.roles r WHERE (c.payload->'roles') ? r.code;
   UPDATE platform.accounts SET updated_at=now() WHERE id=c.target_id;
   UPDATE platform.sessions SET revoked_at=now() WHERE account_id=c.target_id AND revoked_at IS NULL;
 ELSIF p_approve AND c.kind='recovery' THEN
   IF NOT EXISTS(SELECT 1 FROM platform.accounts WHERE id=c.target_id AND version=c.target_version AND status='active') THEN RETURN 'conflict'; END IF;
   UPDATE platform.accounts SET status='invited',password_hash=NULL,totp_secret_sealed=NULL,totp_last_step=0,mfa_enrolled=false,failed_logins=0,locked_until=NULL WHERE id=c.target_id;
   UPDATE platform.sessions SET revoked_at=now() WHERE account_id=c.target_id AND revoked_at IS NULL;
 ELSIF c.kind='plan' THEN
   SELECT * INTO d FROM platform.plan_drafts WHERE id=c.target_id FOR UPDATE;
   IF d.version<>c.target_version OR d.status<>'pending' THEN RETURN 'conflict'; END IF;
   IF p_approve THEN
     payload=d.payload;
     SELECT id INTO pl FROM billing.plans WHERE code=payload->>'code' FOR UPDATE;
     IF pl IS NOT NULL AND EXISTS(SELECT 1 FROM billing.plans WHERE id=pl AND kind<>payload->>'kind') THEN RETURN 'invalid'; END IF;
     IF payload->>'kind'='trial' AND EXISTS(SELECT 1 FROM billing.plans WHERE kind='trial' AND status='active' AND id IS DISTINCT FROM pl) THEN RETURN 'invalid'; END IF;
     IF pl IS NULL THEN INSERT INTO billing.plans(code,name_th,name_en,kind) VALUES(payload->>'code',payload->>'name_th',payload->>'name_en',payload->>'kind') RETURNING id INTO pl;
     ELSE UPDATE billing.plans SET name_th=payload->>'name_th',name_en=payload->>'name_en',status='active' WHERE id=pl; END IF;
     SELECT coalesce(max(version_no),0)+1 INTO v FROM billing.plan_versions WHERE plan_id=pl;
     INSERT INTO billing.plan_versions(plan_id,version_no,technician_seats,storage_bytes,ocr_per_period,trial_days,grace_days,published_at)
     VALUES(pl,v,(payload->>'technician_seats')::integer,(payload->>'storage_bytes')::bigint,(payload->>'ocr_per_period')::integer,(payload->>'trial_days')::integer,(payload->>'grace_days')::integer,(payload->>'effective_at')::timestamptz) RETURNING id INTO pv;
     IF payload->>'kind'='trial' THEN INSERT INTO billing.price_versions(plan_version_id,amount_minor,interval_unit,effective_from) VALUES(pv,0,'month',(payload->>'effective_at')::timestamptz); END IF;
     FOR item IN SELECT * FROM jsonb_array_elements(payload->'prices') LOOP
       INSERT INTO billing.price_versions(plan_version_id,amount_minor,interval_unit,effective_from) VALUES(pv,(item->>'amount_minor')::bigint,item->>'interval_unit',(payload->>'effective_at')::timestamptz);
     END LOOP;
     UPDATE platform.plan_drafts SET status='published',plan_version_id=pv,version=version+1 WHERE id=d.id;
   ELSE UPDATE platform.plan_drafts SET status='draft',version=version+1 WHERE id=d.id; END IF;
 ELSIF p_approve AND c.kind='policy' THEN
   PERFORM pg_advisory_xact_lock(17018);
   IF coalesce((SELECT max(version) FROM platform.policy_versions),0)<>c.target_version THEN UPDATE platform.change_requests SET status='obsolete' WHERE id=c.id;RETURN 'conflict'; END IF;
   INSERT INTO platform.policy_versions(version,payload,published_by,approval_id) VALUES(c.target_version+1,c.payload,p_actor,c.id);
 END IF;
 UPDATE platform.change_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=p_actor,decided_at=now(),decision_note=p_note WHERE id=c.id;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,details,request_id) VALUES(p_actor,CASE WHEN p_approve THEN 'approval.approved' ELSE 'approval.rejected' END,'change_request',c.id,p_note,
  jsonb_build_object('kind',c.kind,'self_approved',c.requested_by=p_actor),p_request);
 RETURN 'ok';
END $$;

-- A super admin's request is applied in the same transaction; a refusal (e.g. last super admin,
-- second trial plan, stale version) undoes the request too.
CREATE OR REPLACE FUNCTION padmin.submit_change(p_actor uuid,p_kind text,p_target uuid,p_version integer,p_payload jsonb,p_reason text,p_request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v uuid;outcome text;
BEGIN
 IF p_kind IN ('roles','recovery') THEN
   PERFORM padmin.require(p_actor,'accounts.manage');
   IF (p_actor=p_target AND NOT padmin.is_super_admin(p_actor)) OR NOT EXISTS(SELECT 1 FROM platform.accounts WHERE id=p_target AND version=p_version AND status<>'disabled') THEN RAISE EXCEPTION 'invalid target' USING ERRCODE='42501'; END IF;
   IF p_kind='recovery' AND p_actor=p_target THEN RAISE EXCEPTION 'cannot recover own account' USING ERRCODE='42501'; END IF;
   IF p_kind='roles' AND (coalesce(jsonb_typeof(p_payload->'roles'),'')<>'array' OR jsonb_array_length(p_payload->'roles')<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_payload->'roles') x WHERE NOT EXISTS(SELECT 1 FROM platform.roles r WHERE r.code=x))) THEN RAISE EXCEPTION 'invalid roles' USING ERRCODE='22023'; END IF;
   IF p_kind='recovery' THEN p_payload='{}'; END IF;
 ELSIF p_kind='plan' THEN
   PERFORM padmin.require(p_actor,'plans.manage');
   UPDATE platform.plan_drafts SET status='pending',version=version+1 WHERE id=p_target AND version=p_version AND status='draft' RETURNING version,payload INTO p_version,p_payload;
   IF NOT FOUND THEN RAISE EXCEPTION 'stale draft' USING ERRCODE='40001'; END IF;
 ELSIF p_kind='policy' THEN
   PERFORM padmin.require(p_actor,'settings.manage');PERFORM pg_advisory_xact_lock(17018);
   IF coalesce((SELECT max(version) FROM platform.policy_versions),0)<>p_version THEN RAISE EXCEPTION 'stale policy' USING ERRCODE='40001'; END IF;
 ELSE RAISE EXCEPTION 'invalid kind' USING ERRCODE='22023'; END IF;
 INSERT INTO platform.change_requests(kind,target_id,target_version,payload,reason,requested_by) VALUES(p_kind,p_target,p_version,p_payload,p_reason,p_actor) RETURNING id INTO v;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,details,request_id) VALUES(p_actor,'approval.requested','change_request',v,p_reason,jsonb_build_object('kind',p_kind),p_request);
 IF padmin.is_super_admin(p_actor) THEN
   outcome=padmin.decide_change(p_actor,v,true,p_reason,p_request);
   IF outcome='conflict' THEN RAISE EXCEPTION 'stale change' USING ERRCODE='40001'; END IF;
   IF outcome<>'ok' THEN RAISE EXCEPTION 'change refused: %',outcome USING ERRCODE='22023'; END IF;
 END IF;
 RETURN v;
END $$;

-- Refunds: the table refused approver = requester; the rule now lives in the function only.
DO $$ DECLARE n text; BEGIN
 FOR n IN SELECT conname FROM pg_constraint WHERE conrelid='billing.refunds'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%approved_by <> requested_by%' LOOP
  EXECUTE format('ALTER TABLE billing.refunds DROP CONSTRAINT %I',n);
 END LOOP; END $$;

CREATE OR REPLACE FUNCTION padmin.decide_refund(p_account_id uuid, p_refund_id uuid, p_approve boolean, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.refunds%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'refund.approve');
  SELECT * INTO r FROM billing.refunds x WHERE x.id = p_refund_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN 'not_found'; END IF;
  IF r.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF r.requested_by = p_account_id AND NOT padmin.is_super_admin(p_account_id) THEN RETURN 'self_approval'; END IF;
  UPDATE billing.refunds SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    approved_by = CASE WHEN p_approve THEN p_account_id END, approved_at = now(), decision_reason = nullif(trim(p_reason), '') WHERE id = r.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id)
    VALUES (p_account_id, r.organization_id, 'refund.approve', CASE WHEN p_approve THEN 'refund.approved' ELSE 'refund.rejected' END, 'refund', r.id, nullif(trim(p_reason), ''),
      jsonb_build_object('self_approved', r.requested_by = p_account_id), p_request_id);
  RETURN 'ok';
END $$;

-- Support access: a super admin may approve their own request. Owner consent is still required.
CREATE OR REPLACE FUNCTION padmin.decide_access(p_account_id uuid, p_grant_id uuid, p_approve boolean, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE g platform.support_access_grants%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'access.approve');
  SELECT * INTO g FROM platform.support_access_grants x WHERE x.id = p_grant_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN 'not_found'; END IF;
  IF g.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF g.account_id = p_account_id AND NOT padmin.is_super_admin(p_account_id) THEN RETURN 'self_approval'; END IF;
  IF p_approve AND g.consented_by IS NULL THEN RETURN 'no_consent'; END IF;
  IF p_approve THEN
    UPDATE platform.support_access_grants SET status = 'active', approved_by = p_account_id, approved_at = now(),
      valid_from = now(), valid_until = now() + make_interval(mins => duration_minutes) WHERE id = g.id;
  ELSE
    UPDATE platform.support_access_grants SET status = 'rejected', ended_at = now(), end_reason = nullif(trim(p_reason), '') WHERE id = g.id;
  END IF;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id, support_grant_id)
    VALUES (p_account_id, g.organization_id, 'access.approve', CASE WHEN p_approve THEN 'support_access.approved' ELSE 'support_access.rejected' END,
      'support_grant', g.id, nullif(trim(p_reason), ''), jsonb_build_object('self_approved', g.account_id = p_account_id), p_request_id, g.id);
  RETURN 'ok';
END $$;

-- Closure / deletion: a super admin may execute a request they approved themselves.
-- Holds, retention/cooling, unsettled payments and owner verification still block.
CREATE OR REPLACE FUNCTION padmin.execute_privacy(p_actor uuid,p_id uuid,p_version integer,p_note text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.data_requests%ROWTYPE;v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'data.manage');SELECT * INTO d FROM platform.data_requests WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL THEN RETURN 'not_found'; END IF;
 IF d.version<>p_version OR d.status<>'approved' OR d.request_type NOT IN ('closure','deletion') THEN RETURN 'conflict'; END IF;
 IF d.decided_by=p_actor AND NOT padmin.is_super_admin(p_actor) THEN RETURN 'self'; END IF;
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
 INSERT INTO platform.audit_logs(actor_account_id,organization_id,action,target_type,target_id,reason,details,request_id) VALUES(p_actor,d.organization_id,'privacy.executed','data_request',d.id,p_note,
  jsonb_build_object('self_approved',d.decided_by=p_actor),p_request);RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION padmin.is_super_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.is_super_admin(uuid) TO fs_platform;
