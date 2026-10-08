-- Automatic card renewal. The owner opts in while paying an invoice by card on Stripe Checkout;
-- the card is saved on a Stripe customer of the platform account. The worker then charges it
-- off-session one day before the paid period ends, through the same invoice -> payment -> period
-- path as every other payment, so our periods stay the only schedule (no Stripe Subscription).
-- PromptPay and transfers stay one-time.

ALTER TABLE billing.stripe_checkouts ADD COLUMN save_card boolean NOT NULL DEFAULT false;
ALTER TABLE billing.stripe_checkouts ADD CONSTRAINT save_card_only_card CHECK (NOT save_card OR method = 'card');

CREATE TABLE billing.card_autopay (
 organization_id uuid PRIMARY KEY REFERENCES core.organizations(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 credential_id uuid NOT NULL REFERENCES platform.stripe_credentials(id),
 customer_id text NOT NULL CHECK (customer_id ~ '^cus_[A-Za-z0-9]+$'),
 payment_method_id text NOT NULL CHECK (payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
 brand text, last4 text CHECK (last4 ~ '^[0-9]{4}$'), exp_month integer, exp_year integer,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')), disabled_reason text,
 source_checkout_id uuid REFERENCES billing.stripe_checkouts(id)
);
CREATE TABLE billing.autopay_charges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 renews_period_id uuid NOT NULL, invoice_id uuid, credential_id uuid NOT NULL REFERENCES platform.stripe_credentials(id),
 attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
 status text NOT NULL DEFAULT 'charging' CHECK (status IN ('charging','processing','paid','failed','manual_review')),
 payment_intent text, reason text, next_attempt_at timestamptz,
 UNIQUE (renews_period_id, attempt_no),
 FOREIGN KEY (organization_id,renews_period_id) REFERENCES billing.subscription_periods(organization_id,id),
 FOREIGN KEY (organization_id,invoice_id) REFERENCES billing.invoices(organization_id,id)
);
CREATE UNIQUE INDEX one_active_autopay_charge ON billing.autopay_charges(organization_id) WHERE status IN ('charging','processing');
ALTER TABLE billing.card_autopay ENABLE ROW LEVEL SECURITY; ALTER TABLE billing.card_autopay FORCE ROW LEVEL SECURITY;
ALTER TABLE billing.autopay_charges ENABLE ROW LEVEL SECURITY; ALTER TABLE billing.autopay_charges FORCE ROW LEVEL SECURITY;
CREATE POLICY autopay_owner_read ON billing.card_autopay FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY autopay_functions ON billing.card_autopay TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY autopay_charge_owner_read ON billing.autopay_charges FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY autopay_charge_functions ON billing.autopay_charges TO fs_migrator USING (true) WITH CHECK (true);
GRANT SELECT ON billing.card_autopay, billing.autopay_charges TO fs_api;

-- Last 4 digits of the card when automatic renewal can run now: enabled by the owner, card
-- payments enabled on the platform, and the saved customer belongs to the current Stripe account.
CREATE FUNCTION billing.autopay_card(p_org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT coalesce(ap.last4, '0000') FROM billing.card_autopay ap
 JOIN platform.stripe_credentials saved ON saved.id = ap.credential_id
 JOIN platform.payment_settings s ON s.id AND s.card_enabled
 JOIN platform.stripe_credentials cur ON cur.id = s.credential_id
 WHERE ap.organization_id = p_org AND ap.status = 'active' AND saved.account_id = cur.account_id AND saved.mode = cur.mode
$$;

-- Checkout ----------------------------------------------------------------------------------
DROP FUNCTION worker.prepare_stripe(uuid,uuid,uuid,text,uuid);
CREATE FUNCTION worker.prepare_stripe(p_user uuid,p_org uuid,p_invoice uuid,p_method text,p_key uuid,p_save boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i billing.invoices%ROWTYPE; a billing.stripe_checkouts%ROWTYPE; s platform.payment_settings%ROWTYPE; v_customer text;
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN jsonb_build_object('error','TENANT_ACCESS_DENIED'); END IF;
 IF p_save AND p_method<>'card' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 SELECT * INTO i FROM billing.invoices WHERE organization_id=p_org AND id=p_invoice FOR UPDATE;
 IF i.id IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 SELECT * INTO a FROM billing.stripe_checkouts WHERE organization_id=p_org AND request_key=p_key;
 IF a.id IS NOT NULL AND (a.invoice_id<>p_invoice OR a.method<>p_method OR a.save_card<>p_save) THEN RETURN jsonb_build_object('error','VERSION_CONFLICT'); END IF;
 IF i.status<>'open' THEN RETURN jsonb_build_object('error','INVOICE_CLOSED'); END IF;
 IF a.id IS NULL THEN SELECT * INTO a FROM billing.stripe_checkouts WHERE invoice_id=i.id AND status IN ('creating','open'); END IF;
 IF a.id IS NOT NULL THEN
   IF a.method<>p_method OR a.save_card<>p_save THEN RETURN jsonb_build_object('error','PAYMENT_IN_PROGRESS'); END IF;
   IF a.status NOT IN ('creating','open') THEN RETURN jsonb_build_object('error','INVALID_STATE_TRANSITION'); END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM billing.payment_proofs WHERE invoice_id=i.id AND status='pending')
     OR EXISTS(SELECT 1 FROM billing.autopay_charges WHERE invoice_id=i.id AND status IN ('charging','processing','manual_review')) THEN
     RETURN jsonb_build_object('error','PAYMENT_IN_PROGRESS'); END IF;
   SELECT * INTO s FROM platform.payment_settings WHERE id;
   IF s.credential_id IS NULL OR NOT (CASE p_method WHEN 'card' THEN s.card_enabled WHEN 'promptpay' THEN s.qr_enabled ELSE false END) THEN
     RETURN jsonb_build_object('error','TEMPORARILY_UNAVAILABLE'); END IF;
   INSERT INTO billing.stripe_checkouts(organization_id,invoice_id,credential_id,method,request_key,expires_at,save_card)
   VALUES(p_org,i.id,s.credential_id,p_method,p_key,now()+interval '35 minutes',p_save) RETURNING * INTO a;
 END IF;
 -- Reuse the shop's Stripe customer when it belongs to the same Stripe account.
 SELECT ap.customer_id INTO v_customer FROM billing.card_autopay ap
   JOIN platform.stripe_credentials saved ON saved.id=ap.credential_id JOIN platform.stripe_credentials cur ON cur.id=a.credential_id
   WHERE ap.organization_id=p_org AND saved.account_id=cur.account_id AND saved.mode=cur.mode;
 RETURN to_jsonb(a)||jsonb_build_object('amount_minor',i.amount_minor,'number',i.number,'currency',trim(i.currency),'customer_id',v_customer);
END $$;

CREATE OR REPLACE FUNCTION worker.stripe_attempt(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT to_jsonb(a)||jsonb_build_object('amount_minor',i.amount_minor,'number',i.number,
   'autopay_saved',EXISTS(SELECT 1 FROM billing.card_autopay ap WHERE ap.organization_id=a.organization_id AND ap.source_checkout_id=a.id))
 FROM billing.stripe_checkouts a JOIN billing.invoices i ON i.id=a.invoice_id WHERE a.id=p_id
$$;

-- Saves the card from a paid checkout where the owner chose automatic renewal. A replay of an
-- older checkout never replaces a card saved later. outcome: ok | existing | ignored
CREATE FUNCTION worker.save_autopay(p_checkout uuid,p_customer text,p_method text,p_brand text,p_last4 text,p_exp_month integer,p_exp_year integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a billing.stripe_checkouts%ROWTYPE; ap billing.card_autopay%ROWTYPE;
BEGIN
 SELECT * INTO a FROM billing.stripe_checkouts WHERE id=p_checkout FOR UPDATE;
 IF a.id IS NULL OR a.status<>'paid' OR NOT a.save_card THEN RETURN 'ignored'; END IF;
 SELECT * INTO ap FROM billing.card_autopay WHERE organization_id=a.organization_id FOR UPDATE;
 IF ap.source_checkout_id=a.id THEN RETURN 'existing'; END IF;
 IF ap.organization_id IS NOT NULL AND ap.updated_at>a.verified_at THEN RETURN 'ignored'; END IF;
 INSERT INTO billing.card_autopay(organization_id,credential_id,customer_id,payment_method_id,brand,last4,exp_month,exp_year,source_checkout_id)
 VALUES(a.organization_id,a.credential_id,p_customer,p_method,p_brand,p_last4,p_exp_month,p_exp_year,a.id)
 ON CONFLICT(organization_id) DO UPDATE SET credential_id=excluded.credential_id,customer_id=excluded.customer_id,
   payment_method_id=excluded.payment_method_id,brand=excluded.brand,last4=excluded.last4,exp_month=excluded.exp_month,
   exp_year=excluded.exp_year,source_checkout_id=excluded.source_checkout_id,status='active',disabled_reason=NULL,updated_at=now();
 INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
 VALUES(a.organization_id,'autopay.enabled','invoice',a.invoice_id,jsonb_build_object('checkout_id',a.id,'last4',p_last4));
 RETURN 'ok';
END $$;

-- Owner stops automatic renewal. The saved card is no longer charged. outcome: ok | forbidden | not_found
CREATE FUNCTION auth.disable_card_autopay(p_user uuid,p_org uuid,p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN 'forbidden'; END IF;
 UPDATE billing.card_autopay SET status='disabled',disabled_reason='OWNER',updated_at=now() WHERE organization_id=p_org AND status='active';
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,request_id) VALUES(p_org,p_user,'autopay.disabled','subscription',p_request);
 RETURN 'ok';
END $$;

-- Renewal charges ---------------------------------------------------------------------------
-- The paid period to renew when a charge should be attempted now: period ends within a day (or
-- is in grace), next period unpaid, nothing in flight, retry time reached, under three attempts.
CREATE FUNCTION billing.autopay_due(p_org uuid,p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT e.period_id FROM billing.card_autopay ap
 JOIN core.organizations o ON o.id=ap.organization_id AND o.status='active'
 CROSS JOIN LATERAL billing.entitlement(ap.organization_id,p_at) e
 WHERE ap.organization_id=p_org AND ap.status='active' AND billing.autopay_card(ap.organization_id) IS NOT NULL
   AND e.state IN ('active','past_due') AND e.source='paid' AND NOT e.cancel_at_period_end AND e.period_end-p_at<=interval '1 day'
   AND NOT EXISTS(SELECT 1 FROM billing.subscription_periods n WHERE n.organization_id=ap.organization_id AND n.source='paid' AND n.start_at>=e.period_end)
   AND NOT EXISTS(SELECT 1 FROM billing.autopay_charges c WHERE c.organization_id=ap.organization_id AND c.renews_period_id=e.period_id
     AND (c.status IN ('charging','processing','paid','manual_review') OR (c.status='failed' AND (c.next_attempt_at IS NULL OR c.next_attempt_at>p_at))))
   AND (SELECT count(*) FROM billing.autopay_charges c WHERE c.organization_id=ap.organization_id AND c.renews_period_id=e.period_id)<3
$$;
CREATE FUNCTION worker.autopay_candidates(p_at timestamptz,p_limit integer) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT ap.organization_id FROM billing.card_autopay ap
 WHERE ap.status='active' AND billing.autopay_due(ap.organization_id,p_at) IS NOT NULL
 ORDER BY ap.organization_id LIMIT p_limit
$$;

-- Creates (or reuses) the renewal invoice at the current price of the same plan and records a
-- charge attempt. Returns the charge to send, or {skip: reason}. A shop paying the open invoice
-- itself (slip under review, active checkout) is left alone.
CREATE FUNCTION worker.prepare_autopay(p_org uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ap billing.card_autopay%ROWTYPE; v_period uuid; s platform.payment_settings%ROWTYPE; v_price uuid; v_owner uuid; r record;
  i billing.invoices%ROWTYPE; c billing.autopay_charges%ROWTYPE; v_attempt integer;
BEGIN
 PERFORM 1 FROM core.organizations WHERE id=p_org AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('skip','suspended'); END IF;
 SELECT * INTO ap FROM billing.card_autopay WHERE organization_id=p_org AND status='active' FOR UPDATE;
 IF ap.organization_id IS NULL OR billing.autopay_card(p_org) IS NULL THEN RETURN jsonb_build_object('skip','not_enabled'); END IF;
 v_period:=billing.autopay_due(p_org,p_at);
 IF v_period IS NULL THEN RETURN jsonb_build_object('skip','not_due'); END IF;
 SELECT * INTO s FROM platform.payment_settings WHERE id;
 SELECT coalesce(max(attempt_no),0)+1 INTO v_attempt FROM billing.autopay_charges WHERE renews_period_id=v_period;
 -- Same plan and billing interval as the period being renewed, at today's published price.
 SELECT pr.id INTO v_price FROM billing.subscription_periods sp
   JOIN billing.plans p ON p.code=sp.plan_snapshot->>'plan_code' AND p.kind='paid' AND p.status='active'
   JOIN billing.plan_versions pv ON pv.plan_id=p.id AND pv.published_at<=p_at
   JOIN billing.price_versions pr ON pr.plan_version_id=pv.id AND pr.effective_from<=p_at AND pr.interval_unit=sp.price_snapshot->>'interval_unit'
   WHERE sp.id=v_period
   ORDER BY pv.version_no DESC, pr.effective_from DESC LIMIT 1;
 SELECT m.user_id INTO v_owner FROM core.organization_members m WHERE m.organization_id=p_org AND m.role='owner' AND m.status='active';
 IF v_price IS NOT NULL AND v_owner IS NOT NULL THEN
   SELECT * INTO r FROM auth.create_invoice(v_owner,p_org,v_price,md5('autopay:'||v_period)::uuid);
   IF r.outcome IN ('ok','existing') THEN SELECT * INTO i FROM billing.invoices WHERE organization_id=p_org AND id=r.invoice_id FOR UPDATE; END IF;
 END IF;
 IF i.id IS NULL THEN
   -- Plan withdrawn or the team is larger than the plan now allows: the owner must choose.
   INSERT INTO billing.autopay_charges(organization_id,renews_period_id,credential_id,attempt_no,status,reason)
   VALUES(p_org,v_period,s.credential_id,v_attempt,'failed',CASE WHEN r.outcome='seats' THEN 'SEAT_LIMIT' ELSE 'PLAN_UNAVAILABLE' END) RETURNING * INTO c;
   PERFORM worker.notify_autopay_failed(c.id);
   RETURN jsonb_build_object('skip',c.reason);
 END IF;
 IF i.status<>'open' OR EXISTS(SELECT 1 FROM billing.payment_proofs WHERE invoice_id=i.id AND status='pending')
   OR EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE invoice_id=i.id AND status IN ('creating','open','manual_review')) THEN
   RETURN jsonb_build_object('skip','owner_paying');
 END IF;
 INSERT INTO billing.autopay_charges(organization_id,renews_period_id,invoice_id,credential_id,attempt_no)
 VALUES(p_org,v_period,i.id,s.credential_id,v_attempt) RETURNING * INTO c;
 RETURN worker.autopay_charge(c.id);
END $$;

CREATE FUNCTION worker.autopay_charge(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT to_jsonb(c)||jsonb_build_object('amount_minor',i.amount_minor,'number',i.number,'customer_id',ap.customer_id,'payment_method_id',ap.payment_method_id)
 FROM billing.autopay_charges c JOIN billing.invoices i ON i.id=c.invoice_id JOIN billing.card_autopay ap ON ap.organization_id=c.organization_id
 WHERE c.id=p_id
$$;

-- Charges a crashed worker left mid-request, and charges Stripe is still processing.
CREATE FUNCTION worker.autopay_pending(p_older_seconds integer) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT worker.autopay_charge(c.id) FROM billing.autopay_charges c
 WHERE (c.status='charging' AND c.updated_at<now()-make_interval(secs=>p_older_seconds)) OR c.status='processing'
 ORDER BY c.created_at LIMIT 20
$$;

CREATE FUNCTION worker.notify_autopay_failed(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c billing.autopay_charges%ROWTYPE; sp billing.subscription_periods%ROWTYPE; v_owner uuid; v_last4 text; v_stopped boolean;
BEGIN
 SELECT * INTO c FROM billing.autopay_charges WHERE id=p_id;
 SELECT * INTO sp FROM billing.subscription_periods WHERE id=c.renews_period_id;
 SELECT last4,status='disabled' INTO v_last4,v_stopped FROM billing.card_autopay WHERE organization_id=c.organization_id;
 FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=c.organization_id AND role='owner' AND status='active' LOOP
   PERFORM core.notify(c.organization_id,v_owner,
     CASE WHEN v_stopped THEN 'autopay_stopped:'||c.id ELSE 'autopay_failed:'||c.renews_period_id END,
     CASE WHEN v_stopped THEN 'autopay_stopped' ELSE 'autopay_failed' END,
     jsonb_build_object('last4',coalesce(v_last4,'****'),'date',to_char((sp.end_at+make_interval(days=>coalesce((sp.plan_snapshot->>'grace_days')::integer,0))) AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),
     CASE WHEN c.invoice_id IS NULL THEN 'subscription' ELSE 'invoice' END,c.invoice_id);
 END LOOP;
END $$;

-- outcome of one charge: paid | processing | failed | manual_review | existing | not_found
-- p_retry=false (card expired, authentication needed, card removed...) also turns autopay off.
-- Declines are retried a day later, at most three attempts per period.
CREATE FUNCTION worker.finish_autopay(p_id uuid,p_intent text,p_amount bigint,p_currency text,p_status text,p_reason text,p_retry boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c billing.autopay_charges%ROWTYPE; i billing.invoices%ROWTYPE; r record; v_payment uuid; v_owner uuid;
BEGIN
 SELECT x.* INTO i FROM billing.invoices x JOIN billing.autopay_charges y ON y.invoice_id=x.id WHERE y.id=p_id FOR UPDATE OF x;
 SELECT * INTO c FROM billing.autopay_charges WHERE id=p_id FOR UPDATE;
 IF c.id IS NULL OR i.id IS NULL THEN RETURN 'not_found'; END IF;
 IF c.payment_intent IS NOT NULL AND p_intent IS DISTINCT FROM c.payment_intent THEN RETURN 'not_found'; END IF;
 IF c.status='paid' THEN RETURN 'existing'; END IF;
 IF c.status NOT IN ('charging','processing') THEN RETURN c.status; END IF;
 IF p_status='processing' THEN
   UPDATE billing.autopay_charges SET status='processing',payment_intent=p_intent,updated_at=now() WHERE id=c.id; RETURN 'processing';
 END IF;
 IF p_status='failed' THEN
   UPDATE billing.autopay_charges SET status='failed',payment_intent=p_intent,reason=left(coalesce(p_reason,'PAYMENT_FAILED'),60),updated_at=now(),
     next_attempt_at=CASE WHEN p_retry AND c.attempt_no<3 THEN now()+interval '1 day' END WHERE id=c.id;
   IF NOT p_retry THEN
     UPDATE billing.card_autopay SET status='disabled',disabled_reason=left(coalesce(p_reason,'PAYMENT_FAILED'),60),updated_at=now() WHERE organization_id=c.organization_id AND status='active';
   END IF;
   PERFORM worker.notify_autopay_failed(c.id);
   RETURN 'failed';
 END IF;
 IF p_status<>'paid' THEN RETURN 'not_found'; END IF;
 IF i.status<>'open' OR p_amount IS DISTINCT FROM i.amount_minor OR p_currency<>'thb' OR p_intent IS NULL OR p_intent !~ '^pi_[A-Za-z0-9]+$' THEN
   UPDATE billing.autopay_charges SET status='manual_review',reason='PAYMENT_MISMATCH',payment_intent=p_intent,updated_at=now() WHERE id=c.id; RETURN 'manual_review';
 END IF;
 INSERT INTO billing.payments(organization_id,invoice_id,amount_minor,currency,bank_reference,verified_at,verified_by,received_at,verification_source,note)
 VALUES(i.organization_id,i.id,i.amount_minor,'THB','STRIPE:'||p_intent,now(),NULL,now(),'stripe','card_autopay')
 ON CONFLICT DO NOTHING RETURNING id INTO v_payment;
 IF v_payment IS NULL THEN UPDATE billing.autopay_charges SET status='manual_review',reason='DUPLICATE',payment_intent=p_intent,updated_at=now() WHERE id=c.id; RETURN 'manual_review'; END IF;
 UPDATE billing.invoices SET status='paid',paid_at=now() WHERE id=i.id;
 SELECT * INTO r FROM billing.apply_paid_period(i.organization_id,i.id,i.price_version_id,now());
 IF r.period_id IS NULL THEN RAISE EXCEPTION 'paid period could not be applied'; END IF;
 UPDATE billing.autopay_charges SET status='paid',payment_intent=p_intent,reason=NULL,updated_at=now() WHERE id=c.id;
 INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
 VALUES(i.organization_id,'payment.autopay_confirmed','invoice',i.id,jsonb_build_object('payment_id',v_payment,'payment_intent',p_intent,'charge_id',c.id));
 FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=i.organization_id AND role='owner' AND status='active' LOOP
   PERFORM core.notify(i.organization_id,v_owner,'payment_confirmed:'||i.id,'payment_confirmed',
     jsonb_build_object('date',to_char(r.end_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),'invoice',i.id);
 END LOOP;
 RETURN 'paid';
END $$;

-- An automatic charge in flight blocks slips and keeps its invoice from being replaced.
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
    IF EXISTS (SELECT 1 FROM billing.payment_proofs pp WHERE pp.organization_id = p_organization_id AND pp.invoice_id = v_open.id AND pp.status = 'pending')
      OR EXISTS(SELECT 1 FROM billing.stripe_checkouts sc WHERE sc.invoice_id=v_open.id AND sc.status IN ('creating','open','manual_review'))
      OR EXISTS(SELECT 1 FROM billing.autopay_charges ac WHERE ac.invoice_id=v_open.id AND ac.status IN ('charging','processing','manual_review')) THEN
      -- A payment is being checked: do not swap the invoice under it.
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
  IF EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE invoice_id=p_invoice_id AND status IN ('creating','open','manual_review'))
    OR EXISTS(SELECT 1 FROM billing.autopay_charges WHERE invoice_id=p_invoice_id AND status IN ('charging','processing','manual_review')) THEN
    RETURN QUERY SELECT 'checkout_active'::text; RETURN; END IF;
  IF v_status <> 'open' THEN RETURN QUERY SELECT 'closed'::text; RETURN; END IF;
  INSERT INTO billing.payment_proofs(id,organization_id,invoice_id,private_object_key,submitted_by,checksum,size_bytes)
    VALUES(p_proof_id,p_organization_id,p_invoice_id,p_object_key,p_user_id,p_checksum,p_size);
  INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
    VALUES(p_organization_id,p_user_id,'payment_proof.submitted','invoice',p_invoice_id,gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text;
END $$;

-- Reminders: renewal now also 1 day before; shops on automatic renewal are told which card will
-- be charged instead of being asked to pay. Same event keys, so nobody gets both texts.
CREATE OR REPLACE FUNCTION worker.scan_subscriptions(p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s record; e record; o record; v_key text; v_template text; v_days integer; v_count integer := 0; v_last4 text; v_params jsonb;
BEGIN
  FOR s IN SELECT sub.organization_id FROM billing.subscriptions sub JOIN core.organizations org ON org.id = sub.organization_id WHERE org.status = 'active' LOOP
    SELECT * INTO e FROM billing.entitlement(s.organization_id, p_at);
    v_key := NULL;
    v_params := jsonb_build_object('date', to_char(coalesce(e.grace_until, e.period_end) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'));
    IF e.state = 'trialing' AND e.period_end - p_at <= interval '3 days' THEN v_key := 'trial_ending:' || e.period_id; v_template := 'trial_ending';
    ELSIF e.state = 'active' AND e.source = 'paid' AND NOT e.cancel_at_period_end AND e.period_end - p_at <= interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM billing.subscription_periods n WHERE n.organization_id = s.organization_id AND n.source = 'paid' AND n.start_at >= e.period_end) THEN
      v_days := CASE WHEN e.period_end - p_at <= interval '1 day' THEN 1 WHEN e.period_end - p_at <= interval '3 days' THEN 3 ELSE 7 END;
      v_key := 'renewal_' || v_days || ':' || e.period_id;
      v_last4 := billing.autopay_card(s.organization_id);
      IF v_last4 IS NULL THEN v_template := 'renewal_due';
      ELSE v_template := 'autopay_upcoming'; v_params := v_params || jsonb_build_object('last4', v_last4); END IF;
    ELSIF e.state = 'past_due' THEN v_key := 'payment_overdue:' || e.period_id; v_template := 'payment_overdue';
    ELSIF e.state IN ('expired','ended') AND e.period_id IS NOT NULL THEN v_key := 'subscription_' || e.state || ':' || e.period_id; v_template := 'subscription_' || e.state;
    END IF;
    IF v_key IS NOT NULL THEN
      FOR o IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = s.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
        IF core.notify(s.organization_id, o.user_id, v_key, v_template, v_params, 'subscription', NULL) IS NOT NULL THEN
          v_count := v_count + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION billing.autopay_card(uuid), billing.autopay_due(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker.prepare_stripe(uuid,uuid,uuid,text,uuid,boolean), worker.save_autopay(uuid,text,text,text,text,integer,integer),
  worker.autopay_candidates(timestamptz,integer), worker.prepare_autopay(uuid,timestamptz), worker.autopay_charge(uuid), worker.autopay_pending(integer),
  worker.notify_autopay_failed(uuid), worker.finish_autopay(uuid,text,bigint,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.prepare_stripe(uuid,uuid,uuid,text,uuid,boolean), worker.save_autopay(uuid,text,text,text,text,integer,integer),
  worker.autopay_candidates(timestamptz,integer), worker.prepare_autopay(uuid,timestamptz), worker.autopay_charge(uuid), worker.autopay_pending(integer),
  worker.finish_autopay(uuid,text,bigint,text,text,text,boolean) TO fs_worker;
REVOKE ALL ON FUNCTION auth.disable_card_autopay(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.disable_card_autopay(uuid,uuid,uuid) TO fs_api;
