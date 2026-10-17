# Historical Validation Snapshot (moved from the README)

> **Status: historical.** This is a verbatim copy of the test-result breakdown and hardware-validation transcript that
> used to live in the project README. It describes the suites as they were during Phases 1-7.1 and is kept for history only.
> Its counts are **out of date**; for current commands, prerequisites and status see [../testing.md](../testing.md).
> Entries here that describe a "59 / 59" hardware run refer to an earlier device state and an earlier version of the suite.

## Verified Test Results Breakdown

```
==================================================
        ANDROSCRN AUTOMATED TEST VERIFICATION
==================================================
1. Unit Tests (tests/unit/runner.ts):              430 / 430 Passed (0 Failed)
   - Input sanitization & injection defenses:      31 Passed
   - Device parsing & alias management:            10 Passed
   - Scrcpy argument composition:                  9 Passed
   - Process lifecycle & missing binary handling:  8 Passed
   - Device state guidance:                        3 Passed
   - Binary screencap PNG magic byte check:        4 Passed
   - Diagnostic bundle & sensitive redaction:      4 Passed
   - Captures folder scanner:                      1 Passed
   - MCP Server & HITL Handshake Security:         83 Passed
   - Tier 3 Controlled Device Input Tools:         42 Passed
   - CLI Launcher, Flags & Packaging (Phase 4):    65 Passed
   - Camera Studio Argument & Security (Phase 5):  50 Passed
     * Safe parameter arrays & shell injection prevention
     * Camera facing and ID mapping (--camera-facing, --camera-id)
     * Resolution formatting, aspect ratios & FPS constraints
     * High-speed 120 FPS validation
     * Startup digital zoom clamping [1.0x - 10.0x]
     * Startup torch flag (--camera-torch)
     * Output recording path validation & path traversal defense
     * Camera list & camera size parsing logic
     * Capability detection model & transport boundary checks (Android 12+ API 31)
     * Process lifecycle, duplicate prevention, and cleanup
   - Security Regression & IPC Suite (Phases 3C/3D): 62 Passed
     * Pairing TTL expiration & replay single-use rejection
     * Client identity binding & brute-force PIN lockout
     * Session token non-revivability & emergency kill-switch
     * Coordinate boundaries: (0,0), (max-1), and max out-of-bounds rejection
     * Swipe duration boundaries (50ms, 10000ms, >10000ms rejection)
     * Keycode boundaries (0, 300, 301 rejection)
     * 15-character shell metacharacter injection defense matrix
     * Text length boundaries (500 max, 501 rejection) & control char rejection
     * Audit log token & sensitive payload omission
     * Named pipe NDJSON framing, corruption, and split chunk parsing
     * TOCTOU in-flight pre-dispatch cancellation re-check
     * Race pairing deduplication & single-consumption enforcement
     * McpControlServer static bounding (10 clients, 25 requests, 50 audit logs)
     * Client disconnect and defunct pipe recovery
   - Companion Client & Wire Protocol (Phase 6):   48 Passed
     * Challenge PIN validation & single-use consumption
     * Port forwarding and loopback socket routing (127.0.0.1:8080)
     * Shutter photo trigger & path integrity
   - Lab & Inspection Tools Subsystem (Phase 7.1):  15 Passed
     * Non-destructive SVG overlay generation (grid, crosshair, reticle, diagonal)
     * Overlay opacity, color sanitization & uncalibrated px badges
     * Side-by-side & blend reference comparison modes
     * Snapshot metadata creation with explicit calibration warnings
     * Timelapse interval scheduler & manifest hash generation
2. Integration Tests (tests/integration):         39 / 39 Passed (0 Failed)
   - Bundled ADB & scrcpy binary execution:        7 Passed
   - Socket probe, discovery & process safety:     6 Passed
   - End-to-End MCP & HITL IPC Flow:              26 Passed
     * Mock desktop Named Pipe server listening & client connection
     * request_pairing with PIN omission
     * Live PAIRING_REQUEST delivery over named pipe with PIN for display
     * Desktop human approval & pair_session token issuance
     * Authorized Tier 3 tap execution
     * Live ACTION_AUDIT delivery over named pipe without secrets
     * Desktop emergency revocation & subsequent operation rejection
     * Desktop human denial flow & rejection
     * Multi-client connection & broadcast revokeAll delivery
     * Server retention of pending pairing requests during client disconnect
3. Playwright UI Tests (tests/ui):                88 / 88 Passed (0 Failed)
   - Zero-device empty state & guidance:           4 Passed
   - Multi-device dropdowns & status badges:       7 Passed
   - Mirroring controls, pulse & presets:          6 Passed
   - Screenshot capture & media gallery:           2 Passed
   - Diagnostics introspections & copy:            3 Passed
   - Keyboard accessibility & tab navigation:      3 Passed
   - Viewport responsiveness (1024x768 / 1080p):   2 Passed
   - AI Agent Security Center & HITL UI:          12 Passed
   - Live AI Action Audit Log rendering:           6 Passed
   - Camera Studio UI & Controls (Phase 5):       13 Passed
     * Header & connected device selector
     * Physical camera sensor & facing selector
     * Video resolution & FPS selector
     * High-speed 120 FPS & aspect ratio controls
     * Continuous PC-side MP4 recording toggle
     * Start/Stop preview toggle with live pulse
     * Digital zoom slider & live badge
     * Discrete Zoom In / Zoom Out buttons
     * Live Torch toggle button
     * Live shortcut cheat sheet (Alt+Up, Alt+Down, Alt+T)
   - Camera Companion Mode Switcher & Live Feed (Phase 6): 16 Passed
     * Companion mode switcher toggle & state persistence
     * PIN challenge input and authorize trigger
     * Live viewport image rendering
     * Full-resolution photo shutter capture
     * Lens flip & torch controls
   - Lab & Inspection Tools Suite (Phase 7.1):     14 Passed
     * Overlay dropdown switcher & viewport mounting
     * Real-time SVG update on selector change
     * RGB color and opacity slider dynamic styling
     * Golden sample comparison toggle & blend controls
     * Interval timelapse scheduler start/stop lifecycle
     * Non-destructive raw capture guarantee & export annotated copy
--------------------------------------------------
TOTAL AUTOMATED TEST VERIFICATION:               557 / 557 Passed (100% Green)
==================================================
```

