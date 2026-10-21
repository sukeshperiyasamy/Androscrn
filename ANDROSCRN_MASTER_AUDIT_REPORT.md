# AndroScrn Master Audit Report (2026-10-21)

Scope note: this audit was run in one session. Depth was concentrated on the Try Again / connection-retry
path, scrcpy lifecycle and a bounded hardware pass. Other areas were inventoried and baseline-tested but NOT
exhaustively traced (see "Not audited in depth"). Nothing was committed, pushed or discarded.

## Architecture (verified from the tree)
Electron main (`apps/desktop/electron/main.ts`, 68 IPC handlers) + preload + React `App.tsx` (4.9k lines);
backend modules in `modules/`: device_manager, connection_manager, connection_retry (new, uncommitted),
scrcpy_manager, camera_manager, companion_client, diagnostics, wireless_discovery, workflow_engine,
document_intelligence, lab_inspection, oem_guidance, mcp, security, cli. Bundled ADB + scrcpy 5.0.1.

## Baseline (before changes)
typecheck PASS; unit 1211/1211; integration 39/39; build PASS.
Preload/main channel check: every invoke channel has a handler; the 9 push-only channels
(camera-status-changed, connection-retry-*, mirror-status-changed, mcp-*, document-ocr-progress) are all emitted by main.

