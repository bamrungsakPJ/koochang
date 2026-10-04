-- Platform Stripe settings, pinned credentials and tenant checkout records.
INSERT INTO platform.permissions(code) VALUES('payments.manage');
INSERT INTO platform.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM platform.roles r CROSS JOIN platform.permissions p
 WHERE r.code IN ('super_admin','platform_admin') AND p.code='payments.manage';

CREATE TABLE platform.stripe_credentials (
 id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
 account_id text NOT NULL CHECK(account_id ~ '^acct_[A-Za-z0-9]+$'),
 mode text NOT NULL CHECK(mode IN ('test','live')), secret_sealed text NOT NULL, webhook_sealed text NOT NULL
);
CREATE TABLE platform.payment_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), version integer NOT NULL DEFAULT 1,
 credential_id uuid NOT NULL REFERENCES platform.stripe_credentials(id),
 card_enabled boolean NOT NULL DEFAULT false, qr_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform.stripe_credentials,platform.payment_settings FROM PUBLIC;
CREATE TABLE billing.stripe_checkouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 invoice_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 credential_id uuid NOT NULL REFERENCES platform.stripe_credentials(id),
 method text NOT NULL CHECK(method IN ('card','promptpay')), request_key uuid NOT NULL,
 session_id text UNIQUE, checkout_url text, expires_at timestamptz,
 status text NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','open','paid','expired','failed','manual_review')),
 reason text, payment_intent text, verified_at timestamptz,
 UNIQUE(organization_id,id), UNIQUE(organization_id,request_key),
 FOREIGN KEY(organization_id,invoice_id) REFERENCES billing.invoices(organization_id,id)
);
CREATE UNIQUE INDEX one_active_stripe_checkout ON billing.stripe_checkouts(invoice_id) WHERE status IN ('creating','open');
ALTER TABLE billing.stripe_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.stripe_checkouts FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_owner_read ON billing.stripe_checkouts FOR SELECT TO fs_api
 USING(core.owner_allowed(organization_id));
CREATE POLICY stripe_functions ON billing.stripe_checkouts TO fs_migrator USING(true) WITH CHECK(true);
GRANT SELECT ON billing.stripe_checkouts TO fs_api;

CREATE FUNCTION padmin.stripe_settings(p_account uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_account,'payments.manage');
 SELECT jsonb_build_object('version',s.version,'credential_id',c.id,'account_id',c.account_id,'mode',c.mode,
   'card_enabled',s.card_enabled,'qr_enabled',s.qr_enabled,'key_configured',true,'webhook_configured',true)
 INTO v FROM platform.payment_settings s JOIN platform.stripe_credentials c ON c.id=s.credential_id;
 RETURN coalesce(v,jsonb_build_object('version',0,'card_enabled',false,'qr_enabled',false,'key_configured',false,'webhook_configured',false));
