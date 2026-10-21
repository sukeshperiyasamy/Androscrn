# AndroScrn Camera Companion — Test Matrix

Run date: 2026-10-21. Environment: Windows 11, Node 22.12, Electron 31, JDK 21 (Android Studio JBR), Android SDK 34, Gradle 8.14.3. Device: Xiaomi Redmi Note 11 Pro+ 5G (21091116I), Android 13, HyperOS OS1.0.13.0, serial kjizrsgekfsglvgi. Companion APK 1.0.0-alpha.2 (versionCode 2, debug), SHA-256 `2c28019460ce3aaaaf36d70597aabfe0d2f513156c0bbdf24c8947170cf3cdc9`.

Status values: VERIFIED ON HARDWARE, VERIFIED AT RUNTIME (real app/process, no phone camera involved), AUTOMATED (JVM/Node tests; mocks are labelled), BLOCKED, NOT RUN.

## Android (JVM unit tests, `gradlew testDebugUnitTest`: 30/30 pass)

| Feature | Expected | Test | Result | Status |
|---|---|---|---|---|
| Control command parsing | Valid commands parsed; bad types/values rejected with codes | ProtocolTest (2 tests) | Pass | AUTOMATED |
| Torch honours requested state (regression) | `set_torch` requires boolean `enabled` | ProtocolTest | Pass | AUTOMATED |
| HTTP parser limits | 400/405/413/431/501 for malformed, oversized, chunked | ProtocolTest (2 tests) | Pass | AUTOMATED |
| YUV_420_888 → NV21 with padded rows and interleaved chroma (regression) | Exact bytes, buffer reuse, odd sizes rejected | CameraPipelineTest (3) | Pass | AUTOMATED |
| Bounded frame buffer | Only newest frame kept; waiters woken; clear ends streams | CameraPipelineTest (2) | Pass | AUTOMATED |
| Stale camera callbacks | Late result of an older start/stop ignored; 50 start/stop cycles consistent | SessionTrackerTest (4) | Pass | AUTOMATED |
| Pairing | PIN, token, lockout, single use, expiry, challenge rate limit | PairingManagerTest (10) | Pass | AUTOMATED |
| Router auth/validation | All protected endpoints 401 without token; stream 409 before camera; photo single download; permission denial → 403; disconnect revokes token | RouterTest (7, fake camera) | Pass | AUTOMATED (mock camera) |
| Instrumentation (launch, permission, CameraX bind, capture) | — | No emulator/system image installed; device install blocked | — | NOT RUN |

## Desktop (Node, `npm run test:unit`: 1306/1306 pass, 1 skipped unrelated)

| Feature | Expected | Test | Result | Status |
|---|---|---|---|---|
| APK resolution | Valid staged APK found; tampered bytes, wrong package, bad version, missing metadata rejected | companion-manager.test | Pass | AUTOMATED |
| Install state / forward port parsing | dumpsys and `forward tcp:0` output parsed; garbage rejected | companion-manager.test | Pass | AUTOMATED |
| Install failure mapping | USER_RESTRICTED, UPDATE_INCOMPATIBLE (no auto-uninstall), device lost, timeout | companion-manager.test | Pass | AUTOMATED |
| Explicit install only | No `adb install` without consent; never uninstall/clear | companion-manager.test (fake ADB) | Pass | AUTOMATED (mock ADB) |
| Install verification | adb "Success" without new versionCode → `install_unverified` | companion-manager.test | Pass | AUTOMATED (mock ADB) |
| Full prepare path | checking→installing→launching→connecting→ready; `install -r`; `forward tcp:0 localabstract:androscrn_companion` | companion-manager.test with local fake status server | Pass | AUTOMATED (mock ADB + fake server) |
| Protocol mismatch | v1 app rejected | companion-manager.test | Pass | AUTOMATED |
| Readiness timeout / stale session | Bounded; superseded prepare creates no forward | companion-manager.test | Pass | AUTOMATED |
| Client has no default port (regression) | No request before a forward exists; loopback-only base URL | companion-manager.test | Pass | AUTOMATED |
| Android server security (source checks) | Abstract socket, UID gate, no TCP/INTERNET | companion.test §14 | Pass | AUTOMATED |

## Runtime (real Electron app and real ADB)

