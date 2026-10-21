# AndroScrn UI Test Matrix

Run date: 2026-10-21. Environment: Windows 11, 2560×1600 at 175 % scaling, Electron 31, Xiaomi 21091116I (Android 13) over USB.

Methods:
- **Electron audit:** real app, window resized with `setContentSize`, automated measurement plus screenshots.
- **Playwright UI:** `npm run test:ui`, the built UI in Chromium with a mocked `androscrnApi`.
- **Hardware:** real app driving the real phone.

## Layout (Electron audit, final build)

Each cell is one screen at one size. Pass means: no horizontal page scroll; no page-level vertical scroll (only `#main-content` scrolls); no element extends past the right edge; no clipped headings or buttons.

| Screen | 800×600 | 1024×768 | 1280×720 | 1366×768 | 1440×900 | 1920×1080 |
|---|---|---|---|---|---|---|
| Screen Mirroring | Pass | Pass | Pass | Pass | Pass | Pass |
| Camera Studio | Pass | Pass | Pass | Pass | Pass | Pass |
| Wireless & Hotspot | Pass (was page scroll) | Pass | Pass (was page scroll) | Pass | Pass | Pass |
| Media & Captures | Pass | Pass | Pass | Pass | Pass | Pass |
| Documents & OCR | Pass | Pass | Pass | Pass | Pass | Pass |
| Diagnostics & Logs | Pass | Pass | Pass | Pass | Pass | Pass |
| Workflow Runner | Pass | Pass | Pass | Pass | Pass | Pass |
| Local AI Assistant | Pass | Pass | Pass | Pass | Pass | Pass |
| About & Licenses | Pass | Pass | Pass | Pass | Pass | Pass |

Before: 800×600 could not be tested (minimum window 960×680), and Wireless scrolled the whole page at 1280×720.

## Components and conditions

| Component | Condition | Expected | Actual | Method | Status | Limitation |
|---|---|---|---|---|---|---|
| Sidebar | Width < 1100 px | Icon rail, tooltips, accessible names | As expected | Playwright UI (1024 px), screenshots | Pass | |
| Sidebar | 1920 px | Full labels | As expected | Playwright UI | Pass | |
| Sidebar | Manual collapse/expand | Toggles, remembered | As expected | Playwright UI | Pass | |
| Sidebar | Keyboard | One Tab stop; arrows, Home/End move focus and selection | As expected | Playwright UI | Pass | No screen-reader test |
| Header | 800 px | Subtitle hidden, device label truncated, no overflow | As expected | Screenshots | Pass | |
| No-device state | 0 devices | "No phone connected", Try again, Connect over Wi-Fi | As expected | Playwright UI (scenario 1) | Pass | |
| Tips banner | Ready phone | No Try Again | As expected | Playwright UI | Pass | |
| Tips banner | Unauthorized phone | Try Again re-checks device and guidance | As expected | Playwright UI | Pass | |
| Camera Studio (separate window) | Camera off | Compact status box, no empty 16:9 frame | As expected | Screenshots | Pass | |
| Companion preview | Frame decoded | "Streaming" only after first frame | As expected | Playwright UI with a local image server | Pass | Mocked API, real image decode |
| Text contrast | Small secondary text | ≥ 4.5:1 | 4.97:1 (white), 4.58:1 (grey) | Calculation | Pass | |
| Internal wording | All screens | No phase, test, verified or tooling notes | Only real device logs and the AI audit-log feature name remain | Electron audit text scan | Pass | |

## Functional regression (hardware)

| # | Workflow | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Device discovery | Phone in header, Ready badge | "21091116I · USB · kjizrsgekfsglvgi", Ready | Pass |
| 2 | Try Again search | Finds the authorized phone | status `authorized` | Pass |
| 3 | Diagnostics console | CMD window launched | PID reported (window behaviour itself verified earlier on screen) | Pass |
| 4 | USB / wireless connect | — | USB covered by 1; wireless not run (Wi-Fi client isolation) | USB Pass / wireless NOT RUN |
| 5 | Mirroring start/stop | scrcpy starts and stops | 1 process, then 0 | Pass |
| 6 | SDK → UHID switch while mirroring | Restart with UHID keyboard and mouse | `--keyboard=uhid --mouse=uhid` | Pass |
| 7 | Camera Studio start/stop (separate window) | scrcpy camera starts and stops | 1 process, then 0 | Pass |
| 8 | Companion readiness | Prepare, launch, pairing requested | PIN card shown | Pass |
| 9 | Settings persistence | Preset survives restart | Battery Saver restored | Pass |
| 10 | Shutdown cleanup | No scrcpy, no adb forwards | 0 and none | Pass |
| — | Console errors during the session | None | None | Pass |

## Performance (hardware)

| Measurement | Before | After | Method |
|---|---|---|---|
| ADB calls per poll | 3 | 1 | `getDevicesDetailed` counted, 8 polls |
| Poll median | 350 ms | 47 ms | same |
| Idle DOM mutations / 20 s | 32 | 0 | MutationObserver in the real app |
| Long tasks / 20 s idle | 0 ms | 0 ms | PerformanceObserver |

Not measured: memory over hours-long sessions, and render counts during active mirroring.
