# AndroScrn Camera Companion — Development

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| JDK | 17 or newer (Android Studio's bundled JBR 21 works) | `JAVA_HOME`, or the build script finds `C:\Program Files\Android\Android Studio\jbr` |
| Android SDK | platform 34, build-tools 34+ | `android/companion/local.properties` with `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk` (use forward slashes; backslashes are escape characters in this file) |
| Gradle | 8.14.3 via the wrapper | first build downloads dependencies; later builds work with `--offline` |
| Node.js | as for the desktop app | for the staging script and desktop tests |

## Build and stage the APK

```bash
npm run build:companion
```

This runs `gradlew assembleDebug testDebugUnitTest` in `android/companion`, then copies the APK to `bin/companion/androscrn-companion.apk` and writes `bin/companion/androscrn-companion.json` (package, versionCode, versionName, protocolVersion, SHA-256, size, build time, git commit). The desktop refuses an APK whose bytes do not match the recorded SHA-256 or whose metadata names another package. The portable packager copies `bin/companion` when it exists. `bin/companion/` is git-ignored: the APK is a reproducible build output (6.8 MB, debug-signed), so run `npm run build:companion` after cloning or changing the Android code; until then Camera Studio reports that no companion APK is bundled.

Release builds (`node scripts/build-companion.js --release`) need a signing config; none is committed. Add one locally (keystore outside the repo, passwords from environment variables) before using `--release`.

## Tests

Android JVM unit tests (protocol, HTTP parser limits, YUV conversion, frame buffer, session generations, pairing, router auth and validation):

```bash
cd android/companion
./gradlew testDebugUnitTest
```

Results: `android/companion/app/build/test-results/testDebugUnitTest/`. There are no instrumentation tests yet; they need a device or emulator with a camera.

Desktop tests (CompanionManager with a fake ADB and a local fake status server, client defaults, legacy client suite):

```bash
npm run test:unit
```

## Bump the version

1. Increase `versionCode` and `versionName` in `android/companion/app/build.gradle.kts`.
2. If the wire format changes incompatibly, increase `Protocol.VERSION` (Kotlin), `COMPANION_PROTOCOL_VERSION` (`modules/companion_client/manager.ts`) and `PROTOCOL_VERSION` (`scripts/build-companion.js`) together, and update [PROTOCOL.md](PROTOCOL.md).
3. `npm run build:companion`.

## Manual device test

1. Phone: Developer options → USB debugging on; on Xiaomi/Redmi/POCO also "Install via USB" (Mi account sign-in required) and keep the phone unlocked.
2. AndroScrn → Camera Studio → Companion → **Connect to Companion**. If it says not installed, click **Install companion app** and confirm on the phone if asked.
3. Allow camera access on the phone when asked.
4. Type the PIN shown on the phone → the camera starts → the preview should show live video and the badge "Streaming".
5. Try lens switch, zoom, torch, photo (saved in Captures), Stop camera / Start camera, unplug and Reconnect, and Disconnect.

Useful commands (bundled ADB):

```bash
bin/scrcpy-win64/adb.exe shell dumpsys package com.androscrn.companion
```

```bash
bin/scrcpy-win64/adb.exe logcat -s CompanionServer CompanionCamera CompanionMain
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `INSTALL_FAILED_USER_RESTRICTED` | Xiaomi "Install via USB" off, phone locked, or the on-phone prompt was dismissed |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | An app with the same package but another signing key is installed; uninstall it on the phone manually (AndroScrn never does) |
| `protocol_mismatch` | Old (v1) companion installed; use the update offer |
| `not_ready` | App not in front, phone locked, or the control socket failed (see the app's status screen) |
| "Camera is in use by another app" | A scrcpy camera session or another camera app holds the camera |
| Preview stops when switching apps on the phone | Expected: Android forbids background camera use; reopen the app and click Reconnect |
| Gradle `Invalid file path` | `local.properties` `sdk.dir` uses backslashes; use forward slashes |
