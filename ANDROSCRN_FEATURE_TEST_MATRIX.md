# AndroScrn Feature Test Matrix (2026-10-21)

| Feature | Method | Result | Status | Blocker |
|---|---|---|---|---|
| ADB discovery (bundled adb.exe, `devices -l`) | Ran binary | Device listed, authorized | VERIFIED ON HARDWARE | |
| Try Again opens visible CMD console | Hardware script + screenshot | Was broken (quoting); fixed, live output shown | VERIFIED ON HARDWARE | |
| Retry state machine (timeout, cancel, unauthorized, offline, multiple, error, dup-click, dispose, no overlap) | Unit, mock ADB | Pass | AUTOMATED TESTS PASS | |
| Retry result continues into renderer connection flow | deviceReady emit tested; App.tsx not exercised | | PARTIAL | GUI not run |
| Portable package ships diagnostics script | Script edited only | | UNTESTED | portable build not run |
| scrcpy mirroring launch/stop | Real device | Video up, clean stop | VERIFIED ON HARDWARE | |
| Session-ID isolation, rapid restart | Real device + diff review | No stale state, 0 orphans | VERIFIED AT RUNTIME | |
| SDK input on Xiaomi | Real device | INJECT_EVENTS error | BLOCKED | Phone: enable USB debugging (Security settings) |
| UHID input | Real device, launch only | Starts, no block error; no interactions tested | PARTIAL | touch/keyboard test needed |
| Camera and mirroring mutual exclusion | Code review of main.ts handlers | Stops conflicting session | PARTIAL | hardware NOT RUN |
| Camera Studio start/stop/retry | | | UNTESTED | |
| Audio, recording, virtual display, clipboard | | | UNTESTED | |
| Wireless pairing | Existing unit tests | | AUTOMATED TESTS PASS | no hardware run |
| IPC contract (preload vs main) | Static channel diff | Consistent | AUTOMATED TESTS PASS | |
| Settings persistence | | | UNTESTED | |
| Electron GUI startup | | | UNTESTED | |
| Webcam/V4L2, OTG, gamepad | | | UNSUPPORTED on Windows | |

## Round 2 updates (supersede earlier rows where they overlap)
| Feature | Method | Result | Status | Blocker |
|---|---|---|---|---|
| Electron GUI startup, render, device list | Playwright on real Electron | OK, no console errors | VERIFIED AT RUNTIME | |
| Try Again button (banner) | Real GUI click | Was crashing UI (fixed); CMD console opens | VERIFIED AT RUNTIME | |
| Start/Stop Mirroring via UI | Real GUI + hardware | Works, process cleaned | VERIFIED ON HARDWARE | |
| Camera Studio via UI | Real GUI + hardware | Was failing at 4000x3000 default (fixed); runs at 1920x1080 | VERIFIED ON HARDWARE | 4000x3000 still rejected by this phone's encoder |
| Camera module start/stop/no-retry-after-stop | Hardware script | Pass | VERIFIED ON HARDWARE | |
| Camera <-> mirroring exclusion | Real GUI + process list | One scrcpy process, UI state consistent | VERIFIED ON HARDWARE | |
| Camera recording (MP4) | Hardware + ffmpeg | Was corrupt; now valid 7.98 s | VERIFIED ON HARDWARE | |
| Mirror recording (MP4 + audio) | Hardware + ffmpeg | Valid 7.30 s video + Opus | VERIFIED ON HARDWARE | |
| UHID left click / scroll / middle-click Home | Hardware via desktop automation | Observed working | PARTIAL | pointer capture prevents absolute targeting |
| UHID right-click Back | Hardware | Seen once (Flipkart double-back toast), not reproduced | PARTIAL | |
| UHID keyboard typing | | | UNTESTED | needs focused text field + captured pointer |
| Frontend typecheck | tsc on apps/desktop/src | Was not running; now clean | AUTOMATED TESTS PASS | |
| Captures actions (refreshCaptures, Open Captures) | typecheck only | Fixed undefined refs | AUTOMATED TESTS PASS | not clicked in GUI |

## Round 3 updates (supersede earlier rows where they overlap)
| Feature | Method | Result | Status | Blocker |
|---|---|---|---|---|
| UHID keyboard typing + Backspace | Hardware, SendKeys to scrcpy window, uiautomator | "wifi" typed correctly | VERIFIED ON HARDWARE | |
| UHID Escape as Back | Hardware | No navigation | PARTIAL | |
| Wireless input validation (IP/port/PIN) | Module on hardware host | Rejected instantly | VERIFIED AT RUNTIME | |
| Wireless connect/pair timeouts | Real adb, unreachable host | 8 s / 10 s bounded | VERIFIED AT RUNTIME | |
| USB-to-Wi-Fi handoff | Hardware | Fails (network isolation); now reverts to USB with clear message | PARTIAL | campus Wi-Fi client isolation |
| Wireless pairing (Android 11+ code) | | | BLOCKED | Wireless debugging + code on phone, non-isolated network |
| mDNS discovery | Real adb | Supported, 0 endpoints | VERIFIED AT RUNTIME | |
| Settings / alias persistence | Restart test in real app | Not persisted; no settings store | UNSUPPORTED | product decision; docs overstate |
| Portable package build | package-portable.ps1 to scratch dir | Builds, includes diagnostics script | VERIFIED AT RUNTIME | |
| Packaged GUI + Try Again | Playwright on packaged exe | Works, CMD console opens | VERIFIED AT RUNTIME | |
| Packaged CLI `devices` | Ran exe | Lists phone | VERIFIED ON HARDWARE | |

## Round 4 updates
| Feature | Method | Result | Status | Blocker |
|---|---|---|---|---|
| Settings persistence (alias, quality preset, input mode) | Unit (37) + restart test in real Electron app | Survives restart | VERIFIED AT RUNTIME | |
| Corrupt / partially invalid settings recovery | Unit + real app with truncated and invalid files | Backup kept, defaults or valid fields restored, WARN logged | VERIFIED AT RUNTIME | |
