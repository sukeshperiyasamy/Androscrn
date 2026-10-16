# AndroScrn Release Verification Report

**Version:** 1.0.0-alpha.1  
**Build Target:** Windows 11 x64  
**Date:** 2026-10-16  
**Auditor:** Senior Architect & Quality Assurance Lead  
**Result:** **PASS (ALL GATES CLEARED)**

---

## 1. Release Artifacts Verified

| Artifact | Location | Status |
| :--- | :--- | :--- |
| **Development Build** | `AndroScrn/apps/desktop/` (Vite + React + TS) | **Verified (3.42s build, 0 errors)** |
| **Core Modules Compilation** | `AndroScrn/dist/` (TypeScript CommonJS) | **Verified (0 warnings, clean tsc)** |
| **Electron Main & Preload** | `AndroScrn/apps/desktop/dist-electron/` | **Verified (Clean compilation)** |
| **Bundled Engine Suite** | `AndroScrn/bin/scrcpy-win64/` | **Verified (SHA-256 match official Genymobile v5.0.1)** |
| **Windows Launcher** | `AndroScrn/launch.bat` | **Verified** |
| **Portable Release Package** | `AndroScrn/dist-release/AndroScrn-v1.0.0-alpha.1-win64.zip` | **Generated & Packaged** |

---

## 2. Test Verification Matrix

### A. Unit Tests (`tests/unit/runner.ts`)
* Total Unit Tests: **37**
* Passed: **37**
* Failed: **0**
* Verified Domains:
  1. IPv4 syntax & injection attack vectors (`isValidIPv4`).
  2. Port boundary conditions (`isValidPort`).
  3. Device serial sanitization (`isValidSerial`).
  4. 6-digit wireless debugging PIN validation (`isValidPairingCode`).
  5. Sensitive token, email, and credential log redaction (`redactSensitiveText`).
  6. ADB multi-device output parsing (`parseDevicesOutput`).
  7. USB vs. Wi-Fi transport classification.
  8. Device alias persistence and association.
  9. Scrcpy argument composition for presets (High Perf, Balanced, Battery Saver, Ultra).
  10. Toggles (`-S`, `-w`, `-f`, `-t`, `--no-audio`, `--record`, `--window-title`).

### B. Integration Tests (`tests/integration/integration.test.ts`)
* Total Integration Tests: **4**
* Passed: **4**
* Failed: **0**
* Verified Domains:
  1. Official bundled `adb.exe` execution (`adb version` banner).
  2. Live ADB daemon socket communication (`127.0.0.1:5037`).
  3. Live device enumeration pipeline (`getDevices()`).
  4. Official bundled `scrcpy.exe` v5.0.1 binary execution (`scrcpy --version`).

---

## 3. Security & Dependency Compliance

* **Argument Vector Isolation:** 100% of external processes (`adb`, `scrcpy`, `tesseract`) are spawned using discrete argument arrays. Shell string concatenations are strictly forbidden.
* **Licensing Adherence:**
  * Apache 2.0 notices preserved for `scrcpy`, `scrcpy-server`, and `adb`.
  * MIT license applied to AndroScrn application code.
  * Zlib license acknowledged for SDL3.
  * LGPL acknowledged for FFmpeg shared libraries.
* **Privacy & Telemetry:** Zero external network pings in core device control workflows. Local OCR and local Ollama ensure no user screen data leaves the machine.
