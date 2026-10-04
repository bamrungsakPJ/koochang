-- B03 jobs: planned work, assignment history, state changes, technician scope via assignment,
-- notifications to affected technicians. PostgreSQL 16 target. Apply as fs_migrator.

CREATE POLICY job_functions ON core.jobs TO fs_migrator USING (true);

-- jobs -------------------------------------------------------------------------------------
-- A job is a plan for one location; equipment may be unknown (estimated count only).
ALTER TABLE core.jobs
  ALTER COLUMN title DROP NOT NULL,
  ADD COLUMN source text NOT NULL DEFAULT 'owner_created' CHECK (source IN ('owner_created','maintenance','technician_adhoc')),
  ADD COLUMN description text,
  ADD COLUMN estimated_equipment_count integer CHECK (estimated_equipment_count IS NULL OR estimated_equipment_count > 0),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN created_by_member_id uuid,
  ADD COLUMN create_request_key uuid,
  ADD CONSTRAINT jobs_unassigned_has_no_assignee CHECK (status <> 'unassigned' OR current_assignee_id IS NULL),
  ADD CONSTRAINT jobs_cancelled_at CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT jobs_create_request UNIQUE (organization_id, create_request_key),
  ADD FOREIGN KEY (organization_id, created_by_member_id) REFERENCES core.organization_members(organization_id, id);
CREATE INDEX jobs_schedule ON core.jobs(organization_id, scheduled_start) WHERE status IN ('unassigned','scheduled','in_progress');

ALTER TABLE core.job_equipment
  ADD COLUMN requested_service_type text CHECK (requested_service_type IS NULL OR requested_service_type IN ('installation','repair','inspection','maintenance','other')),
  ADD COLUMN request_note text;

ALTER TABLE core.job_assignments ADD COLUMN reason text;
-- Planned equipment is part of the plan, not history: an owner may replace the list.
GRANT DELETE ON core.job_equipment TO fs_api;

-- Names of fellow members for job screens. members' own RLS only shows the caller's row, so
-- this definer returns just the display name, and only inside a shop the caller belongs to.
CREATE FUNCTION core.member_name(p_organization_id uuid, p_member_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT m.display_name FROM core.organization_members m
  WHERE m.organization_id = p_organization_id AND m.id = p_member_id AND p_organization_id = core.context_organization_id()
    AND core.context_member_id() IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION core.member_name(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.member_name(uuid, uuid) TO fs_api;

CREATE TABLE core.job_state_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  job_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_member_id uuid NOT NULL,
  reason text,
  FOREIGN KEY (organization_id, job_id) REFERENCES core.jobs(organization_id, id),
  FOREIGN KEY (organization_id, actor_member_id) REFERENCES core.organization_members(organization_id, id),
  UNIQUE (organization_id, id)
);
CREATE INDEX job_state_changes_by_job ON core.job_state_changes(organization_id, job_id, created_at);
ALTER TABLE core.job_state_changes ENABLE ROW LEVEL SECURITY; ALTER TABLE core.job_state_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON core.job_state_changes TO fs_api USING (core.tenant_allowed(organization_id)) WITH CHECK (core.tenant_allowed(organization_id));
GRANT SELECT, INSERT ON core.job_state_changes TO fs_api;

-- Technician scope -------------------------------------------------------------------------
-- A technician sees the jobs currently assigned to them (a reassigned job disappears at once),
-- and through an open job its customer and location. Owners see everything.
CREATE POLICY technician_scope ON core.jobs AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR current_assignee_id = core.context_member_id())
  WITH CHECK (core.context_is_owner() OR current_assignee_id = core.context_member_id());
CREATE POLICY technician_scope ON core.job_equipment AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = job_equipment.organization_id AND j.id = job_equipment.job_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = job_equipment.organization_id AND j.id = job_equipment.job_id));
CREATE POLICY technician_scope ON core.job_assignments AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR member_id = core.context_member_id())
  WITH CHECK (core.context_is_owner());
CREATE POLICY technician_scope ON core.job_state_changes AS RESTRICTIVE TO fs_api
  USING (EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = job_state_changes.organization_id AND j.id = job_state_changes.job_id))
  WITH CHECK (EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = job_state_changes.organization_id AND j.id = job_state_changes.job_id));

-- Open jobs of the caller, as a definer so customer/location policies can use it without the
-- jobs policy re-entering them.
CREATE FUNCTION core.assigned_open_job_at(p_organization_id uuid, p_customer_id uuid, p_location_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM core.jobs j WHERE j.organization_id = p_organization_id
    AND (p_customer_id IS NULL OR j.customer_id = p_customer_id) AND (p_location_id IS NULL OR j.location_id = p_location_id)
    AND j.current_assignee_id = core.context_member_id() AND j.status IN ('scheduled','in_progress'))
$$;
REVOKE EXECUTE ON FUNCTION core.assigned_open_job_at(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.assigned_open_job_at(uuid, uuid, uuid) TO fs_api;

DROP POLICY technician_scope ON core.customers;
CREATE POLICY technician_scope ON core.customers AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR created_by_member_id = core.context_member_id() OR core.assigned_open_job_at(organization_id, id, NULL))
  WITH CHECK (core.context_is_owner() OR created_by_member_id = core.context_member_id() OR core.assigned_open_job_at(organization_id, id, NULL));
-- Only the job's location, not every location of that customer.
DROP POLICY technician_scope ON core.customer_locations;
CREATE POLICY technician_scope ON core.customer_locations AS RESTRICTIVE TO fs_api
  USING (core.context_is_owner() OR created_by_member_id = core.context_member_id()
    OR EXISTS (SELECT 1 FROM core.customers c WHERE c.organization_id = customer_locations.organization_id AND c.id = customer_locations.customer_id
      AND c.created_by_member_id = core.context_member_id())
    OR core.assigned_open_job_at(organization_id, NULL, id))
  WITH CHECK (core.context_is_owner() OR created_by_member_id = core.context_member_id()
    OR EXISTS (SELECT 1 FROM core.customers c WHERE c.organization_id = customer_locations.organization_id AND c.id = customer_locations.customer_id
      AND c.created_by_member_id = core.context_member_id())
    OR core.assigned_open_job_at(organization_id, NULL, id));

-- Notifications ----------------------------------------------------------------------------
-- The new assignee hears about the job, the previous one that it was taken away; the assignee
-- hears about time changes and cancellation. Only shop members' own inboxes, no customer data.
CREATE FUNCTION core.notify_job_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_user uuid; v_old_user uuid; v_when text;
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
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION core.notify_job_change() FROM PUBLIC;
CREATE TRIGGER notify_job AFTER INSERT OR UPDATE OF current_assignee_id, scheduled_start, status ON core.jobs
  FOR EACH ROW EXECUTE FUNCTION core.notify_job_change();
