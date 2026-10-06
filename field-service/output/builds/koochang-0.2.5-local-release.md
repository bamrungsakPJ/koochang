# KooChang 0.2.5 / Build 7 — local signed Android APK

- Source: 891f731; staging API/console deployed 1d77395, migration 027.
- Artifact: apk/KooChang-0.2.5-build7.apk (ignored); 75,700,232 bytes.
- SHA256: e890e260544ea945b5aff0bac0b33c5de8b529343639ceef6cf3a13970ef7a76.
- Certificate SHA256: 4eed94856fe8200e9f9f1b71c296be0f9e43c323549ef1584f110b3b7fd4f7f9 (original EAS key).
- Verified com.koochang.app / versionName 0.2.5 / versionCode 7 / all four ABIs / USE_BIOMETRIC, staging API and module in bundle, company Thai/English exact.
- Removes version/About UI. Nameplate local preview, upload/read/result/error states, per-field suggestions and same-photo upload retry. Direct native ArrayBuffer upload.
- Atomic session in SecureStore with legacy restore and network failure preservation; biometric opt-in under Account on cold launch, password fallback. No password stored.
- Console > Platform settings > AI nameplate reading: encrypted Anthropic key/model/enable, version conflict and step-up. API/worker use saved configuration immediately. Staging development reader disabled; no key configured yet.
- Typechecks/Next build pass, mobile session/transport tests 6 pass, Claude mocked 4 pass, console 9 pass. PostgreSQL upload/OCR/auth/worker checks pass across original and targeted corrected-fixture runs (see VERIFICATION.md).
- Not yet tested on an actual device or with real Anthropic credentials. User will enter key in console; scan/camera/library require device check.
