-- Plan changes for shops that already pay (owner decision 2026-10-08, "policy C"):
-- * Better for the shop (price not higher and no fewer seats, storage or grace days): the shop moves
--   to the new version at its first renewal starting on or after the version takes effect.
-- * Worse in any way (a mix of better and worse counts as worse): owners are told first, and the shop
--   moves at its first renewal starting 30 days or more after that notice (never before the version
--   takes effect). Until then renewals keep the shop's price and limits.
-- * Periods already paid never change (their snapshots stay). Fewer seats or less storage never
--   removes members or files; the shop only cannot add more until it is within the limit.
-- * Covers renewals of the same plan and billing interval while the shop still has time (active or in
--   grace). Lapsed or trial shops, and any other plan, buy at today's price. An archived plan keeps
--   the old behaviour (manual renewal must pick an active plan; Stripe keeps its price).
-- * Card subscriptions: the new price is pushed to Stripe before the charge that starts the moved
--   period, without proration. Replaces 029's "a subscription keeps the price it started with".

CREATE TABLE billing.plan_change_notices (
 organization_id uuid NOT NULL REFERENCES core.organizations(id),
 price_version_id uuid NOT NULL REFERENCES billing.price_versions(id),
 from_price_version_id uuid NOT NULL REFERENCES billing.price_versions(id),
 notified_at timestamptz NOT NULL DEFAULT now(),
 effective_at timestamptz NOT NULL,
 PRIMARY KEY (organization_id, price_version_id)
);
ALTER TABLE billing.plan_change_notices ENABLE ROW LEVEL SECURITY; ALTER TABLE billing.plan_change_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_change_owner_read ON billing.plan_change_notices FOR SELECT TO fs_api USING (core.owner_allowed(organization_id));
CREATE POLICY plan_change_functions ON billing.plan_change_notices TO fs_migrator USING (true) WITH CHECK (true);
GRANT SELECT ON billing.plan_change_notices TO fs_api;

-- Price Stripe charged before the latest push, so a late invoice at the old price still matches.
ALTER TABLE billing.stripe_subscriptions ADD COLUMN previous_price_version_id uuid REFERENCES billing.price_versions(id);

