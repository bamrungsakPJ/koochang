-- Staff enrollment, immutable catalog drafts, approvals and approved platform policies.
INSERT INTO platform.permissions(code) VALUES ('accounts.approve'),('plans.manage'),('plans.publish'),('policy.approve'),('communications.manage'),('operations.manage');
INSERT INTO platform.permissions(code) VALUES('approvals.read');
INSERT INTO platform.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p WHERE r.code IN ('super_admin','platform_admin') AND p.code='approvals.read';
INSERT INTO platform.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p WHERE
 (r.code='super_admin' AND p.code IN ('accounts.approve','plans.manage','plans.publish','policy.approve','communications.manage','operations.manage')) OR
 (r.code='platform_admin' AND p.code IN ('plans.manage','plans.publish','policy.approve','communications.manage')) OR
 (r.code='operations' AND p.code IN ('operations.manage','communications.manage'));
CREATE TABLE platform.staff_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES platform.accounts(id),
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),totp_sealed text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '48 hours',
 consumed_at timestamptz,revoked_at timestamptz,attempts integer NOT NULL DEFAULT 0,created_by uuid NOT NULL REFERENCES platform.accounts(id)
);
CREATE TABLE platform.plan_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','published','cancelled')),
 created_by uuid NOT NULL REFERENCES platform.accounts(id),created_at timestamptz NOT NULL DEFAULT now(),
 plan_version_id uuid REFERENCES billing.plan_versions(id)
);
CREATE TABLE platform.change_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('roles','recovery','plan','policy')),
 target_id uuid,target_version integer,payload jsonb NOT NULL,reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','obsolete')),
 requested_by uuid NOT NULL REFERENCES platform.accounts(id),decided_by uuid REFERENCES platform.accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,decision_note text
);
CREATE UNIQUE INDEX one_pending_change ON platform.change_requests(kind,target_id) WHERE status='pending' AND target_id IS NOT NULL;
CREATE TABLE platform.policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version integer NOT NULL UNIQUE,payload jsonb NOT NULL,
 published_by uuid NOT NULL REFERENCES platform.accounts(id),approval_id uuid NOT NULL UNIQUE REFERENCES platform.change_requests(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION padmin.staff(p_actor uuid,p_query text,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'accounts.manage');
 SELECT coalesce(jsonb_agg(x),'[]') INTO v FROM (
 SELECT a.id,a.version,a.display_name,a.email,a.status,a.mfa_enrolled,a.last_login_at,a.created_at,
 (SELECT coalesce(jsonb_agg(r.code ORDER BY r.code),'[]') FROM platform.account_roles ar JOIN platform.roles r ON r.id=ar.role_id WHERE ar.account_id=a.id) AS roles,
 (SELECT count(*) FROM platform.sessions s WHERE s.account_id=a.id AND s.revoked_at IS NULL AND s.expires_at>now()) AS active_sessions
 FROM platform.accounts a WHERE a.display_name ILIKE '%'||p_query||'%' OR a.email ILIKE '%'||p_query||'%'
 ORDER BY a.created_at DESC,a.id LIMIT 51 OFFSET greatest(p_offset,0)) x;
 RETURN jsonb_build_object('items',v);
END $$;
CREATE FUNCTION padmin.role_catalog(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'accounts.manage');
 SELECT jsonb_agg(jsonb_build_object('code',r.code,'permissions',(SELECT jsonb_agg(p.code ORDER BY p.code) FROM platform.role_permissions rp JOIN platform.permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id)) ORDER BY r.code) INTO v FROM platform.roles r;
 RETURN v;
END $$;
CREATE FUNCTION padmin.invite_staff(p_actor uuid,p_email text,p_name text,p_roles text[],p_token text,p_totp text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a uuid;
BEGIN
 PERFORM padmin.require(p_actor,'accounts.manage');
 IF coalesce(cardinality(p_roles),0)<1 OR EXISTS(SELECT 1 FROM unnest(p_roles) x WHERE x IS NULL OR x IN ('super_admin','billing_approver') OR NOT EXISTS(SELECT 1 FROM platform.roles r WHERE r.code=x)) THEN
 RAISE EXCEPTION 'roles need approval' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(17017);
 IF EXISTS(SELECT 1 FROM platform.accounts WHERE lower(email)=lower(trim(p_email))) THEN RETURN jsonb_build_object('outcome','exists'); END IF;
 INSERT INTO platform.accounts(email,display_name,status) VALUES(lower(trim(p_email)),p_name,'invited') RETURNING id INTO a;
 INSERT INTO platform.account_roles(account_id,role_id) SELECT a,id FROM platform.roles WHERE code=ANY(p_roles);
 INSERT INTO platform.staff_invitations(account_id,token_hash,totp_sealed,created_by) VALUES(a,p_token,p_totp,p_actor);
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,details,request_id)
 VALUES(p_actor,'staff.invited','platform_account',a,jsonb_build_object('roles',p_roles),p_request);
 RETURN jsonb_build_object('outcome','ok','account_id',a);
END $$;
CREATE FUNCTION padmin.invitation_context(p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',i.id,'account_id',a.id,'email',a.email,'display_name',a.display_name,'totp_sealed',i.totp_sealed)
 FROM platform.staff_invitations i JOIN platform.accounts a ON a.id=i.account_id
 WHERE i.token_hash=p_hash AND a.status='invited' AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.attempts<5 AND i.expires_at>now()
$$;
CREATE FUNCTION padmin.refresh_invitation(p_actor uuid,p_target uuid,p_version integer,p_token text,p_totp text,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'accounts.manage');PERFORM pg_advisory_xact_lock(17017);
 UPDATE platform.accounts SET updated_at=now() WHERE id=p_target AND version=p_version AND status='invited';
 IF NOT FOUND THEN RETURN 'conflict'; END IF;
 UPDATE platform.staff_invitations SET revoked_at=now() WHERE account_id=p_target AND consumed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO platform.staff_invitations(account_id,token_hash,totp_sealed,created_by) VALUES(p_target,p_token,p_totp,p_actor);
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,'staff.reinvited','platform_account',p_target,p_reason,p_request);RETURN 'ok';
END $$;
CREATE FUNCTION padmin.enroll_staff(p_hash text,p_password text,p_step bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i platform.staff_invitations%ROWTYPE;
BEGIN
 SELECT * INTO i FROM platform.staff_invitations WHERE token_hash=p_hash FOR UPDATE;
 IF i.id IS NULL OR i.consumed_at IS NOT NULL OR i.revoked_at IS NOT NULL OR i.expires_at<=now() OR i.attempts>=5 THEN RETURN 'invalid'; END IF;
 IF p_step IS NULL THEN UPDATE platform.staff_invitations SET attempts=attempts+1 WHERE id=i.id;RETURN 'invalid'; END IF;
 UPDATE platform.accounts SET status='active',password_hash=p_password,totp_secret_sealed=i.totp_sealed,totp_last_step=p_step,mfa_enrolled=true WHERE id=i.account_id AND status='invited';
 IF NOT FOUND THEN RETURN 'invalid'; END IF;
 UPDATE platform.staff_invitations SET consumed_at=now() WHERE id=i.id;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id) VALUES(i.account_id,'staff.enrolled','platform_account',i.account_id);
 RETURN 'ok';
END $$;
CREATE FUNCTION padmin.staff_action(p_actor uuid,p_target uuid,p_action text,p_version integer,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a platform.accounts%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_actor,'accounts.manage');PERFORM pg_advisory_xact_lock(17017);
 SELECT * INTO a FROM platform.accounts WHERE id=p_target FOR UPDATE;
 IF a.id IS NULL THEN RETURN 'not_found'; END IF;
 IF a.version<>p_version THEN RETURN 'conflict'; END IF;
 IF p_target=p_actor THEN RETURN 'self'; END IF;
 IF p_action='disable' AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.roles r ON r.id=ar.role_id WHERE ar.account_id=p_target AND r.code='super_admin')
 AND NOT EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.roles r ON r.id=ar.role_id JOIN platform.accounts x ON x.id=ar.account_id WHERE x.id<>p_target AND x.status='active' AND r.code='super_admin') THEN RETURN 'last_admin'; END IF;
 IF p_action='disable' THEN
   UPDATE platform.accounts SET status='disabled' WHERE id=p_target;
   UPDATE platform.staff_invitations SET revoked_at=now() WHERE account_id=p_target AND consumed_at IS NULL;
 ELSIF p_action='enable' THEN
   IF a.password_hash IS NULL OR a.totp_secret_sealed IS NULL THEN RETURN 'not_enrolled'; END IF;
   UPDATE platform.accounts SET status='active' WHERE id=p_target;
 ELSIF p_action<>'revoke_sessions' THEN RETURN 'invalid'; END IF;
 UPDATE platform.sessions SET revoked_at=now() WHERE account_id=p_target AND revoked_at IS NULL;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,'staff.'||p_action,'platform_account',p_target,p_reason,p_request);
 RETURN 'ok';
