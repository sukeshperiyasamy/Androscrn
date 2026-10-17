# AndroScrn — Remediation Backlog & Defect Tracking Log

**Audit Baseline Date:** October 18, 2026  
**Auditor:** Senior QA & System Architecture Review (Phase 11.3 Independent Verification)  
**Repository Baseline:** `6f4a6eb` (working tree with Phases 10–11.3 hardening)  
**Classification Schema:**
- **P0 — Critical:** Security vulnerability, remote code injection vector, memory safety fault, or unhandled fatal crash.
- **P1 — High:** Broken workflow, uncleaned resource leak, missing IPC boundary validation, or white-screen UI fault.
- **P2 — Medium:** Disconnected backend functionality, missing UI action, or unsynchronized asynchronous state.
- **P3 — Low / Informational:** Developer experience improvement, build convenience script, or documentation clarification.

---

## 1. Remediation Summary Table

| Issue ID | Priority | Category | Title | Affected Files | Resolution Status | Verified By |
| :--- | :---: | :---: | :--- | :--- | :---: | :--- |
| **BUG-001** | **P0** | **Security** | Workflow Engine Shell Metacharacter & Argument Injection | `modules/workflow_engine/index.ts`, `modules/security/index.ts` | **RESOLVED** (Phase 11.3) | `tests/unit/workflow-engine.test.ts` (32 tests) |
| **BUG-002** | **P1** | **Reliability**| Preload IPC Event Listener Accumulation & Memory Leak | `apps/desktop/electron/preload.ts`, `apps/desktop/src/App.tsx` | **RESOLVED** | Code inspection & Playwright UI (Scenario 15) |
| **BUG-003** | **P1** | **Reliability**| Unsafe IPC Payload Destructuring & Missing Null Guards | `apps/desktop/electron/main.ts` | **RESOLVED** | Root typecheck & Playwright UI |
| **BUG-004** | **P1** | **Reliability**| Missing React Root Error Boundary on Workbench UI | `apps/desktop/src/ErrorBoundary.tsx`, `apps/desktop/src/main.tsx` | **RESOLVED** | Component test & desktop build |
| **BUG-005** | **P2** | **Integration**| Workflow Engine Sequencer Disconnected & UI Report Mismatch | `apps/desktop/src/App.tsx`, `apps/desktop/electron/main.ts`, `apps/desktop/electron/preload.ts`, `modules/workflow_engine/index.ts` | **RESOLVED** (Phase 11.3) | Interactive unit tests & desktop build |
| **BUG-006** | **P2** | **Integration**| Phone Hotspot Gateway Auto-Detection Disconnected from UI | `apps/desktop/src/App.tsx` | **RESOLVED** | Code inspection & desktop build |
| **BUG-007** | **P2** | **Integration**| Wi-Fi Target Device Disconnection Action Missing in UI | `apps/desktop/src/App.tsx` | **RESOLVED** | Header & Wireless tab verification |
| **BUG-008** | **P2** | **Integration**| Timelapse Scheduler Frame Progress Polling Missing in UI | `apps/desktop/src/App.tsx` | **RESOLVED** | `useEffect` polling integration |
| **BUG-009** | **P3** | **Build / DX** | Missing Comprehensive Root `typecheck` Script | `package.json` | **RESOLVED** | `npm run typecheck` (root + desktop) |
| **BUG-010** | **P3** | **Build** | Companion Android App Lacks Gradle Wrapper & Prebuilt APK | `android/companion/` | **DOCUMENTED** (Backlog) | Documented in `android/companion/README.md` |

---

## 2. Detailed Defect & Remediation Records

