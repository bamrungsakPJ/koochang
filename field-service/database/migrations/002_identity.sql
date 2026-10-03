-- A02 identity: phone OTP, sessions, shop creation, reusable join links and team approval.
-- PostgreSQL 16 target. Apply as fs_migrator.
--
-- Identity work happens before a tenant context exists (sign in, create a shop, ask to join),
-- so it runs through SECURITY DEFINER functions in schema auth. fs_api gets EXECUTE on those
-- functions only; it gets no grants on the auth tables and no new write grants on core tables.
-- The functions run as fs_migrator (the table owner). FORCE RLS applies to the owner too, so the
-- tables they touch get an explicit fs_migrator policy below.

CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO fs_api;

CREATE POLICY identity_functions ON core.users TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON core.organizations TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON core.organization_members TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON core.organization_join_links TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON core.jobs TO fs_migrator USING (true);
CREATE POLICY identity_functions ON billing.subscriptions TO fs_migrator USING (true);
CREATE POLICY identity_functions ON ops.audit_logs TO fs_migrator USING (true) WITH CHECK (true);

-- users ----------------------------------------------------------------------------------
ALTER TABLE core.users ADD COLUMN phone_verified_at timestamptz;
ALTER TABLE core.users ADD CONSTRAINT users_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE core.users ADD CONSTRAINT users_verified_has_phone CHECK (phone_verified_at IS NULL OR phone_e164 IS NOT NULL);

-- organizations: retrying "create shop" with the same client request id returns the same shop.
ALTER TABLE core.organizations
  ADD COLUMN contact_phone text,
  ADD COLUMN created_by_user_id uuid REFERENCES core.users(id),
  ADD COLUMN creation_request_id uuid,
  ADD CONSTRAINT organizations_creation_request UNIQUE (created_by_user_id, creation_request_id);

-- organization_members -------------------------------------------------------------------
ALTER TABLE core.organization_members
  ADD COLUMN display_name text,
  ADD COLUMN approved_by_member_id uuid,
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN removed_at timestamptz,
  ADD COLUMN joined_via_link_id uuid;
UPDATE core.organization_members m SET display_name = u.display_name FROM core.users u WHERE u.id = m.user_id;
ALTER TABLE core.organization_members
  ALTER COLUMN display_name SET NOT NULL,
  ADD CONSTRAINT members_display_name CHECK (length(trim(display_name)) > 0),
  ADD CONSTRAINT members_removed_at CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  ADD FOREIGN KEY (organization_id, approved_by_member_id) REFERENCES core.organization_members(organization_id, id);

-- organization_join_links ----------------------------------------------------------------
-- One current link per shop: active (accepting requests) or closed (paused). Reset revokes it
-- and creates the next generation. The token is stored hashed for lookup and encrypted (key
-- outside the database) so the owner can share the same link again.
ALTER TABLE core.organization_join_links
  ADD COLUMN token_ciphertext text NOT NULL,
  ADD COLUMN generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  ADD COLUMN created_by_member_id uuid NOT NULL,
  ADD COLUMN closed_at timestamptz,
  ADD FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id),
  ADD CONSTRAINT join_links_revoked_at CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  ADD CONSTRAINT join_links_generation UNIQUE (organization_id, generation);
CREATE UNIQUE INDEX one_current_join_link ON core.organization_join_links(organization_id) WHERE status IN ('active','closed');
ALTER TABLE core.organization_members
  ADD FOREIGN KEY (organization_id, joined_via_link_id) REFERENCES core.organization_join_links(organization_id, id);

-- auth tables (no grants to fs_api) ------------------------------------------------------
CREATE TABLE auth.otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hmac text NOT NULL CHECK (length(code_hmac) = 64),
  client_key_hash text CHECK (client_key_hash IS NULL OR length(client_key_hash) = 64),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX otp_by_phone ON auth.otp_challenges(phone_e164, created_at DESC);
CREATE INDEX otp_by_client ON auth.otp_challenges(client_key_hash, created_at DESC) WHERE client_key_hash IS NOT NULL;

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES core.users(id),
  access_hash text NOT NULL UNIQUE CHECK (length(access_hash) = 64),
  access_expires_at timestamptz NOT NULL,
  refresh_hash text NOT NULL UNIQUE CHECK (length(refresh_hash) = 64),
  refresh_expires_at timestamptz NOT NULL,
  rotation integer NOT NULL DEFAULT 0 CHECK (rotation >= 0),
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('logout','refresh_reuse','user_disabled')),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE INDEX sessions_by_user ON auth.sessions(user_id) WHERE revoked_at IS NULL;

