# AndroScrn Phase 6 — Android Camera Companion Report

Date: 2026-10-21. Branch: `audit/master-audit-fixes` (uncommitted changes on top of `6b4517e`). Nothing was committed or pushed.

## Executive summary

The repository already had a companion app (Kotlin/CameraX/NanoHTTPD) and a desktop client, but it was not integrated: the desktop never installed or launched it, the UI showed fake success (mock stream token, fake "2450 KB" photo), and the app had a security hole (TCP server reachable by every app on the phone), broken frame conversion, a torch command that ignored its argument and a lens command that did nothing.

Phase 6 kept that architecture (embedded MJPEG preview over ADB), hardened and finished it, and integrated it end to end in the desktop app:
- **Android:** a new transport, validated protocol v2, an on-demand camera lifecycle, a status UI, and 30 JVM tests.
- **Desktop:** install, launch and handshake management, an honest UI, and 46 new Node assertions.
- **Build:** a reproducible APK build and packaging step.

**The companion has not been verified on the phone.** Installation was blocked by the phone's "Install via USB" setting, and the user chose to skip the hardware tests. So no claim is made that live camera video reaches Camera Studio; that remains the main open item.

## Original architecture found

See [docs/companion/ARCHITECTURE.md](docs/companion/ARCHITECTURE.md#architecture-found-before-phase-6). Option A (scrcpy) cannot render inside Electron, so the existing companion (Option B) was kept.

## Defects found and fixed

| # | Defect | Root cause | Fix | Test |
|---|---|---|---|---|
| C1 | Any app on the phone could connect to the companion and attempt pairing | NanoHTTPD on TCP `127.0.0.1:8080` is reachable by all local apps | Abstract UNIX socket with UID check (shell/root only); INTERNET permission removed | companion.test §14 (source), device test BLOCKED |
| C2 | Distorted/green frames on most devices | NV21 built by concatenating plane buffers, ignoring row/pixel strides | `YuvConverter` with stride handling and buffer reuse | CameraPipelineTest |
| C3 | Preview rotated 90° | Analysis frames in sensor orientation | CameraX output rotation enabled (upright portrait) | Code; device test BLOCKED |
| C4 | Camera ran whenever the app was open | Bound in `onCreate` | Bound only on `start_camera`; stopped on stop/disconnect/idle watchdog/app hidden | SessionTrackerTest, RouterTest |
| C5 | `set_torch` toggled regardless of `enabled` → desktop/phone desync | Handler called `toggleTorch()` | `setTorch(enabled)`; boolean required | ProtocolTest |
| C6 | `set_camera` returned success without switching | Stub handler | Rebinds the requested camera | RouterTest (fake camera) |
| C7 | Unbounded memory: photo map, frame copies | `HashMap` photo store, stream re-sent stale frames | ≤3 photos, single download; one-frame buffer, only newer frames sent | RouterTest, CameraPipelineTest |
| C8 | Unlimited PIN brute force by requesting new challenges | Only per-challenge limit | 5 challenges / 5 min; lockout consumes the challenge; constant-time compare | PairingManagerTest |
| C9 | Desktop never installed or launched the app | Missing feature | `CompanionManager` (install check, explicit install, launch, forward, handshake) | companion-manager.test; real-phone read-only path |
| C10 | UI claimed "Pairing approved! Live studio feed active" with a mock stream URL and a fake photo size | Mock fallbacks in production handlers | Removed; "Streaming" only after the first decoded frame; stream loss detected | Playwright runtime run |
| C11 | Fixed PC port 8080 (conflicts) and client default to `127.0.0.1:8080` | Hard-coded port | `adb forward tcp:0`; client has no default target | companion-manager.test |
| C12 | Requests could hang | No timeouts in the client | 3–15 s timeouts on every request | companion-manager.test (timeout path) |
| C13 | Gradle failed with "Invalid file path" | `local.properties` written with backslashes | Documented forward-slash `sdk.dir` | Build passes |
| C14 | Starting the companion while scrcpy camera runs (or vice versa) would fail on "camera in use" | No coordination | Each stops the other first | Code review; device test BLOCKED |

## Features

Implemented:
- **Camera:** enumeration with runtime ids and facings, start and stop, switching by facing or id, zoom, torch, still photo, and an MJPEG preview inside Camera Studio.
- **Pairing and safety:** PIN pairing, a live banner on the phone, permission handling without prompt loops, and an idle watchdog.
- **Install and connection:** an install/update offer, Xiaomi install-restriction guidance, and protocol version checks.
- **Lifecycle:** clean stop on quit, and manual reconnect.

Not implemented, and why:
- **Background capture or a foreground service:** Android restricts background camera use, and keeping the app on screen is simpler and visible to the user.
- **Audio:** not required for a camera preview.
- **H.264 transport:** MJPEG is sufficient and needs no decoder.
- **Automatic reconnect loop:** a manual Reconnect avoids hidden retry loops.
- **Release signing:** no keystore exists, and none was invented.
- **Instrumentation tests:** no emulator or device was available.

## Build and test results (after the final change)

| Check | Result |
|---|---|
| `gradlew assembleDebug testDebugUnitTest` (via `npm run build:companion`) | BUILD SUCCESSFUL; 30/30 Android unit tests |
| `npm run typecheck` | 0 errors |
| `npm run test:unit` | 1306/1306 pass (1 unrelated opt-in skip) |
| `npm run test:integration` | 39/39 |
| `npm run build` | pass |
| `npm run docs:check` | pass |
| Playwright on real Electron + real phone | Companion: bundle detected, not-installed + install offer, no errors. Regression: Try Again console, mirroring start/stop, no leftover processes or forwards |

## APK artifact

`bin/companion/androscrn-companion.apk` — package `com.androscrn.companion`, versionName `1.0.0-alpha.2`, versionCode 2, protocol 2, debug variant, 6,815,875 bytes, SHA-256 `2c28019460ce3aaaaf36d70597aabfe0d2f513156c0bbdf24c8947170cf3cdc9`, built from the working tree on top of `6b4517e`. Metadata: `bin/companion/androscrn-companion.json`.

## Physical-device validation

The phone (21091116I, Android 13, HyperOS OS1.0.13.0) rejected `adb install` with `INSTALL_FAILED_USER_RESTRICTED` three times: once as a baseline, and once with consent through `CompanionManager`. In both runs `persist.security.adbinstall` was unset and the phone was locked. `pm list packages --user all` showed no companion in the Owner or XSpace profiles. All 15 companion device tests are **BLOCKED**; see [docs/companion/TEST_MATRIX.md](docs/companion/TEST_MATRIX.md).

## Security and compatibility limitations

See [Security model](docs/companion/ARCHITECTURE.md#security-model) and [Known limitations](docs/companion/ARCHITECTURE.md#known-limitations). In short:
- Anyone with this PC's ADB key can reach the companion, which is the same trust model as scrcpy.
- The app must stay on screen while streaming.
- The build is debug-signed only.

## Remaining blockers / next actions

1. On the phone: enable Developer options → "Install via USB" (Mi account), keep it unlocked, then run the [manual device test](docs/companion/DEVELOPMENT.md#manual-device-test) and fill in TEST_MATRIX rows 1–15.
2. Add instrumentation tests (CameraX bind, permission flow) once a device or emulator with a camera is available.
3. `bin/companion/` is git-ignored (decided at commit time): the APK is rebuilt with `npm run build:companion`. Add a release signing config (and ideally a CI build) before distributing.

## Changed files

Android (modified): `android/companion/app/build.gradle.kts`, `app/src/main/AndroidManifest.xml`, `MainActivity.kt`, `security/PairingManager.kt`, `res/layout/activity_main.xml`, `res/values/colors.xml`, `res/values/strings.xml`, `src/test/.../security/PairingManagerTest.kt`.
Android (replaced, deleted): `camera/CameraManager.kt` → `camera/CompanionCamera.kt`; `server/CompanionHttpServer.kt` → `server/CompanionServer.kt` + `server/Router.kt`.
Android (new): `camera/CameraBackend.kt`, `camera/FrameBuffer.kt`, `camera/YuvConverter.kt`, `protocol/Protocol.kt`, `protocol/HttpRequest.kt`, `session/SessionState.kt`, `res/drawable/card_bg.xml`, tests `camera/CameraPipelineTest.kt`, `protocol/ProtocolTest.kt`, `server/RouterTest.kt`, `session/SessionTrackerTest.kt`.
Desktop (modified): `apps/desktop/electron/main.ts`, `apps/desktop/electron/preload.ts`, `apps/desktop/src/App.tsx`, `modules/companion_client/index.ts`, `package.json` (`build:companion`), `packaging/portable/package-portable.ps1`, `tests/unit/companion.test.ts`, `tests/unit/runner.ts`.
Desktop (new): `modules/companion_client/manager.ts`, `scripts/build-companion.js`, `tests/unit/companion-manager.test.ts`.
Artifacts/docs (new): `bin/companion/androscrn-companion.apk`, `bin/companion/androscrn-companion.json`, `docs/companion/ARCHITECTURE.md`, `DEVELOPMENT.md`, `PROTOCOL.md`, `TEST_MATRIX.md`, this report.
Local only (git-ignored): `android/companion/local.properties`.


## Update — physical-device validation (2026-10-21, after manual install)

The user installed the companion from the phone's file manager (alpha.2). Builds 3 and 4 were then installed with `pm install` from `/data/local/tmp` at the user's request; `adb install` remains blocked by Xiaomi "Install via USB", and AndroScrn does not use the `pm install` route automatically because it sidesteps that phone setting.

**Now verified on the phone:**
- **Preview:** live camera video appears inside the Camera Studio page. It is upright, 720×960, with correct colours and aspect ratio.
- **Controls:** back/front lens switching, zoom, torch, and a 2.3 MB full-resolution photo saved to Captures.
- **Camera lifecycle:** stop and start, background-and-return recovery, and USB unplug-and-replug recovery.
- **Session end:** the Disconnect button works, and desktop quit releases the phone camera (confirmed by Android's camera service log).
- **Coexistence:** screen mirroring runs alongside the companion, and the companion hands the camera to scrcpy when the scrcpy camera starts.
- **Updates and security:** the 2 → 3 update offer works, and the UID gate rejects another app (uid 10411).

**Additional defects found on hardware and fixed:**

| # | Defect | Fix |
|---|---|---|
| D1 | Desktop kept showing a frozen frame and "Streaming" after the phone ended the stream (Chromium fires no `<img>` error) | 2 s status poll while the camera runs |
| D2 | ADB forward left behind when the app quits via `app.quit()` | Cleanup in `before-quit`, bounded to 2 s |
| D3 | Zoom slider capped at 8× (camera supports 10×) | Uses the phone's `maxZoom` |
| D4 | Phone stuck on "Camera unavailable" after returning to the foreground | Reset on resume and on pairing (build 3) + JVM test |
| D6 | Phone viewfinder kept the last frame after stop | Dark cover while the camera is off (build 4) |
| D7 | Duplicate Connect/Reconnect buttons after a lost stream | Only Reconnect shown |

**Still open:**
- **D5:** one unexplained companion photo, not reproduced afterwards.
- **Permission-denial path on hardware:** not run.
- **Instrumentation tests:** none yet.
- **Release signing:** none exists.

**Current artifact:** `bin/companion/androscrn-companion.apk`, 1.0.0-alpha.4 (versionCode 4), 6,832,386 bytes, SHA-256 `ff64974b64846e692ba1e14329fff8dfb525840f8001d87560f3bda1933dbae4`. It is also copied to `/sdcard/Androscrn/AndroScrn-Camera-1.0.0-alpha.4.apk` on the phone.

**Final results:**
- Android: 31/31 JVM tests.
- Desktop: typecheck 0 errors, 1306/1306 unit tests, 39/39 integration tests.
- Build and docs check pass.
- No leftover scrcpy or Electron processes, and no ADB forwards.
