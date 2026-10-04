# Console settings and account security — 2026-10-04

- Workspace typechecks, API production compilation and Next.js production build passed.
- Full isolated PostgreSQL 16 suite: **143 passed / 0 skipped / 0 failed**, using `node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs` (provider responses mocked). Includes existing HTTP pilot journey, OTP, EasySlip, Stripe and concurrent role/quota/payment workflows.
- Full PGlite run before the final diagnostic case: **142 total / 115 passed / 27 skipped / 0 failed**. Final console/SMS/auth targeted suite: **21 passed / 0 failed**, including the added diagnostics case. No repeated full suite was needed after final display-label/copy polish.
- Eight new console cases cover actual HTTP permissions/TOTP, restricted raw settings, encrypted/preserved secrets and sanitized audit, stale updates, bank snapshot retention, dynamic providers/explicit disable over environment, own-account profile/session binding, password verification/lockout, session revocation and console-aware startup diagnostics.
- Browser QA used the isolated owner_web fixture, API 4101 / web 3101 and synthetic platform account. Confirmed email/password/MFA sign-in, receiving-account save/readback across navigation, profile-name save, account/device view, DeeSMSx/EasySlip forms, Stripe full endpoint/receiver status, Thai/English and My account/Stripe widths at 320px (document width 305 <= viewport 320).
- Browser QA did not submit Stripe keys, call live providers, send SMS, change a user's password, deploy or perform human UAT. Password changes and provider writes were covered through synthetic HTTP/service tests. Screenshot is a synthetic receiving-account example.
- Setup, remaining infrastructure requirements and scope: [CONSOLE.md](CONSOLE.md). Account roles/email remain managed by the existing operator tool; real provider setup remains pending.

---

# DeeSMSx OTP — 2026-10-04

- API TypeScript build passed. `node --test tests/sms.test.mjs tests/auth-unit.test.mjs`: **13 passed / 0 skipped / 0 failed**. The initial sandbox attempt blocked process spawning with EPERM; the authorized rerun passed.
- New provider tests use mocked fetch for official JSON fields, E.164-to-digits recipient, Thai/English text, mandatory credentials, unknown providers, fixed HTTPS endpoint, redirect rejection setting, timeout signal, HTTP rejection, malformed response, sanitized errors and no automatic retries.
- Actual AuthService integration with a synthetic database proves provider acknowledgment returns `delivery: sms`, codes stay out of the response and are hashed for storage, and failed sending returns generic 503. Existing OTP/phone/configuration/security tests remain passing.
- No real account keys, SMS delivery, credits, deployment or human UAT. Provider acceptance is not a handset delivery receipt. See [DEESMSX.md](DEESMSX.md).

---

# Stripe QR/card and platform account settings — 2026-10-04

- Final workspace typechecks and API/Next.js production build passed. Windows sandbox initially blocked child processes with spawn EPERM; the authorized verification rerun succeeded.
- Full PGlite suite: **131 total, 104 passed / 27 skipped / 0 failed** (`node --test --test-concurrency=1 tests/*.test.mjs`). PostgreSQL HTTP/concurrency cases are skipped here.
- Isolated PostgreSQL 16 covered all **13 Stripe scenarios** with no failures: initial 10 Stripe cases plus the existing payments HTTP case passed (11 total), then 3 added cases plus credential rotation passed (4 total; rotation repeats an earlier case).
- Final targeted command: `node --env-file=.env --test --test-name-pattern='Stripe-only|Stripe activation|late Stripe|Stripe credentials rotate' tests/stripe.test.mjs`.
- Coverage includes restricted settings/TOTP flow, encrypted and sanitized credentials, account rotation, server-priced Checkout, idempotent retries, competing payment channels, owner RLS, raw HTTP signed webhook and stale/tampered signatures, canonical provider status, currency/amount/metadata checks, unpaid and production-test rejection.
- Verified immediate expired-shop activation, one payment/period on duplicate and concurrent callbacks, rollback on entitlement failure, security suspension, Stripe-only billing without bank details and late funds routed to the admin queue without a second period.
- All provider responses are synthetic. No Stripe account was connected, real provider payment made, deployment performed or human UAT/device test claimed. Setup and scope: [STRIPE.md](STRIPE.md).

---

# EasySlip immediate activation — 2026-10-04

- All workspace typechecks and production API/Next.js build passed.
- Latest full PGlite suite: **118 total, 92 passed / 26 skipped / 0 failed**. PostgreSQL HTTP/concurrency checks are intentionally skipped there.
- Latest isolated PostgreSQL 16 EasySlip suite: **11 passed / 0 skipped / 0 failed** (`node --env-file=.env --test tests/easyslip.test.mjs`).
- Existing payments HTTP workflow separately passed: owner upload/private proof, operator TOTP and permission checks, duplicate confirmation, rejection, two-person refund and append-only audit. No live provider was invoked.
- EasySlip tests cover official authenticated multipart v2 options, sanitized evidence, duplicates, exact amount/account and corroborating mask digits, currency/date errors, missing response fields, timeout/errors/configuration and image size.
- Actual controller and service use mocked provider HTTP plus real SQL/roles to prove synchronous paid upload response, immutable bytes, lost-response replay without a second call/period, and tenant protection. Real PostgreSQL concurrent claims issue one attempt; concurrent matching references pay one invoice only.
- Confirmed expired-shop authorization opens immediately, one payment/period/audit/notification on replay, automatic payments remain visible in console and reconciliation, admin can confirm exceptions, late automation cannot extend a manual confirmation, security suspension wins and failed period insertion rolls back the whole activation.
- Initial real-DB synthetic timestamps were four seconds behind database creation time. Fixtures now use database timestamps; the transfer-date acceptance rule was not relaxed.
- Tests/QA child processes strip real EasySlip credentials. No real EasySlip key/account registration, charged API call, bank transfer, deployment, new browser/device QA or human UAT was performed. Setup and operational limits: [EASYSLIP.md](EASYSLIP.md).

