# Pilot runbook (stage D) — 2026-10-04

What is needed to run a pilot with real shops, what the code already does, and what still needs a
decision or a person. This is not a deployment script and grants no credentials.

## 1. Before the first shop

| Gate | State | Owner of the decision |
|---|---|---|
| Server with PostgreSQL 16, roles from `infra/postgres/00-roles.sql` (fs_migrator, fs_api, fs_worker, fs_platform; none superuser/BYPASSRLS) | Ready to apply; verified on server2 dev | Team |
| Migrations `pnpm db:migrate` (001–024), no seed in production | Ready | Team |
| API start prints `CONFIG_MISSING <name>` for every production setting not set (names only); each missing feature answers 503 | Done | — |
| SMS provider for OTP (`SMS_PROVIDER`) | **DeeSMSx chosen and adapter implemented** — account keys/approved sender and authorized live delivery verification pending; see [DEESMSX.md](DEESMSX.md) | Business |
| OCR provider (`OCR_PROVIDER=claude`, `ANTHROPIC_API_KEY`) | **Chosen: Claude API** (2026-10-04), code ready; needs the API key and an accuracy check on real nameplates — see [OCR_CLAUDE.md](OCR_CLAUDE.md) | Team (key), Business (model/cost) |
| Push provider (`PUSH_PROVIDER=fcm`, `FCM_SERVICE_ACCOUNT_FILE`) | **Chosen: FCM, Android first** (2026-10-05), code ready; needs final package name, Firebase project and a development build — see [PUSH_FCM.md](PUSH_FCM.md). Without it pushes are skipped, inbox works | Business (package name), Team (Firebase) |
| Receiving bank account (`PAYMENT_*`) confirmed by the team | **Not set** — owners cannot create invoices until set | Business |
| EasySlip (`EASYSLIP_API_KEY`, `PAYMENT_BANK_CODE`, `SLIP_DATABASE_URL`) | Provider chosen; integration implemented; real credentials/account registration and live checks pending — see [EASYSLIP.md](EASYSLIP.md) | Team |
| Platform Stripe account (console Payment settings), webhook, PAYMENT_DATABASE_URL / OWNER_WEB_URL | QR PromptPay/card integration implemented; real account/onboarding and test/live verification pending — see [STRIPE.md](STRIPE.md) | Team |
| Receipt / tax document format | Not decided (invoices carry snapshots; no receipt PDF yet) | Business/accounting |
| Final prices | Seed values are pilot proposals (Starter 590, Team 1,290 THB/month) and labelled as such | Business |
| Two different people for refunds (requester ≠ approver) | Enforced by code; needs two staff accounts | Team |
| HTTPS domain for API, console and join links (`JOIN_LINK_BASE_URL`, `ADMIN_ORIGIN`) | Not set up | Team |
| Off-host backup target | Cloudflare R2, encrypted with rclone crypt (`OFFSITE_RCLONE=r2crypt:`, chosen 2026-10-07) | Team |
| Physical Android/iOS test: camera, gallery, GPS button, offline draft, push | **Not done** (only Expo web/Go so far) | Team |

## 2. Platform accounts