END $$;
CREATE FUNCTION padmin.catalog(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'plans.manage');
 RETURN jsonb_build_object('plans',(SELECT coalesce(jsonb_agg(x ORDER BY x.code),'[]') FROM (
 SELECT p.*,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',pv.id,'version_no',pv.version_no,'technician_seats',pv.technician_seats,'storage_bytes',pv.storage_bytes,'ocr_per_period',pv.ocr_per_period,'trial_days',pv.trial_days,'grace_days',pv.grace_days,'published_at',pv.published_at,'prices',(SELECT jsonb_agg(pr ORDER BY pr.effective_from DESC) FROM billing.price_versions pr WHERE pr.plan_version_id=pv.id)) ORDER BY pv.version_no DESC),'[]') FROM billing.plan_versions pv WHERE pv.plan_id=p.id) AS versions FROM billing.plans p) x),
 'drafts',(SELECT coalesce(jsonb_agg(d ORDER BY d.created_at DESC),'[]') FROM platform.plan_drafts d WHERE d.status IN ('draft','pending')));
END $$;
CREATE FUNCTION padmin.save_plan_draft(p_actor uuid,p_id uuid,p_version integer,p_payload jsonb,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d platform.plan_drafts%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_actor,'plans.manage');
 IF p_id IS NULL THEN INSERT INTO platform.plan_drafts(payload,created_by) VALUES(p_payload,p_actor) RETURNING * INTO d;
 ELSE UPDATE platform.plan_drafts SET payload=p_payload,version=version+1 WHERE id=p_id AND version=p_version AND status='draft' RETURNING * INTO d;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','conflict'); END IF; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,request_id) VALUES(p_actor,'plan.draft_saved','plan_draft',d.id,p_request);
 RETURN to_jsonb(d)||jsonb_build_object('outcome','ok');
END $$;
CREATE FUNCTION padmin.archive_plan(p_actor uuid,p_id uuid,p_version integer,p_reason text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require(p_actor,'plans.publish');
 UPDATE billing.plans SET status='archived' WHERE id=p_id AND version=p_version;
 IF NOT FOUND THEN RETURN 'conflict'; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,request_id) VALUES(p_actor,'plan.archived','plan',p_id,p_reason,p_request);
 RETURN 'ok';
END $$;
CREATE FUNCTION padmin.submit_change(p_actor uuid,p_kind text,p_target uuid,p_version integer,p_payload jsonb,p_reason text,p_request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v uuid;
BEGIN
 IF p_kind IN ('roles','recovery') THEN
   PERFORM padmin.require(p_actor,'accounts.manage');
   IF p_actor=p_target OR NOT EXISTS(SELECT 1 FROM platform.accounts WHERE id=p_target AND version=p_version AND status<>'disabled') THEN RAISE EXCEPTION 'invalid target' USING ERRCODE='42501'; END IF;
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
 RETURN v;
END $$;
CREATE FUNCTION padmin.approvals(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'approvals.read');
 IF NOT EXISTS(SELECT 1 FROM platform.accounts a JOIN platform.account_roles ar ON ar.account_id=a.id JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id
 WHERE a.id=p_actor AND a.status='active' AND p.code IN ('accounts.manage','accounts.approve','plans.manage','plans.publish','settings.manage','policy.approve')) THEN RAISE EXCEPTION 'permission required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v FROM (
 SELECT c.*,a.display_name AS requester FROM platform.change_requests c JOIN platform.accounts a ON a.id=c.requested_by
 WHERE (c.kind IN ('roles','recovery') AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id WHERE ar.account_id=p_actor AND p.code IN ('accounts.manage','accounts.approve')))
 OR (c.kind='plan' AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id WHERE ar.account_id=p_actor AND p.code IN ('plans.manage','plans.publish')))
 OR (c.kind='policy' AND EXISTS(SELECT 1 FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id=ar.role_id JOIN platform.permissions p ON p.id=rp.permission_id WHERE ar.account_id=p_actor AND p.code IN ('settings.manage','policy.approve')))
 ORDER BY (c.status='pending') DESC,c.created_at DESC LIMIT 200) x;
 RETURN v;
