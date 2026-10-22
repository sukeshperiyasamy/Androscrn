# AndroScrn Phase 7 — Enhanced Remote Control MVP Report

Date: 2026-10-22. Branch `audit/master-audit-fixes`, uncommitted changes on top of `950fb0b`. Device: Xiaomi 21091116I (Android 13, HyperOS), USB. Bundled scrcpy 5.0.1.

## Summary

Three features were added end to end (UI → preload → IPC → main process → persistence), reusing the existing managers:

- **Reconnection and session recovery:** a coordinator restores a mirroring session after a disconnect. It reuses `ConnectionRetryManager` for the bounded wait, so there is no second retry engine.
- **Clipboard:** an opt-in automatic sync setting plus a "Send clipboard to phone" action, built on scrcpy's own clipboard handling. No new backend was invented.
- **Device profiles:** versioned, validated profiles stored in the existing settings file, with a compact selector and dialogs.

Verified on the real phone: recovery after a disconnect, clipboard in both directions with Unicode text, profile save, restart and apply, and no regressions in mirroring, UHID, Camera Studio, the companion or Try Again.

## Existing implementation discovered (baseline)

| Area | Found |
|---|---|
| Disconnect handling | `ScrcpyManager` emitted `stopped` and, for exit code 2, `disconnected`. The UI showed a red "Device disconnected! Screen mirroring terminated" banner and did nothing else. `ConnectionRetryManager` (bounded, cancellable, session-guarded) existed but was only used for Try Again. |
| scrcpy exit codes | Observed on hardware: `adb reconnect` while mirroring gives exit code 2 and "WARN: Device disconnected". After `adb reconnect` the phone did not reappear for over 40 s; it came back after restarting the ADB server (see Remaining limitations). |
| Clipboard | scrcpy 5.0.1 has automatic two-way sync enabled by default (`--no-clipboard-autosync` disables it), MOD+v ("copy PC clipboard to device, then paste") and `--legacy-paste`. `ScrcpyOptions.noClipboardAutosync` existed but nothing in the UI used it, so clipboard sync was always on and invisible to the user. No "send" action. |
| Profiles | None. Settings (`SettingsStore`, version 1) held aliases, quality preset and input mode only. |

## Defects found and fixed