### BUG-001: Workflow Engine Shell Metacharacter & Argument Injection
- **Severity:** P0 — Critical (Security Vulnerability)
- **Affected Modules:** `modules/workflow_engine/index.ts`, `modules/security/index.ts`
- **Initial Audit State (Phase 11.2):** Text input relied on an overly broad metacharacter blacklist (`/[;&|`$<>(){}[\]\\"]/`) which rejected legitimate user punctuation (such as `!`, `@`, `#`, `$`, `&`, `(`, `)`, `[`, `]`, `{`, `}`, `\`, `"`, `;`, `<`, `>`). Coordinates had no upper screen boundaries.
- **Phase 11.3 Root-Cause Resolution:**
  - Avoided shell interpretation entirely on the host side: all ADB commands are executed using discrete process argument arrays passed directly to `child_process.spawn(adbPath, args)` with `shell: false`.
  - For device-side text input (`adb shell input text <arg>`), added `SecurityValidator.escapeShellArg` implementing POSIX single-quote escaping (`'...'` with internal `'` escaped as `'\''`). This mathematically guarantees that the remote `/system/bin/sh` treats all characters literally, preventing command injection, subshell creation, variable expansion, backgrounding, and command chaining while preserving legitimate punctuation.
  - Retained strict metacharacter filtering for untrusted MCP AI agent tool calls (`allowPunctuation: false`) to avoid breaking MCP security regression tests.
  - Enforced coordinate bounds (`0 <= coord <= 20000`) on `tap` and `swipe` via `SecurityValidator.isValidCoordinate(coord, 20000)`.
  - Enforced keycode bounds (`0 <= keycode <= 300`) on `keyevent`.
  - Enforced wait duration limits (`0 <= waitMs <= 60000`).
  - Added full workflow definition validation (rejects missing ID, name, empty steps array, steps exceeding 1000, and malformed step objects).
- **Verification:** Tested in `tests/unit/workflow-engine.test.ts` across 32 distinct tests covering invalid serials, malformed structures, coordinate boundaries, gesture durations, keycode limits, empty/newline/Unicode/overlength rejections, legitimate punctuation sets, injection payload neutralization, and live cancellation. All tests pass cleanly.

---

### BUG-002: Preload IPC Event Listener Accumulation & Memory Leak
- **Severity:** P1 — High (Reliability & Memory Safety)
- **Affected Files:** `apps/desktop/electron/preload.ts`, `apps/desktop/src/App.tsx`
- **Root Cause:** Event listener bindings in `preload.ts` (`onMirrorStatusChanged`, `onMcpPairingRequest`, `onMcpStatusChanged`, `onMcpSessionsRevoked`, `onMcpActionAudit`) registered callbacks with `ipcRenderer.on` but failed to return an unsubscribe function. When React components remounted or re-executed effects, duplicate listeners accumulated in the renderer process.
- **Remediation Applied:**
  - Updated all event registration methods in `preload.ts` to return an explicit unsubscribe closure:
    ```typescript
    onMirrorStatusChanged: (callback: (status: any) => void) => {
      const handler = (_: any, status: any) => callback(status);
      ipcRenderer.on('mirror-status-changed', handler);
      return () => ipcRenderer.removeListener('mirror-status-changed', handler);
    }
    ```
  - Added `onCameraStatusChanged` binding with identical unsubscribe pattern.
  - Updated `App.tsx` main `useEffect` to store all returned unsubscribe callbacks and execute them during cleanup on component unmount.
- **Verification:** Verified in Playwright UI suite (Scenario 15) confirming zero event listener leaks across multiple navigations.

---

### BUG-003: Unsafe IPC Payload Destructuring & Missing Null Guards
- **Severity:** P1 — High (Process Stability)
- **Affected File:** `apps/desktop/electron/main.ts`
- **Root Cause:** Multiple IPC handlers in `main.ts` used unguarded object destructuring directly in the argument signature (e.g. `async (_, { serial }) =>`). If a renderer invoked the channel with `null`, `undefined`, or a non-object payload, Node.js threw an unhandled `TypeError: Cannot destructure property 'serial' of 'undefined' as it is undefined`, crashing the handler and logging unhandled promise rejections.
- **Remediation Applied:**
  - Audited all 36 IPC channels in `main.ts`.
  - Replaced argument destructuring with safe extraction: `const { serial } = payload || {};`.
  - Added input validation guards using `SecurityValidator` for device serials, IP addresses, ports, PIN codes, zoom ratios, and camera facing enums.
  - Returned structured failure payloads (`{ success: false, error: '...' }`) rather than throwing raw runtime errors.
- **Verification:** Validated by `npm run typecheck` and Playwright automated IPC tests.

---

### BUG-004: Missing React Root Error Boundary on Workbench UI
- **Severity:** P1 — High (User Experience & Fault Tolerance)
- **Affected Files:** `apps/desktop/src/ErrorBoundary.tsx`, `apps/desktop/src/main.tsx`
- **Root Cause:** The desktop workbench lacked an error boundary in `main.tsx`. Any unexpected runtime error or render failure in a child component would unmount the entire React component tree, leaving the user with an unresponsive blank white screen with no recovery mechanism.
- **Remediation Applied:**
  - Created `apps/desktop/src/ErrorBoundary.tsx` adhering to React Error Boundary specifications (`getDerivedStateFromError`, `componentDidCatch`).
  - Styled with AndroScrn dark slate theme, displaying error message, expandable component stack trace, "Try Again" state reset button, and "Reload Workbench" action.
  - Wrapped `<App />` within `<ErrorBoundary>` in `apps/desktop/src/main.tsx`.
- **Verification:** Verified compilation and rendering via `npm run build` and `npm run test:ui`.

---

### BUG-005: Workflow Engine Sequencer Disconnected & UI Report Mismatch
- **Severity:** P2 — Medium (Feature Disconnection & UI Mismatch)
- **Affected Files:** `apps/desktop/src/App.tsx`, `apps/desktop/electron/main.ts`, `apps/desktop/electron/preload.ts`, `modules/workflow_engine/index.ts`
- **Root Cause:**
  1. In earlier versions, `App.tsx` rendered only a static placeholder card for the Workflow tab.
  2. In Phase 11.2, although an interactive table was connected, property names returned by `WorkflowEngine` (`overallStatus`, `totalDurationMs`, `passedSteps`, `results`) mismatched `App.tsx` expectations (`success`, `durationMs`, `completedSteps`, `steps`). Consequently, passing workflows rendered with red error borders, an alert icon, and empty step logs.
  3. No cancellation IPC channel existed to stop long or hung sequences.
- **Remediation Applied (Phase 11.3):**
  - Added `cancel-workflow` IPC channel in `main.ts` and `cancelWorkflow` binding in `preload.ts`.
  - Added "Cancel Sequence" button in `App.tsx` alongside running spinner.
  - Updated `WorkflowExecutionReport` in `WorkflowEngine` to return both canonical fields and UI compatibility aliases (`success`, `durationMs`, `completedSteps`, `steps`).
  - Harmonized `App.tsx` results view to handle both schemas, ensuring accurate green pass styling, step counters, execution durations, and step outcome badges.
- **Verification:** Validated via unit tests in `workflow-engine.test.ts`, desktop typecheck, and full production build.

---

### BUG-006: Phone Hotspot Gateway Auto-Detection Disconnected from UI
- **Severity:** P2 — Medium (Feature Disconnection)
- **Affected File:** `apps/desktop/src/App.tsx`
- **Root Cause:** `ConnectionManager.detectHotspotGateway()` was implemented in the backend and exposed in preload, but `App.tsx` hardcoded the gateway IP to `'192.168.43.1'` without ever invoking the detection API.
- **Remediation Applied:**
  - Added automatic gateway detection invocation in `useEffect` when switching to the Wireless tab (`activeTab === 'wireless'`).
  - Added a dedicated "Detect Gateway" button in the Phone Hotspot Gateway Connect card, enabling one-click discovery from active network adapters.
- **Verification:** Verified via `npm run build` and desktop TypeScript checks.

---

### BUG-007: Wi-Fi Target Device Disconnection Action Missing in UI
- **Severity:** P2 — Medium (UI Completeness)
- **Affected File:** `apps/desktop/src/App.tsx`
- **Root Cause:** While `ConnectionManager.disconnect(serial)` existed in the backend and `disconnect-device` IPC was registered, the desktop UI provided no button to disconnect connected Wi-Fi or TCP/IP Android devices. Users had no option other than restarting the app or manually issuing `adb disconnect` from a terminal.
- **Remediation Applied:**
  - Added a "Disconnect" action button in the global device header bar when the active device is connected over Wi-Fi (`transportType === 'wifi'`).
  - Added an "Active Wi-Fi Device" status card in the Wireless tab with a direct "Disconnect Wi-Fi Device" action button.
  - Wired both buttons to `handleDisconnectWifiDevice(serial)`, which invokes `api.disconnectDevice(serial)` and refreshes the device list.
- **Verification:** Verified via `npm run build` and desktop interface validation.

---

### BUG-008: Timelapse Scheduler Frame Progress Polling Missing in UI
- **Severity:** P2 — Medium (UI / State Synchronization)
- **Affected File:** `apps/desktop/src/App.tsx`
- **Root Cause:** In the Lab & Inspection panel, starting a timelapse set `timelapseRunning` to `true` and displayed `Frame 1/X`, but never polled `api.labGetTimelapseStatus()`. The UI frame counter remained frozen at Frame 1 until manually stopped or refreshed.
- **Remediation Applied:**
  - Added an interval polling effect in `App.tsx` active while `timelapseRunning` is true.
  - Polls `api.labGetTimelapseStatus()` every 1000ms, updating `timelapseCurrentFrame` with real-time frame counts and automatically clearing `timelapseRunning` when the session concludes.
- **Verification:** Verified via `npm run build` and component inspection.

---

### BUG-009: Missing Comprehensive Root `typecheck` Script
- **Severity:** P3 — Low (Developer Experience & CI Quality Gate)
- **Affected File:** `package.json`
- **Root Cause:** `package.json` had individual test scripts that compiled the root `tsconfig.json`, but lacked a single unified `typecheck` command that simultaneously typechecked both the root backend modules and the `apps/desktop` React frontend without emitting build artifacts.
- **Remediation Applied:**
  - Added `"typecheck": "tsc -p tsconfig.json --noEmit && npm --prefix apps/desktop exec tsc -- --noEmit"` to `package.json`.
- **Verification:** Executed `npm run typecheck`, verifying both root and desktop projects pass with zero diagnostics.

---

### BUG-010: Companion Android App Lacks Gradle Wrapper & Prebuilt APK
- **Severity:** P3 — Low (Distribution & Build Automation)
- **Affected Directory:** `android/companion/`
- **Root Cause:** The companion app Kotlin source files are complete in `android/companion/app/src/main/java/`, but Gradle wrapper files (`gradlew`, `gradlew.bat`, `gradle/wrapper/`) are absent from the repository. The companion APK is not built by GitHub Actions CI or bundled into the portable release ZIP.
- **Current Status:** Documented in `android/companion/README.md`. Users compile the companion app by opening `android/companion` in Android Studio or running external Gradle.
- **Recommended Future Action:** Add Gradle wrapper scripts to `android/companion/` and configure a GitHub Actions build step to compile `androscrn-companion-debug.apk` and bundle it into `dist-release/`.
