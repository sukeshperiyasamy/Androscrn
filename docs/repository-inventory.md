# Repository Inventory & Workspace Audit

**Date:** 2026-10-16  
**Environment:** Windows 11 x64 (Build 10.0.26200), Intel Core i5-11300H, 16 GB RAM, Intel Iris Xe Graphics  
**Auditor:** Senior Software Architect & Technical Lead (AndroScrn Project)

---

## 1. Executive Summary

This inventory documents the inspection of all relevant repositories, reference materials, local dependencies, and development tools available in the workspace. It strictly distinguishes between the three core software repositories identified in the prompt:

1. **Repository A — REA (`morluto/rea`)**: Reverse-engineering and binary analysis MCP server.
2. **Repository B — Android Control Center Reference**: The conceptual reference application for portable Windows Android wireless control.
3. **Repository C — scrcpy & Android SDK ADB (`Genymobile/scrcpy` & Google Android Platform Tools)**: The official screen-mirroring and device-bridge engines.

---

## 2. Repository A: REA (morluto/rea)

* **Repository URL:** `https://github.com/morluto/rea.git`
* **Local Clone Path:** `<USER_PROFILE>\Downloads\rea-research` (Cloned & Verified)
* **License:** MIT License (`LICENSE`)
* **Package Identity:** `rea-agents` (npm package), TypeScript/Node.js based Model Context Protocol (MCP) server.
* **Primary Purpose:**  
  REA (*Reverse Engineer Anything*) is an AI agent tool suite / MCP server providing inspection tools across native binaries (Ghidra, Hopper, IDA, Rizin), runtime process observation, memory inspection, network packet captures (pcap), SQLite databases, and Android application packages (APK, ADB device state).

### Verified Capabilities Relevant to AndroScrn:
* **`docs/adb-device-analysis.md`**: Fixed argument-vector execution for ADB commands, safe quotation without shell-string injection, enumeration of USB and TCP/IP devices, inspection of device properties (`ro.product.model`, `ro.build.version.release`), window hierarchies, package listing, logcat stream capture, and non-blocking probe checks (`inspect_adb_client`).
* **`docs/android-analysis.md`**: APK inspection, manifest parsing, permission audits, package extraction (`base.apk`), activity launching, and intent management.
* **Process Observation Architecture (`src/process/`, `src/signals/`)**: Child process supervision patterns, asynchronous stdout/stderr stream parsing, bounded timeouts, and explicit PID tracking to avoid orphaned processes or killing unrelated host processes.

### Clear Distinction & Boundaries:
* **REA is NOT an Android screen mirroring engine.** It does not capture display frames, encode H.264/H.265/AV1 video, or forward HID/touch inputs.
* **Reuse Assessment:** REA's safe ADB argument-vector patterns, process supervision patterns, and logcat parsing logic can be adapted and cleanly implemented in AndroScrn under MIT license compliance. No closed or proprietary code exists in REA.

---

## 3. Repository B: Android Control Center Reference

* **Source Status:** No verified official open-source Git repository exists under the exact trademark "Android Control Center" for the described portable Windows tool.
* **Documented Functionality:**
  1. Portable Windows desktop executable (zero mandatory external dependencies like Python).
  2. Wireless Android screen mirroring and remote input control.
  3. USB-assisted initial pairing and handoff to TCP/IP.
  4. Phone-hotspot connection support (automatic or guided IP discovery when phone is hotspot host).
  5. Simple Connect / Disconnect and Device Selector interface.
  6. No companion app required on the Android device (utilizing standard ADB permissions and system server).
* **Finding & Architecture Implication:**  
  The reference product represents a polished desktop GUI layer managing ADB and scrcpy under the hood, bundling portable binaries. Rather than copying an unverified executable, AndroScrn will directly architect and implement this workflow independently with modern technology, superior UI aesthetics, and enterprise-grade reliability.

---

## 4. Repository C: scrcpy & ADB (Genymobile & Google Android Open Source)

* **Official scrcpy Repository:** `https://github.com/Genymobile/scrcpy` (Genymobile)
* **scrcpy License:** Apache License 2.0 (`LICENSE`)
* **Local Source Snapshot:** `<USER_PROFILE>\Downloads\scrcpy-master` (scrcpy v5.0.1 source tree)
* **Verified Official Binary Release:** `scrcpy-win64-v5.0.1.zip`
  * Download URL: `https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip`
  * Official SHA-256 Hash: `b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5`
  * Verification Result: **VALIDATED (MATCHED)**
  * Extracted Directory: `<USER_PROFILE>\Downloads\scrcpy-bin-v5.0.1\extracted\scrcpy-win64-v5.0.1\`
  * Bundled Binaries & Libraries:
    * `scrcpy.exe` (v5.0.1, SDL3 runtime)
    * `scrcpy-server` (Android jar server v5.0.1, runs on Android API 21+)
    * `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` (Google Android Platform Tools)
    * `SDL3.dll` (v3.4.18)
    * `avcodec-63.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll` (FFmpeg)
    * `libusb-1.0.dll`

* **Official ADB Installation:**
  * System Location: `<USER_PROFILE>\AppData\Local\Android\Sdk\platform-tools\adb.exe`
  * Version: Android Debug Bridge version 1.0.41 (Version 37.0.0-14910828)
  * Verification Result: Verified running and functional (`adb devices -l` active on port 5037).

---

## 5. Local System & Developer Environment Audit

| Tool / Runtime | Location | Version | Status |
| :--- | :--- | :--- | :--- |
| **Operating System** | Windows 11 Home / Pro x64 | Build 10.0.26200 | Verified |
| **Node.js** | `C:\Program Files\nodejs\node.exe` | v20.20.1 | Verified |
| **npm** | `C:\Program Files\nodejs\npm.cmd` | 10.8.2 | Verified |
| **Git** | `C:\Program Files\Git\cmd\git.exe` | 2.45.1.windows.1 | Verified |
| **ADB** | `<USER_PROFILE>\AppData\Local\Android\Sdk\platform-tools\adb.exe` | 1.0.41 (37.0.0) | Verified |
| **scrcpy binary** | `<USER_PROFILE>\Downloads\scrcpy-bin-v5.0.1\extracted\...\scrcpy.exe` | 5.0.1 | Verified |
| **Tesseract OCR** | `C:\Program Files\Tesseract-OCR\tesseract.exe` | v5.3.x | Verified |
| **Ollama AI** | `<USER_PROFILE>\AppData\Local\Programs\Ollama\ollama.exe` | v0.34.4 | Verified |
| **Python** | `<USER_PROFILE>\AppData\Local\Programs\Python\Python313\python.exe`| 3.13.x | Present (Not required for AndroScrn) |
| **Rust / Cargo** | Not installed in standard path | N/A | Evaluated for stack decision |
| **MSVC / C++ Tools**| Not installed | N/A | Evaluated for stack decision |

---

## 6. Integrity and Protection Rules

1. Existing files in `<USER_PROFILE>\Downloads\scrcpy-master` are preserved intact.
2. The cloned REA repository (`<USER_PROFILE>\Downloads\rea-research`) serves strictly as an analysis resource.
3. The new product **AndroScrn** is structured in its own self-contained directory with dedicated git history, documentation, tests, and build artifacts.
