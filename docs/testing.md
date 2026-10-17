# AndroScrn Testing Guide

Run commands from the repository root. Every `test:*` script compiles TypeScript first (`tsc -p tsconfig.json`).
Result counts change as tests are added: read the `RESULTS` line each command prints. The last recorded run is in
[section 7](#7-current-validation-status); the README deliberately contains no test totals.

## 1. Commands

| Group | Command | Needs a phone? | Notes |
| :--- | :--- | :--- | :--- |
| Everything automated | `npm test` | No | Unit, integration and Playwright UI suites in sequence. |
| Unit suite | `npm run test:unit` | No | Prints `UNIT TEST RESULTS: passed/total (failed, skipped)` and lists every skipped test with its reason. Skips are never counted as passes. |
| Native CLI launcher only | `npm run test:native-cli` | No | See section 2. |
| PATH logic only | `npm run test:path` | No | See section 3. |
| Discovery, OEM guidance, wireless validation, redaction | `npm run test:discovery` | No | All ADB and network behavior is **mocked**. |
| Document intelligence (OCR) | `npm run test:document` | No | Synthetic images; the engine is scripted except for one smoke test of the real tesseract.js engine (skipped with a reason if unavailable). See [document-intelligence.md](document-intelligence.md). |
| Documentation checks | `npm run docs:check` | No | Relative links and anchors, `npm run` references, no local paths or private IPs, README stays a landing page. |
| Integration | `npm run test:integration` | No | |
| Playwright UI | `npm run test:ui` | No | Needs Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` and a built UI (`npm run build`). The UI runs against a mocked `androscrnApi`. |
| Hardware validation | `npm run test:hardware` | **Yes** (USB, authorized) | Reports `BLOCKED` (not a failure, not a pass) for operations the phone's vendor policy forbids, such as touch injection on some Xiaomi builds. It injects real touch events and records a camera, so run it only on a phone you control. |
| Full build | `npm run build` | No | |
| Portable build | `npm run build:portable` | No | Produces `dist-release/` (git-ignored). Windows only. |

## 2. Native CLI test prerequisites

`npm run test:native-cli` never relies on whatever `androscrn.exe` happens to be installed or built:

- **Fixture build.** The launcher is compiled from `packaging/portable/androscrn-cli.cs` into a fresh temp folder using the .NET Framework `csc.exe` (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`). If `csc.exe` is missing the test is **skipped with that reason**.
- **Portable artifact.** If `dist-release\AndroScrn-portable-win-x64\androscrn.exe` exists (from `npm run build:portable`) it is tested too; otherwise that part is skipped with the hint to build it.
- **No accidental installed copy.** Executables are launched by absolute path, from a temp working directory, with a `PATH` from which any folder containing `androscrn.exe`/`androscrn.cmd` has been removed.
- **Console-encoding independence.** The launcher prints an em dash without setting an output encoding, so the character that reaches a pipe depends on the parent's console code page. The tests assert ASCII text only. (This was the root cause of the earlier intermittent `--help` failure when tests were run from Git Bash instead of PowerShell.)
- **Cleanup.** Only the temp folders the test created are removed.
- **Diagnostics.** A failing check prints exit status, signal, spawn error, and the first part of stdout/stderr.

## 3. How PATH tests are isolated

PATH management lives in `modules/cli/path-utils.ts`:

- Pure functions (`normalizePathEntry`, `parsePathList`, `addPathEntry`, `removePathEntry`) do all the string work: case-insensitive comparison, quote/slash/trailing-separator normalization, duplicate prevention, removal of only the intended entry, preservation of unrelated and malformed entries.
- A `UserPathStore` interface hides persistence. Production uses `PowerShellUserPathStore`; tests inject `MemoryUserPathStore`. The CLI never writes after a failed read, so a read error cannot overwrite the existing PATH.
- The suite takes a **read-only snapshot** of the real User PATH before it starts and asserts it is byte-for-byte unchanged at the end. If the snapshot cannot be taken, that check is reported as skipped.
- Writing a persistent User variable on Windows takes roughly 6-7 s because of the settings-change broadcast. The old 8 s timeout made the real `setup-path` tests fail intermittently; the production timeout is now 60 s.

Optional test of the real PowerShell persistence layer (opt-in, about 30 s, uses a **disposable** variable and never touches PATH):

```bash
ANDROSCRN_TEST_REAL_ENV=1 npm run test:path
```

On PowerShell: `$env:ANDROSCRN_TEST_REAL_ENV=1; npm run test:path`.

## 4. What needs a physical phone

| Area | Automated without a phone | Requires a phone |
| :--- | :--- | :--- |
| USB enumeration, properties, guidance | Parsing and logic with recorded ADB output | `npm run test:hardware`, plus the read-only probe in section 5 |
| Wireless discovery | Parsing, validation, gating, cancel/timeout (mocked) | Real mDNS advertisement, pairing, connect, disconnect (section 5) |
| Touch injection | Failure reporting | Only a phone that permits injection can verify success |

