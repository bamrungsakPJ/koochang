-- Brand logo and favicon, changed by a super admin in the console.
-- Images are re-encoded by the API (PNG, logo at most 512 px, favicon 64 px) before they reach the
-- database, so only small, sanitized files are stored. They are public: the sign-in pages, the join
-- page and browser tabs show them before anyone signs in.

INSERT INTO platform.permissions(code) VALUES ('branding.manage') ON CONFLICT DO NOTHING;
INSERT INTO platform.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.code='super_admin' AND p.code='branding.manage' ON CONFLICT DO NOTHING;

CREATE TABLE platform.branding (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 logo bytea CHECK(logo IS NULL OR octet_length(logo) BETWEEN 1 AND 1048576),
 favicon bytea CHECK(favicon IS NULL OR octet_length(favicon) BETWEEN 1 AND 262144),
 -- false: the favicon was made from the logo and follows it; true: uploaded on its own.
 favicon_custom boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES platform.accounts(id)
);
REVOKE ALL ON platform.branding FROM PUBLIC;

-- Public summary: which images exist and a version for cache busting.
CREATE FUNCTION padmin.branding() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('version',coalesce(max(b.version),0),'logo',coalesce(bool_or(b.logo IS NOT NULL),false),
   'favicon',coalesce(bool_or(b.favicon IS NOT NULL),false),'favicon_custom',coalesce(bool_or(b.favicon_custom),false),'updated_at',max(b.updated_at))
 FROM platform.branding b WHERE b.id
$$;

CREATE FUNCTION padmin.branding_image(p_kind text) RETURNS TABLE(content bytea, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p_kind WHEN 'logo' THEN b.logo WHEN 'favicon' THEN b.favicon END, b.version
 FROM platform.branding b WHERE b.id AND CASE p_kind WHEN 'logo' THEN b.logo WHEN 'favicon' THEN b.favicon END IS NOT NULL
$$;

-- p_action: 'logo' (new logo; p_favicon is its derived favicon, kept only while the favicon is not
-- custom), 'favicon' (custom favicon), 'reset_logo', 'reset_favicon' (back to the one made from the
-- logo, or none). Optimistic version check; every change is audited.
CREATE FUNCTION padmin.save_branding(p_account uuid,p_action text,p_logo bytea,p_favicon bytea,p_version integer,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b platform.branding%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account,'branding.manage');
 IF p_action NOT IN ('logo','favicon','reset_logo','reset_favicon')
   OR (p_action='logo' AND (p_logo IS NULL OR p_favicon IS NULL)) OR (p_action='favicon' AND p_favicon IS NULL) THEN
   RAISE EXCEPTION 'invalid branding change' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(16025);
 SELECT * INTO b FROM platform.branding WHERE id FOR UPDATE;
 IF coalesce(b.version,0)<>p_version THEN RETURN 'conflict'; END IF;
 IF b.id IS NULL THEN INSERT INTO platform.branding(id) VALUES(true) RETURNING * INTO b;
 ELSE UPDATE platform.branding SET version=version+1 WHERE id RETURNING * INTO b; END IF;
 IF p_action='logo' THEN
   UPDATE platform.branding SET logo=p_logo, favicon=CASE WHEN favicon_custom THEN favicon ELSE p_favicon END WHERE id;
 ELSIF p_action='favicon' THEN
   UPDATE platform.branding SET favicon=p_favicon, favicon_custom=true WHERE id;
 ELSIF p_action='reset_logo' THEN
   UPDATE platform.branding SET logo=NULL, favicon=CASE WHEN favicon_custom THEN favicon END WHERE id;
 ELSE
   -- p_favicon here is the favicon made from the current logo (NULL when there is no logo).
   UPDATE platform.branding SET favicon=CASE WHEN logo IS NULL THEN NULL ELSE p_favicon END, favicon_custom=false WHERE id;
 END IF;
 UPDATE platform.branding SET updated_at=now(), updated_by=p_account WHERE id;
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,details,request_id)
 VALUES(p_account,'branding.updated','platform_settings',jsonb_build_object('change',p_action),p_request);
 RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION padmin.branding(),padmin.branding_image(text),padmin.save_branding(uuid,text,bytea,bytea,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.branding(),padmin.branding_image(text),padmin.save_branding(uuid,text,bytea,bytea,integer,uuid) TO fs_platform;
