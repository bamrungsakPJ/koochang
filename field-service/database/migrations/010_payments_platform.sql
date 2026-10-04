-- C01 bank-transfer payments and the platform identity they need. PostgreSQL 16 target.
-- Apply as fs_migrator. The role fs_platform (no superuser, no BYPASSRLS) is created by infra.
--
-- Shops: the owner creates an invoice (price snapshot) and submits a private proof. Neither
-- changes the entitlement. Platform: a billing operator confirms money actually received with a
-- bank reference that can be used once; only then is the paid period applied. Refunds need a
-- requester and a different approver; the total refunded never exceeds the payment.
--
-- fs_platform reaches data only through padmin.* functions, and every function checks that the
-- calling platform account holds the permission. fs_api never sees the platform schema.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fs_platform') THEN
    RAISE EXCEPTION 'role fs_platform is missing (see infra/postgres/00-roles.sql)';
  END IF;
END $$;
CREATE SCHEMA padmin;
REVOKE ALL ON SCHEMA padmin FROM PUBLIC;
GRANT USAGE ON SCHEMA padmin TO fs_platform;

-- definer functions run as fs_migrator; RLS-forced tables need a policy for it.
CREATE POLICY payment_functions ON billing.payments TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY payment_functions ON billing.payment_proofs TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY payment_functions ON billing.refunds TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY payment_functions_write ON billing.entitlement_grants TO fs_migrator USING (true) WITH CHECK (true);

-- platform identity ----------------------------------------------------------------------------
ALTER TABLE platform.accounts
  ADD COLUMN password_hash text,
  ADD COLUMN totp_secret_sealed text,
  ADD COLUMN totp_last_step bigint NOT NULL DEFAULT 0,
  ADD COLUMN failed_logins integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_login_at timestamptz;
ALTER TABLE platform.accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE platform.accounts ADD CONSTRAINT accounts_status_check CHECK (status IN ('invited','active','disabled'));

CREATE TABLE platform.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
);
CREATE TABLE platform.role_permissions (
  role_id uuid NOT NULL REFERENCES platform.roles(id),
  permission_id uuid NOT NULL REFERENCES platform.permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
INSERT INTO platform.roles(code) VALUES ('super_admin'),('platform_admin'),('billing_operator'),('billing_approver'),('support_agent'),('operations'),('auditor')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO platform.permissions(code) VALUES
  ('shops.read'),('shops.suspend'),('grants.manage'),('billing.read'),('billing.verify'),('refund.request'),('refund.approve'),
  ('support.read'),('support.manage'),('access.request'),('access.approve'),('system.read'),('audit.read'),('accounts.manage');
INSERT INTO platform.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM platform.roles r JOIN platform.permissions p ON p.code = ANY (CASE r.code
  WHEN 'super_admin' THEN ARRAY['shops.read','audit.read','accounts.manage','system.read']
  WHEN 'platform_admin' THEN ARRAY['shops.read','shops.suspend','grants.manage','billing.read','support.read','system.read']
  WHEN 'billing_operator' THEN ARRAY['shops.read','billing.read','billing.verify','refund.request']
  WHEN 'billing_approver' THEN ARRAY['shops.read','billing.read','refund.approve']
  WHEN 'support_agent' THEN ARRAY['shops.read','support.read','support.manage','access.request']
  WHEN 'operations' THEN ARRAY['system.read','shops.read']
  WHEN 'auditor' THEN ARRAY['audit.read','billing.read','shops.read'] END);

-- Opaque session tokens, stored as hashes. A login first gets a short MFA-pending session;
-- the TOTP code turns it into a full session. step_up_at gates money and access actions.
CREATE TABLE platform.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  account_id uuid NOT NULL REFERENCES platform.accounts(id),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  mfa_verified_at timestamptz,
  step_up_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  client text
);
CREATE INDEX sessions_by_account ON platform.sessions(account_id) WHERE revoked_at IS NULL;

