# Build Android APK locally on Windows

## Readiness audit — 2026-10-06

Checked this Windows machine using scripts/android-build-doctor.ps1. Node 24.19.0, pnpm, Git, ADB and Android Build Tools 36.0.0 are available. Java/Javac are not available from PATH or JAVA_HOME; Android Studio folders exist, but its bundled java.exe was not found. SDK has Android 35, but the installed React Native 0.86.3 needs Android 36 and NDK 27.1.12297006. Command-line SDK Manager and NDK were absent. No SDK/JDK software installed in this audit.

C: free ~18.7 GB; D: free ~87.2 GB. Prefer D:\Android\Sdk and D:\Android\gradle-cache for new downloads. Do not move/delete the existing SDK automatically.

## Required setup

1. Install a full JDK 17 (Java runtime and compiler). Example using Windows package manager: `winget install --id EclipseAdoptium.Temurin.17.JDK --exact`. Confirm its installed path and `java -version` / `javac -version`.
2. Repair/install Android Studio if necessary, or install official Android command-line tools. In SDK Manager select SDK location D:\Android\Sdk, install Android SDK Command-line Tools (latest), Platform Tools, Android SDK Platform 36, Build Tools 36.0.0, NDK (Side by side) 27.1.12297006 and CMake 3.30.5. Accept Android SDK licenses yourself after reading them. An emulator is optional when building an APK for a physical phone.
3. Use the original Android keystore from EAS. Do not generate a replacement key: it would prevent installing over the current APK. Run `eas credentials -p android`, choose staging-apk, and download the existing credentials (do not select a new keystore). Store the keystore/passwords privately; never put passwords in command logs or Git. This download has NOT been performed.
4. Configure Gradle release signing to read the existing keystore and alias/passwords from private local configuration. Do not distribute a release APK signed with the generated debug key. The prebuild template defaults must be inspected and replaced before a release build.

Expo EAS `build --local` does not officially support Windows. Use Expo prebuild + Gradle on Windows instead. No global Gradle installation is needed: the generated project has a wrapper (installed Expo template specifies Gradle 9.3.1).

## Prepared commands

Run from the workspace root after installing tools, replacing JDK_PATH with the actual installed path:

```powershell
. ./scripts/android-build-env.ps1 -JavaPath 'JDK_PATH' -SdkPath 'D:\Android\Sdk'
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
