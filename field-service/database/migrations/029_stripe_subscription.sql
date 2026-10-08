-- Automatic card renewal with Stripe Subscription. The owner subscribes from an invoice by card on
-- Stripe Checkout (mode=subscription). Stripe keeps the card and charges each period; we store no
-- card details, only Stripe IDs and status. Every paid Stripe invoice becomes our invoice + payment +
-- period ending at Stripe's period end, so both schedules stay equal. PromptPay/transfers stay one-time.
-- Decisions (2026-10-08): a shop with time left is first charged when that time ends; while a
-- subscription is live the owner cannot pay by slip/QR/one-time card or change plan (cancel first);
-- a subscription keeps the price it started with; owners manage their card in Stripe's portal.

ALTER TABLE billing.stripe_checkouts ADD COLUMN mode text NOT NULL DEFAULT 'payment' CHECK (mode IN ('payment','subscription'));
ALTER TABLE billing.stripe_checkouts ADD CONSTRAINT subscription_only_card CHECK (mode = 'payment' OR method = 'card');
ALTER TABLE billing.stripe_checkouts DROP CONSTRAINT stripe_checkouts_status_check;
ALTER TABLE billing.stripe_checkouts ADD CONSTRAINT stripe_checkouts_status_check
 CHECK (status IN ('creating','open','paid','subscribed','expired','failed','manual_review'));

CREATE TABLE billing.stripe_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES core.organizations(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 checkout_id uuid NOT NULL UNIQUE REFERENCES billing.stripe_checkouts(id),
 credential_id uuid NOT NULL REFERENCES platform.stripe_credentials(id),
 price_version_id uuid NOT NULL REFERENCES billing.price_versions(id),
 subscription_id text NOT NULL UNIQUE CHECK (subscription_id ~ '^sub_[A-Za-z0-9]+$'),
 customer_id text NOT NULL CHECK (customer_id ~ '^cus_[A-Za-z0-9]+$'),
 status text NOT NULL, cancel_at_period_end boolean NOT NULL DEFAULT false, current_period_end timestamptz,
 canceled_by_owner boolean NOT NULL DEFAULT false
);
-- Live = Stripe may still charge it. 'unpaid' counts: the owner cancels before paying another way.
CREATE UNIQUE INDEX one_live_stripe_subscription ON billing.stripe_subscriptions(organization_id)
 WHERE status IN ('trialing','active','past_due','unpaid','incomplete','paused');
CREATE TABLE billing.stripe_subscription_invoices (
 stripe_invoice_id text PRIMARY KEY CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
 organization_id uuid NOT NULL REFERENCES core.organizations(id), created_at timestamptz NOT NULL DEFAULT now(),
 subscription_row uuid NOT NULL REFERENCES billing.stripe_subscriptions(id), invoice_id uuid,
 amount_minor bigint NOT NULL, status text NOT NULL CHECK (status IN ('paid','failed','manual_review')), reason text,
 FOREIGN KEY (organization_id,invoice_id) REFERENCES billing.invoices(organization_id,id)
);
ALTER TABLE billing.stripe_subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE billing.stripe_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE billing.stripe_subscription_invoices ENABLE ROW LEVEL SECURITY; ALTER TABLE billing.stripe_subscription_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_owner_read ON billing.stripe_subscriptions FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY subscription_functions ON billing.stripe_subscriptions TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY subscription_invoice_owner_read ON billing.stripe_subscription_invoices FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY subscription_invoice_functions ON billing.stripe_subscription_invoices TO fs_migrator USING (true) WITH CHECK (true);
GRANT SELECT ON billing.stripe_subscriptions, billing.stripe_subscription_invoices TO fs_api;

