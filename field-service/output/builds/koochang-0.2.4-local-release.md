# KooChang 0.2.4 — local Windows APK

- Status: BUILD SUCCESSFUL on Windows, 2026-10-06 Asia/Bangkok.
- Source snapshot: b40b210fb6a0a2dbf5bb19e50fb583fcf3412fb7 (HEAD:field-service).
- Version: 0.2.4 / versionCode 6; package com.koochang.app.
- APK: output/builds/apk/KooChang-0.2.4-build6.apk (ignored by Git).
- Size: 75,553,519 bytes.
- SHA-256: a3917c388edd7b7e8e9e07d6d74848bd68f589deb55c43559508da51ab7913cf.
- Certificate SHA-256: 4eed94856fe8200e9f9f1b71c296be0f9e43c323549ef1584f110b3b7fd4f7f9; matches existing EAS Android credentials.
- APK Signature Scheme v2 verified with Android apksigner.
- ABIs: arm64-v8a, armeabi-v7a, x86, x86_64.
- Verified staging API string in bundled JS: https://api-staging.koochang.com.
- Verified assets/app.config version and company exactly match apps/mobile/app.json, including Thai Unicode and English company names.

First attempt in the main pnpm isolated workspace failed during Expo native CMake/Ninja with long-path warnings and `manifest build.ninja still dirty after 100 tries`. A fresh source snapshot under D:\kc with pnpm nodeLinker: hoisted and the unchanged lockfile succeeded. Original workspace dependency layout was retained. Shared packages rebuilt, Expo prebuild generated native files, and release signing was configured to read ignored credentials.json. Private credentials and keystore are NOT committed.

Second attempt: Gradle 9.3.1 / JDK 17, app:assembleRelease --max-workers=2, 291 tasks, 21m43s. Build log retained locally at D:\Android\downloads\koochang-local-build.log. Gradle installed Build Tools 35.0.0 and CMake 3.22.1 on D for dependencies, in addition to previously installed tools.

No device install/run or real AI reading test was performed. Certificate/version checks support upgrade compatibility; actual installation remains to be verified on a device. The EAS build is independent and was not cancelled.
