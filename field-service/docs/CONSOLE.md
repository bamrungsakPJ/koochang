# Platform console

The platform uses `/console` with its own email/password + mandatory authenticator login.
Shop sessions and platform sessions remain separate. Thai and English are available throughout.

## Available workspaces

- **Overview**: queues, shops by state, pilot indicators and open incidents (accounts with `system.read`).
- **Shops** (50 per page, search by name/ID/last four phone digits), subscription history, security
  suspension and temporary grants.
- **Plans and prices**: drafts → approval → immutable published version (monthly and/or yearly
  price, seats, storage, OCR, trial and grace days, effective time). A new version applies to new
  invoices and new trials only; issued invoices and running periods keep their snapshot. Only one
  active trial plan; archive needs `plans.publish`.
- **Staff**: invite with a one-use 48-hour link (password + authenticator on enrolment), disable /
  enable, sign out devices, role changes and account recovery through **Approvals**. Recovery
  clears password and MFA after a second person approves; then **Create new invitation link**
  (each new link revokes the previous one).
- **Approvals**: role, recovery, plan and policy requests shown as readable details (who, which
  account, new roles, prices, policy values). Requester and approver must differ; nobody approves
  a change about their own account.
- **Payments** (50 per page), proof exceptions, invoice details, refunds (two people),
  **Reconciliation**: CSV per Bangkok day and a **finance summary** (received, refunded, net, by
  confirmation channel / plan / day, unpaid invoices, pending refunds, paying shops; ≤ 366 days).
- Support tickets, owner-consented temporary data access, audit and system health.
- **Data requests** (50 per page): owner export (encrypted JSON, 24 h, owner download only),
  closure and deletion with legal holds, retention/cooling policy, unsettled-payment block and a
  second person to execute. Erasure keeps financial documents and shared user identities.
- **Operations tools**: dated backup/restore/API/storage/OCR/webhook evidence, retry failed push
  deliveries and failed OCR (quota re-reserved once; not for deleted images or shops that cannot
  write), refresh a Stripe checkout through the trusted service, outbox view.
- **Announcements and incidents**: scheduled bilingual announcements by audience (published text
  is immutable; withdraw only) and incident timelines.
- **Stripe settings**, **Platform settings** (bank, DeeSMSx, EasySlip, service on/off),
  **System policy** (new shops / new payments, retention and cooling days — two people) and
  **My account** (name, language, password, sessions).

## Setup and runtime behavior

Apply migrations **001–020** using fs_migrator (64 core/billing/platform/ops tables).
Platform functions use the separate fs_platform connection in `PLATFORM_DATABASE_URL`.
`settings.manage` belongs to super_admin/platform_admin; Stripe uses `payments.manage`.

Create the first account with `scripts/platform-account.mjs`; there is no public signup/default
admin. Production still needs HTTPS, `PLATFORM_SECRET_KEY`, authentication/storage configuration
and trusted worker connections. Infrastructure credentials remain server-only.

Saved console values override environment values, including disabled services. Before a section
is first saved, it uses the environment configuration. Blank keys keep existing credentials;
replacing DeeSMSx keys requires both keys. Keys never return to the browser or audit; only
configured status is shown. Settings apply on the next request without restarting the API.

No provider test button sends a billable message/payment. Provider verification still requires
an authorized real account. See [DEESMSX.md](DEESMSX.md), [EASYSLIP.md](EASYSLIP.md) and
[STRIPE.md](STRIPE.md). Stripe needs PAYMENT_DATABASE_URL and trusted OWNER_WEB_URL;
automatic slip confirmation needs SLIP_DATABASE_URL (both database logins must be fs_worker).

Bank changes affect new invoice snapshots. Existing invoices keep their original account.

Sensitive actions require TOTP step-up (5 minutes). Versions prevent lost updates; **Reload latest
settings** after a conflict.

### Erasure and restore

Deletion writes a tombstone and queues image keys; the worker deletes the bytes. Set
`ERASURE_REGISTRY_FILE` for the worker to a path **outside the database backup** (e.g. a separate
disk or the off-site target): the worker keeps the list of erased shops there and the file never
shrinks. After restoring any database backup, before opening the API:

```
ERASURE_REGISTRY_FILE=/srv/field-service-registry/erasure.json node --env-file=.env apps/api/dist/worker.js replay-erasure
```

This re-erases business content for every shop in the database tombstones or the registry,
recreates missing tombstones and queues the image keys again; then start the worker normally so
restored image bytes are deleted. **Download erasure ledger** in Data requests gives the same list.

OCR/Push provider integration, automatic Stripe subscriptions, Stripe API refunds/disputes/payout
sync and production deployment are not part of the console. Refund and data-request records follow
operational runbooks; they do not silently trigger provider transactions.

## Developer verification

Build the API, then `node --test --test-concurrency=1 tests/console-*.test.mjs` with mocked providers.
For PostgreSQL use guarded loopback TEST_DATABASE_URL ending in `_test`. Browser fixture:

```powershell
$env:CONSOLE_QA='1'
node --env-file=.env scripts/owner-web-test-server.mjs
```

This recreates only the isolated owner_web test database, generates synthetic console credentials
and starts API 4101 / web 3101. Real provider credentials are stripped; console/worker connections
point to the test database. Stop it when done. Do not run concurrently with PostgreSQL HTTP tests:
both temporarily change passwords on test-cluster roles.
