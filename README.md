# AndroScrn

<div align="center">

# 📱 AndroScrn
### Next-Generation Android Control & Automation Platform for Windows

[![Windows 11](https://img.shields.io/badge/Windows-11%20%7C%2010%20x64-0078d4?style=for-the-badge&logo=windows&logoColor=white)](https://microsoft.com/windows)
[![scrcpy v5.0.1](https://img.shields.io/badge/Engine-scrcpy%20v5.0.1-brightgreen?style=for-the-badge)](https://github.com/Genymobile/scrcpy)
[![ADB Verified](https://img.shields.io/badge/Bridge-Google%20ADB%201.0.41-orange?style=for-the-badge)](https://developer.android.com/tools/adb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

*Ultra-low latency screen mirroring, 1-click wireless handoff, phone-hotspot discovery, recording studio, filtered logcat diagnostics, test automation workflows, and local AI assistance.*

</div>

---

## ✨ Key Features

* **⚡ Ultra-Low Latency Mirroring:** Powered by verified `scrcpy v5.0.1` (SDL3 + FFmpeg hardware acceleration on Intel Iris Xe). 35–70ms typical latency, up to 120 FPS.
* **📶 1-Click Wireless Handoff:** Connect via USB once; AndroScrn configures TCP/IP 5555, establishes the network bridge, and tells you when to unplug the cable.
* **🔥 Smart Hotspot Mode:** Connect your laptop to your phone's personal hotspot; AndroScrn automatically detects the phone's gateway IP (`192.168.43.1`) for instant connection.
* **🔐 Android 11+ Pair Wizard:** Clean pairing dialog with 6-digit PIN and port validation.
* **🎥 Integrated Recording Studio:** Single-click MP4/MKV video recording and PNG screenshots with zero CPU re-encoding overhead and automatic gallery organization in `Captures/`.
* **🔍 Filtered Logcat Studio:** Real-time log streamer with instant search, tag filter, level badges, and 1-click diagnostic export.
* **🤖 Test Automation & Workflow Runner:** Create and run reusable step workflows (`tap`, `swipe`, `keyevent`, `input_text`, `wait`, `screenshot`, `assert_text`).
* **🧠 Local AI & OCR Assistant:** On-device screen OCR via Tesseract and private local LLM diagnostic analysis via Ollama. 100% offline, zero cloud subscriptions.
* **🛡️ Enterprise Process Supervision:** Child processes are strictly managed via immutable argument vectors (zero shell injection), health monitoring, and exponential backoff auto-reconnect.

---

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
