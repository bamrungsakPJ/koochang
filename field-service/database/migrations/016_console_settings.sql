-- Console-managed receiver/providers and personal account security.
INSERT INTO platform.permissions(code) VALUES ('settings.manage');
INSERT INTO platform.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.code IN ('super_admin','platform_admin') AND p.code='settings.manage';
CREATE TABLE platform.runtime_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), version integer NOT NULL DEFAULT 1,
 bank jsonb, sms jsonb, easyslip jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform.runtime_settings FROM PUBLIC;
CREATE FUNCTION padmin.runtime_settings() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT to_jsonb(s) FROM platform.runtime_settings s WHERE id
$$;
CREATE FUNCTION padmin.console_settings(p_account uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s platform.runtime_settings%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account,'settings.manage');
 SELECT * INTO s FROM platform.runtime_settings WHERE id;
 RETURN jsonb_build_object('version',coalesce(s.version,0),'bank',s.bank,
 'sms',CASE WHEN s.sms IS NULL THEN NULL ELSE s.sms-'apiKeySealed'-'secretKeySealed' ||
   jsonb_build_object('key_configured',s.sms ? 'apiKeySealed' AND s.sms ? 'secretKeySealed') END,
 'easyslip',CASE WHEN s.easyslip IS NULL THEN NULL ELSE s.easyslip-'keySealed' ||
   jsonb_build_object('key_configured',s.easyslip ? 'keySealed') END);
END $$;
CREATE FUNCTION padmin.save_console_settings(p_account uuid,p_section text,p_value jsonb,p_version integer,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s platform.runtime_settings%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account,'settings.manage');
 IF p_section NOT IN ('bank','sms','easyslip') OR jsonb_typeof(p_value)<>'object' THEN RAISE EXCEPTION 'invalid settings' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_value->'enabled') IS DISTINCT FROM 'boolean' OR
   (p_section='bank' AND p_value-ARRAY['enabled','bankName','accountName','accountNumber','bankCode','promptPayId']<>'{}'::jsonb) OR
   (p_section='sms' AND p_value-ARRAY['enabled','sender','apiKeySealed','secretKeySealed']<>'{}'::jsonb) OR
   (p_section='easyslip' AND p_value-ARRAY['enabled','keySealed']<>'{}'::jsonb) THEN
   RAISE EXCEPTION 'invalid settings fields' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(16016);
 SELECT * INTO s FROM platform.runtime_settings WHERE id FOR UPDATE;
 IF coalesce(s.version,0)<>p_version THEN RETURN 'conflict'; END IF;
 IF s.id IS NULL THEN INSERT INTO platform.runtime_settings(id,version) VALUES(true,1);
 ELSE UPDATE platform.runtime_settings SET version=version+1,updated_at=now() WHERE id; END IF;
 IF p_section='bank' THEN UPDATE platform.runtime_settings SET bank=p_value WHERE id;
 ELSIF p_section='sms' THEN UPDATE platform.runtime_settings SET sms=coalesce(s.sms,'{}')||p_value WHERE id;
 ELSE UPDATE platform.runtime_settings SET easyslip=coalesce(s.easyslip,'{}')||p_value WHERE id; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,details,request_id)
 VALUES(p_account,'console_settings.updated','platform_settings',jsonb_build_object('section',p_section,'enabled',p_value->'enabled'),p_request);
 RETURN 'ok';
END $$;

-- Own-account functions bind the account to a complete, unexpired session.
CREATE FUNCTION padmin.require_own_session(p_account uuid,p_hash text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM platform.sessions s JOIN platform.accounts a ON a.id=s.account_id
 WHERE s.account_id=p_account AND s.token_hash=p_hash AND s.mfa_verified_at IS NOT NULL
 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active') THEN
 RAISE EXCEPTION 'own session required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION padmin.account_profile(p_account uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require_own_session(p_account,p_hash);
 SELECT jsonb_build_object('id',id,'version',version,'display_name',display_name,'email',email,
 'preferred_language',preferred_language,'mfa_enrolled',mfa_enrolled) INTO v FROM platform.accounts WHERE id=p_account;
 RETURN v;
END $$;
CREATE FUNCTION padmin.update_profile(p_account uuid,p_hash text,p_name text,p_language text,p_version integer,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require_own_session(p_account,p_hash);
 IF length(trim(p_name)) NOT BETWEEN 1 AND 100 OR p_language NOT IN ('th','en') THEN RAISE EXCEPTION 'invalid profile' USING ERRCODE='22023'; END IF;
 UPDATE platform.accounts SET display_name=trim(p_name),preferred_language=p_language WHERE id=p_account AND version=p_version;
 IF NOT FOUND THEN RETURN 'conflict'; END IF;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,request_id)
 VALUES(p_account,'account.profile_updated','platform_account',p_account,p_request);
 RETURN 'ok';
END $$;
CREATE FUNCTION padmin.account_sessions(p_account uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require_own_session(p_account,p_hash);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'expires_at',expires_at,
 'client',left(client,300),'current',token_hash=p_hash) ORDER BY created_at DESC),'[]') INTO v
 FROM platform.sessions WHERE account_id=p_account AND mfa_verified_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now();
 RETURN v;
END $$;
CREATE FUNCTION padmin.revoke_other_sessions(p_account uuid,p_hash text,p_request uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE n integer;
BEGIN
 PERFORM padmin.require_own_session(p_account,p_hash);
 UPDATE platform.sessions SET revoked_at=now() WHERE account_id=p_account AND token_hash<>p_hash AND revoked_at IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,details,request_id)
 VALUES(p_account,'account.sessions_revoked','platform_account',p_account,jsonb_build_object('count',n),p_request);
 RETURN n;
END $$;
CREATE FUNCTION padmin.change_password(p_account uuid,p_hash text,p_old_hash text,p_new_hash text,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM padmin.require_own_session(p_account,p_hash);
 UPDATE platform.accounts SET password_hash=p_new_hash,failed_logins=0,locked_until=NULL WHERE id=p_account AND password_hash=p_old_hash;
 IF NOT FOUND THEN RETURN 'conflict'; END IF;
 PERFORM padmin.revoke_other_sessions(p_account,p_hash,p_request);
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,request_id)
 VALUES(p_account,'account.password_changed','platform_account',p_account,p_request);
 RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION padmin.runtime_settings(),padmin.console_settings(uuid),padmin.save_console_settings(uuid,text,jsonb,integer,uuid),
 padmin.require_own_session(uuid,text),padmin.account_profile(uuid,text),padmin.update_profile(uuid,text,text,text,integer,uuid),
 padmin.account_sessions(uuid,text),padmin.revoke_other_sessions(uuid,text,uuid),padmin.change_password(uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.runtime_settings(),padmin.console_settings(uuid),padmin.save_console_settings(uuid,text,jsonb,integer,uuid),
 padmin.account_profile(uuid,text),padmin.update_profile(uuid,text,text,text,integer,uuid),padmin.account_sessions(uuid,text),
 padmin.revoke_other_sessions(uuid,text,uuid),padmin.change_password(uuid,text,text,text,uuid) TO fs_platform;
