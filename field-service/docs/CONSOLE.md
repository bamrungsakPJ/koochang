# Platform console

The platform uses `/console` with its own email/password + mandatory authenticator login.
Shop sessions and platform sessions remain separate. Thai and English are available throughout.

## Available workspaces

- Overview, shops, subscription history, security suspension and temporary grants.
- Payments, proof exceptions, invoice details, reconciliation and two-person refund records.
- Support tickets, owner-consented temporary data access, data requests, audit and system queues.
- **Stripe settings**: account, test/live mode, card/PromptPay toggles, encrypted secret/webhook
  keys, full webhook URL and reload after a version conflict.
- **Platform settings**: receiving bank/account/three-digit code/optional PromptPay identifier;
  DeeSMSx sender + encrypted API/secret keys; EasySlip encrypted key; enable/disable each service.
- **My account**: name and language, password change, active session list and sign out other
  devices. Email and roles remain managed by the existing operator account tool.

## Setup and runtime behavior

Apply migrations **001–016** using fs_migrator. There are 53 core/billing/platform/ops tables.
Platform functions use the separate fs_platform connection in `PLATFORM_DATABASE_URL`.
New `settings.manage` belongs to super_admin/platform_admin; Stripe uses `payments.manage`.
Every complete platform session can manage its own profile.

Create the first account with `scripts/platform-account.mjs`; there is no public signup/default
admin. Production still needs HTTPS, `PLATFORM_SECRET_KEY`, authentication/storage configuration
and trusted worker connections. Infrastructure credentials remain server-only.

Saved console values override environment values, including disabled services. Before a section
is first saved, it uses the environment configuration. Blank keys keep existing credentials;
replacing DeeSMSx keys requires both keys. Keeping environment keys during a first save copies
them into encrypted storage. Keys never return to the browser or audit; only configured status
is shown. Settings apply on the next request without restarting the API.

No provider test button sends a billable message/payment. Provider verification still requires
an authorized real account. See [DEESMSX.md](DEESMSX.md), [EASYSLIP.md](EASYSLIP.md) and
[STRIPE.md](STRIPE.md). Stripe needs PAYMENT_DATABASE_URL and trusted OWNER_WEB_URL;
automatic slip confirmation needs SLIP_DATABASE_URL (both database logins must be fs_worker).

Bank changes affect new invoice snapshots. Existing invoices keep their original account so
existing slips are verified against the original receiver. Disabling a bank prevents that channel
on new invoices; existing invoices can still be settled to their pinned account.

Settings, password changes and session revocation require TOTP step-up. Versions prevent lost
updates; **Reload latest settings** after a conflict. Password changes require the current password
and a different 12–200 character password. Wrong-password attempts use the account lockout.
Other sessions, including unfinished sign-ins, are revoked; the current session remains.
SQL account functions require a complete session bound to the same active account.

OCR/Push provider integration, automatic Stripe subscriptions, Stripe API refunds/disputes/payout
sync and production deployment are not part of this change. Existing refund/data-request records
follow operational runbooks; they do not silently trigger provider transactions.

## Developer verification

Build the API, then `node --test tests/console-settings.test.mjs` with mocked providers.
For PostgreSQL use guarded loopback TEST_DATABASE_URL ending in `_test`. Browser fixture:

```powershell
$env:CONSOLE_QA='1'
node --env-file=.env scripts/owner-web-test-server.mjs
```

This recreates only the isolated owner_web test database, generates synthetic console credentials
and starts API 4101 / web 3101. Real provider credentials are stripped; console/worker connections
point to the test database. Stop it when done. Do not run concurrently with PostgreSQL HTTP tests:
both temporarily change passwords on test-cluster roles.
