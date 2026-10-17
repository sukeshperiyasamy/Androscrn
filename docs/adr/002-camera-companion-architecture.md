# ADR-002: Lightweight Android Camera Companion Architecture & Protocol

## Status
**Accepted / Implemented (Phase 6)**

## Context
In Phase 5, AndroScrn introduced the Camera Studio MVP utilizing Genymobile `scrcpy` (v5.0.1) as the camera transport. While scrcpy provides zero-install Direct3D11 hardware-accelerated video streaming over ADB, rigorous testing and real-device validation revealed fundamental transport limitations:
1. **No Single-Frame Still Snapshots:** Scrcpy streams an encoded continuous H.264/H.265 bitstream to a video renderer. It cannot trigger high-resolution uncompressed JPEG/RAW photo captures during active streaming.
2. **Stream Interruption on Reconfiguration:** Switching physical lenses (front/rear/ultrawide) or changing stream resolutions requires terminating the scrcpy child process and relaunching it.
3. **External Win32 Window:** Scrcpy renders into a standalone Win32/SDL3 Direct3D11 window outside the Electron application viewport, preventing integrated DOM overlays (e.g. framing grids, histogram, watermark).
4. **No Advanced Studio Controls:** Scrcpy CLI does not expose manual ISO, shutter speed, manual focus distance, or exposure compensation.

To complement (not replace) scrcpy, Phase 6 introduces an optional **AndroScrn Camera Companion** Android application.

---

## Architectural Decisions

### 1. Framework: Kotlin + Jetpack CameraX
* **Decision:** Implement the companion app using **Kotlin** and **Android Jetpack CameraX** (`androidx.camera`).
* **Rationale:**
  * **Lifecycle Management:** CameraX automatically binds to Android lifecycle events (`ProcessCameraProvider`), guaranteeing zero battery drain and clean camera release when the app is paused, backgrounded, or terminated.
  * **Concurrent Use Cases:** CameraX natively supports simultaneous binding of `Preview`, `ImageCapture` (full-resolution photos), and `VideoCapture` (continuous MP4 video) from the same physical camera session.
  * **Hardware Abstraction:** Eliminates device-specific Camera2 quirks and vendor HAL inconsistencies across Samsung, Xiaomi, Google Pixel, and OnePlus devices.
  * **Minimal Footprint:** Compiles to a lightweight APK (~4.2 MB) without bulky third-party native C++ dependencies.

### 2. Transport Protocol: Localhost Loopback over ADB Port Forwarding
* **Evaluation Matrix:**

| Transport | Latency | Complexity | Network Setup | Security Profile | Reliability | Selected |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **USB via ADB Port Forwarding** | **< 15 ms** | **Low** | **Zero Config (127.0.0.1)** | **Isolated to Host PC** | **100% (No Wi-Fi drops)** | **YES (MVP)** |
| **Local Wi-Fi Network** | 30 - 80 ms | Medium | Subnet matching, IP input | Exposed to LAN / AP isolation | Variable (Wi-Fi jitter) | Future Phase |
| **WebRTC PeerConnection** | < 100 ms | High | Signaling server, STUN/ICE | Encrypted DTLS-SRTP | Heavy native libs (~20MB) | Future Studio |

* **Decision:** The MVP uses **USB communication via ADB Port Forwarding** (`adb forward tcp:8080 tcp:8080`):
  * Binds exclusively to loopback `127.0.0.1:8080`.
  * Zero firewall alerts or Windows Defender network prompts.
  * Completely immune to corporate Wi-Fi AP client isolation, public hotspot restrictions, and IP changes.

### 3. Stream & Control Architecture
* **Control Channel:** HTTP REST / JSON-RPC over `POST /api/v1/control` on `http://127.0.0.1:8080`.
* **Stream Channel:** Multi-part boundary-framed MJPEG stream over `GET /api/v1/stream?token=<token>`.
  * Renders natively in standard HTML `<img>` and `<canvas>` elements inside the Electron React UI without external plugins.
  * Delivers 30 FPS at 1080p/720p with sub-30ms local loopback latency.
* **Photo Capture Channel:** Direct high-resolution JPEG binary endpoint `GET /api/v1/photo/:id?token=<token>` triggered by `take_photo` control command.

---

## Security & Privacy Governance

1. **Explicit Camera Permissions:**
   * The app checks and requests `android.permission.CAMERA` at runtime with an interactive permission dialog.
   * If denied, the app displays a clear guidance screen and rejects remote streaming commands with `PERMISSION_DENIED`.
2. **Human-in-the-Loop Challenge-Response Pairing:**
   * When an unauthenticated desktop client connects, it calls `POST /api/v1/pair`.
   * The Android app generates a cryptographically random **6-digit verification PIN** displayed on the phone's physical screen.
   * The desktop user must enter this PIN into AndroScrn.
   * The phone validates the PIN (60-second TTL, 3 failed attempts lockout) and issues a 64-character high-entropy hex session token.
3. **Zero Unauthenticated Streaming:**
   * Both `GET /api/v1/stream` and `GET /api/v1/photo/:id` require a valid `token` parameter matching an active session. Unauthenticated requests are rejected with `401 Unauthorized`.
4. **Anti-Covert Surveillance (Zero Hidden Camera):**
   * The phone screen prominently displays a live viewfinder, red recording/streaming indicator banner, and active client connection information whenever the camera is active.
   * Background streaming while the screen is off or app is closed is strictly forbidden.
5. **Session Revocation & Expiry:**
   * Desktop user can click **"Disconnect Companion"** or trigger the global **Emergency Kill Switch**, which sends `POST /api/v1/control` `{"action": "disconnect"}` and immediately purges the session token.
6. **Strict Command Allowlist:**
   * Allowed actions: `get_status`, `pair`, `get_capabilities`, `set_camera`, `set_zoom`, `set_torch`, `take_photo`, `start_recording`, `stop_recording`, `disconnect`.
   * No shell execution, filesystem browsing, or arbitrary endpoint invocation.

---

## Dual-Mode Desktop Integration

Camera Studio in AndroScrn supports two complementary workflows:
1. **Mode A — Native scrcpy Direct3D11 (No App Required):**
   * Instant plug-and-play camera streaming via bundled scrcpy.
   * Renders in native Win32 window.
   * Supports continuous PC-side MP4 recording.
2. **Mode B — AndroScrn Camera Companion (Full Studio):**
   * Requires companion APK running on phone.
   * In-app seamless React UI preview.
   * Full-resolution still photo capture without stream restart.
   * Instant lens switching (front/back) without terminating preview.
   * Live digital zoom slider and torch toggle.
