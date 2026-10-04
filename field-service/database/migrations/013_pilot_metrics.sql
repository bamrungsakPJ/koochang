-- D pilot metrics for the platform overview: aggregates only, no shop content.
-- PostgreSQL 16 target. Apply as fs_migrator.

-- p_days: look-back window. Figures:
--  record_minutes_median   minutes from opening the service form to committing it
--  history_coverage        share of active equipment with at least one done service
--  maintenance_due/_followed  cycles due in the window, and how many got a booking or were done
--  active_shops / active_technicians  shops and members that committed service in the window
--  trial_ended / converted shops whose trial ended in the window, and those with a paid period
--  storage_bytes / ocr_used  totals for cost per shop
CREATE FUNCTION padmin.metrics(p_account_id uuid, p_days integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_from timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
BEGIN
  PERFORM padmin.require(p_account_id, 'shops.read');
  RETURN jsonb_build_object(
    'days', greatest(1, least(p_days, 365)),
    'service_records', (SELECT count(*) FROM core.service_events se WHERE se.status = 'committed' AND se.created_at >= v_from),
    'record_minutes_median', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM se.created_at - se.occurred_at) / 60))::numeric, 1)
      FROM core.service_events se WHERE se.status = 'committed' AND se.created_at >= v_from AND se.created_at >= se.occurred_at),
    'history_coverage', (SELECT round(avg(CASE WHEN EXISTS (SELECT 1 FROM core.service_event_equipment i WHERE i.organization_id = e.organization_id AND i.equipment_id = e.id AND i.outcome = 'done')
      THEN 1.0 ELSE 0.0 END), 3) FROM core.equipment e WHERE e.status = 'active'),
    'maintenance_due', (SELECT count(*) FROM core.maintenance_cycles c WHERE c.due_date >= v_from::date AND c.due_date <= now()::date),
    'maintenance_followed', (SELECT count(*) FROM core.maintenance_cycles c WHERE c.due_date >= v_from::date AND c.due_date <= now()::date
      AND (c.status = 'fulfilled' OR EXISTS (SELECT 1 FROM core.maintenance_bookings b WHERE b.organization_id = c.organization_id AND b.cycle_id = c.id AND b.status <> 'cancelled'))),
    'active_shops', (SELECT count(DISTINCT se.organization_id) FROM core.service_events se WHERE se.status = 'committed' AND se.created_at >= v_from),
    'active_technicians', (SELECT count(DISTINCT se.performed_by) FROM core.service_events se WHERE se.status = 'committed' AND se.created_at >= v_from),
    'shops_total', (SELECT count(*) FROM core.organizations WHERE status <> 'closed'),
    'trial_ended', (SELECT count(*) FROM billing.subscription_periods sp WHERE sp.source = 'trial' AND sp.end_at >= v_from AND sp.end_at <= now()),
    'trial_converted', (SELECT count(*) FROM billing.subscription_periods sp WHERE sp.source = 'trial' AND sp.end_at >= v_from AND sp.end_at <= now()
      AND EXISTS (SELECT 1 FROM billing.subscription_periods p WHERE p.organization_id = sp.organization_id AND p.source = 'paid')),
    'storage_bytes', coalesce((SELECT sum(uc.used) FROM billing.usage_counters uc WHERE uc.metric = 'storage_bytes' AND uc.window_key = 'all'), 0),
    'ocr_used', (SELECT count(*) FROM core.ocr_requests r WHERE r.quota_consumed AND r.created_at >= v_from));
END $$;
REVOKE EXECUTE ON FUNCTION padmin.metrics(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION padmin.metrics(uuid, integer) TO fs_platform;
