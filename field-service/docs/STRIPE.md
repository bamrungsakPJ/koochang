# Stripe platform payments — 2026-10-04

The platform console has **Payment settings** for its own Stripe account. Shop owners can select
**PromptPay QR Code** or **credit/debit card** on their invoice in `/shop` and the mobile app.
The existing transfer/EasySlip option remains available when its receiver is configured.

The implementation uses the official `stripe` SDK, pinned to **23.0.0**, with its default API version
**2026-09-30.endive**. Hosted Checkout receives one invoice amount in THB, with
`allowed_payment_method_types` restricted to the owner's selected method. Payment details are
entered at Stripe; the API never receives card numbers. These are one-time payments for the existing
monthly plan period, not automatic recurring card charges. PromptPay uses Checkout **payment** mode;
[Stripe's PromptPay documentation](https://docs.stripe.com/payments/promptpay) does not support
Checkout subscription/setup mode for this method.

## Platform setup

1. Apply migration **015_stripe.sql** with fs_migrator; never seed production. There are now 52
   core/billing/platform/ops tables. Runtime role restrictions and FORCE RLS remain in place.
2. Set server-only `PAYMENT_DATABASE_URL` to an **fs_worker** login (NOSUPERUSER/NOBYPASSRLS).
   Use `PLATFORM_SECRET_KEY` (32-byte base64) to encrypt Stripe keys in the database. It must remain
   available across restarts and backups, just like the existing sealed platform TOTP secrets.
3. Set `OWNER_WEB_URL` to the trusted `/shop` URL. Production requires HTTPS; development accepts
   localhost/127.0.0.1 HTTP only. The browser cannot supply a return URL. The return includes invoice
   and organization IDs, allowing an existing owner session to restore the correct shop.
4. In `/console` → **Payment settings**, copy the displayed webhook path and prefix the API's HTTPS
   origin. Register that endpoint in the same Stripe account/mode as the secret key. Subscribe to
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed` and `checkout.session.expired`.
5. Enter both the Stripe secret key (`sk_test_...` or `sk_live_...`) and endpoint signing secret
   (`whsec_...`). The API checks the Stripe account and shows its account ID and mode. Enable card
   and/or QR both here and in Stripe Dashboard. PromptPay requires a Thai account and THB. Live
   enabled methods require an account able to charge; complete Stripe onboarding first.
6. Saving requires `payments.manage` and TOTP step-up. Default super_admin/platform_admin roles
   have that permission; billing operators and shop users cannot manage settings. Saved keys never
   return to the UI. They are not stored in browser storage or Expo/Next public environment variables.

There is no publishable-key setting because hosted Checkout is used. Bank payout/account identity
and payment-method activation are managed in Stripe Dashboard. The bank receiving fields for
EasySlip remain server settings; this screen reports whether that transfer channel is configured.

Test mode is labelled in both owner clients. **Production cannot offer test mode or activate a shop
from a test callback**, even for a checkout created with old credentials. No real Stripe account,
key, charge, onboarding, live transfer, deployment or manual UAT was configured in this work session.

## Payment confirmation

- Creating Checkout never opens shop access. A signed webhook or owner-triggered status refresh
  retrieves the canonical Checkout Session from Stripe. The success-page redirect alone is not
  evidence of payment, as explained in [Stripe's fulfillment guide](https://docs.stripe.com/checkout/fulfillment).
- Validate invoice/org/attempt/credential metadata, client reference, payment mode and live/test
  mode. Only `payment_status=paid`, exact invoice amount and THB can activate.
- Payment, paid invoice, checkout state, subscription period, platform audit and owner notification
  commit atomically. If period application fails, everything rolls back and Stripe can retry delivery.
- Invoice detail and reconciliation show **Stripe** as verifier, a `STRIPE:pi_...` reference and the
  gross invoice amount. Stripe fees, payout timing and net settlement remain in Stripe Dashboard.
- Owner web checks pending sessions immediately after return and every ten seconds. Mobile opens
  Checkout in the browser and refreshes when the app returns to foreground, with a manual status
  button. The hosted success URL points at owner web; returning to the native app uses the device's
  normal app switch/back flow. Native deep-link return and real-device UX have not been verified.
- Declined/failed payments grant nothing. Expired/cancelled sessions allow a new method. A verified
  payment never lifts an independent platform security suspension.

## Retry, switching and exceptions

One active checkout per invoice and row locks prevent simultaneous QR/card sessions. Owners can
cancel the active session before changing method. A pending proof blocks Stripe checkout, and an
active checkout blocks a new EasySlip proof. An active checkout also prevents replacing its invoice
with another plan underneath it.

Checkout creation has a stable server-generated attempt ID, fixed amount/metadata/expiry and Stripe
idempotency key. Unknown network failures keep that attempt for retry; definitive request errors
mark it failed. Paid callbacks and status refreshes cannot create a second payment or paid period.
Initial expiry is pinned to 35 minutes after attempt creation. Provider timeout is 20 seconds with
one SDK network retry; a crash before attaching a session can be recovered from its signed webhook.

Amount/currency mismatches, duplicate references or payment arriving after an invoice was already
paid enter **manual_review**, visible in the admin queue even when the invoice is paid. The console
shows the session/payment intent and reason. Operators reconcile those exceptional funds in Stripe;
they are not automatically added to the shop's period or automatically refunded.

Stripe refunds/disputes/payout synchronization are **not** implemented in this change. Existing
two-person manual refund records remain available, but they do not call Stripe's refund API. Any
Stripe Dashboard refund must be reconciled by the team; do not treat a console record as proof that
Stripe executed a refund. This feature adds receiving payments and activation, not recurring billing
or a settlement accounting system.

Credential changes require entering both keys and registering the displayed **new** webhook path.
Each checkout pins its original credential revision. Old encrypted credentials and webhook routes
are retained so pending sessions can finish after a rotation/account switch. Keep the old Stripe
endpoint active until those sessions are settled. Changing only the enabled methods retains the
current endpoint and applies to new checkouts; existing sessions can still finish.

## Verification and operations

Webhook JSON is captured as raw bytes (`rawBody: true`) and checked by the SDK's `constructEvent`
with a 300-second signature tolerance. Invalid/stale/tampered signatures are rejected. Endpoint paths
identify a credential revision but are not authentication; the signature is mandatory. Server/API and
Stripe clocks must be synchronized. Failed delivery remains retryable; there is no additional
scheduled Stripe polling/reconciliation worker in this change.

Tests mock SDK account/Checkout API calls, use SDK-generated signatures and run actual SQL/roles in
isolated PGlite/PostgreSQL databases. An HTTP test confirms exact raw-body handling. Real PostgreSQL
checks concurrent preparation/confirmation. Tests also cover encryption/no returned secrets,
permissions/version conflict, retry parameters, cross-shop denial, Stripe-only invoicing, unpaid and
test-mode rejection, suspension/rollback, paid-invoice exceptions, cancellation and pending-session
completion after credential rotation. QA child processes strip `PAYMENT_DATABASE_URL` to avoid
inheriting a payment connection.

Before live launch, explicitly validate the platform's test Stripe account, card/3DS, bank QR scanning,
failed/expired payments, webhook delivery, device return UX, credential rotation and reconciliation.
