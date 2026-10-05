-- Finance report: count paying shops in one set-based pass instead of evaluating
-- billing.entitlement() for every organization (slow once there are many shops).
-- Same rule as billing.entitlement(): an active shop whose chosen current period is 'paid'
-- (paid/complimentary win over trial, newest start first), or with no current period whose
-- last ended period is 'paid', not cancelled at period end and still within grace (past_due).
-- PostgreSQL 16 target. Apply as fs_migrator.

CREATE FUNCTION billing.paid_shop_count(p_at timestamptz DEFAULT now()) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH cur AS (
  SELECT DISTINCT ON (sp.organization_id) sp.organization_id,sp.source FROM billing.subscription_periods sp
  WHERE sp.start_at<=p_at AND p_at<sp.end_at ORDER BY sp.organization_id,(sp.source='trial'),sp.start_at DESC),
 last AS (
  SELECT DISTINCT ON (sp.organization_id) sp.organization_id,sp.source,sp.end_at,sp.plan_snapshot FROM billing.subscription_periods sp
  WHERE sp.end_at<=p_at ORDER BY sp.organization_id,sp.end_at DESC)
 SELECT count(*) FROM core.organizations o JOIN billing.subscriptions s ON s.organization_id=o.id
  LEFT JOIN cur c ON c.organization_id=o.id LEFT JOIN last l ON l.organization_id=o.id
 WHERE o.status='active' AND (c.source='paid' OR (c.organization_id IS NULL AND l.source='paid' AND NOT s.cancel_at_period_end
  AND p_at<l.end_at+make_interval(days=>coalesce((l.plan_snapshot->>'grace_days')::integer,0))))
$$;
REVOKE ALL ON FUNCTION billing.paid_shop_count(timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION padmin.finance_report(p_actor uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 PERFORM padmin.require(p_actor,'billing.read');
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 THEN RAISE EXCEPTION 'invalid range' USING ERRCODE='22023'; END IF;
 WITH pay AS (
  SELECT p.amount_minor,p.verification_source AS source,(p.verified_at AT TIME ZONE 'Asia/Bangkok')::date AS day,
   i.plan_snapshot->>'plan_code' AS plan_code,i.plan_snapshot->>'name_th' AS name_th,i.plan_snapshot->>'name_en' AS name_en,pr.interval_unit
  FROM billing.payments p JOIN billing.invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
  JOIN billing.price_versions pr ON pr.id=i.price_version_id
  WHERE (p.verified_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to),
 ref AS (
  SELECT r.amount_minor,(r.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS day FROM billing.refunds r
  WHERE r.status='succeeded' AND (r.completed_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN p_from AND p_to)
 SELECT jsonb_build_object(
  'from',p_from,'to',p_to,
  'received_minor',(SELECT coalesce(sum(amount_minor),0) FROM pay),'payments',(SELECT count(*) FROM pay),
  'refunded_minor',(SELECT coalesce(sum(amount_minor),0) FROM ref),'refunds',(SELECT count(*) FROM ref),
  'net_minor',(SELECT coalesce(sum(amount_minor),0) FROM pay)-(SELECT coalesce(sum(amount_minor),0) FROM ref),
  'by_source',(SELECT coalesce(jsonb_agg(x ORDER BY x.source),'[]') FROM (SELECT source,count(*) AS count,sum(amount_minor) AS amount_minor FROM pay GROUP BY source) x),
  'by_plan',(SELECT coalesce(jsonb_agg(x ORDER BY x.amount_minor DESC),'[]') FROM (SELECT plan_code,max(name_th) AS name_th,max(name_en) AS name_en,interval_unit,count(*) AS count,sum(amount_minor) AS amount_minor FROM pay GROUP BY plan_code,interval_unit) x),
  'by_day',(SELECT coalesce(jsonb_agg(x ORDER BY x.day),'[]') FROM (
    SELECT day,sum(received) AS received_minor,sum(refunded) AS refunded_minor FROM (
     SELECT day,amount_minor AS received,0 AS refunded FROM pay UNION ALL SELECT day,0,amount_minor FROM ref) d GROUP BY day) x),
  'open_invoices',(SELECT count(*) FROM billing.invoices WHERE status='open'),
  'open_minor',(SELECT coalesce(sum(amount_minor),0) FROM billing.invoices WHERE status='open'),
  'pending_refunds',(SELECT count(*) FROM billing.refunds WHERE status IN ('pending','approved')),
  'paid_shops',billing.paid_shop_count()) INTO v;
 RETURN v;
END $$;
