-- Immediate EasySlip verification; exceptional proofs keep their existing admin review path.
ALTER TABLE billing.invoices ADD COLUMN receiver_snapshot jsonb;
ALTER TABLE billing.payment_proofs
  ADD COLUMN verification_code text NOT NULL DEFAULT 'CONFIGURATION',
  ADD COLUMN verification_token uuid,
  ADD COLUMN verification_at timestamptz;
ALTER TABLE billing.payments ALTER COLUMN verified_by DROP NOT NULL;
ALTER TABLE billing.payments ADD COLUMN verification_source text NOT NULL DEFAULT 'admin'
  CHECK (verification_source IN ('admin','easyslip'));
ALTER TABLE billing.payments ADD CONSTRAINT payment_verifier
  CHECK ((verification_source = 'admin' AND verified_by IS NOT NULL) OR
         (verification_source = 'easyslip' AND verified_by IS NULL AND proof_id IS NOT NULL));

CREATE FUNCTION auth.freeze_invoice_receiver(p_user uuid, p_org uuid, p_invoice uuid, p_receiver jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.owner_member_id(p_user, p_org) IS NULL THEN RAISE insufficient_privilege; END IF;
  UPDATE billing.invoices SET receiver_snapshot = p_receiver
    WHERE organization_id = p_org AND id = p_invoice AND status = 'open' AND receiver_snapshot IS NULL
      AND NOT EXISTS (SELECT 1 FROM billing.payment_proofs WHERE invoice_id = p_invoice);
END $$;
REVOKE ALL ON FUNCTION auth.freeze_invoice_receiver(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.freeze_invoice_receiver(uuid,uuid,uuid,jsonb) TO fs_api;

-- Register before writing the object. An id can never overwrite another invoice's proof or bytes.
CREATE OR REPLACE FUNCTION auth.submit_payment_proof(p_user_id uuid, p_organization_id uuid, p_invoice_id uuid,
  p_proof_id uuid, p_object_key text, p_checksum text, p_size bigint)
RETURNS TABLE (outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_status text; pp billing.payment_proofs%ROWTYPE;
BEGIN
  IF auth.owner_member_id(p_user_id,p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text; RETURN; END IF;
  SELECT status INTO v_status FROM billing.invoices WHERE organization_id=p_organization_id AND id=p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN QUERY SELECT 'not_found'::text; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_proof_id::text, 14));
  SELECT * INTO pp FROM billing.payment_proofs WHERE id=p_proof_id;
  IF pp.id IS NOT NULL THEN
    IF pp.organization_id <> p_organization_id OR pp.invoice_id <> p_invoice_id THEN RETURN QUERY SELECT 'not_found'::text;
    ELSIF pp.checksum IS DISTINCT FROM p_checksum THEN RETURN QUERY SELECT 'mismatch'::text;
    ELSE RETURN QUERY SELECT 'existing'::text; END IF;
    RETURN;
  END IF;
  IF v_status <> 'open' THEN RETURN QUERY SELECT 'closed'::text; RETURN; END IF;
  INSERT INTO billing.payment_proofs(id,organization_id,invoice_id,private_object_key,submitted_by,checksum,size_bytes)
    VALUES(p_proof_id,p_organization_id,p_invoice_id,p_object_key,p_user_id,p_checksum,p_size);
  INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
    VALUES(p_organization_id,p_user_id,'payment_proof.submitted','invoice',p_invoice_id,gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text;
END $$;

CREATE FUNCTION worker.claim_slip(p_proof uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  UPDATE billing.payment_proofs SET verification_token=p_token,verification_code='CHECKING'
    WHERE id=p_proof AND status='pending' AND verification_token IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('id',i.id,'amount_minor',i.amount_minor,'created_at',i.created_at,'receiver',i.receiver_snapshot)
    INTO v FROM billing.invoices i JOIN billing.payment_proofs pp ON pp.invoice_id=i.id WHERE pp.id=p_proof;
  RETURN v;
END $$;

CREATE FUNCTION worker.finish_slip(p_proof uuid,p_token uuid,p_result jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE pp billing.payment_proofs%ROWTYPE; i billing.invoices%ROWTYPE; v_code text:=p_result->>'code';
  v_ref text:=p_result->>'reference'; v_received timestamptz; v_payment uuid; r record; v_owner uuid;
BEGIN
  SELECT x.* INTO i FROM billing.invoices x JOIN billing.payment_proofs y ON y.invoice_id=x.id WHERE y.id=p_proof FOR UPDATE OF x;
  SELECT * INTO pp FROM billing.payment_proofs WHERE id=p_proof FOR UPDATE;
  IF pp.id IS NULL OR pp.verification_token IS DISTINCT FROM p_token OR pp.status <> 'pending' THEN RETURN 'existing'; END IF;
  IF v_code='VERIFIED' THEN
    v_received:=(p_result->>'receivedAt')::timestamptz;
    IF i.status <> 'open' THEN v_code:='INVOICE_CLOSED';
    ELSIF (p_result->>'amountMinor')::bigint IS DISTINCT FROM i.amount_minor THEN v_code:='AMOUNT_MISMATCH';
    ELSIF v_ref IS NULL OR v_ref !~ '^[A-Z0-9-]{1,80}$' OR v_received IS NULL OR
      v_received<i.created_at OR v_received>now()+interval '1 minute' THEN v_code:='INVALID_RESPONSE';
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended(v_ref, 15));
      IF EXISTS(SELECT 1 FROM billing.payments WHERE bank_reference=v_ref) THEN v_code:='DUPLICATE'; END IF;
    END IF;
  END IF;
  IF v_code='VERIFIED' THEN
    -- A concurrent manual confirmation may have taken the reference; the unique index is final authority.
    INSERT INTO billing.payments(organization_id,invoice_id,amount_minor,currency,bank_reference,verified_at,verified_by,received_at,proof_id,verification_source)
      VALUES(i.organization_id,i.id,i.amount_minor,'THB',v_ref,now(),NULL,v_received,pp.id,'easyslip')
      ON CONFLICT DO NOTHING RETURNING id INTO v_payment;
    IF v_payment IS NULL THEN v_code:='DUPLICATE';
    ELSE
      UPDATE billing.invoices SET status='paid',paid_at=now() WHERE id=i.id;
      UPDATE billing.payment_proofs SET status='accepted',reviewed_at=now() WHERE id=pp.id;
      SELECT * INTO r FROM billing.apply_paid_period(i.organization_id,i.id,i.price_version_id,now());
      IF r.period_id IS NULL OR r.outcome NOT IN ('created','existing') THEN
        RAISE EXCEPTION 'paid period could not be applied';
      END IF;
      INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
        VALUES(i.organization_id,'payment.auto_confirmed','invoice',i.id,jsonb_build_object('provider','easyslip','payment_id',v_payment,'bank_reference',v_ref,'period_end',r.end_at));
      FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=i.organization_id AND role='owner' AND status='active' LOOP
        PERFORM core.notify(i.organization_id,v_owner,'payment_confirmed:'||i.id,'payment_confirmed',
          jsonb_build_object('date',to_char(r.end_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),'invoice',i.id);
      END LOOP;
    END IF;
  END IF;
  UPDATE billing.payment_proofs SET verification_code=coalesce(v_code,'INVALID_RESPONSE'),verification_at=now() WHERE id=pp.id;
  RETURN coalesce(v_code,'INVALID_RESPONSE');
END $$;
REVOKE ALL ON FUNCTION worker.claim_slip(uuid,uuid),worker.finish_slip(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.claim_slip(uuid,uuid),worker.finish_slip(uuid,uuid,jsonb) TO fs_worker;
CREATE OR REPLACE FUNCTION padmin.invoice_detail(p_account_id uuid, p_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  SELECT jsonb_build_object(
    'invoice', to_jsonb(i) - 'buyer_snapshot' || jsonb_build_object('organization_name', o.name, 'buyer', i.buyer_snapshot),
    'proofs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', pp.id, 'status', pp.status, 'reason', pp.reason, 'created_at', pp.created_at,
        'reviewed_at', pp.reviewed_at, 'size_bytes', pp.size_bytes, 'verification_code', pp.verification_code, 'verification_at', pp.verification_at) ORDER BY pp.created_at DESC)
      FROM billing.payment_proofs pp WHERE pp.organization_id = i.organization_id AND pp.invoice_id = i.id), '[]'),
    'payment', (SELECT jsonb_build_object('id', p.id, 'amount_minor', p.amount_minor, 'bank_reference', p.bank_reference, 'received_at', p.received_at,
        'verified_at', p.verified_at, 'verified_by', coalesce(a.display_name, 'EasySlip'), 'verification_source', p.verification_source, 'note', p.note,
        'refunded_minor', coalesce((SELECT sum(r.amount_minor) FROM billing.refunds r WHERE r.organization_id = p.organization_id AND r.payment_id = p.id AND r.status = 'succeeded'), 0))
      FROM billing.payments p LEFT JOIN platform.accounts a ON a.id = p.verified_by WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id),
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

CREATE OR REPLACE FUNCTION padmin.reconciliation(p_account_id uuid, p_from date, p_to date)
RETURNS TABLE (day date, kind text, number text, organization_name text, amount_minor bigint, bank_reference text, at timestamptz, actor text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM padmin.require(p_account_id, 'billing.read');
  RETURN QUERY
  SELECT (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date, 'payment'::text, i.number, o.name, p.amount_minor, p.bank_reference, p.verified_at, coalesce(a.display_name, 'EasySlip')
  FROM billing.payments p JOIN billing.invoices i ON i.organization_id = p.organization_id AND i.id = p.invoice_id
  JOIN core.organizations o ON o.id = p.organization_id LEFT JOIN platform.accounts a ON a.id = p.verified_by
  WHERE (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to
  UNION ALL
  SELECT (r.completed_at AT TIME ZONE 'Asia/Bangkok')::date, 'refund', i.number, o.name, -r.amount_minor, r.bank_reference, r.completed_at, a.display_name
  FROM billing.refunds r JOIN billing.payments p ON p.organization_id = r.organization_id AND p.id = r.payment_id
  JOIN billing.invoices i ON i.organization_id = p.organization_id AND i.id = p.invoice_id
  JOIN core.organizations o ON o.id = r.organization_id JOIN platform.accounts a ON a.id = r.requested_by
  WHERE r.status = 'succeeded' AND (r.completed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to
  ORDER BY 7;
END $$;
