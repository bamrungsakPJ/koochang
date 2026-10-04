# B04 decisions — service records and completing jobs (2026-10-04)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | One event per job | Completing a job creates one ServiceEvent with one row per unit and service type (per-unit service type, result, notes, photos, next due). | DB §2: MVP uses one event from normal completion. |
| 2 | Who completes | Only the current assignee, on a job in progress. Owners record service by assigning the job to themselves. | DB §5.4: completed by the person who did the service. |
| 3 | All or nothing | Results, photos, cycles, job state, state history and audit commit in one transaction. Schedules are locked in id order to avoid deadlocks. | DB §9.1. |
| 4 | Retries | `client_event_id` is unique forever; the same id with the same body returns the original result (`replayed`), a different body returns 409 `IDEMPOTENCY_MISMATCH`. The app keeps the id and its entries until the server confirms. | DB §9.2–9.3. |
| 5 | Results | done / not_done / deferred per unit; not done and deferred need a reason. At least one unit must be done, otherwise reschedule or cancel. Units in the plan that were not serviced get no history. | DB §5.4, Functional §10.2. |
| 6 | Next maintenance | Per done unit: keep the schedule, 3/6/12 months (any 1–60 via API), a custom date after the service, or no reminder. Calendar months from the service date in the shop time zone (31 Aug + 6 → last day of Feb). Only a done result fulfills the open cycle and creates the next one; active bookings for the cycle become fulfilled. One schedule per unit and service type. | Functional §12, DB §7.4. |
| 7 | Back-dated work | If a later done service for the same unit and type already exists, the record is kept but the cycle is not moved. | DB §7.4. |
| 8 | Snapshots | Each result stores the unit's name, category, brand, model and serial at that time, and the performer member, so renaming equipment or a new technician never changes past history. | DB §4.4, §6.1. |
| 9 | On-site work | `POST /service-events` creates a `technician_adhoc` job assigned to the recorder and completes it with the service in one transaction. | DB §6.6, Functional §10.3. |
| 10 | Photos | Before/after photos are A04 uploads (GPS removed) attached per unit; technicians may attach only their own uploads. | Functional §11.2. |
| 11 | History visibility | Whoever may see a location sees its service history, including earlier technicians' work. | DB §8. |
| 12 | Late submission | After the plan stops, the assignee may finish a job that the server recorded as started before the end, for 24 hours; no new work. Never during a security suspension. | Functional §22. |
| 13 | Location | Recording or finishing reads no location; occurred_at is the device time when the form opened, validated not to be in the future. | Functional §6. |

Not in B04: offline drafts stored on the device (entries stay in memory until sent), editing committed history with audit (owner flow), several service events per job.
