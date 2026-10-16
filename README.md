# AndroScrn

<div align="center">

# 📱 AndroScrn
### Next-Generation Android Control & Automation Platform for Windows

[![Windows 11](https://img.shields.io/badge/Windows-11%20%7C%2010%20x64-0078d4?style=for-the-badge&logo=windows&logoColor=white)](https://microsoft.com/windows)
[![scrcpy v5.0.1](https://img.shields.io/badge/Engine-scrcpy%20v5.0.1-brightgreen?style=for-the-badge)](https://github.com/Genymobile/scrcpy)
[![ADB Verified](https://img.shields.io/badge/Bridge-Google%20ADB%201.0.41-orange?style=for-the-badge)](https://developer.android.com/tools/adb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

*Ultra-low latency screen mirroring, 1-click wireless handoff, phone-hotspot discovery, raw binary screenshot capture, filtered logcat diagnostics, test automation workflows, and diagnostic reports.*

</div>

---

## 🏗️ Architecture Status: Provisional Standalone Electron Distribution

> **Architecture Disclosure:** The approved long-term target architecture is **Tauri 2 + Rust + React/TypeScript** with an out-of-process MCP server over Windows Named Pipes (`\\.\pipe\androscrn-ipc`).
> Because the current development machine lacks the MSVC C++ build environment and Rust compiler, this release is distributed as a **provisional standalone Electron 31 + Node.js 20 LTS** portable package. All underlying device management, security, and process supervision logic is completely decoupled in `modules/` for future Rust porting.

---

## 📊 Feature Status Matrix (Evidence-Based Classification)

In compliance with strict verification standards, each capability is classified according to its actual verified status:

| Feature | Scope / Engine | Status | Notes |
| :--- | :--- | :--- | :--- |
| **USB Device Discovery & State Guidance** | Bundled ADB 1.0.41 parser | **Implemented & tested** | Multi-device parsing, state guidance (unauthorized, offline, ready). |
| **Multi-Device Serial Scoping** | `-s <serial>` argument isolation | **Implemented & tested** | Commands strictly target selected device; avoids multi-device collisions. |
| **Raw Binary Screenshot Capture** | `adb exec-out screencap -p` | **Implemented & tested** | Raw buffer streaming; PNG magic header (`89 50 4E 47`) verified. |
| **Captures Gallery & Folder Explorer** | Real filesystem scan of `Captures/` | **Implemented & tested** | Dynamic list of `.png` and `.mp4` files with system viewer launch. |
| **System Diagnostics & Report Export** | Bundled binary introspection | **Implemented & tested** | Version reporting (ADB 1.0.41, scrcpy 5.0.1) and redacted bug reports. |
| **Dual Log Streamer** | Device Logcat + Application Log | **Implemented & tested** | Live logcat viewing alongside `androscrn.log`. |
| **Quality Preset Switching** | Scrcpy argument composition | **Implemented & tested** | High (1080p·12M·60fps), Balanced, Fast presets verified. |
| **Screen Mirroring Lifecycle** | Bundled scrcpy 5.0.1 child process | **Implemented (pending hardware)** | Binary verified, duplicate guard active; needs physical device. |
| **Quick Remote Navigation** | ADB `input keyevent` with `-s` | **Implemented (pending hardware)** | Home, Back, App Switch, Power verified via CLI; needs physical device. |
| **1-Click Wireless Handoff** | TCP/IP port 5555 configuration | **Implemented (pending hardware)** | Automatic gateway probe verified; needs physical device. |
| **Android 11+ PIN Pairing** | `adb pair <ip>:<port> <pin>` | **Implemented (pending hardware)** | Regex & command syntax verified; needs physical device. |
| **Video Recording via scrcpy** | Pass-through `--record` muxing | **Implemented (pending hardware)** | Scrcpy option enabled; needs physical device. |
| **Automation Workflow Runner** | Step sequencer (`WorkflowEngine`) | **Implemented (pending hardware)** | Core execution loop verified; needs physical device. |
| **Tesseract OCR Analysis** | Tesseract 5.3 CLI on host | **Mocked / Preview** | Engine installed on host; renderer currently uses mock preview. |
| **Ollama Local AI Summary** | Local Ollama 0.34 API on host | **Mocked / Preview** | Engine installed on host; renderer currently uses mock preview. |
| **MCP Stdio Server** | Planned Model Context Protocol | **Not implemented** | Scheduled for Phase 2. |
| **Named-Pipe AI Firewall** | Planned security IPC bridge | **Not implemented** | Scheduled for Phase 2. |

---

## ✨ Implemented Core Features

* **⚡ Ultra-Low Latency Mirroring:** Powered by verified `scrcpy v5.0.1` (SDL3 + FFmpeg hardware acceleration). Safe argument-vector spawning, duplicate session prevention, and exit code tracking.
* **📱 Actionable Device Guidance:** Clear badges for `READY`, `UNAUTHORIZED`, `OFFLINE`, and `CONNECTING`, with instant instructions to unlock the screen and accept RSA debugging prompts.
* **📸 Reliable Raw Binary Screenshots:** Raw binary stream capture from device memory directly to disk with PNG magic byte validation, preventing UTF-8 conversion corruption.
* **📁 Real Captures Management:** Direct access to genuine screenshots and recordings saved in `Captures/` with 1-click viewing in Windows Photo Viewer or Explorer.
* **🛠️ System Diagnostics & Sanity Reports:** Introspects bundled ADB and scrcpy binaries, detects system health, and exports sensitive-redacted diagnostic reports for troubleshooting.
* **🛡️ Defensive Process Supervision:** Child processes spawned with strict input validation, non-shell execution (`shell: false`, `windowsHide: true`), and graceful teardown.

## 🚀 Quick Start (Development)

### Prerequisites
* Windows 10 or Windows 11 (x64)
* Node.js v20+ LTS (`npm install`)
* Android device with **USB Debugging** enabled (*Settings -> Developer Options -> USB Debugging*)

### Running in Development
```bash
# Navigate to the desktop app directory
cd apps/desktop

# Install dependencies
npm install

# Start development mode
npm run dev
```

### Running Tests
```bash
npm test
```

### Building Portable Windows Release
```bash
npm run build:portable
```

---

## 📄 Licensing & Acknowledgments

AndroScrn is an independent open-source project licensed under the [MIT License](LICENSE).
It integrates with and attributes:
* **[scrcpy](https://github.com/Genymobile/scrcpy)** by Genymobile (Apache License 2.0).
* **[Android Debug Bridge](https://developer.android.com/tools/adb)** by Google Android Open Source Project (Apache License 2.0).
* **[REA](https://github.com/morluto/rea)** by morluto (MIT License).
* **[FFmpeg](https://ffmpeg.org)** (LGPL v2.1+).
* **[SDL3](https://libsdl.org)** (zlib License).