---

# Owner list pagination — 2026-10-04

- All workspace typechecks and Next.js production build passed.
- PGlite suite before the final added client assertion: 106 total, 81 passed / 25 skipped / 0 failed. Owner-client suite after that addition: 5 passed / 0 failed.
- New SQL/controller tests run the actual customer/job list controllers under fs_api with RLS. Confirmed 106 matching customers and 205 jobs across pages, identical timestamp boundaries without duplicates, filters, cross-shop denial, default/capped sizes, and rejection of fractional/negative/nonfinite paging input.
- PostgreSQL 16.15 targeted verification: 5 passed / 0 skipped / 0 failed (customer/job HTTP workflows plus all 3 new SQL/controller pagination tests). Added assertions verify next-page metadata, no repeated ids and invalid paging input. Run: `node --env-file=.env --test --test-concurrency=1 --test-name-pattern='customers: phone-first|jobs: create and assign|pagination' tests/auth-http.test.mjs tests/pagination.test.mjs`.
- No new manual browser/device/UAT checks this round. Previous owner browser verification below remains historical evidence for the earlier workspace; new paging controls were checked through compilation, transport tests and API tests.

---

# Owner web verification — 2026-10-04

- Added the owner workspace at `/shop`; root `/` redirects there. Platform staff continue to use `/console` with separate sessions.
- Workspace typechecks passed; final production API/Next.js build after draft/OCR refinements passed with `/shop`, `/console` and `/join/[token]`.
- PGlite suite: 103 total, **78 passed / 25 skipped / 0 failed**. Skipped HTTP/concurrency cases require real PostgreSQL.
- Four new owner browser transport tests exercise the actual TypeScript API/storage client: shop/platform session isolation, network failure preservation and restoration, access-token refresh, temporary refresh outage versus revocation, and raw Blob uploads.
- Final real PostgreSQL 16.15 suite: **103 passed / 0 skipped / 0 failed**, including HTTP pilot journey, cross-tenant authorization, concurrent approvals/quotas/renewals, service replay, unscheduled completed-job history, and worker retries. Run: `node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs` after API build; isolated test cluster over SSH.
- Browser QA used synthetic data on a separate PostgreSQL 16.15 test database via `scripts/owner-web-test-server.mjs`, API 4101 / Next dev 3101. No real SMS, payments or shop data were used.
- Confirmed through the web UI: OTP registration/sign-in; shop creation and switching; phone-only customer with first location; manual equipment; planned job creation/self-assignment/reschedule/start; Bangkok 09:00–10:00 appointments; service draft restoration after page reload including photo IDs and custom due date; photo upload/retry after test DB outage; successful service completion; maintenance cycle and follow-up booking; invoice creation/payment destination; synthetic proof pending review; support ticket; team QR and pause joining; Thai/English; team layout at 320px (document width equals viewport).
- Captured final Thai owner overview. A Next dev RSC navigation fetch failed during test connectivity interruption and recovered after retry; no claim of a completely error-free browser session. The fixture no longer holds its setup DB connection idle.
- Browser checks did not exercise every team status transition, support consent/revocation, actual GPS permission, OCR provider, browser print dialog, or every device. Server authorization/concurrency is covered by the API suite; human UAT and real-device checks remain deferred at the user's request.
- No production deployment/providers, live payment or mobile device testing in this work session. Detailed owner scope, run instructions and API list limits: [OWNER_WEB.md](OWNER_WEB.md).

---

# Verification — 2026-10-03 (historical baseline)

- All workspace typechecks passed.
- API compilation and Next.js production build passed.
- Automated tests: 25 passed, 0 failed (database, i18n, HTTP).
- Database tests used PGlite 0.5.8 / PostgreSQL 18.3, NOT the PostgreSQL 16 deployment target.
- PostgreSQL 16 CI is configured but was not executed on GitHub. Run it before deployment.
- Expo SDK installed-version check passed offline; Android and iOS Hermes bundle exports passed.
- No APK/IPA build, device testing or app-store submission performed.
- Admin browser checks passed: th/en, preference persistence, html language, 320 px overflow, no runtime errors.
- No Ubuntu server connection/deployment, real OTP/OCR/storage/payment integration performed.
- Business API remains closed (401) until verified sessions and complete authorization are implemented. (A02, below: sessions and shop/team authorization are implemented; customer/job APIs are still not.)
- RLS isolates tenants; technician assignment scope, subscription and atomic quotas still require business API implementation.
- Language preference persists per device now; account synchronization is pending authentication.

