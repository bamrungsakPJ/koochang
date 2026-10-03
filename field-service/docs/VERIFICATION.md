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