END $$;
CREATE FUNCTION padmin.decide_change(p_actor uuid,p_id uuid,p_approve boolean,p_note text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c platform.change_requests%ROWTYPE;d platform.plan_drafts%ROWTYPE;pl uuid;pv uuid;payload jsonb;item jsonb;v integer;
BEGIN
 PERFORM pg_advisory_xact_lock(17017);
 SELECT * INTO c FROM platform.change_requests WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL THEN RETURN 'not_found'; END IF;
 PERFORM padmin.require(p_actor,CASE WHEN c.kind IN ('roles','recovery') THEN 'accounts.approve' WHEN c.kind='plan' THEN 'plans.publish' ELSE 'policy.approve' END);
 IF c.requested_by=p_actor OR (c.kind IN ('roles','recovery') AND c.target_id=p_actor) THEN RETURN 'self'; END IF;
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
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,reason,details,request_id) VALUES(p_actor,CASE WHEN p_approve THEN 'approval.approved' ELSE 'approval.rejected' END,'change_request',c.id,p_note,jsonb_build_object('kind',c.kind),p_request);
 RETURN 'ok';
END $$;
CREATE FUNCTION padmin.policy(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'settings.manage');
 SELECT to_jsonb(p) INTO v FROM platform.policy_versions p ORDER BY version DESC LIMIT 1;
 RETURN coalesce(v,jsonb_build_object('version',0,'payload',jsonb_build_object('new_shops_enabled',true,'new_payments_enabled',true)));