| Feature | Expected | Test | Result | Status |
|---|---|---|---|---|
| Bundled APK detected by the app | 1.0.0-alpha.2, protocol 2 | Playwright on Electron, `companionGetBundleInfo` | As expected | VERIFIED AT RUNTIME |
| Not-installed detection on the real phone | "not installed" + Install offer, no preview, nothing installed without a click | Playwright click "Connect to Companion" | As expected; package still absent afterwards | VERIFIED ON HARDWARE (read-only path) |
| Install restriction reporting | Xiaomi guidance shown | `CompanionManager.prepare(serial, true)` with real ADB | `INSTALL_FAILED_USER_RESTRICTED` mapped to the "Install via USB" guidance | VERIFIED ON HARDWARE (failure path) |
| No leftovers | No adb forwards, no scrcpy processes after runs | `adb forward --list`, tasklist | Empty / 0 | VERIFIED AT RUNTIME |
| Existing features unaffected | Try Again console, mirroring start/stop, process cleanup | Playwright regression run | Pass | VERIFIED ON HARDWARE |
| APK build from current source | APK + metadata staged with SHA-256 | `npm run build:companion` | Pass | VERIFIED AT RUNTIME |

## Physical device acceptance (companion running on the phone)

All BLOCKED: the phone rejected installation with `INSTALL_FAILED_USER_RESTRICTED` (Developer options → "Install via USB" not enabled; phone locked), and the user chose to skip hardware tests.

| # | Test | Status |
|---|---|---|
| 1 | Fresh installation through the app | BLOCKED |
| 2 | Upgrade from existing install | BLOCKED |
| 3 | Launch and readiness handshake | BLOCKED |
| 4 | Permission grant / denial | BLOCKED |
| 5 | Camera discovery (`/capabilities`) | BLOCKED |
| 6 | Actual capture | BLOCKED |
| 7 | Live video in Camera Studio preview | BLOCKED |
| 8 | Camera switching | BLOCKED |
| 9 | Repeated start/stop | BLOCKED |
| 10 | Disconnect during streaming | BLOCKED |
| 11 | Reconnect and recovery | BLOCKED |
| 12 | Interaction with screen mirroring | BLOCKED |
| 13 | Desktop shutdown releases camera | BLOCKED |
| 14 | Companion process cleanup | BLOCKED |
| 15 | Restart after failure | BLOCKED |
| — | UID gate rejects other apps / accepts adb forward | BLOCKED (needs the app on a device) |