-- Append-only: nobody (including the function owner) may change or delete a row.
CREATE TABLE platform.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_account_id uuid REFERENCES platform.accounts(id),
  organization_id uuid REFERENCES core.organizations(id),
  permission text,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  reason text,
  details jsonb NOT NULL DEFAULT '{}',
  request_id uuid,
  support_grant_id uuid
);
CREATE INDEX platform_audit_by_time ON platform.audit_logs(created_at DESC);
CREATE INDEX platform_audit_by_org ON platform.audit_logs(organization_id, created_at DESC);
CREATE FUNCTION platform.audit_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'platform audit is append-only'; END $$;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON platform.audit_logs FOR EACH ROW EXECUTE FUNCTION platform.audit_append_only();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON platform.audit_logs EXECUTE FUNCTION platform.audit_append_only();

-- billing --------------------------------------------------------------------------------------
CREATE SEQUENCE billing.invoice_number_seq;
ALTER TABLE billing.invoices
  ADD COLUMN request_key uuid,
  ADD COLUMN created_by uuid REFERENCES core.users(id),
  ADD COLUMN plan_snapshot jsonb,
  ADD COLUMN price_snapshot jsonb,
  ADD COLUMN due_at timestamptz,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text,
  ADD CONSTRAINT invoices_paid_at CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  ADD CONSTRAINT invoices_voided CHECK (status <> 'voided' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL));
