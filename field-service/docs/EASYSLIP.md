# EasySlip immediate payment verification — 2026-10-04

The receiving account and encrypted EasySlip key can now be set in `/console` → Platform settings.
Console values override environment values without restart. Existing invoices retain their receiver
snapshot; provider registration and the fs_worker connection remain required. See [CONSOLE.md](CONSOLE.md).

The owner uploads a private slip from `/shop` or the mobile app. The API immediately calls
[EasySlip v2](https://document.easyslip.com/en/v2/verify/bank/image) using multipart `image`,
`matchAccount=true`, `matchAmount` in baht, `checkDuplicate=true` and the invoice ID as `remark`.
There is no mock provider in the deployed API and the endpoint is fixed to EasySlip HTTPS.

Valid results confirm payment, mark the invoice paid and proof accepted, apply the paid period,
append the platform audit and notify the owner in one database transaction. The upload response
contains the paid invoice and period, so both owner clients show the result immediately. Current
authorization reads the database entitlement; a shop does not need to sign in again. Security
suspension remains in force independently of payment.

## Before enabling real payments

1. Apply migration `014_easyslip.sql` with the normal migrator. Never use development seed in production.
2. Register/link the receiving account in the EasySlip branch that owns the API key.
3. Configure server-only `EASYSLIP_API_KEY` and `SLIP_DATABASE_URL` (login role **fs_worker**,
   NOSUPERUSER/NOBYPASSRLS). Keep `DATABASE_URL` as fs_api and platform credentials separate.
4. Configure `PAYMENT_BANK_NAME`, `PAYMENT_ACCOUNT_NAME`, `PAYMENT_ACCOUNT_NUMBER`,
   `PAYMENT_BANK_CODE` (three-digit bank code, preserving leading zeros) and optional
   `PAYMENT_PROMPTPAY_ID`. New invoices freeze these values; later account changes do not rewrite them.
5. Keep API, PostgreSQL and bank clocks synchronized. With explicit authorization, verify a real
   transfer from each supported bank, including masked receiver formats and PromptPay, before launch.
   Keys belong in the server's secret environment, never in the browser/mobile build or chat.

Code and synthetic tests are implemented. No real API key/account registration, charged provider
request, live transfer, deployment or human UAT was verified in this session.

## Acceptance and exception handling

- EasySlip must return a new slip, matching exact THB amount, Thai country code, a valid unique
  transaction reference and transfer time at/after invoice creation (future tolerance 60 seconds).
- The registered matched account number and both bank codes must equal the frozen receiver.
  Because provider matching also uses name similarity, visible bank-account digits must corroborate
  the expected number. PromptPay can corroborate a configured NATID/MSISDN instead. Require matching
  length and at least four visible digits; unsupported/ambiguous masks go to admin instead of granting access.
- Images are validated, stripped of metadata and stored privately. EasySlip receives the processed
  JPEG. Images over its 4 MiB limit go to review. Provider requests time out after 20 seconds; no blind
  HTTP retry spends quota or risks a duplicate verdict.
- Wrong amount/account/currency/date, duplicates, unreadable/pending bank slips, quota errors,
  incomplete responses, missing settings and network errors remain `pending` in the existing admin
  queue. The owner and console show a localized `verification_code` explaining the problem.
- Missing trusted database settings leave the proof at `CONFIGURATION`. If the API crashes or the
  result transaction fails after claim, `CHECKING` stays pending and visible to admin; operators can
  inspect the slip and bank statement. No unattended background retry is configured.
- Existing invoices with no receiver snapshot are conservative: the displayed previous channel can
  remain available, but automatic verification falls back to admin. Do not retroactively infer a receiver
  for previously submitted proofs.

Admin confirms exceptional payments against the bank statement through the existing permission/MFA
flow. Refunds still require separate requester and approver. Automatic payments identify the verifier
as EasySlip in invoice detail and reconciliation CSV; `verified_by` is null and `verification_source`
is `easyslip`, rather than impersonating an admin account.

## Replay and permissions

`proof_id` binds immutable processed bytes to a single invoice/shop before the object is written.
Reusing it with different bytes returns conflict without overwriting the saved image. Retrying the
same upload after a successful payment returns the existing paid invoice, without another provider
call or subscription extension. Only one attempt can claim each proof; subsequent exceptional
attempts are handled by admin or a new proof after rejection.

Global bank-reference uniqueness, invoice/proof locks, a transaction-reference advisory lock and
the existing one-payment/one-period constraints prevent duplicate activation. fs_api cannot execute
the trusted `worker.claim_slip` or `worker.finish_slip` functions. Persisted provider evidence excludes
raw QR payload and sender details; the private uploaded slip remains available to authorized reviewers.

Tests use mocked HTTP responses at the provider boundary and isolated migrated PGlite/PostgreSQL
databases. Run `node --test tests/easyslip.test.mjs` after API build, or supply the guarded loopback
`TEST_DATABASE_URL` to exercise real PostgreSQL concurrency. HTTP/owner-browser QA fixtures remove
EasySlip keys and trusted payment database credentials from their child processes.
