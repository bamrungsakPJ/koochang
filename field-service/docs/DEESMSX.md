# DeeSMSx OTP

The user selected DeeSMSx. The API creates/verifies OTP challenges with the existing expiry,
cooldown, attempt limits and hashed codes; DeeSMSx delivers the Thai/English message.

Keys and sender can now be configured in `/console` → Platform settings → SMS / OTP.
Console values override environment values and apply on the next request without restart;
disabling the service overrides environment keys. See [CONSOLE.md](CONSOLE.md).

Set server-only values in the deployment secret store:

```dotenv
SMS_PROVIDER=deesmsx
DEESMSX_API_KEY=<account API key>
DEESMSX_SECRET_KEY=<account secret key>
DEESMSX_SENDER=<approved sender name>
```

Keep these out of Git and public/mobile environment variables. Restart the API after setting them.
Missing values disable OTP requests with 503 and are reported by name in production diagnostics.
Local development may retain `SMS_PROVIDER=development`; it only logs messages and is prohibited
in production. No actual keys have been configured or real SMS sent during this implementation.

The sender posts JSON to the fixed HTTPS `/v1/SMSWebService` endpoint with `apiKey`, `secretKey`,
`sender`, `to` (E.164 without `+`) and `msg`. Redirects are rejected, timeout is 10 seconds and
there is no automatic retry after ambiguous delivery, to avoid duplicate billable messages.
Provider failures return a generic 503; the production sender never logs codes, secrets or responses.

The published response schema specifies HTTP 200 and a JSON object, but no required success fields.
The adapter treats this as API acceptance, not proof of phone delivery. Delivery status callbacks,
credit monitoring and delivery receipts are outside this change. An unsuccessful request still
consumes its existing OTP cooldown; the user can request a new code after that cooldown.

Before enabling real delivery, obtain account keys and approved sender, then verify one authorized
Thai/English OTP delivery and error handling with that account. The provider documentation says
trial users cannot use the API.

Source: [DeeSMSx Send SMS API](https://deesmsx.readme.io/reference/getting-started-with-your-api).
