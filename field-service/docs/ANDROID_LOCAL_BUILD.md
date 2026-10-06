# Latest local APK — 2026-10-06

0.2.5 / versionCode 7 built successfully from reviewed mobile source 891f731 in D:\kc. First native compilation 14m01s; final source/signing assembly 1m59s, 22 tasks executed and 269 cached. Verify the release branch actually selects signingConfigs.release after every prebuild: Expo's generated template selects debug even when a release signing config exists. Inspect the resulting certificate before delivery. Original EAS certificate verified unchanged.

# Build Android APK locally on Windows

## Verified local APK build — 2026-10-06

Built 0.2.4 / Build 6 successfully on Windows. APK is output/builds/apk/KooChang-0.2.4-build6.apk. Original EAS certificate SHA-256 matches; package/version, staging API in JS and Thai/English company configuration verified. No device run yet.

Important Windows workaround: the first build in the long pnpm isolated workspace failed in Expo CMake/Ninja (`build.ninja still dirty after 100 tries`). Use a dedicated short-path source snapshot D:\kc with `nodeLinker: hoisted` added only to the scratch pnpm-workspace.yaml. Install using the unchanged lockfile and D:\Android\pnpm-store. This preserves the main workspace dependency layout. Source snapshot is b40b210; synchronize a reviewed current source snapshot before a future release instead of assuming this scratch copy is current.

For this tested snapshot, after dot-sourcing the environment script, set `$env:NODE_ENV='production'` and run the generated wrapper under D:\kc\apps\mobile\android:

```powershell
./gradlew.bat app:assembleRelease --console=plain --max-workers=2
```

Signing is configured in the generated app/build.gradle to read the original downloaded EAS credentials.json (ignored) and keystore. Do not print credential values. After any new prebuild, verify release signing still uses the original EAS key, because the stock template uses the debug key. Do not share a debug-signed APK as an upgrade.

First successful build took 21m43s / 291 tasks. Log: D:\Android\downloads\koochang-local-build.log. Dependencies additionally installed Build Tools 35.0.0 and CMake 3.22.1 on D. Later builds can reuse caches, but their duration has not been measured.

## Installed on D — 2026-10-06

User requested installation on D. Installed and verified:

- Temurin JDK 17.0.20.1+1: D:\Android\Java\jdk-17.0.20.1+1 (java and javac run successfully).
- Android command-line tools: D:\Android\Sdk\cmdline-tools\latest (official Windows archive 15859902, SHA-256 verified).
- Android SDK Platform 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake 3.30.5 and Platform Tools (ADB 37.0.1): D:\Android\Sdk.
- SDK licenses accepted during the authorized installation. JDK download SHA-256 verified using official Adoptium metadata.
- User JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT, GRADLE_USER_HOME and PATH configured for D paths, preserving prior PATH. Open a new terminal/app to inherit them; for the existing Codex session dot-source the environment script below.
- Gradle cache: D:\Android\gradle-cache. Installer temporary files were placed in D:\Android\temp. Downloads retained in D:\Android\downloads.
- Doctor checks all pass; java/javac/adb/cmake/clang execute successfully. No emulator needed for producing APKs.
- Follow-up: original EAS signing credentials downloaded privately, native project generated, and local Release APK built successfully. See verified build above.

## Original readiness audit — 2026-10-06

Checked this Windows machine using scripts/android-build-doctor.ps1. Node 24.19.0, pnpm, Git, ADB and Android Build Tools 36.0.0 are available. Java/Javac are not available from PATH or JAVA_HOME; Android Studio folders exist, but its bundled java.exe was not found. SDK has Android 35, but the installed React Native 0.86.3 needs Android 36 and NDK 27.1.12297006. Command-line SDK Manager and NDK were absent. No SDK/JDK software installed in this audit.

C: free ~18.7 GB; D: free ~87.2 GB. Prefer D:\Android\Sdk and D:\Android\gradle-cache for new downloads. Do not move/delete the existing SDK automatically.

## Required setup

1. Install a full JDK 17 (Java runtime and compiler). Example using Windows package manager: `winget install --id EclipseAdoptium.Temurin.17.JDK --exact`. Confirm its installed path and `java -version` / `javac -version`.
2. Repair/install Android Studio if necessary, or install official Android command-line tools. In SDK Manager select SDK location D:\Android\Sdk, install Android SDK Command-line Tools (latest), Platform Tools, Android SDK Platform 36, Build Tools 36.0.0, NDK (Side by side) 27.1.12297006 and CMake 3.30.5. Accept Android SDK licenses yourself after reading them. An emulator is optional when building an APK for a physical phone.
3. Use the original Android keystore from EAS. Do not generate a replacement key: it would prevent installing over the current APK. Run `eas credentials -p android`, choose staging-apk, and download the existing credentials (do not select a new keystore). Store the keystore/passwords privately; never put passwords in command logs or Git. The existing EAS credentials were downloaded locally on 2026-10-06 and remain Git-ignored.
4. Configure Gradle release signing to read the existing keystore and alias/passwords from private local configuration. Do not distribute a release APK signed with the generated debug key. The prebuild template defaults must be inspected and replaced before a release build.

Expo EAS `build --local` does not officially support Windows. Use Expo prebuild + Gradle on Windows instead. No global Gradle installation is needed: the generated project has a wrapper (installed Expo template specifies Gradle 9.3.1).

## Prepared commands

Run from the workspace root after installing tools, replacing JDK_PATH with the actual installed path:

```powershell
. ./scripts/android-build-env.ps1 -JavaPath 'D:\Android\Java\jdk-17.0.20.1+1' -SdkPath 'D:\Android\Sdk'
./scripts/android-build-doctor.ps1 -JavaPath $env:JAVA_HOME -SdkPath $env:ANDROID_HOME
pnpm build:packages
```

The environment script only changes the current terminal. It sets the staging API explicitly and puts Gradle cache on D. It does not install tools, modify system/user environment variables or read signing secrets.

After the doctor is green, generate native files from the current Expo configuration:

```powershell
Set-Location apps/mobile
pnpm exec expo prebuild --platform android --no-install
```

Do not use `--clean` on an existing native directory without reviewing any local changes. Configure and inspect release signing, then:

```powershell
Set-Location android
./gradlew.bat app:assembleRelease
```

APK location: apps/mobile/android/app/build/outputs/apk/release/app-release.apk. Verify package com.koochang.app, version/versionCode and certificate match the existing EAS APK before sharing. Android native directory, credential files and signing keys are ignored by Git. Run SDK licensing and an actual build before calling this machine ready. First build still downloads Gradle/Maven dependencies; no EAS queue is involved. iOS still needs a Mac/Xcode.

## Sources

- https://docs.expo.dev/build-reference/local-builds/
- https://docs.expo.dev/guides/local-app-production/
- https://reactnative.dev/docs/set-up-your-environment
- SDK/NDK/build tools versions verified from installed React Native gradle/libs.versions.toml; CMake default from ReactAndroid/build.gradle.kts; Gradle wrapper from installed Expo template.tgz.
