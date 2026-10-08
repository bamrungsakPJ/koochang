-- 033: refunds of Stripe payments go back through Stripe (2026-10-09).
-- Approving a refund of a payment that came from Stripe (one-time card/QR checkout or a subscription invoice)
-- lets the API create the Stripe refund itself and record it as succeeded with the Stripe refund id, instead of
-- someone refunding in the Stripe Dashboard and typing the reference. Bank-transfer payments keep the manual
-- "complete with bank reference" step. The approver (refund.approve) triggers the money; nothing else changes:
-- the total refunded still never exceeds the payment and refunding still never touches the entitlement.

-- The Stripe payment behind an approved refund, or NULL when the payment did not come from Stripe.
CREATE FUNCTION padmin.stripe_refund_target(p_account_id uuid, p_refund_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.refunds%ROWTYPE; v_ref text; v_credential uuid;
BEGIN
  PERFORM padmin.require(p_account_id, 'refund.approve');
  SELECT * INTO r FROM billing.refunds x WHERE x.id = p_refund_id;
  IF r.id IS NULL OR r.status <> 'approved' THEN RETURN NULL; END IF;
  SELECT p.bank_reference INTO v_ref FROM billing.payments p WHERE p.organization_id = r.organization_id AND p.id = r.payment_id;
  IF v_ref ~ '^STRIPE:pi_' THEN
    SELECT c.credential_id INTO v_credential FROM billing.stripe_checkouts c
      WHERE c.organization_id = r.organization_id AND c.payment_intent = substr(v_ref, 8) ORDER BY c.created_at DESC LIMIT 1;
    IF v_credential IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor, 'credential_id', v_credential, 'payment_intent', substr(v_ref, 8));
  ELSIF v_ref ~ '^STRIPE:in_' THEN
    SELECT s.credential_id INTO v_credential FROM billing.stripe_subscription_invoices i
      JOIN billing.stripe_subscriptions s ON s.id = i.subscription_row WHERE i.stripe_invoice_id = substr(v_ref, 8);
    IF v_credential IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('refund_id', r.id, 'amount_minor', r.amount_minor, 'credential_id', v_credential, 'stripe_invoice', substr(v_ref, 8));
  END IF;
  RETURN NULL;
END $$;

-- Result of the Stripe refund call: succeeded with the Stripe refund id (stored as STRIPE:re_…), or failed
-- (Stripe refused it; the amount is free to request again). Retrying with the same Stripe refund id is a no-op.
-- outcome: ok | not_found | not_approved | reference_used
CREATE FUNCTION padmin.finish_stripe_refund(p_account_id uuid, p_refund_id uuid, p_stripe_refund text, p_succeeded boolean, p_error text, p_request_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE r billing.refunds%ROWTYPE; v_ref text := CASE WHEN p_stripe_refund ~ '^re_[A-Za-z0-9]+$' THEN 'STRIPE:' || p_stripe_refund END;
BEGIN
  PERFORM padmin.require(p_account_id, 'refund.approve');
  SELECT * INTO r FROM billing.refunds x WHERE x.id = p_refund_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN 'not_found'; END IF;
  IF r.status = 'succeeded' AND r.bank_reference = v_ref THEN RETURN 'ok'; END IF;
  IF r.status <> 'approved' THEN RETURN 'not_approved'; END IF;
  IF p_succeeded AND (v_ref IS NULL OR EXISTS (SELECT 1 FROM billing.refunds x WHERE x.bank_reference = v_ref)) THEN RETURN 'reference_used'; END IF;
  UPDATE billing.refunds SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END, bank_reference = CASE WHEN p_succeeded THEN v_ref END, completed_at = now()
    WHERE id = r.id;
  INSERT INTO platform.audit_logs(actor_account_id, organization_id, permission, action, target_type, target_id, details, request_id)
    VALUES (p_account_id, r.organization_id, 'refund.approve', CASE WHEN p_succeeded THEN 'refund.succeeded' ELSE 'refund.failed' END, 'refund', r.id,
      jsonb_strip_nulls(jsonb_build_object('bank_reference', v_ref, 'via', 'stripe', 'error', left(p_error, 200))), p_request_id);
  RETURN 'ok';
END $$;

-- Refund queue with whether the payment came from Stripe (the console then offers "refund via Stripe"
-- instead of the bank-reference form). The older padmin.refund_queue stays for the API still running.
CREATE FUNCTION padmin.refund_list(p_account_id uuid)
RETURNS TABLE (refund_id uuid, invoice_id uuid, number text, organization_name text, amount_minor bigint, paid_minor bigint, status text, reason text,
  requested_by uuid, requested_by_name text, created_at timestamptz, via_stripe boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  RETURN QUERY SELECT r.id, i.id, i.number, o.name, r.amount_minor, p.amount_minor, r.status, r.reason, r.requested_by, a.display_name, r.created_at,
    coalesce(p.bank_reference ~ '^STRIPE:(pi|in)_', false)
  FROM billing.refunds r JOIN billing.payments p ON p.organization_id = r.organization_id AND p.id = r.payment_id
  JOIN billing.invoices i ON i.organization_id = p.organization_id AND i.id = p.invoice_id
  JOIN core.organizations o ON o.id = r.organization_id JOIN platform.accounts a ON a.id = r.requested_by
  WHERE r.status IN ('pending','approved') ORDER BY r.created_at;
END $$;

REVOKE ALL ON FUNCTION padmin.stripe_refund_target(uuid,uuid), padmin.finish_stripe_refund(uuid,uuid,text,boolean,text,uuid), padmin.refund_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.stripe_refund_target(uuid,uuid), padmin.finish_stripe_refund(uuid,uuid,text,boolean,text,uuid), padmin.refund_list(uuid) TO fs_platform;
