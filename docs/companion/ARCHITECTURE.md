# AndroScrn Camera Companion — Architecture

Status: protocol v2, companion `1.0.0-alpha.2` (versionCode 2), 2026-10-21.

## What the companion is for

AndroScrn already has two camera paths:

| Path | Where video appears | Needs an app on the phone |
|---|---|---|
| scrcpy camera (`--video-source=camera`) | Separate native scrcpy window | No |
| **Companion** (this document) | **Inside the Camera Studio page** of the AndroScrn window | Yes, "AndroScrn Camera" |

scrcpy cannot render into the Electron window, so an embedded preview needs another source of frames. That is the companion's only reason to exist; it does not replace scrcpy mirroring, input or the scrcpy camera mode. It also provides full-resolution still photos, lens switching, zoom and torch control while previewing.

## Architecture found (before Phase 6)

An Android project already existed in `android/companion` (Kotlin, CameraX, NanoHTTPD) plus `modules/companion_client` on the desktop:

- The app ran an HTTP server on TCP `127.0.0.1:8080`; the desktop used `adb forward tcp:8080 tcp:8080`.
- PIN pairing issued a bearer token; frames were served as MJPEG; photos via `/api/v1/photo/<id>`.
- The desktop never installed or launched the app, and the UI fell back to a fake `mock_token_64` stream URL and fake "photo saved (2450 KB)" success when calls were unavailable.

