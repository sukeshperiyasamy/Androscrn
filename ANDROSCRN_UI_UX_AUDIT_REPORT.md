# AndroScrn UI/UX Audit Report

Date: 2026-10-21. Branch `audit/master-audit-fixes`, uncommitted changes on top of `d6ff987`. Device for runtime checks: Xiaomi 21091116I (Android 13) over USB. Display: 2560×1600 at 175 % Windows scaling.

## Summary

The UI was improved in place, not rewritten. Before this pass, the app did not fit small windows, kept refreshing and talking to the phone even when nothing changed, and showed development notes and inaccurate claims on ordinary screens. The fixes:

- **Layout:** the app fits every size from 800×600 to 1920×1080. It shows no page-level scrolling or overflow on any of the 9 screens at 6 sizes, measured in the real Electron app.
- **Navigation:** it collapses to an icon rail on narrow windows.
- **Polling:** steady-state device polling dropped from 3 ADB processes per phone every 2.5 s to 1, and the median poll time from about 350 ms to about 50 ms.
- **Idle UI:** the app no longer touches the DOM while idle (0 mutations in 20 s, was 32).
- **Wording:** development-phase labels and inaccurate claims were removed from ordinary screens. Real diagnostics stay.
- **Hidden test regression:** the UI test suite had stopped at test 63 of 179 since the companion change. It now runs fully and passes 180/180.

## Issues found (baseline)

Captured with an automated audit that visits every screen at 6 window sizes in the real Electron app (`ui-before` screenshots), plus code inspection.

| # | Problem | Where | Evidence |
|---|---|---|---|
| L1 | Window could not go below 960×680, so the 800×600 target was untestable | `main.ts` `minWidth/minHeight` | Measured 947×618 when 800×600 was requested |
| L2 | Sidebar was a fixed 240 px at every width; 9 copies of the same 15-line button markup; no collapsed mode | `App.tsx` nav | Code |
| L3 | The whole page scrolled as well as the content panel on Wireless (double scrollbar) | 3 `sr-only` labels positioned against the page | Document height 739 px vs window 721 px at 1280×720 |
| L4 | Card header rows never wrapped; "Start Mirroring" broke onto two lines at 1024 px | 15 `flex justify-between` rows | Screenshot |
| L5 | Fixed 3- and 4-column grids (quality presets, mirroring options and two others) | `grid-cols-3/4` | Code |
| L6 | Welcome banner always said "Connect an Android phone… to begin", even with a phone connected and READY | Initial `alertBanner` | Screenshot |
| L7 | Tips banner offered "Try Again" for a phone that was working fine | `ConnectionHelp.tsx` | Screenshot |
| L8 | Camera Studio showed a large empty 16:9 "viewport" in separate-window mode, where video never appears in AndroScrn | Camera preview card | Screenshot |
| A1 | Small uppercase headings used `#84909E`, at 3.25:1 on white and 2.99:1 on grey (fails WCAG AA 4.5:1) | 49 uses | Contrast calculation |
| A2 | Sidebar keyboard use: every tab was a Tab stop; no arrow-key navigation | Nav | UI test |
| P1 | Every 2.5 s poll ran `adb devices -l` plus `dumpsys battery` plus a full `getprop` (about 50 KB) per phone | `DeviceManager.getDevicesDetailed` | 3 ADB calls, median 350 ms per poll |
| P2 | Every poll toggled the busy flag (spinning the refresh icon), replaced the device array even when unchanged, and listed the Captures folder | `App.tsx` `refreshDevices` | 32 DOM mutations per 20 s while idle |
| P3 | The poll's mirroring check read a stale `isMirroring` value captured when the timer was created, so its "mirroring stopped" branch could never run | `refreshDevices` closure | Code |
| P4 | Polling continued while the window was minimized | Poll effect | Code |
| T1 | The UI test suite had been aborting at test 63 since the companion change (old companion mocks); 116 checks never ran | `tests/ui/playwright-ui.test.ts` | `npm run test:ui` |

## User-facing text cleaned up

Only text shown in normal screens was changed. Engineering reports and docs keep their wording.

