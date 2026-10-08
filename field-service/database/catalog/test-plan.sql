-- Test plan for real-payment checks (2026-10-08): 20 THB a month, 1 technician seat, 1 GB photos.
-- Use it to try PromptPay QR, bank transfer and card (one-time and subscription) with live money,
-- then refund in the console and archive the plan there ("Stop selling").
-- Apply as a role that may write billing.*:
--   sudo -u postgres psql -p <port> -d <db> -v ON_ERROR_STOP=1 -f database/catalog/test-plan.sql
-- Does nothing when the code already exists.
BEGIN;
WITH new_plan AS (
  INSERT INTO billing.plans(code, name_th, name_en, kind)
  SELECT 'test20', 'ทดสอบ 20 บาท', 'Test 20 THB', 'paid'
  WHERE NOT EXISTS (SELECT 1 FROM billing.plans WHERE code = 'test20')
  RETURNING id, code
), version AS (
  INSERT INTO billing.plan_versions(plan_id, version_no, technician_seats, storage_bytes, ocr_per_period, trial_days, grace_days, published_at)
  SELECT id, 1, 1, 1000000000, 0, 0, 7, now() FROM new_plan
  RETURNING id, plan_id
), price AS (
  INSERT INTO billing.price_versions(plan_version_id, amount_minor, interval_unit, effective_from)
  SELECT id, 2000, 'month', now() FROM version
  RETURNING plan_version_id
)
INSERT INTO platform.audit_logs(action, target_type, target_id, reason, details)
SELECT 'plan.published', 'plan', n.id, 'Test plan for real-payment checks (database/catalog/test-plan.sql)', jsonb_build_object('code', n.code, 'source', 'test_catalog')
FROM new_plan n WHERE EXISTS (SELECT 1 FROM price);

SELECT p.code, p.status, pv.technician_seats AS seats, pv.storage_bytes / 1000000000 AS storage_gb,
  string_agg(pr.interval_unit || ' ' || (pr.amount_minor / 100), ', ' ORDER BY pr.interval_unit) AS prices_thb
FROM billing.plans p JOIN billing.plan_versions pv ON pv.plan_id = p.id JOIN billing.price_versions pr ON pr.plan_version_id = pv.id
WHERE p.code = 'test20' GROUP BY 1, 2, 3, 4;
COMMIT;
