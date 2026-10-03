# A03 decisions — subscription rules (2026-10-04)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Source of truth | Entitlement is computed by `billing.entitlement(org, at)` from periods and grants at server time on every check. `subscriptions.status` is only a cache. | Spec §16.3: never trust `active` after `end_at`. |
| 2 | Trial | The trial is a plan of kind `trial` (price 0) so trial and paid periods share one snapshot format. A trigger on shop creation starts it, so no other path (reset link, owner change) can start a second one; one trial period per shop is also a unique index. | Commercial §4: one trial per shop. |
| 3 | No trial plan | If no active trial plan is published, a new shop is `pending_payment` (read-only, no approvals). The catalog is platform data: dev/test seed adds Trial 3 seats / 1 GB / 20 OCR / 14 days, Starter, Team. Production needs the platform to publish plans (C02) — prices in the seed are proposals, not published prices. | Spec: prototype prices are not production seed. |
| 4 | States | trialing, active, past_due (grace days from the period's snapshot, 7 for paid), expired, ended (owner stopped renewal: no grace), pending_payment, suspended (shop security suspension wins over periods and grants). Writable = trialing / active / past_due / active grant. | Commercial §4, DB §19, Functional §22. |
| 5 | Overlap | A paid period wins over a trial that covers the same moment. Paid periods never overlap: renewals take a lock on the subscription and start at the end of the latest paid period. | DB §16.4 allows lock + check instead of an exclusion constraint (keeps PGlite tests working). |
| 6 | Renewal timing | Before expiry or within grace → continue from the old end. After grace → start at the confirmation time and re-anchor. Same invoice twice → same period. | Commercial §4 example (10 Nov / 13 Nov / 18 Nov) is a test. |
| 7 | Month length | Period ends are anchor + n months in Asia/Bangkok, so a 31st anchor gives the last day of short months and returns to the 31st. Year prices use 12-month steps. | Commercial §4. |
| 8 | Who creates paid periods | `billing.apply_paid_period` has no grant to `fs_api`. Manual payment verification (C01) and platform admin (C02) will call it from a separate role. | DB §19.1: only verified payment changes entitlement. |
| 9 | Grants | Active grants raise limits per key (never lower) and keep a shop writable without a valid period (pilot extension). | Commercial §12 pilot grant. |
| 10 | Seat limit | From the effective entitlement. Approve/reactivate also require a writable subscription (`SUBSCRIPTION_EXPIRED`). Suspend/remove/reject stay allowed so an owner can always shrink the team. | Functional §22: expired → no approvals. |
| 11 | Usage quotas | `auth.reserve_usage` / `auth.settle_usage` for storage (lifetime window) and OCR (per period window). used + live reservations + request must fit, under the shop lock; same request key → same reservation; consume once; release returns quota. A04 (uploads, OCR) will call them. | DB §16.6. |
| 12 | Visibility | Owners see plan, period, limits and usage. Technicians only get `state` and `writable` — never prices or billing data. | DB §19 table. |
| 13 | Business gate | `auth.require_writable(user, org)` is the check B-module mutations must call (ok / inactive / suspended / forbidden). | DB §19: every mutation checks entitlement. |

Not in A03: payment, invoices, proofs, refunds (C01); plan publishing, grants and suspension through a UI (C02); notifications 3/7 days before expiry (needs the worker); the 24-hour late-submission exception for jobs started before expiry (B04).
