# Push notifications with Firebase Cloud Messaging (Android first)

The user chose FCM directly (2026-10-05), starting with Android. iOS comes later through the same
Firebase project by adding an APNs key; until then iOS device tokens are skipped.

Push is only a nudge. Every notification is already in the in-app inbox (`core.notifications`);
when push is off, fails or the phone has no permission, nothing is lost.

## How it works

1. The app (development build or store build, **not Expo Go**) asks for notification permission
   after sign-in (Android 13+ shows the system prompt once), gets the FCM device token and calls
   `POST /me/devices { token, platform: 'android' }`. A rotated token is re-registered.
2. `core.notify()` queues one `ops.notification_deliveries` row per active device of the recipient.
3. The worker claims deliveries (`worker.claim_deliveries`, SKIP LOCKED), renders the text from the
   shared catalog in the recipient's language and sends an FCM HTTP v1 message:
   `notification {title, body}`, `data {organization_id, target_type, target_id}`, Android
   channel `default`, high priority. Lock-screen text carries no customer details.
4. Tapping a push reloads memberships and opens that shop's inbox; the app re-checks access.
5. Sign-out calls `POST /me/devices/remove` first. Migration 024 also skips queued deliveries whose
   token was revoked or now belongs to someone else (shared phone), so a previous account's push
   never reaches the next person.

Outcomes: `UNREGISTERED` / `SENDER_ID_MISMATCH` → token revoked; 429 / 5xx / network / expired
access token → retried with backoff (up to 5 attempts); `INVALID_ARGUMENT` and other 4xx → failed
without revoking the token (a payload bug must not revoke every device).

## What the team needs to provide

1. Android package name: **`com.koochang.app`** (decided 2026-10-05 with the product name
   KooChang / คู่ช่าง). Firebase registers the app by this name; it cannot change after the Play
   Store release.
2. A Firebase project (free) with an Android app for that package name:
   - `google-services.json` → for the app build. Locally put it at `apps/mobile/google-services.json`;
     on EAS Build upload it as the file variable `GOOGLE_SERVICES_JSON`. It is git-ignored.
   - Project settings → Service accounts → *Generate new private key* → a JSON file for the worker.
     Keep it on the server only (e.g. `/etc/field-service/fcm-service-account.json`, mode 600, owned
     by the worker user). Never commit it or put it in the mobile app.
3. A development build or APK (EAS Build) to test on a real phone — Expo Go cannot receive pushes.

## Server settings (worker)

```dotenv
PUSH_PROVIDER=fcm
FCM_SERVICE_ACCOUNT_FILE=/etc/field-service/fcm-service-account.json
```

Restart the worker after setting them; its start line shows `push=fcm`. If the file is missing or
unreadable the worker runs with `push=none` and deliveries are marked `skipped`. Production API
start lists `PUSH_PROVIDER` / `FCM_SERVICE_ACCOUNT_FILE` under `CONFIG_MISSING` until set.
Development keeps `PUSH_PROVIDER=development`, which only logs `[development push] …`.

## Verified so far

- Unit tests with a fake Google endpoint (`tests/push-fcm.test.mjs`): JWT signed with the service
  account key and checked against its public key, access token cached and renewed, exact HTTP v1
  payload, iOS skipped, error mapping above, network failure retried.
- Database (`tests/worker.test.mjs`): revoked and reassigned tokens are not claimed; the current
  holder still receives theirs. PGlite and PostgreSQL 16.
- Mobile: typecheck and Android bundle export pass.

Not done: no real Firebase project, no real push sent, no device test (needs the items above).
