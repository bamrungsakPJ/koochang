# Verification — 2026-10-03

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