-- Newest version of the same active paid plan and billing interval, including one published for a
-- later date. NULL when the plan is archived.
CREATE FUNCTION billing.price_successor(p_price uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT nx.id FROM billing.price_versions cur
  JOIN billing.plan_versions cpv ON cpv.id=cur.plan_version_id
  JOIN billing.plans p ON p.id=cpv.plan_id AND p.kind='paid' AND p.status='active'
  JOIN billing.plan_versions npv ON npv.plan_id=p.id
  JOIN billing.price_versions nx ON nx.plan_version_id=npv.id AND nx.interval_unit=cur.interval_unit
 WHERE cur.id=p_price
 ORDER BY npv.version_no DESC, nx.effective_from DESC, nx.id LIMIT 1
$$;

-- When a price version can first be bought.
CREATE FUNCTION billing.price_effective_at(p_price uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT greatest(pv.published_at,pr.effective_from) FROM billing.price_versions pr JOIN billing.plan_versions pv ON pv.id=pr.plan_version_id WHERE pr.id=p_price
$$;

-- True when moving from p_from to p_to takes anything away from the shop.
CREATE FUNCTION billing.price_change_worse(p_from uuid,p_to uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT t.amount_minor>f.amount_minor OR tv.technician_seats<fv.technician_seats OR tv.storage_bytes<fv.storage_bytes OR tv.grace_days<fv.grace_days
 FROM billing.price_versions f JOIN billing.plan_versions fv ON fv.id=f.plan_version_id,
      billing.price_versions t JOIN billing.plan_versions tv ON tv.id=t.plan_version_id
 WHERE f.id=p_from AND t.id=p_to
$$;

-- When the shop moves from p_from to p_to: NULL while a worse change has not been announced yet.
CREATE FUNCTION billing.plan_change_at(p_org uuid,p_from uuid,p_to uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN NOT billing.price_change_worse(p_from,p_to) THEN billing.price_effective_at(p_to)
   ELSE (SELECT greatest(n.effective_at,billing.price_effective_at(p_to)) FROM billing.plan_change_notices n WHERE n.organization_id=p_org AND n.price_version_id=p_to) END
$$;

-- Price of a renewal period starting at p_start for a shop renewing from p_from. NULL when the plan
-- is archived.
CREATE FUNCTION billing.renewal_price(p_org uuid,p_from uuid,p_start timestamptz) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_to uuid; v_at timestamptz;
BEGIN
 v_to:=billing.price_successor(p_from);
 IF v_to IS NULL OR v_to=p_from THEN RETURN v_to; END IF;
 v_at:=billing.plan_change_at(p_org,p_from,v_to);
 RETURN CASE WHEN v_at IS NOT NULL AND p_start>=v_at THEN v_to ELSE p_from END;
END $$;

-- The price a shop renews from and when its next period starts. Card subscriptions renew from
-- the price Stripe charges; otherwise only a paid shop that is active or in grace renews.
CREATE FUNCTION billing.renewal_base(p_org uuid,OUT price_version_id uuid,OUT next_start timestamptz,OUT autopay boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE; e record;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE id=billing.live_subscription(p_org);
 IF ss.id IS NOT NULL THEN price_version_id:=ss.price_version_id; next_start:=ss.current_period_end; autopay:=true; RETURN; END IF;
 autopay:=false;
 SELECT * INTO e FROM billing.entitlement(p_org,now());
 IF e.state IS NULL OR e.state NOT IN ('active','past_due') OR e.source IS DISTINCT FROM 'paid' THEN RETURN; END IF;
 SELECT sub.price_version_id INTO price_version_id FROM billing.subscriptions sub WHERE sub.organization_id=p_org;
 SELECT max(end_at) INTO next_start FROM billing.subscription_periods WHERE organization_id=p_org AND source='paid';
END $$;

-- Announces plan changes to owners of shops that renew: a worse change gets a dated notice (and its
-- 30 days start now), a better one a short "from your next renewal" note. Each once per new version.
CREATE FUNCTION worker.scan_plan_changes(p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; b record; v_to uuid; v_at timestamptz; v_key text; v_template text; v_params jsonb; v_owner uuid; v_count integer:=0;
BEGIN
 FOR s IN SELECT sub.organization_id FROM billing.subscriptions sub JOIN core.organizations o ON o.id=sub.organization_id WHERE o.status='active' LOOP
  SELECT * INTO b FROM billing.renewal_base(s.organization_id);
  IF b.price_version_id IS NULL THEN CONTINUE; END IF;
  v_to:=billing.price_successor(b.price_version_id);
  IF v_to IS NULL OR v_to=b.price_version_id THEN CONTINUE; END IF;
  IF billing.price_change_worse(b.price_version_id,v_to) THEN
   v_at:=greatest(billing.price_effective_at(v_to),p_at+interval '30 days');
   INSERT INTO billing.plan_change_notices(organization_id,price_version_id,from_price_version_id,notified_at,effective_at)
    VALUES(s.organization_id,v_to,b.price_version_id,p_at,v_at) ON CONFLICT DO NOTHING;
   SELECT greatest(n.effective_at,billing.price_effective_at(v_to)) INTO v_at FROM billing.plan_change_notices n WHERE n.organization_id=s.organization_id AND n.price_version_id=v_to;
   v_key:='plan_change:'||v_to; v_template:='plan_change_notice';
  ELSE
   v_at:=billing.price_effective_at(v_to); v_key:='plan_change_better:'||v_to; v_template:='plan_change_better';
  END IF;
  v_params:=(SELECT jsonb_build_object('date',to_char(v_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD'),
     'plan',p.name_th,'plan_en',p.name_en,'price',CASE WHEN pr.amount_minor%100=0 THEN to_char(pr.amount_minor/100,'FM999,999,990') ELSE to_char(pr.amount_minor/100.0,'FM999,999,990.00') END,
     'seats',pv.technician_seats,'storage',round(pv.storage_bytes/1e9))
   FROM billing.price_versions pr JOIN billing.plan_versions pv ON pv.id=pr.plan_version_id JOIN billing.plans p ON p.id=pv.plan_id WHERE pr.id=v_to);
  FOR v_owner IN SELECT user_id FROM core.organization_members WHERE organization_id=s.organization_id AND role='owner' AND status='active' LOOP
   IF core.notify(s.organization_id,v_owner,v_key,v_template,v_params,'subscription',NULL) IS NOT NULL THEN v_count:=v_count+1; END IF;
  END LOOP;
 END LOOP;
 RETURN v_count;
END $$;

-- What the owner's plan page shows for the shop's own plan: the price its next renewal uses, and
-- the change still to come (with its date) when one is scheduled.
CREATE FUNCTION auth.renewal_offer(p_user uuid,p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b record; v_price uuid; v_to uuid; v_at timestamptz;
BEGIN
 IF auth.owner_member_id(p_user,p_org) IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO b FROM billing.renewal_base(p_org);
 IF b.price_version_id IS NULL THEN RETURN NULL; END IF;
 v_price:=billing.renewal_price(p_org,b.price_version_id,coalesce(b.next_start,now()));
 IF v_price IS NULL THEN RETURN NULL; END IF;
 v_to:=billing.price_successor(v_price);
 IF v_to IS NOT NULL AND v_to<>v_price THEN v_at:=billing.plan_change_at(p_org,v_price,v_to); END IF;
 RETURN (SELECT jsonb_build_object('code',p.code,'name_th',p.name_th,'name_en',p.name_en,'technician_seats',pv.technician_seats,'storage_bytes',pv.storage_bytes,
   'ocr_per_period',pv.ocr_per_period,'grace_days',pv.grace_days,'price_version_id',pr.id,'amount_minor',pr.amount_minor,'currency',trim(pr.currency),'interval_unit',pr.interval_unit,
   'renewal',true,'next_start',b.next_start,
   'change',CASE WHEN v_at IS NOT NULL THEN (SELECT jsonb_build_object('effective_at',v_at,'amount_minor',npr.amount_minor,'technician_seats',npv.technician_seats,'storage_bytes',npv.storage_bytes)
     FROM billing.price_versions npr JOIN billing.plan_versions npv ON npv.id=npr.plan_version_id WHERE npr.id=v_to) END)
  FROM billing.price_versions pr JOIN billing.plan_versions pv ON pv.id=pr.plan_version_id JOIN billing.plans p ON p.id=pv.plan_id WHERE pr.id=v_price);
END $$;

-- Live card subscriptions whose next charge must use another price.
CREATE FUNCTION worker.subscription_prices_to_push() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('subscription_id',x.subscription_id,'credential_id',x.credential_id,'price_version_id',x.target,
   'amount_minor',pr.amount_minor,'interval_unit',pr.interval_unit)
 FROM (SELECT ss.*,billing.renewal_price(ss.organization_id,ss.price_version_id,ss.current_period_end) AS target
   FROM billing.stripe_subscriptions ss
   WHERE ss.id=billing.live_subscription(ss.organization_id) AND ss.current_period_end>now()) x
 JOIN billing.price_versions pr ON pr.id=x.target
 WHERE x.target<>x.price_version_id
 LIMIT 50
$$;

-- Stripe now charges p_price from the next period.
CREATE FUNCTION worker.subscription_price_pushed(p_sub text,p_price uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE subscription_id=p_sub FOR UPDATE;
 IF ss.id IS NULL THEN RETURN 'not_found'; END IF;
 IF ss.price_version_id=p_price THEN RETURN 'existing'; END IF;
 UPDATE billing.stripe_subscriptions SET previous_price_version_id=price_version_id,price_version_id=p_price,updated_at=now() WHERE id=ss.id;
 INSERT INTO platform.audit_logs(organization_id,action,target_type,target_id,details)
 VALUES(ss.organization_id,'subscription.stripe_price_changed','subscription',NULL,
   jsonb_build_object('subscription_id',p_sub,'from_price_version_id',ss.price_version_id,'to_price_version_id',p_price));
 RETURN 'ok';
END $$;

-- Same as 029, except the renewal invoice uses the price Stripe charged: the current one, or the
-- previous one for an invoice that was created before the price changed.
CREATE OR REPLACE FUNCTION worker.apply_subscription_invoice(p_row uuid,p_in text,p_amount bigint,p_currency text,p_period_end timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss billing.stripe_subscriptions%ROWTYPE; a billing.stripe_checkouts%ROWTYPE; i billing.invoices%ROWTYPE; snap record;
  v_payment uuid; v_owner uuid; r record; v_reason text; v_price uuid;
BEGIN
 SELECT * INTO ss FROM billing.stripe_subscriptions WHERE id=p_row;
 IF ss.id IS NULL THEN RAISE EXCEPTION 'subscription not found'; END IF;
 PERFORM 1 FROM core.organizations WHERE id=ss.organization_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_in,29));
 IF EXISTS(SELECT 1 FROM billing.stripe_subscription_invoices WHERE stripe_invoice_id=p_in) THEN RETURN 'existing'; END IF;
 v_price:=ss.price_version_id;
 IF ss.previous_price_version_id IS NOT NULL
   AND p_amount IS DISTINCT FROM (SELECT amount_minor FROM billing.price_versions WHERE id=ss.price_version_id)
   AND p_amount=(SELECT amount_minor FROM billing.price_versions WHERE id=ss.previous_price_version_id) THEN
   v_price:=ss.previous_price_version_id;
 END IF;
 SELECT * INTO a FROM billing.stripe_checkouts WHERE id=ss.checkout_id;
 SELECT * INTO snap FROM billing.snapshot(v_price);
 SELECT * INTO i FROM billing.invoices WHERE organization_id=ss.organization_id AND id=a.invoice_id AND status='open' FOR UPDATE;
 IF i.id IS NULL THEN
   SELECT * INTO i FROM billing.invoices WHERE organization_id=ss.organization_id AND status='open' FOR UPDATE;
   IF i.id IS NOT NULL AND (i.price_version_id<>v_price OR EXISTS(SELECT 1 FROM billing.payment_proofs WHERE invoice_id=i.id AND status='pending')
       OR EXISTS(SELECT 1 FROM billing.stripe_checkouts WHERE invoice_id=i.id AND status IN ('creating','open','manual_review'))) THEN
     v_reason:='OPEN_INVOICE_CONFLICT';
   ELSIF i.id IS NULL THEN
     INSERT INTO billing.invoices(organization_id,number,amount_minor,currency,price_version_id,status,buyer_snapshot,request_key,plan_snapshot,price_snapshot,due_at)
     SELECT ss.organization_id,'INV-'||to_char(now() AT TIME ZONE 'Asia/Bangkok','YYMM')||'-'||lpad(nextval('billing.invoice_number_seq')::text,6,'0'),
       (snap.price_snapshot->>'amount_minor')::bigint,'THB',v_price,'open',jsonb_build_object('organization_name',o.name),
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

-- Same as 029, plus: renewing the shop's own plan may use the shop's renewal price (kept until a
-- change reaches it). Such a renewal skips the seat check: fewer seats in a new version never
-- blocks renewing; the shop just cannot approve more technicians while over the limit.
CREATE OR REPLACE FUNCTION auth.create_invoice(p_user_id uuid, p_organization_id uuid, p_price_version_id uuid, p_request_key uuid)
RETURNS TABLE (outcome text, invoice_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_now timestamptz := now(); s record; v_current uuid; v_open billing.invoices%ROWTYPE; v_id uuid; v_active integer; v_org text; b record; v_renewal boolean := false;
BEGIN
  IF auth.owner_member_id(p_user_id, p_organization_id) IS NULL THEN RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN; END IF;
  SELECT o.status INTO v_org FROM core.organizations o WHERE o.id = p_organization_id FOR UPDATE;
  IF v_org <> 'active' THEN RETURN QUERY SELECT 'suspended'::text, NULL::uuid; RETURN; END IF;
  SELECT i.id INTO v_id FROM billing.invoices i WHERE i.organization_id = p_organization_id AND i.request_key = p_request_key;
  IF v_id IS NOT NULL THEN RETURN QUERY SELECT 'existing'::text, v_id; RETURN; END IF;
  IF billing.live_subscription(p_organization_id) IS NOT NULL THEN RETURN QUERY SELECT 'subscribed'::text, NULL::uuid; RETURN; END IF;
  SELECT * INTO b FROM billing.renewal_base(p_organization_id);
  IF b.price_version_id IS NOT NULL AND p_price_version_id = billing.renewal_price(p_organization_id, b.price_version_id, greatest(coalesce(b.next_start, v_now), v_now)) THEN
    v_current := p_price_version_id; v_renewal := true;
  ELSE
    -- Otherwise only the current published price of an active paid plan can be bought.
    SELECT pr.id INTO v_current FROM billing.price_versions pr
      JOIN billing.plan_versions pv ON pv.id = pr.plan_version_id AND pv.published_at <= v_now
      JOIN billing.plans p ON p.id = pv.plan_id AND p.kind = 'paid' AND p.status = 'active'
    WHERE pr.id = p_price_version_id AND pr.effective_from <= v_now
      AND NOT EXISTS (SELECT 1 FROM billing.plan_versions newer WHERE newer.plan_id = pv.plan_id AND newer.published_at <= v_now AND newer.version_no > pv.version_no)
      AND NOT EXISTS (SELECT 1 FROM billing.price_versions later WHERE later.plan_version_id = pr.plan_version_id AND later.effective_from <= v_now AND later.effective_from > pr.effective_from);
  END IF;
  IF v_current IS NULL THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  SELECT * INTO s FROM billing.snapshot(v_current);
  SELECT count(*)::integer INTO v_active FROM core.organization_members m WHERE m.organization_id = p_organization_id AND m.role = 'technician' AND m.status = 'active';
  IF NOT v_renewal AND v_active > (s.plan_snapshot->>'technician_seats')::integer THEN RETURN QUERY SELECT 'seats'::text, NULL::uuid; RETURN; END IF;

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

REVOKE ALL ON FUNCTION billing.price_successor(uuid), billing.price_effective_at(uuid), billing.price_change_worse(uuid,uuid),
  billing.plan_change_at(uuid,uuid,uuid), billing.renewal_price(uuid,uuid,timestamptz), billing.renewal_base(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker.scan_plan_changes(timestamptz), worker.subscription_prices_to_push(), worker.subscription_price_pushed(text,uuid),
  auth.renewal_offer(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.scan_plan_changes(timestamptz), worker.subscription_prices_to_push(), worker.subscription_price_pushed(text,uuid) TO fs_worker;
GRANT EXECUTE ON FUNCTION auth.renewal_offer(uuid,uuid) TO fs_api;
