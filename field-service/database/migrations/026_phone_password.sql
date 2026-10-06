-- Phone + password sign-in (2026-10-06). SMS OTP is now used only to prove the phone number:
-- when signing up, and when a password is forgotten. Every later sign-in is phone + password,
-- so a normal sign-in costs no SMS. Owners and technicians work the same way.
--
-- The API hashes passwords (scrypt) and verifies them; the database stores only the hash, in a
-- schema fs_api cannot read directly, and enforces the lockout so parallel guesses cannot pass
-- it. A wrong password counts against the account before the API checks it ("reserve first"),
-- and a correct one clears the count.

CREATE TABLE auth.user_passwords (
  user_id uuid PRIMARY KEY REFERENCES core.users(id),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  set_at timestamptz NOT NULL DEFAULT now(),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until timestamptz
);

-- One row per password sign-in attempt from a client address (hashed), for the per-client limit.
CREATE TABLE auth.password_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_key_hash text NOT NULL CHECK (length(client_key_hash) = 64)
);
CREATE INDEX password_attempts_by_client ON auth.password_attempts(client_key_hash, created_at DESC);

ALTER TABLE auth.user_passwords ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.user_passwords FORCE ROW LEVEL SECURITY;
ALTER TABLE auth.password_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE auth.password_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_functions ON auth.user_passwords TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY identity_functions ON auth.password_attempts TO fs_migrator USING (true) WITH CHECK (true);

-- How the session was obtained. A fresh OTP session may set a new password without the old one
-- (that is the "forgot password" path); a password session may not.
ALTER TABLE auth.sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'otp' CHECK (auth_method IN ('otp','password'));
ALTER TABLE auth.sessions DROP CONSTRAINT sessions_revoke_reason_check;
ALTER TABLE auth.sessions ADD CONSTRAINT sessions_revoke_reason_check
  CHECK (revoke_reason IN ('logout','refresh_reuse','user_disabled','password_changed'));

-- Step 1 of a password sign-in. outcome:
--   check        -> verify password_hash in the API (null hash = unknown phone or no password yet;
--                   the API still does the same hashing work and answers "wrong phone or password")
--   locked       -> too many wrong passwords for this account; retry_after_seconds
--   rate_limited -> too many attempts from this client; retry_after_seconds
CREATE FUNCTION auth.password_login_begin(
  p_phone text, p_client_key_hash text, p_max_failures integer, p_lock_seconds integer, p_client_hourly_limit integer)
RETURNS TABLE (outcome text, user_id uuid, password_hash text, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_user uuid; v_count integer; v_oldest timestamptz; p auth.user_passwords%ROWTYPE;
BEGIN
  IF p_max_failures NOT BETWEEN 1 AND 20 OR p_lock_seconds NOT BETWEEN 60 AND 86400 OR p_client_hourly_limit < 1 THEN
    RAISE EXCEPTION 'PASSWORD_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_client_key_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pwclient:' || p_client_key_hash, 0));
    SELECT count(*), min(a.created_at) INTO v_count, v_oldest FROM auth.password_attempts a
      WHERE a.client_key_hash = p_client_key_hash AND a.created_at > now() - interval '1 hour';
    IF v_count >= p_client_hourly_limit THEN
      RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid, NULL::text,
        greatest(1, ceil(extract(epoch FROM v_oldest + interval '1 hour' - now()))::integer);
      RETURN;
    END IF;
    INSERT INTO auth.password_attempts(client_key_hash) VALUES (p_client_key_hash);
  END IF;

  SELECT u.id INTO v_user FROM core.users u WHERE u.phone_e164 = p_phone;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'check'::text, NULL::uuid, NULL::text, 0; RETURN;
  END IF;
  SELECT * INTO p FROM auth.user_passwords up WHERE up.user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'check'::text, v_user, NULL::text, 0; RETURN;
  END IF;
  IF p.locked_until IS NOT NULL AND p.locked_until > now() THEN
    RETURN QUERY SELECT 'locked'::text, NULL::uuid, NULL::text,
      greatest(1, ceil(extract(epoch FROM p.locked_until - now()))::integer);
    RETURN;
  END IF;
  -- Reserve this attempt as a failure; the last allowed attempt also starts the lock, which a
  -- correct password clears in password_login_finish.
  IF p.failed_count + 1 >= p_max_failures THEN
    UPDATE auth.user_passwords SET failed_count = 0, locked_until = now() + make_interval(secs => p_lock_seconds) WHERE user_passwords.user_id = v_user;
  ELSE
    UPDATE auth.user_passwords SET failed_count = failed_count + 1, locked_until = NULL WHERE user_passwords.user_id = v_user;
  END IF;
  RETURN QUERY SELECT 'check'::text, v_user, p.password_hash, 0;
