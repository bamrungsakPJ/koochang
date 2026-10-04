# Nameplate OCR with the Claude API — 2026-10-04

Decision (user, 2026-10-04): nameplate reading uses the Claude API.

## How it works

- Technician photographs the nameplate → image is stored privately → an OCR request is queued
  (quota reserved) → the worker sends the image to Claude → suggestions (brand, model, serial,
  all legible text, confidence) are saved → the technician confirms or edits before saving.
- Code: `apps/api/src/ocr/ocr.provider.ts` (`ClaudeOcrProvider`), Anthropic TypeScript SDK.
- Request: image (base64, JPEG/PNG/WebP detected from the bytes) + fixed prompt, structured output
  with a JSON schema (`output_config.format`), `effort: low` (extraction is simple), server-side
  `fallbacks: "default"` so a policy decline is retried on Anthropic's recommended model.
- Empty fields are left out; the model is told not to guess. Suggestions never overwrite equipment
  data on their own (same rule as before).

## Errors

| Situation | Result |
|---|---|
| Rate limit (429), server/overload (5xx), network/timeout | Temporary → worker retries (max 3 attempts), quota not used |
| Bad request, wrong key (401/403), refusal, invalid output, empty image | Job fails, quota released, manual entry continues |
| `OCR_PROVIDER=claude` without `ANTHROPIC_API_KEY` | Provider off → OCR endpoints answer 503 (fail closed) |

SDK client: 60 s timeout, 2 SDK retries for 429/5xx before the worker's own retry.

## Settings (server only)

```
OCR_PROVIDER=claude
ANTHROPIC_API_KEY=...            # secret, never in the app or git
OCR_CLAUDE_MODEL=claude-opus-5   # optional; default claude-opus-5
```

The API start check lists `ANTHROPIC_API_KEY` when Claude OCR is selected without a key.

## Cost and privacy

- Default model `claude-opus-5` ($5 / $25 per million input/output tokens). One nameplate photo
  (resized upload) is roughly 1,000–1,600 input tokens plus a short JSON answer, so on the order of
  US$0.01 per read; measure with real photos before setting prices. A cheaper model can be set
  with `OCR_CLAUDE_MODEL` if accuracy holds on real nameplates — that is a business decision.
- Shop quotas (`ocr_per_period` per plan) still cap usage per shop.
- Images are sent to Anthropic for processing. Nameplate photos should show only the plate; the
  privacy notice for shops should mention that an AI service reads nameplate photos.

## Not done

- No call to the real API yet (needs a key and approval). Tests use a mocked client.
- Accuracy on real Thai nameplate photos not measured yet; build a small sample set first.