END $$;
CREATE FUNCTION worker.stripe_config(p_credential uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT to_jsonb(c)||jsonb_build_object('version',s.version,'card_enabled',s.card_enabled,'qr_enabled',s.qr_enabled)
 FROM platform.stripe_credentials c CROSS JOIN platform.payment_settings s
 WHERE c.id=coalesce(p_credential,s.credential_id)
$$;
CREATE FUNCTION padmin.save_stripe_settings(p_account uuid,p_credential uuid,p_stripe_account text,p_mode text,
 p_secret text,p_webhook text,p_card boolean,p_qr boolean,p_version integer,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s platform.payment_settings%ROWTYPE;
BEGIN
 PERFORM padmin.require(p_account,'payments.manage');
 PERFORM pg_advisory_xact_lock(15015);
 SELECT * INTO s FROM platform.payment_settings WHERE id FOR UPDATE;
 IF coalesce(s.version,0)<>p_version THEN RETURN 'conflict'; END IF;
 IF p_secret IS NOT NULL THEN
   INSERT INTO platform.stripe_credentials(id,account_id,mode,secret_sealed,webhook_sealed)
     VALUES(p_credential,p_stripe_account,p_mode,p_secret,p_webhook);
 ELSE
   IF s.credential_id IS DISTINCT FROM p_credential THEN RETURN 'conflict'; END IF;
 END IF;
 INSERT INTO platform.payment_settings(id,credential_id,card_enabled,qr_enabled)
 VALUES(true,p_credential,p_card,p_qr)
 ON CONFLICT(id) DO UPDATE SET credential_id=excluded.credential_id,card_enabled=excluded.card_enabled,
   qr_enabled=excluded.qr_enabled,version=platform.payment_settings.version+1,updated_at=now();
 INSERT INTO platform.audit_logs(actor_account_id,action,target_type,target_id,details,request_id)
 VALUES(p_account,'payment_settings.updated','stripe_credentials',p_credential,
   jsonb_build_object('account_id',p_stripe_account,'mode',p_mode,'card_enabled',p_card,'qr_enabled',p_qr),p_request);
 RETURN 'ok';
END $$;

CREATE FUNCTION worker.prepare_stripe(p_user uuid,p_org uuid,p_invoice uuid,p_method text,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i billing.invoices%ROWTYPE; a billing.stripe_checkouts%ROWTYPE; s platform.payment_settings%ROWTYPE;
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN jsonb_build_object('error','TENANT_ACCESS_DENIED'); END IF;
 SELECT * INTO i FROM billing.invoices WHERE organization_id=p_org AND id=p_invoice FOR UPDATE;
 IF i.id IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 SELECT * INTO a FROM billing.stripe_checkouts WHERE organization_id=p_org AND request_key=p_key;
 IF a.id IS NOT NULL AND (a.invoice_id<>p_invoice OR a.method<>p_method) THEN RETURN jsonb_build_object('error','VERSION_CONFLICT'); END IF;
 IF i.status<>'open' THEN RETURN jsonb_build_object('error','INVOICE_CLOSED'); END IF;
 IF a.id IS NULL THEN SELECT * INTO a FROM billing.stripe_checkouts WHERE invoice_id=i.id AND status IN ('creating','open'); END IF;
 IF a.id IS NOT NULL THEN
   IF a.method<>p_method THEN RETURN jsonb_build_object('error','PAYMENT_IN_PROGRESS'); END IF;
   IF a.status NOT IN ('creating','open') THEN RETURN jsonb_build_object('error','INVALID_STATE_TRANSITION'); END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM billing.payment_proofs WHERE invoice_id=i.id AND status='pending') THEN RETURN jsonb_build_object('error','PAYMENT_IN_PROGRESS'); END IF;
   SELECT * INTO s FROM platform.payment_settings WHERE id;
   IF s.credential_id IS NULL OR NOT (CASE p_method WHEN 'card' THEN s.card_enabled WHEN 'promptpay' THEN s.qr_enabled ELSE false END) THEN
     RETURN jsonb_build_object('error','TEMPORARILY_UNAVAILABLE'); END IF;
   INSERT INTO billing.stripe_checkouts(organization_id,invoice_id,credential_id,method,request_key,expires_at)
   VALUES(p_org,i.id,s.credential_id,p_method,p_key,now()+interval '35 minutes') RETURNING * INTO a;
 END IF;
 RETURN to_jsonb(a)||jsonb_build_object('amount_minor',i.amount_minor,'number',i.number,'currency',trim(i.currency));
END $$;

CREATE FUNCTION worker.attach_stripe(p_id uuid,p_session text,p_url text,p_expires timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE billing.stripe_checkouts SET session_id=p_session,checkout_url=p_url,expires_at=p_expires,status='open'
 WHERE id=p_id AND status='creating' AND (session_id IS NULL OR session_id=p_session);
END $$;
CREATE FUNCTION worker.stripe_attempt(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT to_jsonb(a)||jsonb_build_object('amount_minor',i.amount_minor,'number',i.number)
 FROM billing.stripe_checkouts a JOIN billing.invoices i ON i.id=a.invoice_id WHERE a.id=p_id
$$;

ALTER TABLE billing.payments DROP CONSTRAINT payments_verification_source_check;
ALTER TABLE billing.payments ADD CONSTRAINT payments_verification_source_check CHECK(verification_source IN ('admin','easyslip','stripe'));
ALTER TABLE billing.payments DROP CONSTRAINT payment_verifier;
ALTER TABLE billing.payments ADD CONSTRAINT payment_verifier CHECK(
 (verification_source='admin' AND verified_by IS NOT NULL) OR
 (verification_source='easyslip' AND verified_by IS NULL AND proof_id IS NOT NULL) OR
 (verification_source='stripe' AND verified_by IS NULL AND proof_id IS NULL));

CREATE FUNCTION worker.finish_stripe(p_id uuid,p_session text,p_intent text,p_amount bigint,p_currency text,
 p_status text,p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a billing.stripe_checkouts%ROWTYPE; i billing.invoices%ROWTYPE; r record; v_payment uuid; v_owner uuid;
BEGIN
 SELECT x.* INTO i FROM billing.invoices x JOIN billing.stripe_checkouts y ON y.invoice_id=x.id WHERE y.id=p_id FOR UPDATE OF x;
 SELECT * INTO a FROM billing.stripe_checkouts WHERE id=p_id FOR UPDATE;
 IF a.id IS NULL OR a.session_id IS DISTINCT FROM p_session THEN RETURN 'not_found'; END IF;
 IF a.status='paid' THEN RETURN 'existing'; END IF;
 IF p_status IN ('expired','failed') THEN
   UPDATE billing.stripe_checkouts SET status=p_status,reason=p_reason WHERE id=a.id AND status IN ('creating','open'); RETURN p_status;
 END IF;
 IF p_status<>'paid' THEN RETURN 'pending'; END IF;
 IF i.status<>'open' OR p_amount IS DISTINCT FROM i.amount_minor OR p_currency<>'thb' OR p_intent IS NULL OR p_intent !~ '^pi_[A-Za-z0-9]+$' THEN
   UPDATE billing.stripe_checkouts SET status='manual_review',reason='PAYMENT_MISMATCH',payment_intent=p_intent WHERE id=a.id; RETURN 'manual_review';
 END IF;
 INSERT INTO billing.payments(organization_id,invoice_id,amount_minor,currency,bank_reference,verified_at,verified_by,received_at,verification_source,note)
 VALUES(i.organization_id,i.id,i.amount_minor,'THB','STRIPE:'||p_intent,now(),NULL,now(),'stripe',a.method)
 ON CONFLICT DO NOTHING RETURNING id INTO v_payment;
 IF v_payment IS NULL THEN UPDATE billing.stripe_checkouts SET status='manual_review',reason='DUPLICATE' WHERE id=a.id; RETURN 'manual_review'; END IF;
 UPDATE billing.invoices SET status='paid',paid_at=now() WHERE id=i.id;
 SELECT * INTO r FROM billing.apply_paid_period(i.organization_id,i.id,i.price_version_id,now());
 IF r.period_id IS NULL THEN RAISE EXCEPTION 'paid period could not be applied'; END IF;
 UPDATE billing.stripe_checkouts SET status='paid',payment_intent=p_intent,verified_at=now(),reason=NULL WHERE id=a.id;
 INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
 VALUES(i.organization_id,'payment.stripe_confirmed','invoice',i.id,jsonb_build_object('payment_id',v_payment,'session_id',p_session,'payment_intent',p_intent,'method',a.method));
 FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=i.organization_id AND role='owner' AND status='active' LOOP
   PERFORM core.notify(i.organization_id,v_owner,'payment_confirmed:'||i.id,'payment_confirmed',
     jsonb_build_object('date',to_char(r.end_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),'invoice',i.id);
 END LOOP;
 RETURN 'paid';
END $$;
REVOKE ALL ON FUNCTION padmin.stripe_settings(uuid),padmin.save_stripe_settings(uuid,uuid,text,text,text,text,boolean,boolean,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.stripe_settings(uuid),padmin.save_stripe_settings(uuid,uuid,text,text,text,text,boolean,boolean,integer,uuid) TO fs_platform;
REVOKE ALL ON FUNCTION worker.stripe_config(uuid),worker.prepare_stripe(uuid,uuid,uuid,text,uuid),worker.attach_stripe(uuid,text,text,timestamptz),worker.stripe_attempt(uuid),worker.finish_stripe(uuid,text,text,bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.stripe_config(uuid),worker.prepare_stripe(uuid,uuid,uuid,text,uuid),worker.attach_stripe(uuid,text,text,timestamptz),worker.stripe_attempt(uuid),worker.finish_stripe(uuid,text,text,bigint,text,text,text) TO fs_worker;
CREATE OR REPLACE FUNCTION auth.create_invoice(p_user_id uuid, p_organization_id uuid, p_price_version_id uuid, p_request_key uuid)
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
    IF EXISTS (SELECT 1 FROM billing.payment_proofs pp WHERE pp.organization_id = p_organization_id AND pp.invoice_id = v_open.id AND pp.status = 'pending') OR EXISTS(SELECT 1 FROM billing.stripe_checkouts sc WHERE sc.invoice_id=v_open.id AND sc.status IN ('creating','open','manual_review')) THEN
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
  IF EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE invoice_id=p_invoice_id AND status IN ('creating','open','manual_review')) THEN RETURN QUERY SELECT 'checkout_active'::text; RETURN; END IF;
  IF v_status <> 'open' THEN RETURN QUERY SELECT 'closed'::text; RETURN; END IF;
  INSERT INTO billing.payment_proofs(id,organization_id,invoice_id,private_object_key,submitted_by,checksum,size_bytes)
    VALUES(p_proof_id,p_organization_id,p_invoice_id,p_object_key,p_user_id,p_checksum,p_size);
  INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
    VALUES(p_organization_id,p_user_id,'payment_proof.submitted','invoice',p_invoice_id,gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text;
END $$;

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
        'verified_at', p.verified_at, 'verified_by', coalesce(a.display_name, CASE WHEN p.verification_source='stripe' THEN 'Stripe' ELSE 'EasySlip' END), 'verification_source', p.verification_source, 'note', p.note,
        'refunded_minor', coalesce((SELECT sum(r.amount_minor) FROM billing.refunds r WHERE r.organization_id = p.organization_id AND r.payment_id = p.id AND r.status = 'succeeded'), 0))
      FROM billing.payments p LEFT JOIN platform.accounts a ON a.id = p.verified_by WHERE p.organization_id = i.organization_id AND p.invoice_id = i.id),
    'checkouts',coalesce((SELECT jsonb_agg(to_jsonb(sc)-'credential_id'-'checkout_url'-'request_key') FROM billing.stripe_checkouts sc WHERE sc.invoice_id=i.id),'[]'),
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
  SELECT (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date, 'payment'::text, i.number, o.name, p.amount_minor, p.bank_reference, p.verified_at, coalesce(a.display_name, CASE WHEN p.verification_source='stripe' THEN 'Stripe' ELSE 'EasySlip' END)
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

CREATE OR REPLACE FUNCTION padmin.payment_queue(p_account_id uuid, p_status text)
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
  WHERE (p_status = 'pending' AND ((i.status = 'open' AND pp.status = 'pending') OR EXISTS(SELECT 1 FROM billing.stripe_checkouts sc WHERE sc.invoice_id=i.id AND sc.status='manual_review')))
     OR (p_status = 'open' AND i.status = 'open')
     OR (p_status = 'paid' AND i.status = 'paid')
     OR (p_status = 'all')
  ORDER BY CASE WHEN pp.status = 'pending' THEN pp.created_at END NULLS LAST, i.created_at DESC
  LIMIT 200;
END $$;