# A01 baseline check — 2026-10-03

Dev machine Windows 11, Node 24.19.0, pnpm 11.25.0. Database server `server2` (Ubuntu 24.04.2, PostgreSQL 16.15, native, no Docker).

- `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`: passed.
- Tests on PostgreSQL 16.15: 25 passed, 0 failed. Run against a separate cluster `16/test` (port 5433, listens on localhost only) through an SSH tunnel, so the test guard (loopback host, database name ending `_test`) holds. The test suite creates `fs_api`/`fs_migrator` itself, so it must not share a cluster with the dev database.
- Tests on PGlite (no `TEST_DATABASE_URL`): passed.
- Dev database `field_service` on cluster `16/main`: `pnpm db:migrate` as `fs_migrator` applied `001_foundation.sql`. `fs_api`, `fs_migrator` and `fs_owner` are all NOSUPERUSER NOBYPASSRLS.
- Tables after migration: core 20 (all RLS forced), ops 3 (all forced), billing 12 (9 forced), platform 6 (3 forced), migration 1. Not yet reviewed whether the unforced billing/platform tables are intentional (global catalogs / platform-only).
- Seed: `fs_owner` is not a superuser on server2 (unlike the Docker setup), so `pnpm db:seed` cannot write past RLS. The synthetic seed was loaded on server2 with `sudo -u postgres psql -d field_service < database/seeds/development.sql` (2 organizations, 3 users, 3 memberships).
- Still not done: GitHub CI run, device tests, native APK/IPA, production install.

Local setup (A01): `.env` points migrate/API at server2 directly (Tailscale) and tests at `127.0.0.1:55433`. Open the tunnel first: `ssh -N -L 55432:127.0.0.1:5432 -L 55433:127.0.0.1:5433 uht-dev`, then run `node --env-file=.env --test tests/*.test.mjs`.

# A02 identity / shop / team — 2026-10-03

Decisions: [DECISIONS_A02.md](DECISIONS_A02.md). Migration `002_identity.sql` (new schema `auth`; the 41 foundation tables are unchanged in number).

Done:
- API: phone OTP request/verify (development SMS adapter only), session refresh with rotation and reuse detection, logout, `GET/PATCH /me`, create shop (shop + owner + join link in one transaction, Idempotency-Key), public join link preview, join request (pending), owner team list with seat usage, approve / reject / suspend / reactivate / remove with `expected_version`, join link view (URL + QR PNG), open / close / reset. Every tenant route re-checks the membership; errors keep the same code in th/en with `request_id`.
- Mobile (Expo): welcome, create shop → OTP → shop ready (share link / QR), sign in, join from deep link `fieldservice://join/<token>` or pasted link → shop preview → name + phone → OTP → pending screen with "check status", rejected/suspended screens without business menus, owner team screen, shop switcher, account (language th/en saved to the account, sign out). Tokens in SecureStore.
- Admin web: `/join/<token>` landing page (th/en) that shows the shop name only for an active link and opens the app.

Tests (`pnpm test`, 51 total; files run one at a time):
- PostgreSQL 16.15 on server2 test cluster: 51 passed, 0 failed, 0 skipped.
- PGlite: 44 passed, 7 skipped (concurrency and HTTP end-to-end need a real PostgreSQL connection).
- Covered: forged headers / random bearer → 401; another shop's owner → 403 on every team route and `not_found` for its member ids; technician cannot manage the team; pending sees no customers (RLS); suspend and remove apply on the next request; suspended member cannot reset itself by re-joining; same phone twice → same user; duplicate and concurrent join requests → one membership; 6 concurrent approvals with 3 seats → exactly 3 succeed; OTP attempt limit, cooldown, hourly limit, superseded/expired/used codes; refresh rotation, reuse revokes the session; reset link stops the old token; production refuses the development SMS adapter and short secrets.

Checked by hand (Expo web build + API on the dev database, 2026-10-03): create shop with OTP from the API log → shop ready with link and QR → technician requested through the API → pending blocked with MEMBERSHIP_INACTIVE → owner approved on the team screen (seat count 0 → 1 of 3) → technician reads the shop; admin `/join/<token>` shows the shop name; no console errors.

Not done / remaining:
- No real SMS provider (production OTP answers 503 until one is chosen and an adapter is added).
- No device test, APK/IPA, store links or deferred deep links (install → return to the same shop).
- No QR scanner inside the app (technicians scan with the phone camera, which opens the link).
- Seat limit uses the trial baseline 3 until A03 adds subscriptions.
- Expired OTP challenges and sessions are not purged yet (needs the worker).
- Ownership transfer, multiple owners, account deletion and platform admin login (C02) are not in A02.
- Expo web reaches the API only from origins listed in `ADMIN_ORIGIN`.

How to run locally: `.env` from `.env.example` (OTP_SECRET, JOIN_LINK_KEY, JOIN_LINK_BASE_URL, SMS_PROVIDER=development), `pnpm db:migrate`, `pnpm dev:api`, `pnpm dev:admin`, `pnpm dev:mobile` (set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to an address the phone can reach). The OTP code appears in the API log as `[development SMS]`.

