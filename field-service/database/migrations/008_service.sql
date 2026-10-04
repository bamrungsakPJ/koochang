-- B04 service records: per-equipment results, service photos, completion, next maintenance
-- cycle, history visibility. PostgreSQL 16 target. Apply as fs_migrator.

-- service events ---------------------------------------------------------------------------
-- One committed event per completed job (MVP); request_hash detects a reused client_event_id
-- with a different body.
ALTER TABLE core.service_events ADD COLUMN request_hash text CHECK (request_hash IS NULL OR length(request_hash) = 64);

ALTER TABLE core.service_event_equipment
  ADD COLUMN work_note text,
  ADD COLUMN problem_note text,
  ADD COLUMN not_done_reason text,
  ADD COLUMN equipment_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN next_due_on date,
  ADD CONSTRAINT items_not_done_reason CHECK (outcome = 'done' OR nullif(trim(coalesce(not_done_reason, '')), '') IS NOT NULL);

ALTER TABLE core.service_photos ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

-- maintenance ------------------------------------------------------------------------------
ALTER TABLE core.maintenance_schedules ADD COLUMN last_done_item_id uuid,
  ADD FOREIGN KEY (organization_id, last_done_item_id) REFERENCES core.service_event_equipment(organization_id, id);
ALTER TABLE core.maintenance_cycles
  ADD COLUMN fulfilled_by_item_id uuid,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN close_reason text,
  ADD FOREIGN KEY (organization_id, fulfilled_by_item_id) REFERENCES core.service_event_equipment(organization_id, id);
CREATE UNIQUE INDEX one_active_booking ON core.maintenance_bookings(organization_id, cycle_id) WHERE status = 'active';

-- Technician scope -------------------------------------------------------------------------
-- History follows locations: whoever may see a location sees the service done there, including
-- work by earlier technicians. Owners see everything.
CREATE POLICY technician_scope ON core.service_events AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR performed_by = core.context_member_id()
    OR EXISTS (SELECT 1 FROM core.customer_locations l WHERE l.organization_id = service_events.organization_id AND l.id = service_events.location_id))
  WITH CHECK (core.context_is_owner() OR performed_by = core.context_member_id());
CREATE POLICY technician_scope ON core.service_event_equipment AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.service_events e WHERE e.organization_id = service_event_equipment.organization_id AND e.id = service_event_equipment.service_event_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.service_events e WHERE e.organization_id = service_event_equipment.organization_id AND e.id = service_event_equipment.service_event_id));
CREATE POLICY technician_scope ON core.service_photos AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.service_event_equipment i WHERE i.organization_id = service_photos.organization_id AND i.id = service_photos.service_event_equipment_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.service_event_equipment i WHERE i.organization_id = service_photos.organization_id AND i.id = service_photos.service_event_equipment_id));
CREATE POLICY technician_scope ON core.maintenance_schedules AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.equipment e WHERE e.organization_id = maintenance_schedules.organization_id AND e.id = maintenance_schedules.equipment_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.equipment e WHERE e.organization_id = maintenance_schedules.organization_id AND e.id = maintenance_schedules.equipment_id));
CREATE POLICY technician_scope ON core.maintenance_cycles AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.maintenance_schedules s WHERE s.organization_id = maintenance_cycles.organization_id AND s.id = maintenance_cycles.schedule_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.maintenance_schedules s WHERE s.organization_id = maintenance_cycles.organization_id AND s.id = maintenance_cycles.schedule_id));
-- Bookings are an owner tool (B05); technicians may read them for jobs they can see.
CREATE POLICY technician_scope ON core.maintenance_bookings AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = maintenance_bookings.organization_id AND j.id = maintenance_bookings.job_id))
  WITH CHECK (core.context_is_owner() OR EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = maintenance_bookings.organization_id AND j.id = maintenance_bookings.job_id));