Create with the operator script on the server (prints password and TOTP secret once; store them in
the team's password manager, never in chat):

```
node --env-file=.env scripts/platform-account.mjs create --email person@company --name "Name" --roles billing_operator
node --env-file=.env scripts/platform-account.mjs list
node --env-file=.env scripts/platform-account.mjs disable --email person@company
```

Roles: super_admin, platform_admin, billing_operator, billing_approver, support_agent, operations,
auditor. Give each person only what they do. Disabling revokes sessions at once.

## 3. Daily work in the console (`/console`)

- Valid EasySlip payments activate the shop immediately and appear as paid. **Payments → Proofs to check** handles exceptions: read the automatic verification reason, open the proof, compare with the bank statement (amount, receiver,
  reference), enter the bank reference and time → *Confirm money received*. A wrong amount is refused
  and stays for an exception decision. Target: within 1 business day.
- Stripe QR/card payments activate after verified provider confirmation. Payment settings need payments.manage and step-up; Stripe exceptions in the payment queue require reconciliation with Stripe. Console refund records do not execute Stripe refunds.
- **Refunds**: operator requests, a different approver approves, operator records the transfer reference.
- **Support**: reply within 1 business day (Mon–Fri 09:00–18:00). Internal notes are not shown to the shop.
  Need to look at shop data? *Request access* (scope, 5–60 min, reason) → owner allows in the app →
  a platform admin approves → read. Every view is logged; the owner can revoke.
- **Data requests**: follow the export runbook, record approved → running → succeeded.
- **Overview**: queues and the pilot indicators (time to record, history coverage, maintenance follow-up,
  active shops/technicians, trial conversion, storage, OCR).
- **Audit** (auditor): who did what, with reasons.

## 4. Background worker

`node --env-file=.env apps/api/dist/worker.js` as a service (role fs_worker): OCR queue, push
deliveries, subscription and maintenance reminders every 15 minutes, housekeeping. Several workers
are safe (SKIP LOCKED); reminders are deduplicated per event.

## 5. Backups (internal targets RPO 24 h, RTO 8 h — not promised to shops)

On the database host, daily from cron (as root):

```
15 2 * * * BACKUP_DIR=/var/backups/field-service DB_NAME=field_service MEDIA_DIR=/srv/field-service/media OFFSITE_TARGET=... /opt/field-service/infra/backup/backup.sh
```

Weekly, and before taking real money: `BACKUP_DIR=/var/backups/field-service /opt/field-service/infra/backup/restore-check.sh`
must print `RESTORE OK`.

**After a real restore** (not the check): before opening the API run
`node --env-file=.env apps/api/dist/worker.js replay-erasure` with `ERASURE_REGISTRY_FILE` pointing at
the erasure registry kept outside the database backup, then start the worker so restored images of
deleted shops are removed again. Without the registry only tombstones inside the restored dump are
replayed. Record the run in Operations tools → evidence (kind `restore`). Proven on server2 (PostgreSQL 16) on 2026-10-04: dump 960 KB, restore 2 s,
53 tables, row counts and migration checksums matched. Retention 35 days.

### Off-site copy (Cloudflare R2, encrypted)

One-time, on the backup host as root: `apt-get install -y rclone`, then
`R2_ACCOUNT_ID=<id> R2_BUCKET=koochang R2_PREFIX=<env> infra/backup/setup-offsite-r2.sh`.
It asks for an R2 API token (Object Read & Write, this bucket only), creates the `r2` and `r2crypt`
remotes, checks a round trip and that R2 sees only encrypted names, and prints the two crypt
passwords once. **Keep those passwords outside the server** (password manager): they are the only
way to read the copies. Then add `OFFSITE_RCLONE=r2crypt:` to the backup cron line. Copies older than
`OFFSITE_RETENTION_DAYS` (90) are deleted from R2.

Restore on another machine: install rclone, recreate the same two remotes (`rclone config create r2 s3 ...`
with a token, `rclone config create r2crypt crypt remote r2:koochang/<env> password <p1> password2 <p2> --obscure`),
`rclone copy r2crypt: ./restore --include "*-<stamp>.*"`, check `sha256sum -c sums-<stamp>.sha256`, then restore as above.

## 6. Incidents

API down or `/v1/ready` failing → check PostgreSQL and `CONFIG_MISSING` lines; worker queue growing →
System page (OCR oldest queued, push failures); suspected data exposure → suspend the shop only if it
is a security case (reason required, audited), revoke support grants, collect the platform audit.
Record what happened, impact and timeline (no incident module yet: use the team's document).

## 7. What the pilot measures

From Overview → Pilot indicators (30 days): median minutes from opening the service form to saving,
share of equipment with history, due cycles that were booked or done, active shops and people
recording service, trials converted to paid, total storage and OCR (cost per shop).