# A03 subscription rules — 2026-10-04

Decisions: [DECISIONS_A03.md](DECISIONS_A03.md). Migration `003_entitlements.sql`.

Done:
- Trial started by a trigger when a shop is created (once per shop); effective entitlement from server time with trialing / active / past_due (grace) / expired / ended / pending_payment / suspended; grants; shop suspension overrides everything.
- Seat limit from the plan; approving or reactivating a technician needs a writable subscription (403 `SUBSCRIPTION_EXPIRED`).
- Paid period rules for C01: continue from the old end before expiry and within grace, start on confirmation after grace, idempotent per invoice, no overlap under concurrency, 31st anchor.
- Storage / OCR reservations with consume-once and release.
- API: `GET /v1/organizations/:id/subscription` (owner: plan, period, limits, usage; technician: state only), `POST …/subscription/cancel-renewal|resume-renewal` (owner).
- Mobile: plan card on the owner home (state, days left, seat / storage / OCR meters, stop/resume renewal for paid plans), banners for past due / expired / pending payment, technician banner when work cannot be saved.
- Dev database on server2: migrated; trial plan added and trials started for the 4 existing shops.

Tests (`pnpm test`, 66 total):
- PostgreSQL 16.15 (server2 test cluster): 66 passed.
- PGlite: 56 passed, 10 skipped (need a real PostgreSQL connection).
- New: trial once (link reset does not restart it), no trial plan → pending_payment, trial expiry without grace, paid period after trial, the commercial-policy renewal example (before expiry / in grace / after grace), 31st anchor and leap year, stop renewal → ended without grace, upgrade to Team → 10 seats, pilot grant, suspension over grant, runtime role cannot create periods or call billing functions, owner vs technician summary, reservations (limit, same key, consume once, release), 30 concurrent OCR reservations → exactly 20, two concurrent renewals chain without overlap, HTTP: expired shop approve → 403 SUBSCRIPTION_EXPIRED while reading still works.

Checked by hand: owner home on Expo web shows "ทดลองใช้ · เหลือ 14 วัน", seats 1/3, storage 0/1 GB, OCR 0/20.

Remaining: payment and invoices (C01), platform publishing/grants/suspension UI (C02), expiry notifications (worker), 24-hour late submission (B04), B-module endpoints must call `auth.require_writable`.

# A04 files, OCR, notifications, worker — 2026-10-04

Decisions: [DECISIONS_A04.md](DECISIONS_A04.md). Migration `004_media_notifications.sql` (adds `ops.notification_deliveries`, `auth.device_tokens`, schema `worker`; needs role `fs_worker`, see `infra/postgres/00-roles.sql`).

