-- Launch plan catalog (2026-10-05): one trial plan and three paid plans.
-- Plans limit only technician seats and photo storage; OCR is included in every plan (migration 023).
-- The owner never uses a technician seat, so "solo" (0 seats) is a shop where the owner does the work.
-- Apply once to an environment that has no plans yet (needs migration 023), as a role that may write billing.*:
--   sudo -u postgres psql -p <port> -d <db> -v ON_ERROR_STOP=1 -f database/catalog/launch-plans.sql
-- Codes that already exist are left alone. Later changes go through the console (new plan versions).
BEGIN;
CREATE TEMP TABLE launch(code text, name_th text, name_en text, kind text, seats integer, storage_gb integer,
  trial_days integer, grace_days integer, month_thb integer, year_thb integer) ON COMMIT DROP;
INSERT INTO launch VALUES
  ('trial',      'ทดลองใช้', 'Trial',      'trial', 3,  5,   14, 0, NULL, NULL),
  ('solo',       'เดี่ยว',     'Solo',       'paid',  0,  10,  0,  7, 290,  2900),
  ('small_team', 'ทีมเล็ก',   'Small team', 'paid',  3,  30,  0,  7, 590,  5900),
  ('business',   'ธุรกิจ',    'Business',   'paid',  10, 100, 0,  7, 1290, 12900);

WITH new_plans AS (
  INSERT INTO billing.plans(code, name_th, name_en, kind)
  SELECT l.code, l.name_th, l.name_en, l.kind FROM launch l
  WHERE NOT EXISTS (SELECT 1 FROM billing.plans p WHERE p.code = l.code)
    AND NOT (l.kind = 'trial' AND EXISTS (SELECT 1 FROM billing.plans p WHERE p.kind = 'trial' AND p.status = 'active'))
  RETURNING id, code
), versions AS (
  INSERT INTO billing.plan_versions(plan_id, version_no, technician_seats, storage_bytes, ocr_per_period, trial_days, grace_days, published_at)
  SELECT n.id, 1, l.seats, l.storage_gb * 1000000000::bigint, 0, l.trial_days, l.grace_days, now()
  FROM new_plans n JOIN launch l ON l.code = n.code
  RETURNING id, plan_id
), prices AS (
  INSERT INTO billing.price_versions(plan_version_id, amount_minor, interval_unit, effective_from)
  SELECT v.id, x.amount * 100, x.unit, now()
  FROM versions v JOIN new_plans n ON n.id = v.plan_id JOIN launch l ON l.code = n.code
  CROSS JOIN LATERAL (VALUES ('month', coalesce(l.month_thb, 0)), ('year', l.year_thb)) x(unit, amount)
  WHERE x.amount IS NOT NULL AND (l.kind = 'paid' OR x.unit = 'month')
  RETURNING plan_version_id
)
INSERT INTO platform.audit_logs(action, target_type, target_id, reason, details)
SELECT 'plan.published', 'plan', n.id, 'Launch catalog (database/catalog/launch-plans.sql)', jsonb_build_object('code', n.code, 'source', 'launch_catalog')
FROM new_plans n WHERE EXISTS (SELECT 1 FROM prices);

SELECT p.code, p.kind, pv.technician_seats AS seats, pv.storage_bytes / 1000000000 AS storage_gb,
  string_agg(pr.interval_unit || ' ' || (pr.amount_minor / 100), ', ' ORDER BY pr.interval_unit) AS prices_thb
FROM billing.plans p JOIN billing.plan_versions pv ON pv.plan_id = p.id JOIN billing.price_versions pr ON pr.plan_version_id = pv.id
WHERE p.status = 'active' GROUP BY 1, 2, 3, 4 ORDER BY 3, 1;
COMMIT;