| Before | After | Why |
|---|---|---|
| "Phase 6" badge (Camera Studio) | removed | Development phase |
| "PHASE 7.1 ACTIVE" badge (inspection tools) | removed | Development phase |
| "Verified Status" badge and "Continuous PC recording is **verified**…; full photo capture will be provided via the dedicated CameraX companion APK" | "In this mode you can record the camera to an MP4 file… switch to the in-app preview (companion app) to take full-resolution photos." | Test-status wording; the companion now exists |
| "Verified sensor range: 1.0x – 10.0x" (hard-coded for every phone) | "Digital zoom from 1.0x to 10.0x. Some cameras support less." | Not verified per device |
| "Saves lossless hardware-encoded video… with zero dropped frames" | "Saves an MP4 video of the camera to the Captures folder." | Inaccurate: H.264 is lossy, and dropped frames were never measured |
| "Captures uncompressed 48MP/12MP photo…" | "Takes a full-resolution JPEG photo…" | Inaccurate: JPEG, resolution varies |
| "Loopback only (`127.0.0.1:8080`)" and About "NanoHTTPD … 127.0.0.1:8080 streaming helper" | "Reachable only through the USB (ADB) connection…", credits "CameraX & Gson" | Outdated since the companion moved to the ADB-only socket |
| "Direct low-latency Android camera preview via scrcpy Camera2 Direct3D11 streaming. Zero APK required." | "Use the phone's camera on this PC: in a separate window (nothing to install), or inside AndroScrn with the AndroScrn Camera companion app." | Jargon |
| "Scrcpy Native Direct3D11" / "Camera Companion App" | "Separate window" / "In-app preview" | Jargon |
| "Sensor Stream Only", "Hardware MP4", "HyperOS Shield", "CameraX" badges | removed | Decorative jargon |
| "Sensor Sensor Ratio" | "Camera default" | Typo |
| Mirroring option hints `(-S)`, `(-w)`, `(--always-on-top)`, "via scrcpy" | Plain descriptions | Command-line flags |
| "Auto (Default SDK)", "UHID (Hardware Emulation…)", "SDK (Standard Android Injection)" | "Automatic (standard input)", "Hardware keyboard & mouse (UHID) — best for Xiaomi", "Standard Android input (SDK)" | Clearer; technical term kept in brackets |
| "Screen Mirroring Studio", "Quick Navigation & Device Controls (model)" | "Screen Mirroring", "Phone buttons · model" | Simpler |
| About: "Architecture Designation: Provisional Electron Distribution… target Tauri 2 + Rust… host toolchain constraints" | removed (still in `docs/adr/001-…`) | Internal engineering note |
| About: "Store Readiness" sub-tab ("audit status for Android store compliance") | removed (still in `docs/android-submission-readiness.md`) | Internal submission checklist |
| "About AndroScrn & Governance"; header subtitle "Windows-First Android Control & Automation Platform" | "About AndroScrn"; "Android control for Windows" (hidden on narrow windows) | Simpler |
| Sidebar "Workbench" / "Advanced (Preview)" | "Device" / "Automation (preview)" | Plainer grouping |
| Tooltips "Launch live ADB diagnostics in visible CMD window & retry loop", "Scan for Devices (ADB)" | "Search for the phone again and open a live diagnostics window", "Refresh device list" | Plain language |

Deliberately kept:
- **Device logs:** the Diagnostics screen shows real Android logcat lines, including SELinux "audit" messages, because that is the diagnostic evidence.
- **AI Assistant vocabulary:** MCP, permission tiers and the "action audit log" are the feature's real terms, which someone configuring an AI agent needs.
- **Device error messages:** these, such as "Unauthorized" and the Xiaomi input restriction, were already plain.

## Changes implemented

**Layout and shell (`App.tsx`, `index.css`, `main.ts`)**
- Minimum window size is now 800×560.
- `html`, `body` and `#root` are fixed to the window height, and the content area (`#main-content`) is the only scroll container. It is `relative`, so hidden labels can't stretch the page, and it has `min-w-0` and `overflow-x-hidden`.
- Navigation is now data-driven: one `NAV_SECTIONS` list and a memoized `NavItem` component replace the 9 duplicated buttons.
  - It collapses to a 60 px icon rail below 1100 px.
  - A Collapse/Expand toggle is remembered on this PC (localStorage, as a per-PC convenience).
  - In the rail, items show tooltips and have accessible names.
  - Items are 40 px tall.