## Defects found
| # | Defect | Root cause (confirmed) | Fix | Regression test |
|---|---|---|---|---|
| 1 | Try Again opened a CMD window that only printed "The filename, directory name, or volume label syntax is incorrect." and never ran ADB | Doubled-quote escaping inside PowerShell `-Command` / `Start-Process -ArgumentList` (`modules/connection_retry/index.ts`, `launchDiagnosticConsole`) | New exported `buildConsoleLaunch`: single `cmd /k ""script" "adb" ..."` line passed via `-EncodedCommand`; metacharacter paths rejected; fallback uses verbatim args | connection-retry Scenario 10 |
| 2 | Even when launched, console printed "verified by AndroScrn UI" with no ADB output | App's first poll wrote `success.flag` before the script's first iteration | `scripts/adb-diagnostics.cmd` honors `success.flag` only after attempt 1 | Scenario 10 (script check) + physical screenshot |
| 3 | Slow ADB could stack overlapping polls (setInterval + async) | No re-entrancy guard in `executePollStep` | `pollInFlight` guard | Scenario 11 |
| 4 | Portable package never shipped `adb-diagnostics.cmd`, so a packaged app could not open the console | `packaging/portable/package-portable.ps1` omitted it | Copy to `scripts\` | NOT RUN (portable build not executed) |

## Observations not fixed
- `ScrcpyManager.lastError` stores any stderr line (including INFO output), so "last error" can show non-errors.
- `status.windowTitle` reverts to "AndroScrn Display" after stop; `exitCode` is null after a normal stop.
- `ConnectionRetryManager.dispose()` removes all listeners; fine for quit, but a re-created window would not get events.
- Retry session temp dirs are only removed in `dispose()`.

## Not audited in depth (UNTESTED or baseline-only)
App.tsx control-by-control trace, wireless pairing flows, audio/recording output verification, virtual display,
settings persistence/corruption recovery, camera retry bounds on hardware, Electron GUI runtime run,
clipboard copy/paste end to end.

## Physical device (Xiaomi 21091116I, Android 13, serial kjizrsgekfsglvgi)
- Try Again: real CMD window physically observed (screenshot) showing timestamped `adb devices -l` output and SUCCESS banner. VERIFIED ON HARDWARE.
- Mirroring (SDK and UHID launch args), 7 s each: video decoded 864x1920. VERIFIED ON HARDWARE.
- SDK mode: scrcpy server reported INJECT_EVENTS / "USB debugging (Security Settings)" error: confirmed Xiaomi limitation (BLOCKED by phone setting).
- UHID mode: no input-blocked error; actual click/drag/scroll/typing NOT performed. Input = PARTIAL.
- Rapid start-start-stop cycle: single active process, clean stop, 0 leftover scrcpy.exe. VERIFIED AT RUNTIME.
- Camera Studio and audio/recording: NOT RUN.

## Final results (after changes)
typecheck PASS, unit 1217/1217 (6 assertions added), integration 39/39, build PASS, docs:check PASS.
Electron GUI runtime: NOT RUN. All pre-existing working-tree modifications preserved.

## Files changed by this audit
modules/connection_retry/index.ts, scripts/adb-diagnostics.cmd, tests/unit/connection-retry.test.ts,
packaging/portable/package-portable.ps1, plus the three report files.

---
# Round 2 (same day): UHID input, Camera Studio, recording, Electron GUI

## Additional defects found and fixed
| # | Defect | Root cause (confirmed) | Fix | Regression test |
|---|---|---|---|---|
| 5 | Clicking Try Again in the connection-help banner crashed the whole UI ("Workbench Interface Error: retryAttempt is not defined") | `ConnectionHelp` read `retryAttempt`/`onCancelRetry` but never destructured them from props (`ConnectionHelp.tsx`) | Destructure both props | Playwright GUI run (no pageerror after click) |
| 6 | Frontend was never type-checked: `typecheck` and `apps/desktop` `tsc` had no tsconfig, so tsc checked nothing in `src/` (this hid #5) | Missing `apps/desktop/tsconfig.json`; root script ran a no-op | Added `apps/desktop/tsconfig.json`; root `typecheck` now passes `-p tsconfig.json` | `npm run typecheck` now covers `src/` |
| 7 | `refreshCaptures` and `getCapturesFolder` were undefined in `App.tsx` (pre-existing in HEAD): companion photo, timelapse stop, annotated export would throw ReferenceError; "Open Captures Directory" opened nothing | Missing definitions | Defined `refreshCaptures`; the Open button now opens the folder of the latest capture | typecheck (not exercised in GUI) |
| 8 | Camera recordings (and mirror recordings) were unplayable MP4s (no `moov` atom) | `stopCamera`/`stopMirroring` used `child.kill()` = TerminateProcess on Windows, so scrcpy could not finalize the file | New `gracefulStop` (taskkill without /F posts WM_CLOSE, bounded force-kill fallback) in `modules/scrcpy_manager/graceful-stop.ts`, used by camera and scrcpy managers | `tests/unit/graceful-stop.test.ts`; ffmpeg now reads cam 7.98 s H.264 2560x1920 |
| 9 | Camera Studio launched from the UI always failed ("Launch Failed", exit code 1) on the test phone | UI defaulted `--camera-size` to the sensor maximum 4000x3000; this phone's encoder throws IllegalArgumentException for it (reproduced with raw scrcpy). 1920x1080 works | `pickDefaultCameraSize` / `pickDefaultCameraFps` in `App.tsx` (largest size <= 1920 px, 30 fps if offered) | Playwright GUI run on hardware; no unit test (function lives in App.tsx) |
| 10 | Typecheck error: alertBanner type lacked 'warning'; lucide icons given `title` | Type/prop mismatches | Widened type; removed unsupported `title` props | typecheck |

## Round 2 hardware / runtime evidence
- UHID: two virtual "scrcpy" input devices registered; left click launched an app, mouse wheel scrolled Settings, middle click returned Home once. Right-click Back produced Flipkart's "Press again to exit" once, but was not reproduced on Settings. Alt+H did not trigger Home via synthetic keys.
- UHID semantics: scrcpy captures the mouse in UHID mode (relative pointer), so absolute-coordinate automation cannot target specific controls; several taps missed. Keyboard typing into a text field was NOT verified. Input remains PARTIAL, and absolute-click behaviour differs from SDK mode.
- `adb shell input` is rejected with INJECT_EVENTS on this phone, which confirms the SDK-mode blocker.
- Camera module: 5 cameras listed; start/stop twice clean; no retry after manual stop. scrcpy itself logs two transient "Capture/encoding error" lines then auto-retries (`-m2560`) and streams; the app lists those in `lastError` although the stream is healthy (cosmetic).
- Recording: camera 7.98 s H.264 valid after fix; mirror recording 7.30 s H.264 + Opus valid (ffmpeg probe).
- Electron app launched with Playwright (real Electron 31): window renders, device shown READY, no console errors, Try Again opens the real CMD window (screenshot), UI Start/Stop Mirroring works and `scrcpy.exe` count returns to 0, UI camera start works at 1920x1080, starting mirroring while camera is active leaves exactly one scrcpy process (mirroring) and the camera panel reverts to Start; closing the app leaves 0 scrcpy processes.

## Final results (after round 2)
typecheck PASS (now includes frontend), unit 1220/1220 (+3), integration 39/39, build PASS, docs:check PASS.
Still not covered: wireless pairing on hardware, audio-source options, virtual display, clipboard, settings persistence/corruption, keyboard typing via UHID, portable-package build, unauthorized/offline phone states on hardware.

---
# Round 3 (same day): UHID typing, wireless, settings persistence, portable build

## Additional defects found and fixed
| # | Defect | Root cause (confirmed) | Fix | Regression test |
|---|---|---|---|---|
| 11 | A failed USB-to-Wi-Fi handoff left the phone's adbd listening on TCP 5555 on the network, and the only message was "Command timed out." | `handoffUsbToWifi` ran `adb tcpip` but never reverted on connect failure; raw adb output passed through | On failure run `adb -s <serial> usb`; message names the target and explains same-network / client-isolation causes | runner.ts Group 5 (3 assertions, fake adb); re-run on hardware: device back in USB mode |
| 12 | Disconnect failure banner dropped the reason | `ConnectionManager.disconnect` returns `message`, App.tsx read only `res.error` | Read `res.error || res.message` | typecheck only |

## Round 3 evidence
- UHID keyboard (hardware): user unlocked the phone; Settings search opened over adb; keystrokes sent to the scrcpy window via WScript SendKeys. "wifix" + Backspace produced field text "wifi" (uiautomator dump). VERIFIED ON HARDWARE. Escape x2 did not navigate Back in that screen.
- Wireless (hardware + network): invalid IP/port and malformed PIN rejected instantly; unreachable connect times out at 8 s, unreachable pair at 10 s; phone Wi-Fi IP 172.31.116.120 detected; real handoff could not connect because the PC (172.31.116.122, same /18) cannot even ping the phone: campus Wi-Fi client isolation. `adb mdns check` works; discovery returns no endpoints (Wireless debugging off). Real pairing BLOCKED: needs Wireless debugging enabled on the phone, its pairing code, and a network without client isolation.
- Settings persistence (runtime): an alias set over IPC is lost after app restart; localStorage is empty; no settings file exists. The GUI exposes no alias editor. Presets, input mode and toggles are React state only. Status: UNSUPPORTED (not implemented), contrary to `docs/architecture.md` ("persistent preferences") and `docs/implementation-audit.md` (alias "Persisted"). Nothing transient survives restart (good). Not implemented here: adding persistence is a product decision.
- Portable build: `package-portable.ps1 -OutputDir <scratchpad>` succeeded (ZIP 148.22 MB); existing `dist-release` untouched. Package contains `scripts\adb-diagnostics.cmd`. Packaged `AndroScrn-gui.exe` launched (Playwright): device READY, no console errors, Try Again opened the CMD console using the packaged bundled adb (screenshot). Packaged `androscrn.exe devices` lists the phone. VERIFIED AT RUNTIME.

## Final results (after round 3)
typecheck PASS (0 errors, includes frontend), unit 1223/1223 (1 skipped), integration 39/39, build PASS, docs:check PASS, 0 leftover scrcpy.exe.

---
# Round 4: settings store

Added `modules/settings_store` (`SettingsStore`): `userData/settings.json` holding device aliases, quality preset and input mode only.
- Validation: presets/input modes from fixed enums; aliases need a valid serial (reserved keys like `__proto__` refused), max 64 chars, no control characters, max 200 entries; an update with any invalid field is rejected whole.
- Recovery: unreadable/truncated JSON or a non-object root is renamed to `settings.json.corrupt-<timestamp>` and defaults are used; invalid individual fields are reset and the file rewritten, valid ones kept; UTF-8 BOM tolerated. Both cases log a WARN line.
- Writes are atomic (temp file + rename); a failed write is reported and leaves in-memory settings unchanged.
- Wiring: main.ts loads at startup and re-applies aliases to DeviceManager; `set-alias` now persists; new `get-settings` / `update-settings` IPC (preload `getSettings`, `updateSettings`); App.tsx restores preset and input mode on mount and saves on change (only after the restore, so defaults never overwrite stored values).
- Tests: `tests/unit/settings-store.test.ts`, 37 assertions. Runtime (real Electron app): Battery Saver + UHID + alias survived restart; truncated file -> backup created, defaults, WARN logged; invalid inputMode -> reset to auto with preset and alias kept. Test files removed from userData afterwards.
- Docs: troubleshooting.md section added; implementation-audit.md alias row corrected.
Results: typecheck 0 errors, unit 1260/1260 (1 skipped), integration 39/39, build PASS, docs:check PASS.