END $$;
CREATE OR REPLACE FUNCTION padmin.runtime_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT to_jsonb(s) FROM platform.runtime_settings s WHERE id),'{}'::jsonb)||
 jsonb_build_object('policy',(SELECT payload FROM platform.policy_versions ORDER BY version DESC LIMIT 1))
$$;
REVOKE ALL ON platform.staff_invitations,platform.plan_drafts,platform.change_requests,platform.policy_versions FROM PUBLIC;
REVOKE ALL ON FUNCTION padmin.staff(uuid,text,integer),padmin.role_catalog(uuid),padmin.invite_staff(uuid,text,text,text[],text,text,uuid),
 padmin.invitation_context(text),padmin.enroll_staff(text,text,bigint),padmin.staff_action(uuid,uuid,text,integer,text,uuid),padmin.catalog(uuid),
 padmin.save_plan_draft(uuid,uuid,integer,jsonb,uuid),padmin.archive_plan(uuid,uuid,integer,text,uuid),padmin.submit_change(uuid,text,uuid,integer,jsonb,text,uuid),
 padmin.approvals(uuid),padmin.decide_change(uuid,uuid,boolean,text,uuid),padmin.policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION padmin.refresh_invitation(uuid,uuid,integer,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.refresh_invitation(uuid,uuid,integer,text,text,text,uuid) TO fs_platform;
GRANT EXECUTE ON FUNCTION padmin.staff(uuid,text,integer),padmin.role_catalog(uuid),padmin.invite_staff(uuid,text,text,text[],text,text,uuid),
 padmin.invitation_context(text),padmin.enroll_staff(text,text,bigint),padmin.staff_action(uuid,uuid,text,integer,text,uuid),padmin.catalog(uuid),
 padmin.save_plan_draft(uuid,uuid,integer,jsonb,uuid),padmin.archive_plan(uuid,uuid,integer,text,uuid),padmin.submit_change(uuid,text,uuid,integer,jsonb,text,uuid),
 padmin.approvals(uuid),padmin.decide_change(uuid,uuid,boolean,text,uuid),padmin.policy(uuid) TO fs_platform;