CREATE FUNCTION billing.live_subscription(p_org uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT id FROM billing.stripe_subscriptions WHERE organization_id=p_org AND status IN ('trialing','active','past_due','unpaid','incomplete','paused')
$$;

-- Checkout ----------------------------------------------------------------------------------
DROP FUNCTION worker.prepare_stripe(uuid,uuid,uuid,text,uuid);
CREATE FUNCTION worker.prepare_stripe(p_user uuid,p_org uuid,p_invoice uuid,p_method text,p_key uuid,p_subscribe boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i billing.invoices%ROWTYPE; a billing.stripe_checkouts%ROWTYPE; s platform.payment_settings%ROWTYPE; e record;
  v_mode text := CASE WHEN p_subscribe THEN 'subscription' ELSE 'payment' END; v_customer text; v_until timestamptz;
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN jsonb_build_object('error','TENANT_ACCESS_DENIED'); END IF;
 IF p_subscribe AND p_method<>'card' THEN RETURN jsonb_build_object('error','VALIDATION_ERROR'); END IF;
 SELECT * INTO i FROM billing.invoices WHERE organization_id=p_org AND id=p_invoice FOR UPDATE;
 IF i.id IS NULL THEN RETURN jsonb_build_object('error','RESOURCE_NOT_FOUND'); END IF;
 SELECT * INTO a FROM billing.stripe_checkouts WHERE organization_id=p_org AND request_key=p_key;
 IF a.id IS NOT NULL AND (a.invoice_id<>p_invoice OR a.method<>p_method OR a.mode<>v_mode) THEN RETURN jsonb_build_object('error','VERSION_CONFLICT'); END IF;
 IF i.status<>'open' THEN RETURN jsonb_build_object('error','INVOICE_CLOSED'); END IF;
 IF a.id IS NULL THEN SELECT * INTO a FROM billing.stripe_checkouts WHERE invoice_id=i.id AND status IN ('creating','open'); END IF;
 IF a.id IS NOT NULL THEN
   IF a.method<>p_method OR a.mode<>v_mode THEN RETURN jsonb_build_object('error','PAYMENT_IN_PROGRESS'); END IF;
   IF a.status NOT IN ('creating','open') THEN RETURN jsonb_build_object('error','INVALID_STATE_TRANSITION'); END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM billing.payment_proofs WHERE invoice_id=i.id AND status='pending') OR billing.live_subscription(p_org) IS NOT NULL THEN
     RETURN jsonb_build_object('error','PAYMENT_IN_PROGRESS'); END IF;
   SELECT * INTO s FROM platform.payment_settings WHERE id;
   IF s.credential_id IS NULL OR NOT (CASE p_method WHEN 'card' THEN s.card_enabled WHEN 'promptpay' THEN s.qr_enabled ELSE false END) THEN
     RETURN jsonb_build_object('error','TEMPORARILY_UNAVAILABLE'); END IF;
   INSERT INTO billing.stripe_checkouts(organization_id,invoice_id,credential_id,method,request_key,expires_at,mode)
   VALUES(p_org,i.id,s.credential_id,p_method,p_key,now()+interval '35 minutes',v_mode) RETURNING * INTO a;
 END IF;
 IF a.mode='subscription' THEN
   -- Time the shop already has (trial or paid, including periods paid ahead) is used first; Stripe
   -- needs a delayed first charge at least 48 hours ahead, otherwise it charges now.
   SELECT * INTO e FROM billing.entitlement(p_org,now());
   IF e.state='trialing' OR (e.state='active' AND e.source='paid') THEN
     v_until := greatest(e.period_end,(SELECT max(end_at) FROM billing.subscription_periods WHERE organization_id=p_org AND source='paid'));
   END IF;
   IF v_until<=now()+interval '49 hours' THEN v_until := NULL; END IF;
   SELECT ss.customer_id INTO v_customer FROM billing.stripe_subscriptions ss
     JOIN platform.stripe_credentials saved ON saved.id=ss.credential_id JOIN platform.stripe_credentials cur ON cur.id=a.credential_id
     WHERE ss.organization_id=p_org AND saved.account_id=cur.account_id AND saved.mode=cur.mode ORDER BY ss.created_at DESC LIMIT 1;
 END IF;
 RETURN to_jsonb(a)||jsonb_build_object('amount_minor',i.amount_minor,'number',i.number,'currency',trim(i.currency),
   'interval_unit',i.price_snapshot->>'interval_unit','plan_name',i.plan_snapshot->>'name_en','first_charge_at',v_until,'customer_id',v_customer);
END $$;

-- The checkout completed and Stripe created the subscription. Also called from an invoice webhook
-- that arrives before the checkout event. Returns the subscription row id.
CREATE FUNCTION worker.attach_subscription(p_checkout uuid,p_sub text,p_customer text,p_status text,p_cancel boolean,p_period_end timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a billing.stripe_checkouts%ROWTYPE; i billing.invoices%ROWTYPE; v_id uuid;
BEGIN
 SELECT * INTO a FROM billing.stripe_checkouts WHERE id=p_checkout FOR UPDATE;
 IF a.id IS NULL OR a.mode<>'subscription' THEN RAISE EXCEPTION 'not a subscription checkout'; END IF;
 SELECT id INTO v_id FROM billing.stripe_subscriptions WHERE checkout_id=a.id;
 IF v_id IS NOT NULL THEN
   IF (SELECT subscription_id FROM billing.stripe_subscriptions WHERE id=v_id)<>p_sub THEN RAISE EXCEPTION 'checkout already has another subscription'; END IF;
   RETURN v_id;
 END IF;
 SELECT * INTO i FROM billing.invoices WHERE id=a.invoice_id;
 INSERT INTO billing.stripe_subscriptions(organization_id,checkout_id,credential_id,price_version_id,subscription_id,customer_id,status,cancel_at_period_end,current_period_end)
 VALUES(a.organization_id,a.id,a.credential_id,i.price_version_id,p_sub,p_customer,p_status,coalesce(p_cancel,false),p_period_end) RETURNING id INTO v_id;
 UPDATE billing.stripe_checkouts SET status='subscribed',verified_at=now(),reason=NULL WHERE id=a.id AND status IN ('creating','open');
 INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
 VALUES(a.organization_id,'subscription.stripe_started','invoice',a.invoice_id,jsonb_build_object('checkout_id',a.id,'subscription_id',p_sub));
 RETURN v_id;
END $$;

-- Status from Stripe (subscription updated/deleted, or retrieved). A cancellation the owner did not
-- ask for (retries exhausted, cancelled in Stripe) tells the owner to pay another way.
CREATE FUNCTION worker.sync_subscription(p_sub text,p_status text,p_cancel boolean,p_period_end timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE; v_owner uuid; v_was_live boolean;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE subscription_id=p_sub FOR UPDATE;
 IF ss.id IS NULL THEN RETURN 'not_found'; END IF;
 v_was_live := ss.status IN ('trialing','active','past_due','unpaid','incomplete','paused');
 UPDATE billing.stripe_subscriptions SET status=p_status,cancel_at_period_end=coalesce(p_cancel,cancel_at_period_end),
   current_period_end=coalesce(p_period_end,current_period_end),updated_at=now() WHERE id=ss.id;
 IF v_was_live AND p_status IN ('canceled','incomplete_expired') AND NOT ss.canceled_by_owner THEN
   FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=ss.organization_id AND role='owner' AND status='active' LOOP
     PERFORM core.notify(ss.organization_id,v_owner,'autopay_stopped:'||ss.id,'autopay_stopped','{}'::jsonb,'subscription',NULL);
   END LOOP;
 END IF;
 RETURN 'ok';
END $$;

-- Owner turns automatic renewal off: marked before asking Stripe to cancel, so the cancellation
-- webhook does not send the owner an "automatic renewal stopped" notice for their own action.
CREATE FUNCTION worker.owner_subscription(p_user uuid,p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',ss.id,'subscription_id',ss.subscription_id,'customer_id',ss.customer_id,'credential_id',ss.credential_id,
   'live',ss.id=billing.live_subscription(p_org))
 FROM billing.stripe_subscriptions ss WHERE ss.organization_id=p_org AND auth.owner_member_id(p_user,p_org) IS NOT NULL
 ORDER BY (ss.id=billing.live_subscription(p_org)) DESC NULLS LAST, ss.created_at DESC LIMIT 1
$$;
CREATE FUNCTION worker.owner_canceled_subscription(p_user uuid,p_org uuid,p_sub text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN 'forbidden'; END IF;
 UPDATE billing.stripe_subscriptions SET canceled_by_owner=true,updated_at=now() WHERE organization_id=p_org AND subscription_id=p_sub;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,request_id) VALUES(p_org,p_user,'subscription.stripe_canceled','subscription',gen_random_uuid());
 RETURN 'ok';
END $$;

-- Paid periods for subscription invoices end where Stripe's period ends, so the next Stripe charge
-- falls on our renewal date. Renewal before the end or within grace continues without a gap.
CREATE FUNCTION billing.apply_subscription_period(p_org uuid,p_invoice uuid,p_price uuid,p_confirmed timestamptz,p_end timestamptz)
RETURNS TABLE (outcome text, period_id uuid, start_at timestamptz, end_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE sub billing.subscriptions%ROWTYPE; s record; last billing.subscription_periods%ROWTYPE; v_start timestamptz; v_end timestamptz; v_period uuid;
BEGIN
 SELECT * INTO sub FROM billing.subscriptions WHERE organization_id=p_org FOR UPDATE;
 SELECT * INTO s FROM billing.snapshot(p_price);
 SELECT * INTO last FROM billing.subscription_periods sp WHERE sp.organization_id=p_org AND sp.source='paid' ORDER BY sp.end_at DESC LIMIT 1;
 IF last.id IS NOT NULL AND p_confirmed<last.end_at+make_interval(days=>coalesce((last.plan_snapshot->>'grace_days')::integer,0)) THEN v_start:=last.end_at;
 ELSE v_start:=p_confirmed; END IF;
 v_end:=CASE WHEN p_end>v_start THEN p_end ELSE billing.period_end_after(v_start,v_start,s.interval_unit) END;
 IF sub.id IS NULL THEN
   INSERT INTO billing.subscriptions(organization_id,plan_version_id,price_version_id,status) VALUES(p_org,s.plan_version_id,p_price,'active') RETURNING * INTO sub;
 END IF;
 INSERT INTO billing.subscription_periods(organization_id,subscription_id,invoice_id,start_at,end_at,source,plan_version_id,plan_snapshot,price_snapshot)
 VALUES(p_org,sub.id,p_invoice,v_start,v_end,'paid',s.plan_version_id,s.plan_snapshot,s.price_snapshot) RETURNING id INTO v_period;
 UPDATE billing.subscriptions SET plan_version_id=s.plan_version_id,price_version_id=p_price,billing_anchor_at=coalesce(billing_anchor_at,v_start),
   status=CASE WHEN v_start<=now() THEN 'active' ELSE status END,current_period_id=CASE WHEN v_start<=now() THEN v_period ELSE current_period_id END,
   cancel_at_period_end=false
 WHERE id=sub.id;
 RETURN QUERY SELECT 'created'::text,v_period,v_start,v_end;
END $$;

-- A Stripe invoice of the subscription was paid. Pays the subscribed invoice while it is open,
-- otherwise creates a renewal invoice at the subscribed price. Retries return 'existing'.
-- outcome: paid | existing | manual_review
CREATE FUNCTION worker.apply_subscription_invoice(p_row uuid,p_in text,p_amount bigint,p_currency text,p_period_end timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE; a billing.stripe_checkouts%ROWTYPE; i billing.invoices%ROWTYPE; snap record;
  v_payment uuid; v_owner uuid; r record; v_reason text;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE id=p_row;
 IF ss.id IS NULL THEN RAISE EXCEPTION 'subscription not found'; END IF;
 PERFORM 1 FROM core.organizations WHERE id=ss.organization_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_in,29));
 IF EXISTS(SELECT 1 FROM billing.stripe_subscription_invoices WHERE stripe_invoice_id=p_in) THEN RETURN 'existing'; END IF;
 SELECT * INTO a FROM billing.stripe_checkouts WHERE id=ss.checkout_id;
 SELECT * INTO snap FROM billing.snapshot(ss.price_version_id);
 SELECT * INTO i FROM billing.invoices WHERE organization_id=ss.organization_id AND id=a.invoice_id AND status='open' FOR UPDATE;
 IF i.id IS NULL THEN
   SELECT * INTO i FROM billing.invoices WHERE organization_id=ss.organization_id AND status='open' FOR UPDATE;
   IF i.id IS NOT NULL AND (i.price_version_id<>ss.price_version_id OR EXISTS(SELECT 1 FROM billing.payment_proofs WHERE invoice_id=i.id AND status='pending')
       OR EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE invoice_id=i.id AND status IN ('creating','open','manual_review'))) THEN
     v_reason:='OPEN_INVOICE_CONFLICT';
   ELSIF i.id IS NULL THEN
     INSERT INTO billing.invoices(organization_id,number,amount_minor,currency,price_version_id,status,buyer_snapshot,request_key,plan_snapshot,price_snapshot,due_at)
     SELECT ss.organization_id,'INV-'||to_char(now() AT TIME ZONE 'Asia/Bangkok','YYMM')||'-'||lpad(nextval('billing.invoice_number_seq')::text,6,'0'),
       (snap.price_snapshot->>'amount_minor')::bigint,'THB',ss.price_version_id,'open',jsonb_build_object('organization_name',o.name),
       md5('subscription:'||p_in)::uuid,snap.plan_snapshot,snap.price_snapshot,now()
     FROM core.organizations o WHERE o.id=ss.organization_id RETURNING * INTO i;
   END IF;
 END IF;
 IF v_reason IS NULL AND (p_amount IS DISTINCT FROM i.amount_minor OR p_currency<>'thb') THEN v_reason:='PAYMENT_MISMATCH'; END IF;
 IF v_reason IS NULL THEN
   INSERT INTO billing.payments(organization_id,invoice_id,amount_minor,currency,bank_reference,verified_at,verified_by,received_at,verification_source,note)
   VALUES(i.organization_id,i.id,i.amount_minor,'THB','STRIPE:'||p_in,now(),NULL,now(),'stripe','stripe_subscription')
   ON CONFLICT DO NOTHING RETURNING id INTO v_payment;
   IF v_payment IS NULL THEN v_reason:='DUPLICATE'; END IF;
 END IF;
 IF v_reason IS NOT NULL THEN
   -- Money arrived but cannot be applied automatically: the team reconciles it in Stripe.
   INSERT INTO billing.stripe_subscription_invoices(stripe_invoice_id,organization_id,subscription_row,invoice_id,amount_minor,status,reason)
   VALUES(p_in,ss.organization_id,ss.id,i.id,p_amount,'manual_review',v_reason);
   INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
   VALUES(ss.organization_id,'payment.stripe_subscription_review','invoice',i.id,jsonb_build_object('stripe_invoice',p_in,'reason',v_reason,'amount_minor',p_amount));
   RETURN 'manual_review';
 END IF;
 UPDATE billing.invoices SET status='paid',paid_at=now() WHERE id=i.id;
 SELECT * INTO r FROM billing.apply_subscription_period(i.organization_id,i.id,i.price_version_id,now(),p_period_end);
 INSERT INTO billing.stripe_subscription_invoices(stripe_invoice_id,organization_id,subscription_row,invoice_id,amount_minor,status)
 VALUES(p_in,ss.organization_id,ss.id,i.id,p_amount,'paid');
 INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
 VALUES(i.organization_id,'payment.stripe_subscription_confirmed','invoice',i.id,jsonb_build_object('payment_id',v_payment,'stripe_invoice',p_in,'subscription_id',ss.subscription_id));
 FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=i.organization_id AND role='owner' AND status='active' LOOP
   PERFORM core.notify(i.organization_id,v_owner,'payment_confirmed:'||i.id,'payment_confirmed',
     jsonb_build_object('date',to_char(r.end_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),'invoice',i.id);
 END LOOP;
 RETURN 'paid';
END $$;

-- Stripe could not charge the card; it retries on its own schedule. One notice per Stripe invoice.
CREATE FUNCTION worker.subscription_payment_failed(p_row uuid,p_in text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE; e record; v_owner uuid;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE id=p_row;
 SELECT * INTO e FROM billing.entitlement(ss.organization_id,now());
 FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=ss.organization_id AND role='owner' AND status='active' LOOP
   PERFORM core.notify(ss.organization_id,v_owner,'autopay_failed:'||p_in,'autopay_failed',
     jsonb_build_object('date',to_char(coalesce(e.grace_until,e.period_end,now()) AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')),'subscription',NULL);
 END LOOP;
END $$;

-- Live subscriptions whose "stop renewal" flag differs from ours (owner or platform changed it).
CREATE FUNCTION worker.subscription_flags_to_push(p_org uuid DEFAULT NULL) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('subscription_id',ss.subscription_id,'credential_id',ss.credential_id,'cancel_at_period_end',sub.cancel_at_period_end)
 FROM billing.stripe_subscriptions ss JOIN billing.subscriptions sub ON sub.organization_id=ss.organization_id
 WHERE ss.id=billing.live_subscription(ss.organization_id) AND ss.cancel_at_period_end<>sub.cancel_at_period_end
   AND (p_org IS NULL OR ss.organization_id=p_org)
 LIMIT 50
$$;

-- While a subscription is live the owner cannot replace the invoice/plan or pay another way.
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
  IF billing.live_subscription(p_organization_id) IS NOT NULL THEN RETURN QUERY SELECT 'subscribed'::text, NULL::uuid; RETURN; END IF;
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
  IF EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE invoice_id=p_invoice_id AND status IN ('creating','open','manual_review'))
    OR billing.live_subscription(p_organization_id) IS NOT NULL THEN RETURN QUERY SELECT 'checkout_active'::text; RETURN; END IF;
  IF v_status <> 'open' THEN RETURN QUERY SELECT 'closed'::text; RETURN; END IF;
  INSERT INTO billing.payment_proofs(id,organization_id,invoice_id,private_object_key,submitted_by,checksum,size_bytes)
    VALUES(p_proof_id,p_organization_id,p_invoice_id,p_object_key,p_user_id,p_checksum,p_size);
  INSERT INTO ops.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,request_id)
    VALUES(p_organization_id,p_user_id,'payment_proof.submitted','invoice',p_invoice_id,gen_random_uuid());
  RETURN QUERY SELECT 'ok'::text;
END $$;

-- Reminders: renewal now also 1 day before and skipped when the next period is already paid.
-- Shops on a live, not-stopping subscription are told the card will be charged instead.
CREATE OR REPLACE FUNCTION worker.scan_subscriptions(p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE s record; e record; o record; v_key text; v_template text; v_days integer; v_count integer := 0; v_params jsonb;
BEGIN
  FOR s IN SELECT sub.organization_id FROM billing.subscriptions sub JOIN core.organizations org ON org.id = sub.organization_id WHERE org.status = 'active' LOOP
    SELECT * INTO e FROM billing.entitlement(s.organization_id, p_at);
    v_key := NULL;
    v_params := jsonb_build_object('date', to_char(coalesce(e.grace_until, e.period_end) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'));
    IF e.state = 'trialing' AND e.period_end - p_at <= interval '3 days' THEN v_key := 'trial_ending:' || e.period_id;
      v_template := CASE WHEN EXISTS(SELECT 1 FROM billing.stripe_subscriptions ss WHERE ss.id=billing.live_subscription(s.organization_id) AND NOT ss.cancel_at_period_end)
        THEN 'autopay_upcoming' ELSE 'trial_ending' END;
    ELSIF e.state = 'active' AND e.source = 'paid' AND NOT e.cancel_at_period_end AND e.period_end - p_at <= interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM billing.subscription_periods n WHERE n.organization_id = s.organization_id AND n.source = 'paid' AND n.start_at >= e.period_end) THEN
      v_days := CASE WHEN e.period_end - p_at <= interval '1 day' THEN 1 WHEN e.period_end - p_at <= interval '3 days' THEN 3 ELSE 7 END;
      v_key := 'renewal_' || v_days || ':' || e.period_id;
      v_template := CASE WHEN EXISTS(SELECT 1 FROM billing.stripe_subscriptions ss WHERE ss.id=billing.live_subscription(s.organization_id) AND NOT ss.cancel_at_period_end)
        THEN 'autopay_upcoming' ELSE 'renewal_due' END;
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

REVOKE ALL ON FUNCTION billing.live_subscription(uuid), billing.apply_subscription_period(uuid,uuid,uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker.prepare_stripe(uuid,uuid,uuid,text,uuid,boolean), worker.attach_subscription(uuid,text,text,text,boolean,timestamptz),
  worker.sync_subscription(text,text,boolean,timestamptz), worker.owner_subscription(uuid,uuid), worker.owner_canceled_subscription(uuid,uuid,text),
  worker.apply_subscription_invoice(uuid,text,bigint,text,timestamptz), worker.subscription_payment_failed(uuid,text), worker.subscription_flags_to_push(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.prepare_stripe(uuid,uuid,uuid,text,uuid,boolean), worker.attach_subscription(uuid,text,text,text,boolean,timestamptz),
  worker.sync_subscription(text,text,boolean,timestamptz), worker.owner_subscription(uuid,uuid), worker.owner_canceled_subscription(uuid,uuid,text),
  worker.apply_subscription_invoice(uuid,text,bigint,text,timestamptz), worker.subscription_payment_failed(uuid,text), worker.subscription_flags_to_push(uuid) TO fs_worker;