Next step: enable "Install via USB" on the phone (Mi account sign-in), keep it unlocked, then follow [DEVELOPMENT.md](DEVELOPMENT.md#manual-device-test).

## Update: physical-device run after manual install (2026-10-21, later)

The user installed `AndroScrn-Camera-1.0.0-alpha.2.apk` from the phone's file manager (copied to `/sdcard/Androscrn/` with `adb push`; SHA-256 matched). This supersedes the BLOCKED rows above where listed.

| # | Test | Result | Status |
|---|---|---|---|
| 1 | Fresh install via `adb install` | Still blocked by "Install via USB"; manual install worked | BLOCKED (adb path) / done manually |
| 3 | Launch + readiness handshake | `am start`, `forward tcp:0 localabstract:androscrn_companion`, protocol 2 in 485 ms | VERIFIED ON HARDWARE |
| 4 | Permission | Granted on first launch by the user; denial not re-tested | PARTIAL |
| 5/6/7 | Capture and live video inside Camera Studio | Upright 720×960 MJPEG, correct colours and aspect, red LIVE banner on phone, 1 viewer | VERIFIED ON HARDWARE |
| 8 | Camera switching | Back (0) → front (1) without restarting the stream; front image upright | VERIFIED ON HARDWARE |
| — | Zoom / torch / photo | Zoom 3×, torch on/off on back camera, photo saved (2.3 MB JPEG) | VERIFIED ON HARDWARE |
| 9 | Stop / start camera | Released (state connected, 0 viewers) and restarted | VERIFIED ON HARDWARE |
| 11 | App leaves screen → recovery | Phone stops camera with reason; desktop detects within 2 s (after fix D1), shows reason + Reconnect; Reconnect resumes streaming | VERIFIED ON HARDWARE |
| 12 | Screen mirroring at the same time | Companion keeps streaming while scrcpy mirrors | VERIFIED ON HARDWARE |
| — | scrcpy camera started while companion streams | Companion camera stopped first (state connected), scrcpy camera ran, then stopped cleanly | VERIFIED ON HARDWARE |
| 13 | Desktop quit releases session | Forward removed after quit (after fix D2) | VERIFIED AT RUNTIME |
| 10 | USB unplug during streaming | Not run | NOT RUN |
| — | UID gate rejecting other phone apps | Not run (adb shell accepted, as designed) | NOT RUN |

Defects found on hardware:
- D1 (fixed): desktop kept showing a frozen frame and "Streaming" after the phone ended the MJPEG stream (Chromium fires no `<img>` error). Fix: 2 s status poll while the camera runs.
- D2 (fixed): `adb forward` left behind when the app quits via `app.quit()` (no `window-all-closed`). Fix: cleanup in `before-quit`, bounded to 2 s.
- D3 (fixed): zoom slider capped at 8× while the camera supports 10×; now uses the phone's `maxZoom`.
- D4 (open, phone app): after returning to the foreground the phone keeps showing "Camera unavailable" with the background message until the camera starts again. Needs a small `onStart` reset and a rebuilt APK.
- D5 (open, unexplained): one extra companion photo was saved at 11:35:57 without a click; no code path besides the Snapshot button and timelapse saves companion photos, and it did not recur in later tests.

## Update: builds 3 and 4 on the phone (2026-10-21, evening)

Companion now at **1.0.0-alpha.4 (versionCode 4)**, SHA-256 `ff64974b64846e692ba1e14329fff8dfb525840f8001d87560f3bda1933dbae4`. Builds 3 and 4 were installed with `adb push` to `/data/local/tmp` + `adb shell pm install -r` (the user had asked for the update; `adb install` itself stays blocked by Xiaomi "Install via USB", and AndroScrn does not use this route automatically). Android JVM tests: 31/31.

| # | Test | Result | Status |
|---|---|---|---|
| 2 | Upgrade from an existing install | Desktop reported `update_available` (2 → 3); update kept camera permission | VERIFIED ON HARDWARE |
| — | UID gate: another app's UID | Probe as app uid 10411 refused; server logged `Rejected connection from uid 10411` | VERIFIED ON HARDWARE |
| — | UID gate: shell UID via app_process | Blocked by SELinux before reaching the app (OS policy); the adbd forward path works (all desktop sessions) | VERIFIED ON HARDWARE |
| — | D4 fix: state after returning from background | Phone shows "Connected to desktop (camera off)" | VERIFIED ON HARDWARE |
| 10 | USB unplug during streaming | Desktop dropped the preview within 2 s: "no longer reachable (USB disconnected or app closed)"; adb removed the forward | VERIFIED ON HARDWARE |
| 11 | Reconnect after replug | Reconnect → new forward port → new PIN → live video again | VERIFIED ON HARDWARE |
| — | Disconnect button | Phone: not paired, camera off; no forwards left | VERIFIED ON HARDWARE |
| 13/14 | Desktop quit while streaming | Android camera service logged `DISCONNECT device 0 client for package com.androscrn.companion` at the quit second; no forwards left | VERIFIED ON HARDWARE |
| — | Viewfinder cover (build 4) | Camera running: live image on phone; stopped: dark cover (no frozen frame) | VERIFIED ON HARDWARE |
| 4 | Permission denial path | Not exercised on hardware (permission already granted; JVM test covers the 403 path) | NOT RUN |
| 15 | Restart after a failure | Covered by unplug → reconnect and background → reconnect | VERIFIED ON HARDWARE |

Additional fixes from this round:
- D4 (fixed, build 3): stale "Camera unavailable" after returning to the foreground or pairing again. JVM regression test `pairingClearsStaleCameraErrorState`.
- D6 (fixed, build 4): the phone viewfinder kept showing the last frame after the camera stopped; now covered while the camera is off.
- D7 (fixed, desktop): "Connect to Companion" and "Reconnect" were both shown after a lost stream; only Reconnect is shown now.
- Debug-only `SocketProbe` (src/debug, not in release builds) added for on-device UID-gate checks.

Still open: D5 (one unexplained companion photo at 11:35:57; not reproduced in any later run).
