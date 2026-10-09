-- 035: the console's TOTP re-confirmation (step-up) becomes a system policy (owner decision 2026-10-09).
-- Before: every money/access action needed a code typed within the last 10 minutes. Now the policy holds
-- step_up_enabled (default true) and step_up_minutes (default 60, 5–720); the window restarts on every protected
-- action, so a person working steadily is asked once. Sign-in itself always needs the authenticator code.

-- Read by the API guard on protected actions (cached briefly there). No permission: it reveals only the setting.
CREATE FUNCTION padmin.step_up_policy() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT jsonb_build_object(
   'enabled', coalesce((SELECT (payload->>'step_up_enabled')::boolean FROM platform.policy_versions ORDER BY version DESC LIMIT 1), true),
   'minutes', coalesce((SELECT (payload->>'step_up_minutes')::integer FROM platform.policy_versions ORDER BY version DESC LIMIT 1), 60))
$$;

-- A protected action went through: the confirmation window starts again from now (sliding).
CREATE FUNCTION padmin.touch_step_up(p_session uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 UPDATE platform.sessions SET step_up_at = now() WHERE id = p_session AND revoked_at IS NULL AND step_up_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION padmin.step_up_policy(), padmin.touch_step_up(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.step_up_policy(), padmin.touch_step_up(uuid) TO fs_platform;