## Physical Hardware Validation (historical, 59 checks)

When a physical Android device is connected via USB, AndroScrn provides an isolated hardware validation suite (`npm run test:hardware`) designed to verify the real device pipeline safely:

```
==================================================
   ANDROSCRN PHYSICAL HARDWARE VALIDATION SUITE
==================================================
Device Target: Xiaomi Redmi Note 11 Pro+ 5G (Android 13)
1. Preflight & Hardware Discovery:                 6 / 6 Passed
   - Introspected ADB 1.0.41 & scrcpy 5.0.1 banners
   - Attached USB device detection & state authorization
   - Multi-device ambiguity guard & emulator safety check
2. Real Telemetry, Screencap & Logcat:            14 / 14 Passed
   - Live battery level, charging status & temperature telemetry
   - Bounded live logcat slice & credential redaction
   - Verified raw binary PNG screencap (0x89504E47 header)
3. Tier 3 Hardware Input & Security Controls:      8 / 8 Passed
   - Coordinate out-of-bounds rejection via real display geometry (wm size)
   - Swipe duration & keycode range rejection
   - Shell metacharacter injection defense matrix
   - Xiaomi MIUI/HyperOS vendor security detection (INJECT_EVENTS permission)
4. Live Named-Pipe MCP Server & Desktop HITL:     10 / 10 Passed
   - Out-of-band PIN display on desktop / PIN omission from MCP client
   - Human desktop approval & 64-char session token issuance
   - Live ACTION_AUDIT IPC delivery over Named Pipe without secrets
   - Emergency desktop kill switch & post-revocation command rejection
5. Disconnection & Boundary Resilience:            2 / 2 Passed
   - Disconnected/non-existent serial rejection
6. Camera Studio Hardware Pipeline (Phase 5):     19 / 19 Passed
   - Transport check: Android 13 (API 33) >= Android 12 verified
   - 5 physical camera sensors enumerated (0:back, 1:front, 2:back, 3:back, 4:back)
   - Primary sensor max resolution (4000x3000), 30 FPS, hardware zoom range [1x, 10x]
   - Live Zoom & Torch verified supported via native scrcpy shortcut
   - Direct3D11 hardware camera streaming preview executed & cleanly terminated
   - Continuous PC-side MP4 recording executed, non-zero file verified (1280 KB), cleaned up
--------------------------------------------------
TOTAL PHYSICAL HARDWARE CHECKS:                   59 / 59 Passed
==================================================
```

*Note: The physical hardware suite is strictly isolated from standard `npm test` and GitHub Actions CI. Ordinary CI never fails due to an absent physical device.*

## Continuous Integration (Windows CI)

AndroScrn includes an automated GitHub Actions CI workflow at `.github/workflows/ci.yml`:
* **Environment:** Executed on `windows-latest` with Node.js 20 LTS.
* **Deterministic Execution:** Uses `npm ci` lockfile resolution and Playwright Chromium headless runner.
* **Coverage Scope:** Runs full TypeScript compilation (`npm run build`), unit security regression suites, mocked IPC integration flows, and automated UI suites without requiring physical hardware.
* **Failure Diagnostics:** Uploads compiled bundles and test logs as CI artifacts upon any unexpected failure.

*Testing Hierarchy Notice: Automated unit and integration tests utilize deterministic mocks and local named pipes. Browser UI tests run against headless Chromium. Physical hardware verification is separately conducted on a physical Xiaomi Redmi Note 11 Pro+ 5G (`21091116I`, Android 13) and documented in the [Manual Hardware Test Checklist](../manual-device-test.md).*