| # | Defect | Root cause | Fix | Test |
|---|---|---|---|---|
| R1 | A disconnect ended in a dead-end error banner; nothing tried to recover and the user's session settings were lost | No recovery logic existed | `SessionRecoveryCoordinator` (`modules/session_recovery`) | 41 unit checks + hardware run |
| R2 | A normal stop showed the last stderr line as an error ("Screen mirroring session closed: …") | The `stopped` handler always sent `lastError` | Exit reason computed in main (`user_stopped`, `window_closed`, `disconnected`, `failed`); only `failed` carries an error | UI + hardware |
| R3 | The UI de-selected the phone when it dropped and picked the first listed device when it came back, so with several phones the wrong one could be selected | `refreshDevices` only kept the current serial | The chosen serial is remembered and re-selected when it returns | Code review; not tested with two phones |
| R4 | The "mirroring stopped" check in the poll could never run (stale value captured by the timer), found in the UI pass and relied on here | Closure captured `isMirroring` | Ref-based read | Fixed earlier; used by recovery |
| C1 | Clipboard sync was always on with no setting and no way to see it | See baseline | Off by default; explicit setting; passed to scrcpy as `--no-clipboard-autosync` unless enabled | UI + hardware |
| C2 | First version of "Send clipboard" reported "pasted it" although the phone did not paste (hardware check: the text reached the phone's clipboard, the field stayed unchanged) | MOD+v injects a PASTE key, which this Xiaomi blocks (SDK injection restricted) | With sync on: Ctrl+V (scrcpy syncs, then forwards Ctrl+V as a hardware key) — verified pasting. With sync off: copy only, and the message says so | Hardware (screenshots) |
| P1 | Opening Camera/other tabs reloaded profile data only on mount | n/a | Profiles reload when Screen Mirroring opens | UI scenario |

## Architecture and integration points

**Recovery** (`modules/session_recovery/index.ts`, wired in `main.ts`)
- Eligibility: only a session the user started and did not stop; only scrcpy exit code 2 (disconnect). Exit 0 (window closed) counts as a stop; exit 1 is reported as an error and not retried.
- Waiting: `ConnectionRetryManager.startRetry({ targetSerial, openConsole: false })`, 60 s, 2 s interval. I added `targetSerial` so a search ignores other phones. ADB is never restarted; there is no diagnostics window.
- Guards: a recovery id (older recoveries are ignored), duplicate disconnect events are ignored, cancel/stop/dispose cancel the search, and at most 3 automatic restores within 2 minutes.
- Restore: `ScrcpyManager.startMirroring` with the remembered options on the same serial. If Camera Studio is using that phone, restore fails with a message; recovery never stops the camera.
- States and wording: Device disconnected → Reconnecting… → (Device found) → Restoring session… → Connection restored, or Couldn't reconnect / Reconnecting stopped with **Resume session**. Shown as a banner on every screen; the spinner appears only while a search or restore is active.
- IPC: `get-session-recovery-status`, `cancel-session-recovery`, `resume-session`; event `session-recovery-changed`.

**Clipboard** (`ScrcpyManager.sendClipboardToDevice`, `mirror-paste-clipboard`)
- Uses scrcpy's own shortcuts via the mirroring window (PowerShell `AppActivate` + `SendKeys`, the same mechanism as the existing "Focus Screen"). The text is not read in the app's logs: only its length is logged.
- Validation: mirroring must be running for the selected serial; empty text and text over 100,000 characters are refused with a message.
- Feedback loops and old-session events cannot occur in AndroScrn because it does not relay clipboard events: automatic sync is scrcpy's own, per process, and ends with the process.

**Profiles** (`modules/settings_store`, `apply.ts`)
- Same `settings.json` (now version 2: adds `clipboardSync` and `profiles`; version 1 files load with defaults).
- Profile = id (`p_` + 16 hex), name (1–48 chars, unique ignoring case), optional device serial/label, nine settings (quality, input mode, phone screen off, stay awake, always on top, orientation, record video, phone audio, clipboard sync), timestamps. Anything else is refused by name, so raw scrcpy arguments cannot be stored. No secrets are stored.
- Max 50 profiles. Damaged entries (bad id, duplicate name, non-object) are dropped on load; invalid settings inside a profile are dropped and the rest kept; the file is repaired.
- Applying is planned first (`planProfileApplication`, pure): what changes, what the profile does not specify (left as is), whether it is for another phone (confirmation), whether a running session needs a restart (explicit "Apply and restart", cancellable). Applying never starts mirroring or the camera.
- IPC: `profiles-list`, `profile-save`, `profile-delete`, plus clipboard preference through `get-settings`/`update-settings`.

## Files changed

New: `modules/session_recovery/index.ts`, `modules/settings_store/apply.ts`, `tests/unit/session-recovery.test.ts`, `tests/unit/device-profiles.test.ts`, `tests/ui/scenario-remote-control.ts`, `ANDROSCRN_PHASE7_REMOTE_CONTROL_REPORT.md`, `ANDROSCRN_PHASE7_TEST_MATRIX.md`.
Modified: `modules/settings_store/index.ts`, `modules/connection_retry/index.ts` (`targetSerial`), `modules/scrcpy_manager/index.ts` (`sendClipboardToDevice`), `apps/desktop/electron/main.ts`, `apps/desktop/electron/preload.ts`, `apps/desktop/src/App.tsx`, `tests/unit/connection-retry.test.ts`, `tests/unit/runner.ts`, `tests/ui/playwright-ui.test.ts`, `docs/usage.md`, `docs/troubleshooting.md`.

## Test results (final code)

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run test:unit` | 1413/1413 (1 opt-in skip); new: 41 recovery, 51 profile/clipboard-setting, 2 targeted-search checks |
| `npm run test:integration` | 39/39 |
| `npm run test:ui` | 204/204; new scenario: 22 checks (recovery banner, clipboard, profiles) |
| `npm run build` | pass |
| `npm run docs:check` | pass |

## Hardware results (real phone; automated tests above use mocks)

| Check | Result |
|---|---|
| Disconnect while mirroring with UHID settings (`adb reconnect`) | Banner "Device disconnected / Reconnecting…", scrcpy ended (exit 2); phone returned after an ADB server restart; mirroring restored automatically with the same arguments (`--keyboard=uhid --mouse=uhid …`), exactly one scrcpy process, banner "Connection restored" |
| User stop afterwards | scrcpy ended, recovery state `idle`, nothing restored; no scrcpy left after the app closed |
| Clipboard, nothing to send | Clear message "Your PC clipboard has no text to send." |
| PC → phone, sync on, UHID | Unicode text "नमस्ते héllo 你好 ✓ 100%" appeared in the phone's search field in one step (screenshot) |
| PC → phone, sync off | Text arrived on the phone's clipboard (keyboard suggestion showed it exactly) but was not pasted; the message says "Copied… paste manually" |
| Phone → PC, sync on | Text copied on the phone appeared in the PC clipboard and stayed stable (no overwrite loop) |
| Phone → PC, sync off | PC clipboard untouched |
| Profile save / reload / apply | Saved in the real app, listed after restart, applied (quality, input mode, clipboard sync); duplicate name and an unsupported field (`extraArgs`) refused; test profile deleted afterwards |
| Regression (14 checks): discovery, Try Again + diagnostics window, mirroring start/stop, SDK→UHID switch, Camera Studio start/stop, companion pairing, preset persistence, clean shutdown | All passed |

## Remaining limitations

- **`adb reconnect` is not a normal unplug.** After it, the phone stayed absent until the ADB server was restarted, so the hardware recovery run restarted ADB to bring the phone back. The recovery logic itself does not restart ADB. A real cable unplug and replug was not tried in this phase (it was in Phase 6 for the companion).
- Multi-line text: unit-level handling is plain text; on the phone only single-line fields were available for checking, so multi-line paste was not verified on hardware.
- Large clipboard payloads (up to 100,000 characters) were validated in the app but not pasted at that size on the phone. UHID mode types hardware key presses and may be slow for long text.
- The clipboard action depends on window focus (`AppActivate`/`SendKeys`); a minimized phone window gives an error message.
- Typing speed through UHID: an earlier test showed characters dropped when the PC types very quickly into the phone window; Send clipboard does not type, so it is not affected.
- Profiles do not store camera settings, wireless connection details or window geometry; those are not configurable in the current app.
- Multiple phones: recovery waits for the original serial only and re-selects it (R3), tested with mocks, not with two real phones.
- Recovery restarts only mirroring; a Camera Studio session is never recovered automatically.