- Header: wraps when needed; the subtitle shows only at ≥1024 px; the device label is shorter ("model · USB · serial") and truncates with `clamp(140px, 24vw, 280px)`.
- All 15 card header rows wrap (`flex-wrap gap-3`). Four fixed grids are now `repeat(auto-fit, minmax(…))`. The primary mirroring buttons no longer wrap.
- Camera Studio's separate-window status box sizes to its content instead of a 16:9 frame.
- Banners use the same 12 px side margins as the content.

**States**
- The welcome banner is gone. When no phone is connected, every screen except About shows a "No phone connected" card. It explains what to do and offers **Try again** and **Connect over Wi-Fi**. While a search runs, it shows the live search message and **Stop searching**.
- The tips banner shows Try Again only for a real connection problem, or while a search is running.

**Accessibility**
- 49 small-text uses of `#84909E` changed to `#667085` (4.97:1 on white, 4.58:1 on grey).
- Navigation follows the WAI-ARIA tabs pattern:
  - only the selected tab is a Tab stop;
  - Up/Down arrows move between tabs, and Home/End jump to the first/last;
  - focus follows selection, and arrows start from the focused tab;
  - the tab list is labelled "Main navigation" and declares vertical orientation.

**Performance**
- `DeviceManager` caches each phone's system properties for as long as it stays connected, and its battery level for 30 s. The cache is dropped when the device disappears or becomes unauthorized. Covered by the new `tests/unit/device-cache.test.ts` (9 checks).
- The background poll no longer toggles the busy flag, keeps the previous device array when nothing changed (`sameDeviceList`), skips the Captures listing (refreshed when Camera, Media or Documents opens), and pauses while the window is hidden, refreshing immediately on return.
- Mirroring status in the poll now reads `isMirroringRef`, so the "stopped" message works.
- Both click handlers that called `refreshDevices` directly now call it without the click event, which would otherwise have been treated as a background poll. The type check caught this.

**Tests updated**
- `playwright-ui.test.ts`:
  - companion scenario moved to the real prepare → pair → start-camera flow, with a local one-frame image server so "Streaming" is checked only after a frame decodes;
  - keyboard scenario checks the ARIA tabs pattern;
  - new responsive checks: icon rail at 1024 px, no horizontal scroll at 1024 and 800, manual collapse at 1920;
  - Try Again is tested on the unauthorized phone, plus a check that a ready phone's tips don't offer it;
  - the discovery-Cancel check is scoped to its panel.
- `styling.test.ts`: the arbitrary-value probe now looks for a class that is still in use.

## Measurements (real app, real phone)

| Metric | Before | After |
|---|---|---|
| ADB processes per device poll (steady state) | 3 | 1 |
| Device poll duration, median of 8 | 350 ms | 47 ms |
| DOM mutations in 20 s idle | 32 | 0 |
| Long tasks in 20 s idle | 0 ms | 0 ms |
| Window ready (launch → first screen) | 796–934 ms | 683–790 ms (no change attributed) |
| JS heap after start | 10 MB | 10 MB |
| Screens × sizes with page overflow or extra scroll | Wireless: page scroll at 1280×720 | 0 of 54 |

## Tests executed (final run, after all changes)

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run test:unit` | 1315/1315 (1 opt-in skip) |
| `npm run test:integration` | 39/39 |
| `npm run test:ui` | 180/180 |
| `npm run build` | pass |
| `npm run docs:check` | pass |
| Layout audit: 9 screens × 6 sizes, real Electron app | 0 overflow or double-scroll problems |
| Functional regression on the phone, real Electron app | 14/14 (see `ANDROSCRN_UI_TEST_MATRIX.md`) |

## Remaining issues and limits

- **Monolithic `App.tsx`:** about 5,300 lines. Splitting it into per-screen components would help maintainability and render isolation, but it is a larger refactor and was not done here.
- **Hard-coded colours:** colour classes in `App.tsx` still use hex values (`#0F766E`, etc.) rather than the Tailwind `theme.*` tokens. The values match the tokens, so the change would be mechanical, but it was not done in this pass.
- **No dedicated Settings screen:** settings live inline on each screen, and persistence covers aliases, quality preset and input mode. Section 6.5's grouped Settings screen was not added, because there is not yet enough settings inventory to justify it.
- **Notifications:** still a single banner area (`alertBanner`); there is no toast system or a technical-details expander for every error.
- **Not run:** wireless connect/pairing (blocked by campus Wi-Fi client isolation, see the master audit report); other Windows scaling factors (only 175 % tested); screen readers (keyboard checks only).