## 5. Manual wireless-debugging test plan (hardware)

Prerequisites: Android 11+ phone, same Wi-Fi network as the PC, bundled ADB (`bin\scrcpy-win64\adb.exe`), no VPN or client isolation.

1. Record: Windows version, `adb version`, phone model, Android version and API level.
2. On the phone enable **Developer options -> Wireless debugging**. (AndroScrn never does this for you.)
3. Run `bin\scrcpy-win64\adb.exe mdns check` (expect a daemon version) and `... mdns services`. Record whether a `_adb-tls-connect._tcp` endpoint appears.
4. In AndroScrn open **Wireless & Hotspot -> Discover Wireless Devices**. Record the endpoints listed. Confirm nothing connected on its own (`adb devices`).
5. On the phone choose **Pair device with pairing code**. Rediscover, select the pairing endpoint, enter the 6-digit code, and confirm the native dialog. Record success/failure.
6. Rediscover, select the connection endpoint, confirm, and record whether the device appears in `adb devices` and in the app.
7. Disconnect (`adb disconnect <ip:port>`), confirm the device disappears, and turn Wireless debugging off. Record cleanup results.
8. Decline the confirmation dialog once for each of pair and connect and confirm nothing happens.

Record USB and wireless results separately. Until a run is recorded in `docs/compatibility.md` section 10, wireless hardware status is **Not tested**.

## 6. Browser launch guard

**Problem (fixed in Phase 10.2):** every run of the unit suite opened the default browser on the documentation website.
**Cause:** the CLI `docs` test called the real launcher (`cmd.exe /c start "" <url>`). Reproduced with
`scripts/trace-spawns.js`, which logs every child process:

```bash
SPAWN_TRACE_LOG=trace.log NODE_OPTIONS="--require ./scripts/trace-spawns.js" node dist/tests/unit/runner.js
```

Before the fix the log contained exactly one `cmd.exe /c start "" https://...` entry per unit-suite run (and none for the
integration or UI suites); after the fix it contains none.

**Fix:** the launcher is injectable (`openUrl`, `openInDefaultBrowser(url, platform, spawnFn)`), and tests use a recorder
or a fake `spawn`. `androscrn docs` still opens the browser once per explicit request, and only `http(s)` URLs without shell
metacharacters are accepted.

**Guard:** `tests/unit/launch-guard.ts` blocks and records any browser, URL or HTML launch during the whole unit run and
the suite fails if one was attempted. To check a test run yourself, use the tracer above and search for `start` or
`xdg-open`.

## 7. Current validation status

_Last verified: 2026-10-18, Windows 11 (build 10.0.26200), Node 22 on the host, bundled ADB 1.0.41, Electron 31.7.7. These
results belong to the commit that contains this file; re-run the commands above for anything later._

| Check | Command | Result |
| :--- | :--- | :--- |
| Unit suite (3 consecutive runs) | `node dist/tests/unit/runner.js` | 908 passed, 0 failed, **1 skipped**, in each of three runs |
| Native CLI launcher | `npm run test:native-cli` | 15 passed (fixture build and the portable artifact exe) |
| PATH logic | `npm run test:path` | 67 passed, **1 skipped** (opt-in real-persistence check) |
| Discovery, OEM guidance, wireless validation | `npm run test:discovery` | 222 passed |
| Document intelligence | `npm run test:document` | 146 passed, including the real-engine smoke test on a synthetic image |
| Integration | `npm run test:integration` | 39 passed |
| Playwright UI (mocked IPC) | `npm run test:ui` | 151 passed |
| Full build | `npm run build` | succeeded |
| Portable build | `npm run build:portable` | succeeded (about 148 MB zipped) |
| Documentation checks | `npm run docs:check` | passed |

**Skipped:** *Real PowerShell persistence round-trip* - opt-in (`ANDROSCRN_TEST_REAL_ENV=1`); it writes and deletes a
disposable User variable and is last known to pass from the Phase 10.1 run, not re-run here.

**What these results do and do not show**

- Automated tests use recorded ADB output, fakes and synthetic images. They are not hardware evidence.
- **Physical-device validation (USB):** last performed in Phase 10.1 on a Xiaomi `21091116I` (Android 13, API 33,
  HyperOS): the hardware suite passed except one operation reported as **blocked** (touch injection refused by the
  device). It was **not re-run** for Phase 10.2 or Phase 11.
- **Wireless debugging on a physical phone: Not tested.** Use the procedure in section 5.
- **OCR accuracy on real documents: not measured.** The only recognizer run is on a generated block-letter image.
- **Windows ARM64:** untested ([platform-support.md](platform-support.md)).

Earlier, superseded transcripts of the test suites are kept for history in
[qa/2026-10-readme-validation-history.md](qa/2026-10-readme-validation-history.md).