CREATE UNIQUE INDEX invoices_request_key ON billing.invoices(organization_id, request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX one_open_invoice ON billing.invoices(organization_id) WHERE status = 'open';

ALTER TABLE billing.payments
  ADD COLUMN received_at timestamptz,
  ADD COLUMN proof_id uuid,
  ADD COLUMN note text,
  ADD FOREIGN KEY (organization_id, proof_id) REFERENCES billing.payment_proofs(organization_id, id);
CREATE UNIQUE INDEX one_payment_per_invoice ON billing.payments(organization_id, invoice_id);

ALTER TABLE billing.payment_proofs
  ADD COLUMN checksum text,
  ADD COLUMN size_bytes bigint,
  ADD COLUMN reviewed_by uuid REFERENCES platform.accounts(id),
  ADD COLUMN reviewed_at timestamptz,
  ADD CONSTRAINT proofs_rejected_reason CHECK (status <> 'rejected' OR (reason IS NOT NULL AND length(trim(reason)) > 0));
CREATE INDEX proofs_pending ON billing.payment_proofs(created_at) WHERE status = 'pending';

ALTER TABLE billing.refunds
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN decision_reason text;

-- shop side (fs_api) ---------------------------------------------------------------------------
-- Owner creates (or gets back) the open invoice for a paid plan's current price. Another plan
-- replaces the open invoice. A plan with fewer seats than the active technicians is refused:
-- the owner must first choose who stays. outcome: ok | existing | forbidden | not_found | seats | suspended
CREATE FUNCTION auth.create_invoice(p_user_id uuid, p_organization_id uuid, p_price_version_id uuid, p_request_key uuid)
RETURNS TABLE (outcome text, invoice_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_now timestamptz := now(); s record; v_current uuid; v_open billing.invoices%ROWTYPE; v_id uuid; v_active integer; v_org text;
BEGIN
  IF auth.owner_member_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN; END IF;
  SELECT o.status INTO v_org FROM core.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF v_org <> 'active' THEN RETURN QUERY SELECT 'suspended'::text, NULL::uuid; RETURN; END IF;
  SELECT i.id INTO v_id FROM billing.invoices i WHERE i.organization_id = p_organization_id AND i.request_key = p_request_key;
  IF v_id IS NOT NULL THEN RETURN QUERY SELECT 'existing'::text, v_id; RETURN; END IF;
  -- Only the current published price of an active paid plan can be bought.
  SELECT pr.id INTO v_current FROM billing.price_versions pr
    JOIN billing.plan_versions pv ON pv.id = pr.plan_version_id AND pv.published_at <= v_now
    JOIN billing.plans p ON p.id = pv.plan_id AND p.kind = 'paid' AND p.status = 'active'
  WHERE pr.id = p_price_version_id AND pr.effective_from <= v_now
    AND NOT EXISTS (SELECT 1 FROM billing.plan_versions newer WHERE newer.plan_id = pv.plan_id AND newer.published_at <= v_now AND newer.version_no > pv.version_no)
    AND NOT EXISTS (SELECT 1 FROM billing.price_versions later WHERE later.plan_version_id = pr.plan_version_id AND later.effective_from <= v_now AND later.effective_from > pr.effective_from);
  IF v_current IS NULL THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  SELECT * INTO s FROM billing.snapshot(v_current);
  SELECT count(*)::integer INTO v_active FROM core.organization_members m WHERE m.organization_id = p_organization_id AND m.role = 'technician' AND m.status = 'active';
  IF v_active > (s.plan_snapshot->>'technician_seats')::integer THEN RETURN QUERY SELECT 'seats'::text, NULL::uuid; RETURN; END IF;

  SELECT * INTO v_open FROM billing.invoices i WHERE i.organization_id = p_organization_id AND i.status = 'open' FOR UPDATE;
  IF v_open.id IS NOT NULL AND v_open.price_version_id = v_current THEN RETURN QUERY SELECT 'existing'::text, v_open.id; RETURN; END IF;
  IF v_open.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM billing.payment_proofs pp WHERE pp.organization_id = p_organization_id AND pp.invoice_id = v_open.id AND pp.status = 'pending') THEN
      -- A proof is being checked: do not swap the invoice under the operator.
      RETURN QUERY SELECT 'existing'::text, v_open.id; RETURN;
    END IF;
    UPDATE billing.invoices SET status = 'voided', voided_at = v_now, void_reason = 'replaced' WHERE organization_id = p_organization_id AND id = v_open.id;
  END IF;
  INSERT INTO billing.invoices(organization_id, number, amount_minor, currency, price_version_id, status, buyer_snapshot, request_key, created_by,
      plan_snapshot, price_snapshot, due_at)
    SELECT p_organization_id, 'INV-' || to_char(v_now AT TIME ZONE 'Asia/Bangkok', 'YYMM') || '-' || lpad(nextval('billing.invoice_number_seq')::text, 6, '0'),
      (s.price_snapshot->>'amount_minor')::bigint, 'THB', v_current, 'open',
      jsonb_build_object('organization_name', o.name, 'owner_name', u.display_name), p_request_key, p_user_id, s.plan_snapshot, s.price_snapshot, v_now + interval '7 days'
    FROM core.organizations o JOIN core.users u ON u.id = p_user_id WHERE o.id = p_organization_id
    RETURNING id INTO v_id;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    VALUES (p_organization_id, p_user_id, 'invoice.created', 'invoice', v_id, gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text, v_id;
END $$;

-- Proof of transfer: a private file reference. It never changes the entitlement.
-- outcome: ok | forbidden | not_found | closed
CREATE FUNCTION auth.submit_payment_proof(p_user_id uuid, p_organization_id uuid, p_invoice_id uuid, p_proof_id uuid, p_object_key text, p_checksum text, p_size bigint)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_status text; o record;
BEGIN
  IF auth.owner_member_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text; RETURN; END IF;
  SELECT i.status INTO v_status FROM billing.invoices i WHERE i.organization_id = p_organization_id AND i.id = p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN QUERY SELECT 'not_found'::text; RETURN; END IF;
  IF v_status <> 'open' THEN RETURN QUERY SELECT 'closed'::text; RETURN; END IF;
  INSERT INTO billing.payment_proofs(id, organization_id, invoice_id, private_object_key, submitted_by, checksum, size_bytes)
    VALUES (p_proof_id, p_organization_id, p_invoice_id, p_object_key, p_user_id, p_checksum, p_size)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO ops.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, request_id)
    VALUES (p_organization_id, p_user_id, 'payment_proof.submitted', 'invoice', p_invoice_id, gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text;
END $$;
REVOKE EXECUTE ON FUNCTION auth.create_invoice(uuid, uuid, uuid, uuid), auth.submit_payment_proof(uuid, uuid, uuid, uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.create_invoice(uuid, uuid, uuid, uuid), auth.submit_payment_proof(uuid, uuid, uuid, uuid, text, text, bigint) TO fs_api;

-- platform side (fs_platform) ------------------------------------------------------------------
-- Account by email for login (password hash and sealed TOTP secret go to the API, which checks
-- them; the database records the outcome).
CREATE FUNCTION padmin.login_account(p_email text)
RETURNS TABLE (id uuid, status text, password_hash text, totp_secret_sealed text, totp_last_step bigint, locked_until timestamptz, display_name text, preferred_language text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.id, a.status, a.password_hash, a.totp_secret_sealed, a.totp_last_step, a.locked_until, a.display_name, a.preferred_language
  FROM platform.accounts a WHERE a.email = lower(trim(p_email))
$$;

-- Five wrong passwords or codes lock the account for 15 minutes.
CREATE FUNCTION padmin.record_login_failure(p_account_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE platform.accounts SET failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END,
    locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = p_account_id;
  INSERT INTO platform.audit_logs(actor_account_id, action, target_type, target_id) VALUES (p_account_id, 'account.login_failed', 'account', p_account_id);
END $$;

CREATE FUNCTION padmin.create_session(p_account_id uuid, p_token_hash text, p_client text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO platform.sessions(account_id, token_hash, expires_at, client) VALUES (p_account_id, p_token_hash, now() + interval '5 minutes', left(p_client, 200))
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Sealed TOTP secret of the account behind a live session (MFA-pending or full), for the API to
-- check a code. Locked or disabled accounts get nothing.
CREATE FUNCTION padmin.session_totp(p_token_hash text)
RETURNS TABLE (account_id uuid, totp_secret_sealed text, mfa_pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.id, a.totp_secret_sealed, s.mfa_verified_at IS NULL
  FROM platform.sessions s JOIN platform.accounts a ON a.id = s.account_id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status = 'active'
    AND (a.locked_until IS NULL OR a.locked_until <= now())
$$;

-- TOTP accepted: the step must be newer than the last used one (no replay). Turns an MFA-pending
-- session into a 12-hour session, or refreshes step-up on a full session.
-- outcome: ok | replay | invalid
CREATE FUNCTION padmin.mfa_passed(p_token_hash text, p_step bigint, p_step_up boolean)
RETURNS TABLE (outcome text, account_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s platform.sessions%ROWTYPE; v_last bigint;
BEGIN
  SELECT * INTO s FROM platform.sessions ps WHERE ps.token_hash = p_token_hash AND ps.revoked_at IS NULL AND ps.expires_at > now() FOR UPDATE;
  IF s.id IS NULL OR (p_step_up AND s.mfa_verified_at IS NULL) OR (NOT p_step_up AND s.mfa_verified_at IS NOT NULL) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  SELECT a.totp_last_step INTO v_last FROM platform.accounts a WHERE a.id = s.account_id AND a.status = 'active' FOR UPDATE;
  IF v_last IS NULL THEN RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::timestamptz; RETURN; END IF;
  IF p_step <= v_last THEN RETURN QUERY SELECT 'replay'::text, NULL::uuid, NULL::timestamptz; RETURN; END IF;
  UPDATE platform.accounts SET totp_last_step = p_step, failed_logins = 0, locked_until = NULL,
    last_login_at = CASE WHEN p_step_up THEN last_login_at ELSE now() END, mfa_enrolled = true WHERE id = s.account_id;
  IF p_step_up THEN
    UPDATE platform.sessions SET step_up_at = now() WHERE id = s.id;
  ELSE
    UPDATE platform.sessions SET mfa_verified_at = now(), step_up_at = now(), expires_at = now() + interval '12 hours' WHERE id = s.id RETURNING platform.sessions.expires_at INTO s.expires_at;
    INSERT INTO platform.audit_logs(actor_account_id, action, target_type, target_id) VALUES (s.account_id, 'account.login', 'session', s.id);
  END IF;
  RETURN QUERY SELECT 'ok'::text, s.account_id, s.expires_at;
END $$;

-- Session → account and permissions (codes), only for a full, unexpired session of an active account.
CREATE FUNCTION padmin.resolve_session(p_token_hash text)
RETURNS TABLE (session_id uuid, account_id uuid, display_name text, email text, preferred_language text, permissions text[], roles text[], step_up_at timestamptz, mfa_pending boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.id, a.id, a.display_name, a.email, a.preferred_language,
    coalesce((SELECT array_agg(DISTINCT p.code ORDER BY p.code) FROM platform.account_roles ar JOIN platform.role_permissions rp ON rp.role_id = ar.role_id
      JOIN platform.permissions p ON p.id = rp.permission_id WHERE ar.account_id = a.id), '{}'),
    coalesce((SELECT array_agg(r.code ORDER BY r.code) FROM platform.account_roles ar JOIN platform.roles r ON r.id = ar.role_id WHERE ar.account_id = a.id), '{}'),
    s.step_up_at, s.mfa_verified_at IS NULL
  FROM platform.sessions s JOIN platform.accounts a ON a.id = s.account_id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status = 'active'
$$;

CREATE FUNCTION padmin.revoke_session(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  UPDATE platform.sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

-- Raises unless the account holds the permission. Every padmin function that reads or changes
-- data calls this first, so the API's own check is never the only one.
CREATE FUNCTION padmin.require(p_account_id uuid, p_permission text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.accounts a JOIN platform.account_roles ar ON ar.account_id = a.id
      JOIN platform.role_permissions rp ON rp.role_id = ar.role_id JOIN platform.permissions p ON p.id = rp.permission_id
      WHERE a.id = p_account_id AND a.status = 'active' AND p.code = p_permission) THEN
    RAISE EXCEPTION 'permission % required', p_permission USING ERRCODE = '42501';
  END IF;
END $$;

-- Payment queue: open invoices with their latest proof, oldest pending proof first.
CREATE FUNCTION padmin.payment_queue(p_account_id uuid, p_status text)
RETURNS TABLE (invoice_id uuid, number text, organization_id uuid, organization_name text, amount_minor bigint, status text, plan_name_th text, plan_name_en text,
  created_at timestamptz, proof_id uuid, proof_status text, proof_submitted_at timestamptz, proof_reason text, paid_at timestamptz, bank_reference text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  RETURN QUERY
  SELECT i.id, i.number, i.organization_id, o.name, i.amount_minor, i.status, i.plan_snapshot->>'name_th', i.plan_snapshot->>'name_en', i.created_at,
    pp.id, pp.status, pp.created_at, pp.reason, i.paid_at, pay.bank_reference
  FROM billing.invoices i JOIN core.organizations o ON o.id = i.organization_id
  LEFT JOIN LATERAL (SELECT * FROM billing.payment_proofs x WHERE x.organization_id = i.organization_id AND x.invoice_id = i.id ORDER BY x.created_at DESC LIMIT 1) pp ON true
  LEFT JOIN billing.payments pay ON pay.organization_id = i.organization_id AND pay.invoice_id = i.id
  WHERE (p_status = 'pending' AND i.status = 'open' AND pp.status = 'pending')
     OR (p_status = 'open' AND i.status = 'open')
     OR (p_status = 'paid' AND i.status = 'paid')
     OR (p_status = 'all')
  ORDER BY CASE WHEN pp.status = 'pending' THEN pp.created_at END NULLS LAST, i.created_at DESC
  LIMIT 200;
END $$;

CREATE FUNCTION padmin.invoice_detail(p_account_id uuid, p_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  SELECT jsonb_build_object(
    'invoice', to_jsonb(i) - 'buyer_snapshot' || jsonb_build_object('organization_name', o.name, 'buyer', i.buyer_snapshot),
    'proofs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pp.id, 'status', pp.status, 'reason', pp.reason, 'created_at', pp.created_at,
        'reviewed_at', pp.reviewed_at, 'size_bytes', pp.size_bytes) ORDER BY pp.created_at DESC)
      FROM billing.payment_proofs pp WHERE pp.organization_id = i.organization_id AND pp.invoice_id = i.id), '[]'),
    'payment', (SELECT jsonb_build_object('id', p.id, 'amount_minor', p.amount_minor, 'bank_reference', p.bank_reference, 'received_at', p.received_at,
        'verified_at', p.verified_at, 'verified_by', a.display_name, 'note', p.note,
        'refunded_minor', coalesce((SELECT sum(r.amount_minor) FROM billing.refunds r WHERE r.organization_id = p.organization_id AND r.payment_id = p.id AND r.status = 'succeeded'), 0))
      FROM billing.payments p JOIN platform.accounts a ON a.id = p.verified_by WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id),
    'refunds', coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'amount_minor', r.amount_minor, 'status', r.status, 'reason', r.reason,
        'requested_by', ra.display_name, 'requested_by_id', r.requested_by, 'approved_by', aa.display_name, 'bank_reference', r.bank_reference,
        'decision_reason', r.decision_reason, 'created_at', r.created_at) ORDER BY r.created_at)
      FROM billing.payments p JOIN billing.refunds r ON r.organization_id = p.organization_id AND r.payment_id = p.id
      JOIN platform.accounts ra ON ra.id = r.requested_by LEFT JOIN platform.accounts aa ON aa.id = r.approved_by
      WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id), '[]'),
    'period', (SELECT jsonb_build_object('start_at', sp.start_at, 'end_at', sp.end_at) FROM billing.subscription_periods sp
      WHERE sp.organization_id = i.organization_id AND sp.invoice_id = i.id))
  INTO v FROM billing.invoices i JOIN core.organizations o ON o.id = i.organization_id WHERE i.id = p_invoice_id;
  RETURN v;
END $$;

-- Object key of a proof for the viewer (the read is audited).
CREATE FUNCTION padmin.proof_object(p_account_id uuid, p_proof_id uuid, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_key text; v_org uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  SELECT pp.private_object_key, pp.organization_id INTO v_key, v_org FROM billing.payment_proofs pp WHERE pp.id = p_proof_id;
  IF v_key IS NOT NULL THEN
    INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, request_id)
      VALUES (p_account_id, v_org, 'billing.read', 'payment_proof.viewed', 'payment_proof', p_proof_id, p_request_id);
  END IF;
  RETURN v_key;
END $$;

-- Money received. The bank reference (normalized) can be used once across all invoices. The
-- same reference for the same invoice returns the earlier result. A wrong amount never opens the
-- entitlement: it stays in the queue for an exception decision.
-- outcome: ok | existing | not_found | voided | amount_mismatch | reference_used | already_paid
CREATE FUNCTION padmin.confirm_payment(p_account_id uuid, p_invoice_id uuid, p_amount_minor bigint, p_bank_reference text,
  p_received_at timestamptz, p_proof_id uuid, p_note text, p_request_id uuid)
RETURNS TABLE (outcome text, payment_id uuid, period_start timestamptz, period_end timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE i billing.invoices%ROWTYPE; v_ref text := upper(regexp_replace(trim(p_bank_reference), '\s+', '', 'g')); p billing.payments%ROWTYPE;
  r record; v_owner uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.verify');
  SELECT * INTO i FROM billing.invoices x WHERE x.id = p_invoice_id FOR UPDATE;
  IF i.id IS NULL THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz; RETURN; END IF;
  SELECT * INTO p FROM billing.payments x WHERE x.bank_reference = v_ref;
  IF p.id IS NOT NULL THEN
    IF p.invoice_id = i.id THEN
      RETURN QUERY SELECT 'existing'::text, p.id, sp.start_at, sp.end_at FROM billing.subscription_periods sp WHERE sp.organization_id = i.organization_id AND sp.invoice_id = i.id;
    ELSE
      RETURN QUERY SELECT 'reference_used'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    END IF;
    RETURN;
  END IF;
  IF i.status = 'paid' THEN RETURN QUERY SELECT 'already_paid'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz; RETURN; END IF;
  IF i.status = 'voided' THEN RETURN QUERY SELECT 'voided'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz; RETURN; END IF;
  IF p_amount_minor <> i.amount_minor THEN
    INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id)
      VALUES (p_account_id, i.organization_id, 'billing.verify', 'payment.amount_mismatch', 'invoice', i.id,
        jsonb_build_object('expected', i.amount_minor, 'received', p_amount_minor), p_request_id);
    RETURN QUERY SELECT 'amount_mismatch'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz; RETURN;
  END IF;
  IF p_proof_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM billing.payment_proofs pp WHERE pp.id = p_proof_id AND pp.invoice_id = i.id) THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz; RETURN;
  END IF;

  INSERT INTO billing.payments(organization_id, invoice_id, amount_minor, currency, bank_reference, verified_at, verified_by, received_at, proof_id, note)
    VALUES (i.organization_id, i.id, p_amount_minor, 'THB', v_ref, now(), p_account_id, p_received_at, p_proof_id, nullif(trim(p_note), ''))
    RETURNING * INTO p;
  UPDATE billing.invoices SET status = 'paid', paid_at = now() WHERE id = i.id;
  UPDATE billing.payment_proofs SET status = 'accepted', reviewed_by = p_account_id, reviewed_at = now()
    WHERE organization_id = i.organization_id AND invoice_id = i.id AND status = 'pending' AND (p_proof_id IS NULL OR id = p_proof_id);
  SELECT * INTO r FROM billing.apply_paid_period(i.organization_id, i.id, i.price_version_id, now());
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id)
    VALUES (p_account_id, i.organization_id, 'billing.verify', 'payment.confirmed', 'invoice', i.id,
      jsonb_build_object('payment_id', p.id, 'amount_minor', p.amount_minor, 'bank_reference', v_ref, 'period_start', r.start_at, 'period_end', r.end_at), p_request_id);
  FOR v_owner IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = i.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
    PERFORM core.notify(i.organization_id, v_owner, 'payment_confirmed:' || i.id, 'payment_confirmed',
      jsonb_build_object('date', to_char(r.end_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')), 'invoice', i.id);
  END LOOP;
  RETURN QUERY SELECT 'ok'::text, p.id, r.start_at, r.end_at;
END $$;

-- outcome: ok | not_found | not_pending
CREATE FUNCTION padmin.reject_proof(p_account_id uuid, p_proof_id uuid, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE pp billing.payment_proofs%ROWTYPE; v_owner uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.verify');
  SELECT * INTO pp FROM billing.payment_proofs x WHERE x.id = p_proof_id FOR UPDATE;
  IF pp.id IS NULL THEN RETURN 'not_found'; END IF;
  IF pp.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  UPDATE billing.payment_proofs SET status = 'rejected', reason = trim(p_reason), reviewed_by = p_account_id, reviewed_at = now() WHERE id = pp.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, request_id)
    VALUES (p_account_id, pp.organization_id, 'billing.verify', 'payment_proof.rejected', 'payment_proof', pp.id, trim(p_reason), p_request_id);
  FOR v_owner IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = pp.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
    PERFORM core.notify(pp.organization_id, v_owner, 'payment_proof_rejected:' || pp.id, 'payment_proof_rejected', jsonb_build_object('reason', trim(p_reason)), 'invoice', pp.invoice_id);
  END LOOP;
  RETURN 'ok';
END $$;

-- Refunds: request (operator) → approve/reject (a different account) → succeeded/failed after
-- the bank transfer. The sum of refunds that are not rejected/failed never exceeds the payment.
-- Refunding never changes the entitlement (a separate decision).
-- outcome: ok | not_found | exceeds
CREATE FUNCTION padmin.request_refund(p_account_id uuid, p_payment_id uuid, p_amount_minor bigint, p_reason text, p_request_id uuid)
RETURNS TABLE (outcome text, refund_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE p billing.payments%ROWTYPE; v_taken bigint; v_id uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'refund.request');
  SELECT * INTO p FROM billing.payments x WHERE x.id = p_payment_id FOR UPDATE;
  IF p.id IS NULL THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  SELECT coalesce(sum(r.amount_minor), 0) INTO v_taken FROM billing.refunds r WHERE r.organization_id = p.organization_id AND r.payment_id = p.id
    AND r.status IN ('pending','approved','succeeded');
  IF p_amount_minor <= 0 OR v_taken + p_amount_minor > p.amount_minor THEN RETURN QUERY SELECT 'exceeds'::text, NULL::uuid; RETURN; END IF;
  INSERT INTO billing.refunds(organization_id, payment_id, amount_minor, requested_by, reason) VALUES (p.organization_id, p.id, p_amount_minor, p_account_id, trim(p_reason))
    RETURNING id INTO v_id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, details, request_id)
    VALUES (p_account_id, p.organization_id, 'refund.request', 'refund.requested', 'refund', v_id, trim(p_reason), jsonb_build_object('amount_minor', p_amount_minor), p_request_id);
  RETURN QUERY SELECT 'ok'::text, v_id;
END $$;

-- outcome: ok | not_found | not_pending | self_approval
CREATE FUNCTION padmin.decide_refund(p_account_id uuid, p_refund_id uuid, p_approve boolean, p_reason text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.refunds%ROWTYPE;
BEGIN
  PERFORM padmin.require(p_account_id, 'refund.approve');
  SELECT * INTO r FROM billing.refunds x WHERE x.id = p_refund_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN 'not_found'; END IF;
  IF r.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF r.requested_by = p_account_id THEN RETURN 'self_approval'; END IF;
  UPDATE billing.refunds SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    approved_by = CASE WHEN p_approve THEN p_account_id END, approved_at = now(), decision_reason = nullif(trim(p_reason), '') WHERE id = r.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, reason, request_id)
    VALUES (p_account_id, r.organization_id, 'refund.approve', CASE WHEN p_approve THEN 'refund.approved' ELSE 'refund.rejected' END, 'refund', r.id, nullif(trim(p_reason), ''), p_request_id);
  RETURN 'ok';
END $$;

-- After the bank transfer: succeeded with the bank reference, or failed.
-- outcome: ok | not_found | not_approved | reference_used
CREATE FUNCTION padmin.complete_refund(p_account_id uuid, p_refund_id uuid, p_succeeded boolean, p_bank_reference text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.refunds%ROWTYPE; v_ref text := nullif(upper(regexp_replace(trim(coalesce(p_bank_reference, '')), '\s+', '', 'g')), '');
BEGIN
  PERFORM padmin.require(p_account_id, 'refund.request');
  SELECT * INTO r FROM billing.refunds x WHERE x.id = p_refund_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN 'not_found'; END IF;
  IF r.status = 'succeeded' AND r.bank_reference = v_ref THEN RETURN 'ok'; END IF;
  IF r.status <> 'approved' THEN RETURN 'not_approved'; END IF;
  IF p_succeeded AND (v_ref IS NULL OR EXISTS (SELECT 1 FROM billing.refunds x WHERE x.bank_reference = v_ref)) THEN RETURN 'reference_used'; END IF;
  UPDATE billing.refunds SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END, bank_reference = CASE WHEN p_succeeded THEN v_ref END, completed_at = now()
    WHERE id = r.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id)
    VALUES (p_account_id, r.organization_id, 'refund.request', CASE WHEN p_succeeded THEN 'refund.succeeded' ELSE 'refund.failed' END, 'refund', r.id,
      jsonb_build_object('bank_reference', v_ref), p_request_id);
  RETURN 'ok';
END $$;

-- Refunds waiting for a decision or the transfer.
CREATE FUNCTION padmin.refund_queue(p_account_id uuid)
RETURNS TABLE (refund_id uuid, invoice_id uuid, number text, organization_name text, amount_minor bigint, paid_minor bigint, status text, reason text,
  requested_by uuid, requested_by_name text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  RETURN QUERY SELECT r.id, i.id, i.number, o.name, r.amount_minor, p.amount_minor, r.status, r.reason, r.requested_by, a.display_name, r.created_at
  FROM billing.refunds r JOIN billing.payments p ON p.organization_id = r.organization_id AND p.id = r.payment_id
  JOIN billing.invoices i ON i.organization_id = p.organization_id AND i.id = p.invoice_id
  JOIN core.organizations o ON o.id = r.organization_id JOIN platform.accounts a ON a.id = r.requested_by
  WHERE r.status IN ('pending','approved') ORDER BY r.created_at;
END $$;

-- Daily reconciliation rows (CSV in the API): payments and refunds by Bangkok day.
CREATE FUNCTION padmin.reconciliation(p_account_id uuid, p_from date, p_to date)
RETURNS TABLE (day date, kind text, number text, organization_name text, amount_minor bigint, bank_reference text, at timestamptz, actor text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  RETURN QUERY
  SELECT (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date, 'payment'::text, i.number, o.name, p.amount_minor, p.bank_reference, p.verified_at, a.display_name
  FROM billing.payments p JOIN billing.invoices i ON i.organization_id = p.organization_id AND i.id = p.invoice_id
  JOIN core.organizations o ON o.id = p.organization_id JOIN platform.accounts a ON a.id = p.verified_by
  WHERE (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to
  UNION ALL
  SELECT (r.completed_at AT TIME ZONE 'Asia/Bangkok')::date, 'refund', i.number, o.name, -r.amount_minor, r.bank_reference, r.completed_at, a.display_name
  FROM billing.refunds r JOIN billing.payments p ON p.organization_id = r.organization_id AND p.id = r.payment_id
  JOIN billing.invoices i ON i.organization_id = p.organization_id AND i.id = p.invoice_id
  JOIN core.organizations o ON o.id = r.organization_id JOIN platform.accounts a ON a.id = r.requested_by
  WHERE r.status = 'succeeded' AND (r.completed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to
  ORDER BY 7;
END $$;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA padmin FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA padmin TO fs_platform;
REVOKE EXECUTE ON FUNCTION platform.audit_append_only() FROM PUBLIC;
