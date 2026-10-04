# B05 decisions — maintenance follow-up and reminders (2026-10-04)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Who follows up | Only the Owner sees the due list, logs contacts, books, postpones or stops reminders. Reminders go to active owners only. Technicians see cycles only through equipment history. | Functional §12: reminders go to the shop, not the previous technician. |
| 2 | Due list | Open cycles of enabled schedules on active equipment of non-archived customers, due within 30 days (1–365 via `days`) plus all overdue, in the shop's time zone. Each row is in exactly one bucket: overdue / within 7 days / within 30 days. | Owner home counts never overlap. |
| 3 | Contact log | `no_answer / interested / call_later / declined / booked`, optional note and next contact date. Contacting never changes the due date. Owner-only table (restrictive RLS). | Functional §12.3. |
| 4 | Booking | `POST /maintenance/book` creates a `source='maintenance'` job from one or more open cycles at one location (customer, place, units and service type come from the cycles), optional time and assignee (any active member, not tied to the last technician). Same `request_key` → same job. A cycle with an active booking → 409 `ALREADY_BOOKED` with the job id. Booking does not move the due date; only a done service closes the cycle (B04). | CLAUDE.md rule 9, DB §7.4. |
| 5 | Cancelled job | Cancelling a job releases its active bookings (trigger), so the cycle shows as open for follow-up again. | Avoids cycles stuck as "booked". |
| 6 | Postpone | New due date with a reason and `expected_version`; audited with old and new date. The cycle version changes, so reminder milestones restart for the new date. | Owner decision, traceable. |
| 7 | Stop reminders | Closes the cycle as `disabled` with the reason, switches the schedule off and cancels active bookings. History stays. A later service can turn the schedule on again. | Customer moved / no longer wants service. |
| 8 | Reminders | Worker scan every 15 minutes: one notification per cycle, cycle version and milestone (`due_soon` ≤ 7 days, `due` on the day, `overdue` after). Only the current milestone is sent, so a worker that was down does not send a backlog. Skipped when the cycle is booked or the shop plan is not writable. Push text from the shared catalog; tapping opens the maintenance list. | Dedupe by event key (A04), no spam. |

Not in B05: SMS/LINE messages to customers (no provider, out of MVP), automatic booking, a calendar date picker (date field YYYY-MM-DD for postpone; chips for booking and next contact).