-- Notify owners when a job is completed (in addition to the B03 technician notices).
CREATE OR REPLACE FUNCTION core.notify_job_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_user uuid; v_old_user uuid; v_when text; o record;
BEGIN
  v_when := to_char(NEW.scheduled_start AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI');
  SELECT m.user_id INTO v_user FROM core.organization_members m WHERE m.organization_id = NEW.organization_id AND m.id = NEW.current_assignee_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT m.user_id INTO v_old_user FROM core.organization_members m WHERE m.organization_id = OLD.organization_id AND m.id = OLD.current_assignee_id;
  END IF;
  IF NEW.current_assignee_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.current_assignee_id IS DISTINCT FROM NEW.current_assignee_id) AND NEW.status IN ('scheduled','in_progress') THEN
    PERFORM core.notify(NEW.organization_id, v_user, 'job_assigned:' || NEW.id || ':' || NEW.version, 'job_assigned', jsonb_build_object('when', coalesce(v_when, '')), 'job', NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.current_assignee_id IS NOT NULL AND OLD.current_assignee_id IS DISTINCT FROM NEW.current_assignee_id AND v_old_user IS NOT NULL THEN
    PERFORM core.notify(NEW.organization_id, v_old_user, 'job_unassigned:' || NEW.id || ':' || NEW.version, 'job_unassigned', '{}'::jsonb, NULL, NULL);
  END IF;
  IF TG_OP = 'UPDATE' AND v_user IS NOT NULL AND OLD.current_assignee_id IS NOT DISTINCT FROM NEW.current_assignee_id THEN
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
      PERFORM core.notify(NEW.organization_id, v_user, 'job_cancelled:' || NEW.id, 'job_cancelled', '{}'::jsonb, NULL, NULL);
    ELSIF NEW.status IN ('scheduled','in_progress') AND OLD.scheduled_start IS DISTINCT FROM NEW.scheduled_start THEN
      PERFORM core.notify(NEW.organization_id, v_user, 'job_rescheduled:' || NEW.id || ':' || NEW.version, 'job_rescheduled', jsonb_build_object('when', coalesce(v_when, '')), 'job', NEW.id);
    END IF;
  END IF;
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
    FOR o IN SELECT m.user_id FROM core.organization_members m WHERE m.organization_id = NEW.organization_id AND m.role = 'owner' AND m.status = 'active'
      AND m.id IS DISTINCT FROM NEW.current_assignee_id LOOP
      PERFORM core.notify(NEW.organization_id, o.user_id, 'job_completed:' || NEW.id, 'job_completed',
        jsonb_build_object('name', coalesce((SELECT a.display_name FROM core.organization_members a
          WHERE a.organization_id = NEW.organization_id AND a.id = NEW.current_assignee_id), '')), 'job', NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

-- Late submission: after the plan stops, the assignee may still finish a job that the server
-- recorded as started before the end, for 24 hours. Never during a security suspension.
CREATE FUNCTION auth.late_submission_allowed(p_user_id uuid, p_organization_id uuid, p_job_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE e record; j record; v_end timestamptz;
BEGIN
  SELECT * INTO e FROM billing.entitlement(p_organization_id);
  IF e.state NOT IN ('expired','ended') THEN RETURN false; END IF;
  v_end := coalesce(e.grace_until, e.period_end);
  SELECT jb.started_at, jb.status, m.user_id INTO j FROM core.jobs jb
    JOIN core.organization_members m ON m.organization_id = jb.organization_id AND m.id = jb.current_assignee_id AND m.status = 'active'
    WHERE jb.organization_id = p_organization_id AND jb.id = p_job_id;
  RETURN j.user_id = p_user_id AND j.status = 'in_progress' AND j.started_at IS NOT NULL AND v_end IS NOT NULL
    AND j.started_at < v_end AND now() < v_end + interval '24 hours';
END $$;
REVOKE EXECUTE ON FUNCTION auth.late_submission_allowed(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.late_submission_allowed(uuid, uuid, uuid) TO fs_api;

-- On-site (ad-hoc) work: a technician records an assignment to themselves for the job the
-- server creates for that work. Other assignments stay owner-only.
DROP POLICY technician_scope ON core.job_assignments;
CREATE POLICY technician_scope ON core.job_assignments AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR member_id = core.context_member_id())
  WITH CHECK (core.context_is_owner() OR member_id = core.context_member_id());
