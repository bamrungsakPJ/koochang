# B03 decisions — jobs and scheduling (2026-10-04)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Who plans | Owners create, assign, reschedule, unassign and cancel jobs. Technicians do not plan jobs in MVP; their on-site work (ad-hoc job + service) comes with B04. | DB §8: technicians cannot create/assign/cancel in MVP. |
| 2 | One assignee | One current technician per job (`current_assignee_id` + one open `job_assignments` row, updated together). An owner can assign the job to themselves. Reassigning closes the old assignment with the reason. | Functional §8.2 asks to choose one lead; DB §5.3. |
| 3 | States | unassigned ↔ scheduled → in_progress; unassigned/scheduled/in_progress → cancelled (reason required). Changing time or technician does not change the state; a job in progress can change technician only with a reason. completed and cancelled are final; completion arrives with B04 (needs a service record). | Functional §9, DB §5.4. |
| 4 | Time | Appointments are timestamptz; the app sends Bangkok times with offset. A job may have no time yet. Overlapping open jobs of the same technician come back as `conflicts` — a warning, never a block. No route optimization. | Functional §8.2. |
| 5 | Equipment | Planned equipment (from the location) and/or an estimated count. No placeholder equipment is created from the estimate. The planned list can be replaced while the job is open. | Functional §8.1, DB §5.2. |
| 6 | Technician scope | A technician sees only jobs currently assigned to them; reassigning or unassigning removes access immediately. Through an open job (scheduled / in progress) they also see its customer and **only that job's location** (and its equipment), not the customer's other places. | DB §8 least privilege. |
| 7 | Concurrency and retries | Every change sends `expected_version` (409 VERSION_CONFLICT with latest_version). Creating takes a request key (retry → same job). Each change writes `job_state_changes` (who, when, reason) and an audit row. | DB §5.3, §9. |
| 8 | Start | "Start job" only changes the state and records `started_at` — no location is read. | Functional §6, §9. |
| 9 | Notifications | A database trigger notifies the new technician (job assigned, with time), the previous one (moved away, no customer details), and the assignee on reschedule or cancellation. | Functional §8.2. |
| 10 | Plan state | Creating and changing jobs needs a writable plan; cancelling is still allowed when the plan expired, so owners can tidy up. | A03. |
| 11 | Names | Members' RLS shows only the caller's own row, so job screens get technician names from `core.member_name`, which returns only a display name inside the caller's shop. | Keeps membership data private. |

Not in B03: service records, photos per unit and completing jobs (B04); maintenance-generated jobs (B05); multiple technicians per job; reopening finished jobs.