Defects found in that design are listed in [the Phase 6 report](../../ANDROSCRN_COMPANION_PHASE6_REPORT.md#defects-found-and-fixed).

## Decision

Keep the existing approach (Option B: dedicated companion app, HTTP control + MJPEG over ADB) and fix it, rather than build a new pipeline:

- MJPEG decodes natively in Chromium's `<img>`, so the desktop needs no decoder, worker or native module, and the existing renderer code keeps working.
- At ~720p and ≤20 fps the JPEG bandwidth fits easily in USB ADB forwarding.
- An H.264/MediaCodec stream would need a desktop decoder (WebCodecs or ffmpeg) and keyframe/config handling for little gain in this use case. Rejected for now.
- A modified scrcpy server was rejected: it would fork upstream and still not render into the Electron window.

### Changes made in Phase 6

| Area | Before | After |
|---|---|---|
| Transport | TCP `127.0.0.1:8080` on the phone (reachable by **every app** on the phone) | Abstract UNIX socket `androscrn_companion`; only peers with UID shell (2000, i.e. `adb forward`) or root are accepted |
| Desktop forward | Fixed `tcp:8080` on the PC (port conflicts) | `adb forward tcp:0 localabstract:androscrn_companion` (free port chosen by adb) |
| Install / launch | Manual | `CompanionManager`: install check, explicit install/update, `am start`, forward, protocol-checked handshake |
| Camera lifetime | Bound as soon as the app opened, until it closed | Bound only between `start_camera` and `stop_camera` / disconnect / idle watchdog (60 s) / app leaving the screen |
| Frames | NV21 built by concatenating plane buffers (wrong for padded/interleaved planes), sensor orientation | Stride-correct YUV→NV21, CameraX output rotation (upright portrait), encoded only while a viewer is connected, capped at ~20 fps |
| Buffers | Unbounded photo map, piped stream thread | One-frame buffer (latest only), max 3 stored photos, single download each |
| Control | `set_torch` toggled regardless of request; `set_camera` did nothing | Validated, versioned commands; torch honours `enabled`; camera switch rebinds |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA` | `CAMERA` only |
| Desktop UI | Mock stream/photo success | Real stages, install offer, "Streaming" only after the first frame decodes, stream-loss detection |

## Components

```
Electron renderer (App.tsx, Camera Studio > Companion)
   │  window.androscrnApi.companion*   (preload.ts, typed, no URLs/commands from the renderer)
   ▼
Electron main (main.ts IPC handlers)
   ├─ CompanionManager (modules/companion_client/manager.ts)
   │     bundled ADB: dumpsys package / install -r / am start -W / forward tcp:0 localabstract:…
   └─ CompanionClient  (modules/companion_client/index.ts)
         HTTP/1.1 over the forwarded port, 5 s timeouts, bearer token
   ▼  USB (adb)
Android app com.androscrn.companion
   ├─ MainActivity            lifecycle, permission UI, status screen, watchdog
   ├─ server/CompanionServer  abstract socket, UID gate, ≤6 connections, request parsing, MJPEG writer
   ├─ server/Router           pure routing/auth/validation (JVM-tested)
   ├─ protocol/*              ControlParser, bounded HttpRequestParser (JVM-tested)
   ├─ security/PairingManager PIN challenge, token, rate limits (JVM-tested)
   ├─ session/SessionTracker  state + generation counter against stale callbacks (JVM-tested)
   └─ camera/CompanionCamera  CameraX binding, YuvConverter, FrameBuffer (pure parts JVM-tested)
```

## Session lifecycle

1. **Prepare** (desktop): `get-state` must be `device` → `dumpsys package` → if missing/older, return `install_required`/`update_available` (no install without an explicit click) → `install -r` → verify the new versionCode → `am start -W -n com.androscrn.companion/.MainActivity` → `forward tcp:0` → poll `/api/v1/status` until `protocolVersion == 2` (10 s limit).
2. **Pair**: desktop requests a challenge; the phone shows a 6-digit PIN; the user types it; the phone returns a 64-hex token (1 h TTL).
3. **Start camera**: `start_camera` → camera binds → state `streaming` after the first analysed frame. The desktop then opens the MJPEG URL in an `<img>`; the UI says "Streaming" only after `onLoad` fires for a decoded frame.
4. **Stop**: `stop_camera` releases the camera; `disconnect` also revokes the token; the desktop removes the forward. App quit runs the same stop (bounded to 2 s).

Every desktop prepare/stop increments a session id; results from an older attempt are discarded (`superseded`). On the phone every camera start/stop increments a generation; late CameraX callbacks from an older generation cannot change state.

### Interaction with other sessions

- **scrcpy Camera Studio** and the companion cannot share the camera. Starting one stops the other (main.ts).
- **Screen mirroring** can run at the same time; the companion only needs to be on screen (mirroring will show it).

### Disconnects and recovery

- Phone unplugged / app closed: the MJPEG `<img>` errors → UI shows the reason from `/status` (or "unreachable") and a Reconnect button. Recovery is manual (one click), not an automatic retry loop.
- App leaves the screen: Android revokes background camera access, so the app stops the camera itself and reports `camera_unavailable` with guidance. No foreground service is used (see limitations).
- Desktop crashes: the phone's watchdog stops the camera after 60 s without a viewer or request; the token expires after 1 h.

## Security model

- **Reachability**: only processes the phone sees as UID 2000 (adbd) or 0 can connect. That means only a PC that holds an authorized ADB key for this phone. Other apps on the phone are rejected before any request is read.
- **Authorization**: PIN shown only on the phone screen (human in the loop), 3 wrong PINs consume the challenge, at most 5 challenges per 5 minutes, constant-time comparisons. Token in `Authorization: Bearer` (or `?token=` for `<img>`, which cannot set headers; the URL never leaves the PC's loopback).
- **Input limits**: request head ≤ 8 KiB, body ≤ 16 KiB, no chunked bodies, 10 s read timeout, ≤ 6 concurrent connections, strict JSON field types, camera ids `^[A-Za-z0-9_.:-]{1,32}$`, photo ids `^photo_\d+$`.
- **Visibility**: red "LIVE" banner on the phone while a viewer is connected, and the phone shows the same viewfinder.
- **Desktop**: the renderer cannot pass URLs, ports, paths or shell commands; photos are written only to the Captures folder; the client accepts only `http://127.0.0.1:<port>` and has no default port.
- Not covered: any software on the PC with access to the same ADB key can also reach the companion (the same trust model as scrcpy).

## Permissions

`android.permission.CAMERA` only. Requested once on first launch; if denied, the app shows "Allow camera access", and after Android stops showing the dialog it opens the app settings page instead of re-prompting in a loop. Microphone, network and notification permissions are not requested (no audio, no network listener, no foreground service).

## Compatibility

- minSdk 26 (Android 8.0), targetSdk/compileSdk 34; Kotlin 1.9.23, AGP 8.4.1, Gradle 8.14.3, JDK 17+ to build.
- CameraX 1.3.3 (`camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view`); Gson 2.10.1. NanoHTTPD was removed.
- Protocol v2 desktops reject v1 apps (`protocol_mismatch`) and offer the update.
- Camera ids come from the phone at runtime (`/api/v1/capabilities`), never hard-coded.

## Known limitations

- The app must stay open on screen while streaming (no foreground service); the phone screen stays on during a session.
- MJPEG at ~720p / ≤20 fps, JPEG quality 70; no audio.
- Front camera is not mirrored.
- Only a debug-signed APK can be built here; there is no release signing config in the repository.
- Xiaomi/HyperOS blocks `adb install` unless Developer options → "Install via USB" is enabled (Mi account required). The desktop explains this (`INSTALL_FAILED_USER_RESTRICTED`).
- Physical-device validation of the companion was **not** completed in Phase 6 (install blocked by that setting). See [TEST_MATRIX.md](TEST_MATRIX.md).
