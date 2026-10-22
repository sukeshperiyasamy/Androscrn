# AndroScrn Phase 7 Test Matrix

Run date: 2026-10-22. Methods: **Unit** (Node, mocked ADB/scrcpy), **UI** (`npm run test:ui`, built UI in Chromium with a mocked main process), **Hardware** (real Electron app, Xiaomi 21091116I over USB, screenshots or process/command-line inspection). Hardware results are never inferred from mocked ones.

## A. Reconnection and session recovery

| Scenario | Expected | Actual | Method | Result |
|---|---|---|---|---|
| Disconnect and reconnect, same phone | Reconnecting, then session restored with the same settings | Restored with identical UHID arguments, one process | Unit + Hardware | Pass |
| Delayed reappearance | Keeps waiting (bounded), restores when found | Restored after the phone returned ~15 s later | Unit + Hardware | Pass |
| Phone stays away | After the time limit: "Couldn't reconnect" + Resume session; no auto start later | As expected | Unit | Pass |
| Unauthorized phone | Explains what to do, never restored while unauthorized; restores once authorized | As expected | Unit | Pass |
| ADB/search cannot start | "Couldn't reconnect: the device search could not start" | Covered through the failed-search path | Unit | Pass |
| scrcpy exits with an error (exit 1) | Reported, no retry, Resume offered | As expected | Unit | Pass |
| User stop | Never triggers recovery | As expected (also a later exit event) | Unit + Hardware | Pass |
| Window closed by the user (exit 0) | Treated as a stop | As expected | Unit | Pass |
| Manual cancel (banner or Try Again's cancel) | Search cancelled, no restore later | As expected | Unit + UI | Pass |
| Repeated disconnect events | One search only | As expected | Unit | Pass |
| Duplicate searches | Not started twice | As expected | Unit | Pass |
| Several phones | Another phone never mirrored automatically; keeps waiting for the original serial | As expected | Unit | Pass (mock); NOT RUN with two phones |
| Stale callbacks | Events of an old recovery ignored after cancel/new session | As expected | Unit | Pass |
| Bounded restores | 4th drop within 2 min not restored automatically; manual Resume still works | As expected | Unit | Pass |
| Shutdown during recovery | Search cancelled, listeners removed, nothing restored | As expected | Unit | Pass |
| Camera Studio untouched | Restore refused while the camera uses the phone; camera not stopped | Refusal path covered | Unit | Pass |
| Targeted device search | Ignores other authorized phones | As expected | Unit | Pass |
| Banner wording/state | Real states only; spinner only while active | As expected | UI | Pass |
| Phone unplugged (cable) and replugged | Same behaviour | NOT RUN in this phase | — | NOT RUN |

## B. Clipboard

| Scenario | Expected | Actual | Method | Result |
|---|---|---|---|---|
| No phone / not mirroring | Button disabled / "Start mirroring first." | As expected | UI + Hardware | Pass |
| Empty clipboard | Clear message, nothing sent | "Your PC clipboard has no text to send." | Hardware | Pass |
| PC → phone, sync on (UHID), Unicode | Pasted into the focused field | Pasted exactly (Hindi, accented, Chinese, symbols) | Hardware (screenshot) | Pass |
| PC → phone, sync off | Copied only, honest message | Text on the phone clipboard, not pasted, message says so | Hardware | Pass |
| PC → phone in SDK mode on this Xiaomi | Cannot paste (input injection blocked) | Copied to the phone's clipboard only | Hardware | Limitation (phone setting) |
| Phone → PC, sync on | PC clipboard updated | Updated, stable for 3 s | Hardware | Pass |
| Phone → PC, sync off | PC clipboard untouched | Untouched | Hardware | Pass |
| No feedback loop | PC clipboard not rewritten | Stable | Hardware | Pass |
| Default is opt-in | Sync off by default; scrcpy started with `--no-clipboard-autosync` | As expected | UI + Hardware (command line) | Pass |
| Setting saved and restored | Clipboard preference persists | As expected | Unit + UI + Hardware | Pass |
| Large text | Over 100,000 characters refused with a message | Implemented; not exercised end to end | Code | NOT RUN (end to end) |
| Multi-line text | Supported as plain text | Not pasted on hardware (single-line field only) | — | NOT RUN |
| Device disconnect during a send | Error message, no crash | Not exercised | — | NOT RUN |
| Old-session clipboard event after switching phones | Not applicable: AndroScrn does not relay clipboard events (scrcpy sync lives in its process) | — | Design | N/A |
| Clipboard text in logs | Only the length is logged | As designed | Code review | Pass |

## C. Device profiles

| Scenario | Expected | Actual | Method | Result |
|---|---|---|---|---|
| Create / read / update / delete | Works; ids generated; edit keeps creation time | As expected | Unit + UI + Hardware | Pass |
| Persistence across restart | Profiles and settings survive | As expected | Unit + Hardware | Pass |
| Invalid / unsupported settings | Whole save refused, field named; raw args refused | `extraArgs` refused | Unit + Hardware | Pass |
| Duplicate name | Refused (case-insensitive) | As expected | Unit + UI + Hardware | Pass |
| Name rules | 1–48 chars, no control characters | As expected | Unit | Pass |
| Malformed stored data | Bad entries dropped, valid kept, file repaired | As expected | Unit | Pass |
| Migration from version 1 | Loads, new defaults, rewritten as version 2 | As expected | Unit | Pass |
| Profile for another phone | Warning and confirmation | As expected | Unit + UI | Pass |
| Apply with no phone | Refused with guidance | As expected | Unit + UI | Pass |
| Apply during mirroring | Lists changes, asks, "Apply and restart" or Cancel | As expected; cancel leaves session untouched | UI | Pass |
| Unspecified settings | Left as they are, listed | As expected | Unit + UI | Pass |
| Unrelated settings preserved | Aliases and current settings kept | As expected | Unit | Pass |
| Storage unavailable | Error reported, no phantom profile | As expected | Unit | Pass |
| Limit | 50 profiles | As expected | Unit | Pass |
| Delete confirmation | Cancel keeps, Delete removes | As expected | UI | Pass |
| Applying never starts mirroring/camera/power actions | Settings only | As designed | Code review | Pass |
| Apply on the real phone with a running session | Restart with profile | Not run on hardware (confirmation flow covered by UI scenario) | — | NOT RUN |

## D. Regression (hardware, real app)

Discovery; Try Again with diagnostics window; mirroring start/stop; live SDK→UHID switch; Camera Studio start/stop; companion pairing; preset persistence; clean shutdown with no processes or ADB forwards: **14/14 pass**.

## E. Automated totals

Typecheck 0 errors; unit 1413/1413; integration 39/39; UI 204/204; build and docs check pass.