Done:
- API: `POST/GET /organizations/:id/media`, `PUT …/media/:id/content` (raw image bytes), `GET /v1/files/<signed token>`, `POST/GET …/ocr-requests`, `GET …/notifications`, `POST …/notifications/read`, `POST /me/devices`, `POST /me/devices/remove`.
- Image processing (sharp): type check by decoding, EXIF rotation, metadata/GPS removed, ≤ 2560 px, ≤ 5 MB, 400 px thumbnail, checksum; storage counted once at stored size.
- Worker process (`pnpm dev:worker`, role fs_worker): OCR queue with retry, push deliveries, subscription reminders, housekeeping.
- Notifications: join request, approval, trial ending, renewal due, overdue, expired/ended, storage 80/95%.
- Mobile: bell with unread count on the home header, notifications screen (text rendered in the reader's language, opening a join request goes to the team tab), offline retry screen at start-up, token refresh no longer signs out on network errors.
- Dev on server2: role fs_worker created, migration 004 applied; the worker runs against the dev database with development OCR/push.

Tests (`pnpm test`, 81 total):
- PostgreSQL 16.15 (server2 test cluster): 81 passed.
- PGlite: 69 passed, 12 skipped (need a real PostgreSQL connection).
- New: worker role isolation, OCR counted once / retries not counted / stale job requeued, notifications once per event and only visible to the recipient, push queue and invalid-token revocation, reminders once per period, storage 80% warning and capped consumption, housekeeping; unit: GPS/EXIF removed, resize, thumbnail, non-image and GIF rejected, signed URL expiry and forgery, storage path traversal, production refuses development OCR/push and missing media secrets; HTTP: upload → ready → signed download without EXIF → tampered link 404 → other shop 403 → bad bytes → failed, OCR through the worker counted once, inbox read/mark read.

Not done: photo picker/camera screens (B02/B04), on-device upload queue, real OCR / push / S3 providers, push token registration in the app (needs a development build).

# B01 customers and locations — 2026-10-04

Decisions: [DECISIONS_B01.md](DECISIONS_B01.md). Migration `005_customers.sql`.

Done:
- API: `GET/POST /organizations/:id/customers` (search by phone digits or name), `GET/PATCH …/customers/:id`, `POST …/customers/:id/archive` (owner), `POST …/customers/:id/locations`, `PATCH …/locations/:id`, `PUT …/locations/:id/coordinates`.
- RLS: restrictive technician scope on customers and locations.
- Mobile: Customers tab for owners and technicians (search, list with location/coordinate status), add customer (phone first, optional name, first location, duplicate choice), customer detail (call, edit, locations, navigate, save location once with permission and review, add/edit location, archive for owners).
- Dev database on server2: migration 005 applied.

Tests (`pnpm test`, 87 total): PostgreSQL 16.15: 87 passed. PGlite: 72 passed, 15 skipped.
- New: owner vs technician visibility, technician cannot create in another member's name, name-or-phone and coordinate-pair constraints; HTTP: phone-only customer with first location, retry → same customer, duplicate warning and confirmed duplicate, search by phone fragment and name, location version conflict, coordinate save → replace needs confirmation → audit keeps the previous value, invalid latitude rejected, technician sees only own customers, other shop 403, expired plan → create 403 SUBSCRIPTION_EXPIRED while listing still works.
- Identity tests now prove tenant access through the shop row instead of customers (technicians no longer see every customer).

Checked by hand on Expo web: create shop → Customers tab → add customer with phone + "บ้าน" + address → detail shows the phone as title, "ยังไม่มีพิกัด", navigate and save-location buttons → list and search by "222-33" find it; a non-matching search shows "ไม่พบลูกค้าที่ค้นหา". GPS capture was not tried on a device yet.

# B02 equipment — 2026-10-04

Decisions: [DECISIONS_B02.md](DECISIONS_B02.md). Migration `006_equipment.sql`.

Done:
- API: `GET/POST /organizations/:id/locations/:locationId/equipment`, `GET/PATCH …/equipment/:id`, `POST …/equipment/:id/photos`. Media download now also allowed for technicians on photos of equipment they can see.
- Mobile: equipment list under each location (thumbnail or category icon, serial), add equipment (nameplate photo → background OCR with suggestions → equipment photo → category chips and fields → duplicate choice → "add another"), equipment detail (photos, add photo from camera/library, edit fields). Uses expo-image-picker (camera permission text in app.json, no microphone).
- API errors outside production now log SQLSTATE, constraint and message (found an over-long constraint name this way).
- Dev database on server2: migration 006 applied.

Tests (`pnpm test`, 88 total): PostgreSQL 16.15: 88 passed. PGlite: 72 passed, 16 skipped.
- New HTTP test: nameplate upload + OCR request, equipment created with photo and OCR link, serial kept as typed, retry → same equipment, accepted_fields recorded, same serial in another format → duplicate warning → confirmed different unit, equipment with only a category, list with thumbnails, version conflict and partial update, technician cannot see other customers' equipment or attach someone else's photo, owner opens technician photos.

Checked by hand on Expo web: customer → "เพิ่มเครื่อง" → water filter, nickname, brand, serial (no photo) → saved → listed under the place with S/N → detail shows type, brand, "ไม่ทราบ" for the missing model. Camera, photo library and GPS were not tried on a phone yet.

# B03 jobs and scheduling — 2026-10-04

Decisions: [DECISIONS_B03.md](DECISIONS_B03.md). Migration `007_jobs.sql` (adds `core.job_state_changes`; core now has 21 tables, 43 in core/billing/platform/ops).

Done:
- API: `GET/POST /organizations/:id/jobs`, `GET/PATCH …/jobs/:id`, `POST …/jobs/:id/assign|unassign|reschedule|cancel|start`.
- RLS: technicians see jobs currently assigned to them and, through an open job, its customer and that location only.
- Notifications: job assigned / moved away / rescheduled / cancelled.
- Mobile: owner Jobs tab (today, upcoming, unassigned), create job (pick customer and place or start from a place in the customer screen; type, details, date/time/duration chips, planned equipment, estimate, technician or "I will do it"), job detail (customer call, navigate, planned equipment, assign/change technician, unassign, reschedule, cancel with reason, start, history). Technician home shows "my jobs". Notifications open the job.
- Mobile session: on 401 the app first adopts tokens another instance stored (second tab, hot reload) before signing out — found when a web session was cleared while the server session was still valid.
- Dev database on server2: migration 007 applied.

Tests (`pnpm test`, 90 total): PostgreSQL 16.15: 90 passed. PGlite: 72 passed, 18 skipped.
- New HTTP tests: create + assign with planned equipment and estimate, retry → same job, technicians cannot plan, technician sees the job, its customer and only the job's location, job_assigned notification, overlapping job → conflict warning, stale version, reassignment → previous technician loses job and customer access and gets job_unassigned, start by assignee only, cancel needs a reason and is owner-only, history scheduled → in_progress → cancelled, cancelled job cannot start; unassigned job without time, assign, reschedule → job_rescheduled, unassign removes access, invalid time rejected, expired plan → SUBSCRIPTION_EXPIRED while reading works.

Checked by hand on Expo web (clicks through the DOM because the window was not drawing): Jobs tab → create job → customer → "I will do it" → repair → confirm → detail shows the appointment tomorrow 09:00, "assigned", history → start → "in progress" with the "service recording comes next" note.

# B04 service records and completing jobs — 2026-10-04

Decisions: [DECISIONS_B04.md](DECISIONS_B04.md). Migration `008_service.sql`.

Done:
- API: `POST /organizations/:id/jobs/:jobId/complete`, `POST …/service-events` (on-site work), `GET …/equipment/:id/history`.
- Next maintenance cycles on completion; bookings fulfilled; owners notified when a job is completed; late submission within 24 hours after the plan ends for jobs started before.
- Mobile: "record service" on a job in progress (units of the place, preselected from the plan, add equipment on the way, per-unit type/result/reason/notes/before-after photos/next maintenance with preview date, summary), success screen with next due dates, technician "record on-site work", equipment history with due date and who did each service.
- Dev database on server2: migration 008 applied.

Tests (`pnpm test`, 93 total): PostgreSQL 16.15: 93 passed. PGlite: 72 passed, 21 skipped.
- New HTTP tests: assignee-only completion with done + not done units and photos, 31 Aug + 6 months → 28 Feb, retry returns the same event, changed body → IDEMPOTENCY_MISMATCH, job history completed, owner notified, unit history with technician name and photos, no cycle for the unit not serviced, all-deferred rejected; next round by another technician keeps the first technician in history and reuses the 6-month schedule, back-dated work leaves the cycle, no-reminder disables the schedule; ad-hoc work creates a completed technician_adhoc job; finishing a job started before expiry works within 24 hours while new work is refused.

Checked by hand on Expo web: in-progress job → record service → pick the water filter, 6 months → finish → "job finished, next 4 April 2570" → equipment history shows the repair by Web Tester and the due date.

# B05 maintenance follow-up and reminders — 2026-10-04

Decisions: [DECISIONS_B05.md](DECISIONS_B05.md). Migration `009_maintenance.sql` (44 tables).

Done:
- API (Owner only): `GET /organizations/:id/maintenance`, `POST …/maintenance/cycles/:cycleId/contacts`, `POST …/maintenance/book`, `POST …/maintenance/cycles/:cycleId/postpone`, `POST …/maintenance/cycles/:cycleId/stop`. New error code `ALREADY_BOOKED`.
- Database: contact log table, cancelled jobs release bookings, `worker.scan_maintenance` (owner reminders per milestone); the worker runs it with the subscription scan.
- Mobile: maintenance card on the Owner home (overdue / 7 days / 30 days counts in rose / amber / teal), due list by bucket, cycle detail (customer, call, place, last service, last contact, booked job), log contact, book a job together with other due units at the same place (time chips, assignee), postpone with reason, stop reminders. Maintenance notifications open the list.
- Dev database on server2: migration 009 applied.

Tests (`pnpm test`, 94 total): PostgreSQL 16.15: 94 passed. PGlite: 72 passed, 22 skipped.
- New HTTP test: owner-only list with buckets, phone and last service; scanning twice sends one `due_soon`; contact logged, bad result rejected; booking two cycles creates one scheduled maintenance job with both units, retry returns the same job, booking again → ALREADY_BOOKED; booking leaves the due date; cancelling the job reopens the cycle; postpone checks the version, is audited and the new date triggers `due`; stop removes the cycle from the list.

Checked by hand on Expo web: home card 0/1/1 → list → cycle detail → book both units tomorrow 09:00, "I'll do it" → opens the scheduled job with both units. Test customer "ลูกค้าทดสอบรอบดูแล" left on the dev shop.

# C01 bank-transfer payments and platform sign-in — 2026-10-04

Decisions: [DECISIONS_C01.md](DECISIONS_C01.md). Migration `010_payments_platform.sql` (48 tables; new role `fs_platform`, schema `padmin`).

Done:
- Shop API (owner only): `GET …/billing/plans`, `GET/POST …/billing/invoices`, `GET …/billing/invoices/:id`, `PUT …/billing/invoices/:id/proof?proof_id=`.
- Platform API: `POST /platform/auth/login|mfa|step-up|logout`, `GET /platform/auth/me`; `GET /platform/billing/invoices`, `GET …/invoices/:id`, `GET …/proofs/:id/file`, `POST …/invoices/:id/confirm`, `POST …/proofs/:id/reject`, `GET …/refunds`, `POST …/payments/:id/refunds`, `POST …/refunds/:id/approve|reject|complete`, `GET …/reconciliation.csv`.
- `scripts/platform-account.mjs` (create / reset / roles / disable / list).
- Mobile (owner): plan card button → choose plan (prices, seats, storage, OCR) → invoice with transfer details and reference → send proof (gallery/camera) → status; payment history; payment notifications open the invoice.
- Console (`apps/admin`, `/console`): sign-in with TOTP, step-up dialog, payment queue, invoice detail with proof image, confirm/reject, refunds, reconciliation CSV.
- Dev database on server2: role `fs_platform` created, migration 010 applied, two development console accounts created (credentials in the git-ignored `.dev-platform-accounts.txt`). `.env` has development `PAYMENT_*` values.

Tests (`pnpm test`, 95 total): PostgreSQL 16.15: 95 passed. PGlite: 72 passed, 23 skipped.
- New HTTP test: technician refused; plans in price order; other plan voids the open invoice; same key same invoice; proof stored and pending without changing the trial; wrong password / unknown email → LOGIN_FAILED; shop token refused by platform routes; replayed TOTP refused; proof image no-store; expired step-up → STEP_UP_REQUIRED; wrong amount → PAYMENT_AMOUNT_MISMATCH; approver cannot confirm; confirm → active Starter, invoice paid, proof accepted, owner notified; retry with the same (normalized) reference → same payment and one paid period; reference reused on the renewal invoice → BANK_REFERENCE_USED; rejected proof notifies the owner; refund over the payment → REFUND_EXCEEDS_PAYMENT; operator cannot approve; an account with both roles cannot approve its own request; approved refund completed; shop stays active; CSV contains payment and negative refund; all audit actions present; UPDATE/DELETE on platform audit refused; fs_api cannot call padmin; fs_platform cannot read billing or customer tables.

Checked by hand: Expo web owner → renew → Team invoice with transfer details; proof sent (test image through the API, since the web picker cannot be automated); console on `localhost:3001/console` → sign-in with TOTP → queue → proof image → confirm → "Payment confirmed. Period 4 Oct 2026 – 4 Nov 2026" on the dev shop.

Remaining: physical-phone check of the camera/gallery proof upload; real receiving account and receipt format from the team.

# C02 platform administration — 2026-10-04

Decisions: [DECISIONS_C02.md](DECISIONS_C02.md). Migrations `011_platform_admin.sql` (49 tables), `012_platform_names.sql`.

Done:
- Platform API: `GET /platform/overview`, `GET /platform/shops`, `GET /platform/shops/:id`, `POST /platform/shops/:id/suspend|restore`, `POST /platform/shops/:id/grants`, `POST /platform/grants/:id/end`, `GET/POST /platform/tickets[/:id]`, `POST /platform/tickets/:id/access`, `GET /platform/access`, `POST /platform/access/:id/approve|reject`, `GET /platform/access/:id/read/:what`, `GET /platform/audit`, `GET /platform/system`, `GET/POST /platform/data-requests[/:id]`.
- Shop API (owner, also while suspended): `GET /organizations/:id/support`, `POST …/support/tickets`, `POST …/support/tickets/:id/messages`, `POST …/support/access/:grantId/consent|refuse|revoke`, `POST …/support/data-requests`. Suspended shops get `ORGANIZATION_SUSPENDED` on other shop routes.
- Mobile: Account → Contact our team (tickets with replies, new ticket, access requests to allow/refuse/revoke with scope, time and read count, data export request); suspended shop screen with the support button; support notifications open it.
- Console: Overview tiles, Shops, Support, Access approvals, Data requests, Audit, System.
- Dev database on server2: migrations 011 and 012 applied.

Tests (`pnpm test`, 96 total): PostgreSQL 16.15: 96 passed. PGlite: 72 passed, 24 skipped.
- New HTTP test: shop search with masked owner phone; detail has no customer content; suspend needs a reason and the permission; suspended shop → ORGANIZATION_SUSPENDED but support reachable; restore returns to the trial; grant over 180 days refused; grant raises seats to 20 and ending returns 3; technician cannot open tickets; internal notes hidden from the owner, reply notifies; access: over 60 minutes refused, no read before approval, approval without consent → OWNER_CONSENT_REQUIRED, technician cannot consent, agent cannot approve, approved read returns masked customers, other scope and other agent refused, read count shown to the owner, revoke stops reads at once, requester with approver role cannot approve own request, expired grant refused; data export single open request and step order enforced; audit readable by the auditor only and contains each action; system health permission; phone-like display names masked.

Checked by hand: app (Expo web) Account → Contact our team → new ticket; console → Overview (1 open ticket, shops by state) → Support → ticket → reply from Dev Operator.

Open item: the Expo web preview lost its stored session once after an API restart (server session not revoked, no refresh recorded); not reproduced, watch for it on devices.

# D pilot readiness (no deployment) — 2026-10-04

Runbook: [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md). Migration `013_pilot_metrics.sql`.

Done:
- API hardening: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on every response (downloads set their own), HSTS in production, `x-powered-by` off, optional `TRUST_PROXY`. Production start logs `CONFIG_MISSING <name>` for each missing setting (SMS, OCR, platform key, payment account, https origins, …), names only.
- Offline drafts: the service form keeps entries (including uploaded photo ids and the client event id) on the device (`expo-file-system`, localStorage on web) until the server confirms; reopening the job restores them with a notice; drafts expire after 7 days. A resend after a lost answer is a replay, never a second record.
- Pilot indicators: `GET /platform/metrics?days=` and the console Overview panel.
- Backup: `infra/backup/backup.sh` (pg_dump custom format + media tar, SHA-256 sums, 35-day retention, optional off-host rsync) and `infra/backup/restore-check.sh` (checksum, restore into a scratch DB, compare tables/rows/migration checksums, drop).
- Capabilities endpoint lists the business modules.

Tests (`pnpm test`, 99 total): PostgreSQL 16.15: 99 passed. PGlite: 74 passed, 25 skipped.
- New: production config check (missing names, complete config, http origin refused); scrypt and RFC 6238 TOTP vector; pilot journey over HTTP — th/en error messages with the same code, customer without coordinates, two-unit job, technician saves the place and records with photos, simulated six months → one due-soon reminder per unit despite two scans, owner logs contact and books both units for technician B (A cannot see it), history keeps A and B, cycles close, renewal confirmed by an operator, support ticket resolved, audit visible to the auditor, metrics count the activity.

Checked by hand:
- server2 (PostgreSQL 16): backup of the dev database 960 KB, restore check `RESTORE OK` in 2 s (53 tables, row counts and migration checksums equal); test files removed afterwards.
- Expo web: service form note kept after reloading the app, restored with the notice, sent, device copy cleared.
- Console Overview with pilot indicators.

Not done (needs people or decisions, see the runbook): production SMS/OCR/push providers, receiving bank account and receipt format, HTTPS domains, off-host backup target, physical Android/iOS testing, staging deployment.

# Follow-up: join account clarity — 2026-10-04

- Join preview now shows the signed-in account phone in th/en and offers sign-out to use another phone. The shop link token is retained after sign-out; joining still uses verified identity and owner approval.
- `pnpm typecheck`: passed for all workspaces.
- `pnpm test` (PGlite): 74 passed, 25 skipped, 0 failed.
- `node --env-file=.env --test --test-concurrency=1 tests/*.test.mjs` on the isolated PostgreSQL 16.15 test endpoint: 99 passed, 0 skipped, 0 failed. Includes shop creation/join/approval, concurrency, service idempotency, and the HTTP pilot journey.
- `pnpm mobile:export`: Android and iOS Hermes bundles exported successfully.
- These checks do not verify the new UI, safe-area layout, camera/gallery, GPS, draft restoration, or API-restart session behavior on a physical phone. Prior Android Expo Go testing is recorded in PROGRESS_LOG.md; those remaining device checks still need confirmation.
- No Git remote is configured; push/PR and production providers/settings remain pending.

# Console completion (017–020) — 2026-10-04

Migrations `017_console_management.sql`, `018_console_operations.sql`, `019_console_privacy.sql`, `020_console_reports.sql` (64 tables). Details: [CONSOLE.md](CONSOLE.md).

Done in this round (020 and follow-ups):
- Restore replay: `worker.replay_erasure(uuid[])` re-erases content for tombstoned shops and shops from the off-database registry, recreates missing tombstones (`source='registry'`) and re-queues image keys even when restored job rows say `succeeded`. Worker keeps `ERASURE_REGISTRY_FILE` (merge-only) and has `replay-erasure` command.
- Erasure now also clears `notifications.sent_snapshot`, `ocr_requests.accepted_fields` and `maintenance_cycles.close_reason` (found by listing every tenant text/jsonb column).
- Finance summary `GET /platform/billing/report?from&to` (≤ 366 days, `billing.read`) + console Reconciliation panel.
- Incident summary `GET /platform/incidents/summary` (`system.read`) on the console Overview.
- Paging (50 + has_more) for shops, invoices and data requests; console pager.
- Approvals show readable details and the target account instead of raw JSON.

Tests:
- New `tests/console-completion.test.mjs` (9): recovery with second approver + newest invitation only; no deciding on own account / one pending change per target; new trial version only for shops after it takes effect (scheduled version waits, one active trial plan); OCR retry (permission, state, deleted image, suspended shop, quota allows exactly the remaining units); Stripe refresh only for open checkouts; finance totals/validation/permission; paging past 50; incident summary order; restore replay with registry.
- PGlite full suite: 164 tests, 137 passed, 27 skipped (PostgreSQL-only HTTP), 0 failed.
- PostgreSQL 16.15 (server2 `16/test`, loopback tunnel): 164 passed, 0 skipped, 0 failed.
- `pnpm typecheck` all workspaces; `pnpm --filter @field-service/admin build` (Next production build) passed.

Checked by hand (isolated QA fixture, synthetic account, API 4101 / web 3101): Overview incident panel (sorted by severity), Reconciliation finance summary, Approvals with readable plan and role details (approve buttons hidden for the requester), Thai labels with Buddhist-era dates, no horizontal overflow at 320 px on Approvals / Reconciliation / Overview / Data requests. Fixture stopped and synthetic token removed afterwards.

Not done: OCR retry concurrency was exercised sequentially in tests (PGlite single connection; the function locks the shop row before counting). Real providers, real money, production migration/deploy and UAT remain pending.

# OCR with the Claude API — 2026-10-04

- `ClaudeOcrProvider` (`@anthropic-ai/sdk` 0.131): image + JSON-schema structured output, effort low, server-side fallbacks. Details and costs: [OCR_CLAUDE.md](OCR_CLAUDE.md).
- `tests/ocr-claude.test.mjs` (mocked client, 4 tests): request shape and media type, cleaned fields / clamped confidence, empty fields omitted, 429/529/connection → temporary, 400/refusal/invalid JSON/empty image → failed, no key → provider off. Config check lists ANTHROPIC_API_KEY when `OCR_PROVIDER=claude`.
- `pnpm typecheck` passed; PGlite full suite 168 tests: 141 passed, 27 skipped, 0 failed.
- Not done: no real API call (no key yet); accuracy on real Thai nameplates not measured.
