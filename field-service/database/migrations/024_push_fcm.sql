-- Push with FCM (Android first).
-- A device token can be revoked (sign-out, FCM says it is dead) or move to another account when
-- someone else signs in on the same phone. Deliveries queued before that must not reach the phone:
-- they are skipped at claim time instead of being sent to whoever holds the device now.

-- Same as 004 except that deliveries whose token is revoked or now belongs to another user are
-- skipped, and only deliveries for the current holder are claimed.
CREATE OR REPLACE FUNCTION worker.claim_deliveries(p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid, token text, platform text, template_key text, parameters jsonb, language text, target_type text, target_id uuid, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
#variable_conflict use_column
BEGIN
  UPDATE ops.notification_deliveries d SET status = 'skipped', last_error = 'DEVICE_NOT_CURRENT'
  FROM core.notifications n, auth.device_tokens t
  WHERE d.status = 'queued' AND n.organization_id = d.organization_id AND n.id = d.notification_id AND t.id = d.device_token_id
    AND (t.revoked_at IS NOT NULL OR t.user_id <> n.recipient_user_id);
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM ops.notification_deliveries d WHERE d.status = 'queued' AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  UPDATE ops.notification_deliveries d SET status = 'sending', attempts = d.attempts + 1
  FROM picked, core.notifications n, auth.device_tokens t
  WHERE d.id = picked.id AND n.organization_id = d.organization_id AND n.id = d.notification_id AND t.id = d.device_token_id
  RETURNING d.id, d.organization_id, t.token, t.platform, n.template_key, n.parameters, n.sent_language, n.target_type, n.target_id, d.attempts;
END $$;