-- A refresh token presented after it was rotated means it leaked: the whole session is revoked.
CREATE TABLE auth.retired_refresh_tokens (
  refresh_hash text PRIMARY KEY CHECK (length(refresh_hash) = 64),
  session_id uuid NOT NULL REFERENCES auth.sessions(id),
  retired_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE auth.otp_challenges ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.otp_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.retired_refresh_tokens ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.retired_refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_functions ON auth.otp_challenges TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON auth.sessions TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON auth.retired_refresh_tokens TO fs_migrator USING (true) WITH CHECK (true);

-- helpers ----------------------------------------------------------------------------------
-- Trial baseline (3 technicians) until A03 implements subscriptions and entitlements.
CREATE FUNCTION auth.technician_seat_limit(p_organization_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT pv.technician_seats FROM billing.subscriptions s
    JOIN billing.plan_versions pv ON pv.id = s.plan_version_id WHERE s.organization_id = p_organization_id), 3)
$$;

-- Member id of the caller when the caller is the active owner of an active shop, else NULL.
CREATE FUNCTION auth.owner_member_id(p_user_id uuid, p_organization_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id FROM core.organization_members m
    JOIN core.users u ON u.id = m.user_id
    JOIN core.organizations o ON o.id = m.organization_id
  WHERE m.organization_id = p_organization_id AND m.user_id = p_user_id AND m.role = 'owner'
    AND m.status = 'active' AND u.status = 'active' AND o.status = 'active'
$$;

-- OTP ----------------------------------------------------------------------------------------
-- The API generates the code, sends it and passes only HMAC(code). Limits are enforced here,
-- under a per-phone lock, so parallel requests cannot exceed them.
CREATE FUNCTION auth.create_otp_challenge(
  p_challenge_id uuid, p_phone text, p_code_hmac text, p_client_key_hash text,
  p_ttl_seconds integer, p_max_attempts integer, p_cooldown_seconds integer,
  p_phone_hourly_limit integer, p_client_hourly_limit integer)
RETURNS TABLE (challenge_id uuid, expires_at timestamptz, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_last timestamptz; v_count integer; v_oldest timestamptz; v_wait integer := 0;
  v_id uuid; v_expires timestamptz;
BEGIN
  IF p_ttl_seconds NOT BETWEEN 60 AND 900 OR p_max_attempts NOT BETWEEN 1 AND 10
     OR p_cooldown_seconds < 30 OR p_phone_hourly_limit NOT BETWEEN 1 AND 20 OR p_client_hourly_limit < 1 THEN
    RAISE EXCEPTION 'OTP_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('otp:' || p_phone, 0));

  SELECT max(c.created_at) INTO v_last FROM auth.otp_challenges c WHERE c.phone_e164 = p_phone;
  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => p_cooldown_seconds) THEN
    v_wait := greatest(v_wait, ceil(extract(epoch FROM v_last + make_interval(secs => p_cooldown_seconds) - now()))::integer);
  END IF;

  SELECT count(*), min(c.created_at) INTO v_count, v_oldest FROM auth.otp_challenges c
    WHERE c.phone_e164 = p_phone AND c.created_at > now() - interval '1 hour';
  IF v_count >= p_phone_hourly_limit THEN
    v_wait := greatest(v_wait, ceil(extract(epoch FROM v_oldest + interval '1 hour' - now()))::integer);
  END IF;

  IF p_client_key_hash IS NOT NULL THEN
    SELECT count(*), min(c.created_at) INTO v_count, v_oldest FROM auth.otp_challenges c
      WHERE c.client_key_hash = p_client_key_hash AND c.created_at > now() - interval '1 hour';
    IF v_count >= p_client_hourly_limit THEN
      v_wait := greatest(v_wait, ceil(extract(epoch FROM v_oldest + interval '1 hour' - now()))::integer);
    END IF;
  END IF;

  IF v_wait > 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::timestamptz, greatest(v_wait, 1);
    RETURN;
  END IF;

  INSERT INTO auth.otp_challenges(id, phone_e164, code_hmac, client_key_hash, expires_at, max_attempts)
    VALUES (p_challenge_id, p_phone, p_code_hmac, p_client_key_hash, now() + make_interval(secs => p_ttl_seconds), p_max_attempts)
    RETURNING id, otp_challenges.expires_at INTO v_id, v_expires;
  RETURN QUERY SELECT v_id, v_expires, 0;
END $$;

CREATE FUNCTION auth.issue_session(p_user_id uuid, p_access_hash text, p_access_ttl integer, p_refresh_hash text, p_refresh_ttl integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_access_ttl NOT BETWEEN 60 AND 86400 OR p_refresh_ttl NOT BETWEEN 3600 AND 31536000 OR p_refresh_ttl <= p_access_ttl THEN
    RAISE EXCEPTION 'SESSION_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO auth.sessions(user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
    VALUES (p_user_id, p_access_hash, now() + make_interval(secs => p_access_ttl), p_refresh_hash, now() + make_interval(secs => p_refresh_ttl))
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION auth.issue_session(uuid, text, integer, text, integer) FROM PUBLIC;

-- Verifying a challenge is the only way to obtain a session for a phone number. The same
-- verified phone always maps to the same user, so signing up twice never creates a duplicate.
-- outcome: ok | invalid | expired | attempts_exceeded | user_disabled
CREATE FUNCTION auth.verify_otp(
  p_challenge_id uuid, p_code_hmac text, p_display_name text, p_language text,
  p_access_hash text, p_access_ttl integer, p_refresh_hash text, p_refresh_ttl integer)
RETURNS TABLE (outcome text, user_id uuid, is_new_user boolean, session_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c auth.otp_challenges%ROWTYPE; v_user core.users%ROWTYPE; v_new boolean := false; v_name text;
BEGIN
  SELECT * INTO c FROM auth.otp_challenges WHERE id = p_challenge_id FOR UPDATE;
  IF NOT FOUND OR c.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, false, NULL::uuid; RETURN;
  END IF;
  IF c.expires_at <= now() OR EXISTS (SELECT 1 FROM auth.otp_challenges n WHERE n.phone_e164 = c.phone_e164 AND n.created_at > c.created_at) THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, false, NULL::uuid; RETURN;
  END IF;
  IF c.attempts >= c.max_attempts THEN
    RETURN QUERY SELECT 'attempts_exceeded'::text, NULL::uuid, false, NULL::uuid; RETURN;
  END IF;
  IF c.code_hmac <> p_code_hmac THEN
    UPDATE auth.otp_challenges SET attempts = attempts + 1 WHERE id = c.id;
    RETURN QUERY SELECT CASE WHEN c.attempts + 1 >= c.max_attempts THEN 'attempts_exceeded' ELSE 'invalid' END::text, NULL::uuid, false, NULL::uuid;
    RETURN;
  END IF;

  UPDATE auth.otp_challenges SET consumed_at = now(), attempts = attempts + 1 WHERE id = c.id;
  v_name := nullif(trim(coalesce(p_display_name, '')), '');
  SELECT * INTO v_user FROM core.users WHERE phone_e164 = c.phone_e164 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO core.users(display_name, phone_e164, phone_verified_at, preferred_language)
      VALUES (coalesce(v_name, c.phone_e164), c.phone_e164, now(), CASE WHEN p_language IN ('th','en') THEN p_language ELSE 'th' END)
      ON CONFLICT (phone_e164) DO NOTHING
      RETURNING * INTO v_user;
    IF v_user.id IS NULL THEN
      SELECT * INTO v_user FROM core.users WHERE phone_e164 = c.phone_e164 FOR UPDATE;
    ELSE
      v_new := true;
    END IF;
  END IF;
  IF v_user.status <> 'active' THEN
    RETURN QUERY SELECT 'user_disabled'::text, NULL::uuid, false, NULL::uuid; RETURN;
  END IF;
  IF v_user.phone_verified_at IS NULL THEN
    UPDATE core.users SET phone_verified_at = now() WHERE id = v_user.id;
  END IF;
  RETURN QUERY SELECT 'ok'::text, v_user.id, v_new,
    auth.issue_session(v_user.id, p_access_hash, p_access_ttl, p_refresh_hash, p_refresh_ttl);
END $$;

-- sessions -----------------------------------------------------------------------------------
-- state: active | expired | invalid. Membership is not cached here: every tenant request
-- re-checks membership, so suspend/remove takes effect on the next request.
CREATE FUNCTION auth.resolve_session(p_access_hash text)
RETURNS TABLE (state text, user_id uuid, session_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s auth.sessions%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO s FROM auth.sessions WHERE access_hash = p_access_hash;
  IF NOT FOUND OR s.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  SELECT u.status INTO v_status FROM core.users u WHERE u.id = s.user_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF s.access_expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF s.last_used_at < now() - interval '5 minutes' THEN
    UPDATE auth.sessions SET last_used_at = now() WHERE id = s.id;
  END IF;
  RETURN QUERY SELECT 'active'::text, s.user_id, s.id;
END $$;

-- outcome: ok | invalid | expired | reused
CREATE FUNCTION auth.refresh_session(p_refresh_hash text, p_access_hash text, p_access_ttl integer, p_new_refresh_hash text, p_refresh_ttl integer)
RETURNS TABLE (outcome text, user_id uuid, session_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s auth.sessions%ROWTYPE; v_retired uuid; v_status text;
BEGIN
  SELECT r.session_id INTO v_retired FROM auth.retired_refresh_tokens r WHERE r.refresh_hash = p_refresh_hash;
  IF FOUND THEN
    UPDATE auth.sessions SET revoked_at = now(), revoke_reason = 'refresh_reuse' WHERE id = v_retired AND revoked_at IS NULL;
    RETURN QUERY SELECT 'reused'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO s FROM auth.sessions WHERE refresh_hash = p_refresh_hash FOR UPDATE;
  IF NOT FOUND OR s.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF s.refresh_expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  SELECT u.status INTO v_status FROM core.users u WHERE u.id = s.user_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    UPDATE auth.sessions SET revoked_at = now(), revoke_reason = 'user_disabled' WHERE id = s.id;
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF p_access_ttl NOT BETWEEN 60 AND 86400 OR p_refresh_ttl NOT BETWEEN 3600 AND 31536000 THEN
    RAISE EXCEPTION 'SESSION_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO auth.retired_refresh_tokens(refresh_hash, session_id) VALUES (s.refresh_hash, s.id);
  UPDATE auth.sessions SET access_hash = p_access_hash, access_expires_at = now() + make_interval(secs => p_access_ttl),
    refresh_hash = p_new_refresh_hash, refresh_expires_at = now() + make_interval(secs => p_refresh_ttl),
    rotation = rotation + 1, last_used_at = now()
  WHERE id = s.id;
  RETURN QUERY SELECT 'ok'::text, s.user_id, s.id;
END $$;

CREATE FUNCTION auth.revoke_session(p_session_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH r AS (UPDATE auth.sessions SET revoked_at = now(), revoke_reason = 'logout'
    WHERE id = p_session_id AND revoked_at IS NULL RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM r)
$$;

-- profile ------------------------------------------------------------------------------------
CREATE FUNCTION auth.user_profile(p_user_id uuid)
RETURNS TABLE (id uuid, display_name text, phone_e164 text, preferred_language text, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT u.id, u.display_name, u.phone_e164, u.preferred_language, u.version FROM core.users u
  WHERE u.id = p_user_id AND u.status = 'active'
$$;

CREATE FUNCTION auth.update_profile(p_user_id uuid, p_display_name text, p_language text)
RETURNS TABLE (id uuid, display_name text, phone_e164 text, preferred_language text, version integer)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  UPDATE core.users u SET
    display_name = coalesce(nullif(trim(coalesce(p_display_name, '')), ''), u.display_name),
    preferred_language = coalesce(p_language, u.preferred_language)
  WHERE u.id = p_user_id AND u.status = 'active'
  RETURNING u.id, u.display_name, u.phone_e164, u.preferred_language, u.version
$$;

-- All shops the user belongs to, with the membership state, so the app can choose a context.
CREATE FUNCTION auth.user_memberships(p_user_id uuid)
RETURNS TABLE (member_id uuid, organization_id uuid, organization_name text, organization_status text,
  role text, status text, display_name text, version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, o.id,
    CASE WHEN m.status IN ('active','pending') THEN o.name END,
    o.status, m.role, m.status, m.display_name, m.version
  FROM core.organization_members m JOIN core.organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id AND m.status <> 'removed'
  ORDER BY m.created_at
$$;

-- organizations ------------------------------------------------------------------------------
-- Shop, owner membership and the first join link are created in one transaction, so a shop
-- never exists without its owner.
CREATE FUNCTION auth.create_organization(
  p_user_id uuid, p_name text, p_contact_phone text, p_language text,
  p_token_hash text, p_token_ciphertext text, p_request_id uuid)
RETURNS TABLE (outcome text, organization_id uuid, member_id uuid, join_link_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_user core.users%ROWTYPE; v_org uuid; v_member uuid; v_link uuid;
BEGIN
  SELECT * INTO v_user FROM core.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.phone_verified_at IS NULL THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF nullif(trim(coalesce(p_name, '')), '') IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  SELECT o.id INTO v_org FROM core.organizations o WHERE o.created_by_user_id = p_user_id AND o.creation_request_id = p_request_id;
  IF FOUND THEN
    SELECT m.id INTO v_member FROM core.organization_members m WHERE m.organization_id = v_org AND m.user_id = p_user_id;
    SELECT l.id INTO v_link FROM core.organization_join_links l WHERE l.organization_id = v_org AND l.generation = 1;
    RETURN QUERY SELECT 'existing'::text, v_org, v_member, v_link; RETURN;
  END IF;

  INSERT INTO core.organizations(name, contact_phone, default_language, created_by_user_id, creation_request_id)
    VALUES (trim(p_name), nullif(trim(coalesce(p_contact_phone, '')), ''),
      CASE WHEN p_language IN ('th','en') THEN p_language ELSE v_user.preferred_language END, p_user_id, p_request_id)
    RETURNING id INTO v_org;
  INSERT INTO core.organization_members(organization_id, user_id, role, status, display_name, approved_at, status_changed_at)
    VALUES (v_org, p_user_id, 'owner', 'active', v_user.display_name, now(), now())
    RETURNING id INTO v_member;
  INSERT INTO core.organization_join_links(organization_id, token_hash, token_ciphertext, created_by_member_id)
    VALUES (v_org, p_token_hash, p_token_ciphertext, v_member)
    RETURNING id INTO v_link;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    VALUES (v_org, p_user_id, 'organization.created', 'organization', v_org, p_request_id);
  RETURN QUERY SELECT 'created'::text, v_org, v_member, v_link;
END $$;

-- join links ---------------------------------------------------------------------------------
-- Public preview. Only an active link reveals the shop name; nothing else about the shop.
-- state: active | closed | invalid
CREATE FUNCTION auth.join_link_preview(p_token_hash text)
RETURNS TABLE (state text, organization_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT CASE WHEN l.status = 'active' THEN 'active' ELSE 'closed' END
      FROM core.organization_join_links l JOIN core.organizations o ON o.id = l.organization_id
      WHERE l.token_hash = p_token_hash AND l.status IN ('active','closed') AND o.status = 'active'), 'invalid'),
    (SELECT o.name FROM core.organization_join_links l JOIN core.organizations o ON o.id = l.organization_id
      WHERE l.token_hash = p_token_hash AND l.status = 'active' AND o.status = 'active')
$$;

-- Asking to join never grants access: a new or returning request is pending until an owner
-- approves it. Repeating the request returns the same membership row.
-- outcome: pending | active | suspended | invalid_link | closed | forbidden
CREATE FUNCTION auth.request_join(p_user_id uuid, p_token_hash text, p_display_name text, p_request_id uuid)
RETURNS TABLE (outcome text, organization_id uuid, organization_name text, member_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_link core.organization_join_links%ROWTYPE; v_org core.organizations%ROWTYPE;
  v_user core.users%ROWTYPE; m core.organization_members%ROWTYPE; v_name text;
BEGIN
  SELECT * INTO v_user FROM core.users WHERE id = p_user_id;
  IF NOT FOUND OR v_user.status <> 'active' OR v_user.phone_verified_at IS NULL THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text; RETURN;
  END IF;
  SELECT * INTO v_link FROM core.organization_join_links WHERE token_hash = p_token_hash;
  IF FOUND THEN SELECT * INTO v_org FROM core.organizations WHERE id = v_link.organization_id; END IF;
  IF v_link.id IS NULL OR v_link.status = 'revoked' OR v_org.status <> 'active' THEN
    RETURN QUERY SELECT 'invalid_link'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text; RETURN;
  END IF;

  v_name := coalesce(nullif(trim(coalesce(p_display_name, '')), ''), v_user.display_name);
  SELECT * INTO m FROM core.organization_members WHERE organization_members.organization_id = v_org.id AND user_id = p_user_id FOR UPDATE;
  IF FOUND AND m.status IN ('active','suspended') THEN
    -- An existing member re-opening the link gets their current state; it is not a new request.
    RETURN QUERY SELECT m.status, v_org.id, v_org.name, m.id, m.status; RETURN;
  END IF;
  IF v_link.status = 'closed' THEN
    RETURN QUERY SELECT 'closed'::text, NULL::uuid, NULL::text, NULL::uuid, NULL::text; RETURN;
  END IF;

  IF m.id IS NULL THEN
    INSERT INTO core.organization_members(organization_id, user_id, role, status, display_name, joined_via_link_id, status_changed_at)
      VALUES (v_org.id, p_user_id, 'technician', 'pending', v_name, v_link.id, now())
      ON CONFLICT ON CONSTRAINT organization_members_organization_id_user_id_key DO NOTHING
      RETURNING * INTO m;
    IF m.id IS NULL THEN
      SELECT * INTO m FROM core.organization_members WHERE organization_members.organization_id = v_org.id AND user_id = p_user_id;
      RETURN QUERY SELECT m.status, v_org.id, v_org.name, m.id, m.status; RETURN;
    END IF;
  ELSIF m.status = 'pending' THEN
    IF m.display_name <> v_name THEN
      UPDATE core.organization_members SET display_name = v_name WHERE id = m.id RETURNING * INTO m;
    END IF;
    RETURN QUERY SELECT 'pending'::text, v_org.id, v_org.name, m.id, m.status; RETURN;
  ELSE
    -- rejected or removed: a new request through an active link goes back to pending.
    UPDATE core.organization_members SET status = 'pending', display_name = v_name, joined_via_link_id = v_link.id,
      status_changed_at = now(), removed_at = NULL, approved_at = NULL, approved_by_member_id = NULL
    WHERE id = m.id RETURNING * INTO m;
  END IF;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    VALUES (v_org.id, p_user_id, 'member.join_requested', 'organization_member', m.id, p_request_id);
  RETURN QUERY SELECT 'pending'::text, v_org.id, v_org.name, m.id, m.status;
END $$;

-- Owner view of the current link. token_ciphertext is decrypted by the API for sharing.
CREATE FUNCTION auth.current_join_link(p_user_id uuid, p_organization_id uuid)
RETURNS TABLE (id uuid, status text, generation integer, token_ciphertext text, version integer, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT l.id, l.status, l.generation, l.token_ciphertext, l.version, l.updated_at
  FROM core.organization_join_links l
  WHERE l.organization_id = p_organization_id AND l.status IN ('active','closed')
    AND auth.owner_member_id(p_user_id, p_organization_id) IS NOT NULL
$$;

-- action: open | close | rotate (rotate needs the new token). outcome: ok | forbidden | invalid
CREATE FUNCTION auth.change_join_link(p_user_id uuid, p_organization_id uuid, p_action text,
  p_token_hash text, p_token_ciphertext text, p_request_id uuid)
RETURNS TABLE (outcome text, id uuid, status text, generation integer, token_ciphertext text, version integer, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_owner uuid; l core.organization_join_links%ROWTYPE; v_generation integer;
BEGIN
  v_owner := auth.owner_member_id(p_user_id, p_organization_id);
  IF v_owner IS NULL THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::text, NULL::integer, NULL::text, NULL::integer, NULL::timestamptz; RETURN;
  END IF;
  PERFORM 1 FROM core.organizations WHERE organizations.id = p_organization_id FOR UPDATE;
  SELECT * INTO l FROM core.organization_join_links
    WHERE organization_id = p_organization_id AND organization_join_links.status IN ('active','closed') FOR UPDATE;

  IF p_action = 'rotate' THEN
    IF p_token_hash IS NULL OR p_token_ciphertext IS NULL THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text, NULL::integer, NULL::text, NULL::integer, NULL::timestamptz; RETURN;
    END IF;
    IF l.id IS NOT NULL THEN
      UPDATE core.organization_join_links SET status = 'revoked', revoked_at = now() WHERE organization_join_links.id = l.id;
    END IF;
    SELECT coalesce(max(j.generation), 0) + 1 INTO v_generation FROM core.organization_join_links j WHERE j.organization_id = p_organization_id;
    INSERT INTO core.organization_join_links(organization_id, token_hash, token_ciphertext, generation, created_by_member_id)
      VALUES (p_organization_id, p_token_hash, p_token_ciphertext, v_generation, v_owner)
      RETURNING * INTO l;
  ELSIF p_action IN ('open','close') AND l.id IS NOT NULL THEN
    UPDATE core.organization_join_links SET
      status = CASE WHEN p_action = 'open' THEN 'active' ELSE 'closed' END,
      closed_at = CASE WHEN p_action = 'open' THEN NULL ELSE now() END
    WHERE organization_join_links.id = l.id RETURNING * INTO l;
  ELSE
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text, NULL::integer, NULL::text, NULL::integer, NULL::timestamptz; RETURN;
  END IF;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id, details)
    VALUES (p_organization_id, p_user_id, 'join_link.' || p_action, 'organization_join_link', l.id, p_request_id,
      jsonb_build_object('generation', l.generation));
  RETURN QUERY SELECT 'ok'::text, l.id, l.status, l.generation, l.token_ciphertext, l.version, l.updated_at;
END $$;

-- team ---------------------------------------------------------------------------------------
CREATE FUNCTION auth.team(p_user_id uuid, p_organization_id uuid)
RETURNS TABLE (member_id uuid, user_id uuid, role text, status text, display_name text, phone_e164 text,
  version integer, requested_at timestamptz, status_changed_at timestamptz, open_jobs integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.id, m.user_id, m.role, m.status, m.display_name, u.phone_e164, m.version, m.created_at, m.status_changed_at,
    (SELECT count(*)::integer FROM core.jobs j WHERE j.organization_id = m.organization_id
      AND j.current_assignee_id = m.id AND j.status IN ('scheduled','in_progress'))
  FROM core.organization_members m JOIN core.users u ON u.id = m.user_id
  WHERE m.organization_id = p_organization_id AND m.status <> 'removed'
    AND auth.owner_member_id(p_user_id, p_organization_id) IS NOT NULL
  ORDER BY CASE m.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, m.created_at
$$;

CREATE FUNCTION auth.seat_usage(p_user_id uuid, p_organization_id uuid)
RETURNS TABLE (active_technicians integer, seat_limit integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT (SELECT count(*)::integer FROM core.organization_members m WHERE m.organization_id = p_organization_id
      AND m.role = 'technician' AND m.status = 'active'),
    auth.technician_seat_limit(p_organization_id)
  WHERE auth.owner_member_id(p_user_id, p_organization_id) IS NOT NULL
$$;

-- Owner changes a technician's membership. The shop row is locked first, so concurrent
-- approvals are serialized and the active technician count can never pass the seat limit.
-- action: approve | reject | suspend | reactivate | remove
-- outcome: ok | forbidden | not_found | version_conflict | invalid_transition | seat_limit_reached
CREATE FUNCTION auth.change_member_status(p_user_id uuid, p_organization_id uuid, p_member_id uuid,
  p_action text, p_expected_version integer, p_reason text, p_request_id uuid)
RETURNS TABLE (outcome text, member_id uuid, status text, version integer, active_technicians integer, seat_limit integer, open_jobs integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_owner uuid; m core.organization_members%ROWTYPE; v_to text; v_active integer; v_limit integer; v_open integer;
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
  v_limit := auth.technician_seat_limit(p_organization_id);
  SELECT count(*)::integer INTO v_open FROM core.jobs j WHERE j.organization_id = p_organization_id
    AND j.current_assignee_id = m.id AND j.status IN ('scheduled','in_progress');

  -- A retried command whose result is already in place succeeds without changing anything.
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

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  auth.create_otp_challenge(uuid, text, text, text, integer, integer, integer, integer, integer),
  auth.verify_otp(uuid, text, text, text, text, integer, text, integer),
  auth.resolve_session(text),
  auth.refresh_session(text, text, integer, text, integer),
  auth.revoke_session(uuid),
  auth.user_profile(uuid),
  auth.update_profile(uuid, text, text),
  auth.user_memberships(uuid),
  auth.create_organization(uuid, text, text, text, text, text, uuid),
  auth.join_link_preview(text),
  auth.request_join(uuid, text, text, uuid),
  auth.current_join_link(uuid, uuid),
  auth.change_join_link(uuid, uuid, text, text, text, uuid),
  auth.team(uuid, uuid),
  auth.seat_usage(uuid, uuid),
  auth.change_member_status(uuid, uuid, uuid, text, integer, text, uuid)
TO fs_api;