END $$;

-- Step 2, called only after the API verified the password against p_password_hash.
-- outcome: ok | invalid (password changed meanwhile) | user_disabled
CREATE FUNCTION auth.password_login_finish(
  p_user_id uuid, p_password_hash text, p_access_hash text, p_access_ttl integer, p_refresh_hash text, p_refresh_ttl integer)
RETURNS TABLE (outcome text, session_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_status text; v_session uuid;
BEGIN
  PERFORM 1 FROM auth.user_passwords up WHERE up.user_id = p_user_id AND up.password_hash = p_password_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  SELECT u.status INTO v_status FROM core.users u WHERE u.id = p_user_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN QUERY SELECT 'user_disabled'::text, NULL::uuid; RETURN;
  END IF;
  UPDATE auth.user_passwords SET failed_count = 0, locked_until = NULL WHERE user_id = p_user_id;
  v_session := auth.issue_session(p_user_id, p_access_hash, p_access_ttl, p_refresh_hash, p_refresh_ttl);
  UPDATE auth.sessions SET auth_method = 'password' WHERE id = v_session;
  RETURN QUERY SELECT 'ok'::text, v_session;
END $$;

-- What a signed-in user may do with their password. fresh_otp: this session came from an SMS code
-- within p_window_seconds, so it may set a new password without the current one.
CREATE FUNCTION auth.password_status(p_user_id uuid, p_session_id uuid, p_window_seconds integer)
RETURNS TABLE (has_password boolean, password_hash text, fresh_otp boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT up.user_id IS NOT NULL, up.password_hash,
    coalesce((SELECT s.auth_method = 'otp' AND s.created_at > now() - make_interval(secs => p_window_seconds)
      FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id AND s.revoked_at IS NULL), false)
  FROM (SELECT 1) one LEFT JOIN auth.user_passwords up ON up.user_id = p_user_id
$$;

-- Sets or replaces the password. p_via says why it is allowed and is re-checked here:
--   first   -> the user has no password yet
--   otp     -> this session came from an SMS code within p_window_seconds
--   current -> the API verified the current password, which must still be p_expected_hash
-- Other sessions of the user are signed out; the calling session stays.
-- outcome: ok | not_allowed | conflict
CREATE FUNCTION auth.set_password(
  p_user_id uuid, p_session_id uuid, p_via text, p_expected_hash text, p_new_hash text, p_window_seconds integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE p auth.user_passwords%ROWTYPE; v_found boolean; v_fresh boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('password:' || p_user_id::text, 0));
  SELECT * INTO p FROM auth.user_passwords WHERE user_id = p_user_id FOR UPDATE;
  v_found := FOUND;
  SELECT s.auth_method = 'otp' AND s.created_at > now() - make_interval(secs => p_window_seconds) INTO v_fresh
    FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id AND s.revoked_at IS NULL;
  IF v_fresh IS NULL THEN RETURN 'not_allowed'; END IF;
  IF p_via = 'first' THEN
    IF v_found THEN RETURN 'conflict'; END IF;
  ELSIF p_via = 'otp' THEN
    IF NOT v_fresh THEN RETURN 'not_allowed'; END IF;
  ELSIF p_via = 'current' THEN
    IF NOT v_found OR p.password_hash IS DISTINCT FROM p_expected_hash THEN RETURN 'conflict'; END IF;
  ELSE
    RETURN 'not_allowed';
  END IF;
  INSERT INTO auth.user_passwords(user_id, password_hash) VALUES (p_user_id, p_new_hash)
    ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, set_at = now(), failed_count = 0, locked_until = NULL;
  UPDATE auth.sessions SET revoked_at = now(), revoke_reason = 'password_changed'
    WHERE user_id = p_user_id AND id <> p_session_id AND revoked_at IS NULL;
  RETURN 'ok';
END $$;

REVOKE EXECUTE ON FUNCTION auth.password_login_begin(text, text, integer, integer, integer),
  auth.password_login_finish(uuid, text, text, integer, text, integer),
  auth.password_status(uuid, uuid, integer),
  auth.set_password(uuid, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.password_login_begin(text, text, integer, integer, integer),
  auth.password_login_finish(uuid, text, text, integer, text, integer),
  auth.password_status(uuid, uuid, integer),
  auth.set_password(uuid, uuid, text, text, text, integer) TO fs_api;
