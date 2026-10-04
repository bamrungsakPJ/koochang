-- B05 maintenance follow-up: contact logs, booking from cycles, cancelled bookings reopen the
-- cycle, owner reminders by milestone. PostgreSQL 16 target. Apply as fs_migrator.

CREATE POLICY maintenance_functions ON core.maintenance_cycles TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY maintenance_functions ON core.maintenance_schedules TO fs_migrator USING (true);
CREATE POLICY maintenance_functions ON core.maintenance_bookings TO fs_migrator USING (true) WITH CHECK (true);
CREATE POLICY maintenance_functions ON core.equipment TO fs_migrator USING (true);
CREATE POLICY maintenance_functions ON core.customer_locations TO fs_migrator USING (true);
CREATE POLICY maintenance_functions ON core.customers TO fs_migrator USING (true);

-- Contact attempts never move the due date; they help the owner follow up.
CREATE TABLE core.maintenance_contact_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  cycle_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('no_answer','interested','call_later','declined','booked')),
  note text,
  next_contact_on date,
  created_by_member_id uuid NOT NULL,
  FOREIGN KEY (organization_id, cycle_id) REFERENCES core.maintenance_cycles(organization_id, id),
  FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id),
  UNIQUE (organization_id, id)
);
CREATE INDEX contact_logs_by_cycle ON core.maintenance_contact_logs(organization_id, cycle_id, created_at DESC);
ALTER TABLE core.maintenance_contact_logs ENABLE ROW LEVEL SECURITY; ALTER TABLE core.maintenance_contact_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON core.maintenance_contact_logs TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));
CREATE POLICY owner_only ON core.maintenance_contact_logs AS RESTRICTIVE TO fs_api USING (core.context_is_owner()) WITH CHECK (core.context_is_owner());
GRANT SELECT, INSERT ON core.maintenance_contact_logs TO fs_api;

ALTER TABLE core.maintenance_bookings ADD COLUMN created_by_member_id uuid,
  ADD FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id);

-- A cancelled job releases its bookings, so the cycle shows as open again for follow-up.
CREATE FUNCTION core.release_bookings_on_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    UPDATE core.maintenance_bookings SET status = 'cancelled' WHERE organization_id = NEW.organization_id AND job_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION core.release_bookings_on_cancel() FROM PUBLIC;
CREATE TRIGGER release_bookings AFTER UPDATE OF status ON core.jobs FOR EACH ROW EXECUTE FUNCTION core.release_bookings_on_cancel();

-- Owner reminders: one notification per cycle, cycle version and milestone (7 days before, due
-- day, first overdue). Only the current milestone is sent, so a worker that was down for days
-- does not send a backlog. Cycles with an active booking are skipped. Shops whose plan is not
-- writable get no business reminders (subscription reminders continue separately).
CREATE FUNCTION worker.scan_maintenance(p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; o record; v_today date; v_milestone text; v_count integer := 0;
BEGIN
  FOR c IN
    SELECT cy.id, cy.organization_id, cy.due_date, cy.version, org.timezone, e.id AS equipment_id, coalesce(e.name, e.equipment_type) AS equipment_name
    FROM core.maintenance_cycles cy
    JOIN core.organizations org ON org.id = cy.organization_id AND org.status = 'active'
    JOIN core.maintenance_schedules s ON s.organization_id = cy.organization_id AND s.id = cy.schedule_id AND s.enabled
    JOIN core.equipment e ON e.organization_id = s.organization_id AND e.id = s.equipment_id AND e.status = 'active'
    WHERE cy.status = 'open'
      AND NOT EXISTS (SELECT 1 FROM core.maintenance_bookings b WHERE b.organization_id = cy.organization_id AND b.cycle_id = cy.id AND b.status = 'active')
  LOOP
    v_today := (p_at AT TIME ZONE c.timezone)::date;
    v_milestone := CASE WHEN c.due_date < v_today THEN 'overdue' WHEN c.due_date = v_today THEN 'due' WHEN c.due_date <= v_today + 7 THEN 'due_soon' END;
    CONTINUE WHEN v_milestone IS NULL;
    CONTINUE WHEN NOT (SELECT e.writable FROM billing.entitlement(c.organization_id, p_at) e);
    FOR o IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = c.organization_id AND m.role = 'owner' AND m.status = 'active' LOOP
      IF core.notify(c.organization_id, o.user_id, 'maintenance:' || c.id || ':' || c.version || ':' || v_milestone, 'maintenance_' || v_milestone,
          jsonb_build_object('date', to_char(c.due_date, 'YYYY-MM-DD'), 'name', c.equipment_name), 'maintenance_cycle', c.id) IS NOT NULL THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION worker.scan_maintenance(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker.scan_maintenance(timestamptz) TO fs_worker;
