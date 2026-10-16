# Existing Capabilities & System Tooling Audit

**Document:** `docs/existing-capabilities.md`  
**Date:** 2026-10-16  

---

## 1. Verified System Hardware & Platform

* **Host Machine:** Windows 11 x64 (Build 10.0.26200)
* **CPU:** Intel(R) Core(TM) i5-11300H @ 3.10GHz (4 Cores / 8 Threads, AVX-512, Iris Xe Graphics)
* **RAM:** 16.0 GB physical memory
* **Graphics:** Intel(R) Iris(R) Xe Graphics (DirectX 12, Hardware H.264/H.265/AV1 decoding capabilities)
* **Storage:** Fast NVMe SSD

---

## 2. Verified Local Tooling & Execution Environment

### A. Official Android Debug Bridge (ADB)
* **Location:** `C:\Users\sukes\AppData\Local\Android\Sdk\platform-tools\adb.exe`
* **Version:** 1.0.41 (Version 37.0.0-14910828)
* **Status:** Verified active and listening on `tcp:5037`.
* **Associated Libraries:** `AdbWinApi.dll`, `AdbWinUsbApi.dll`

### B. Official scrcpy Release Suite
* **Release:** v5.0.1 (win64)
* **Source:** Official GitHub Release Asset `scrcpy-win64-v5.0.1.zip`
* **Integrity:** SHA-256 Checksum `b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5` (Verified matching official `SHA256SUMS.txt`).
* **Binary Location:** `C:\Users\sukes\Downloads\scrcpy-bin-v5.0.1\extracted\scrcpy-win64-v5.0.1\`
* **Component Inventory:**
  * `scrcpy.exe` (v5.0.1 executable, SDL 3.4.18, libavcodec 63.1.102, libavformat 63.1.102, libavutil 61.1.102, libusb 1.0.30)
  * `scrcpy-server` (Official Android JAR binary, 733,930 bytes)
  * `SDL3.dll`, `avcodec-63.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll`, `libusb-1.0.dll`

### C. Node.js & Web Platform Toolchain
* **Node.js:** `C:\Program Files\nodejs\node.exe` (v20.20.1 LTS)
* **npm:** `C:\Program Files\nodejs\npm.cmd` (10.8.2)
* **Package Managers:** `pnpm`, `yarn`, `npx` all available in `C:\Program Files\nodejs`
* **Vite / React:** Ready for zero-config bundling and rapid development.
* **Electron:** Supported out of the box with Node 20 LTS for zero-external-dependency portable Windows executables.

### D. Local OCR Engine
* **Tesseract OCR:** Installed and verified in `C:\Program Files\Tesseract-OCR\tesseract.exe`
* **Capability:** Local character recognition from captured screenshots without external APIs or cloud charges.

### E. Local AI Inference Runtime
* **Ollama:** Installed and verified at `C:\Users\sukes\AppData\Local\Programs\Ollama\ollama.exe` (Version 0.34.4).
* **Capability:** Local LLM inference (e.g. `llama3.2`, `qwen2.5-coder`, `mistral`) via standard local HTTP REST API (`http://localhost:11434/api/generate`) with zero cloud cost and full privacy.

---

## 3. Capability Matrix: Existing vs. AndroScrn New Implementation

| Functional Area | Current Raw Tooling Status | AndroScrn Target Implementation |
| :--- | :--- | :--- |
| **Device Discovery** | Raw CLI command `adb devices -l` | Reactive, auto-polling Device Manager with model names, USB/Wireless badges, battery status, aliases. |
| **Pairing & Handoff**| Manual command sequence | 1-Click USB-to-WiFi Handoff & Guided Android 11+ Pairing Wizard with PIN input. |
| **Hotspot Mode** | Manual IP subnet calculation | Auto-detect default gateway when connected to phone hotspot, instant 1-click connect. |
| **Mirroring Control**| CLI flags in command prompt | Visual controls: Quality presets (Low, Balanced, Ultra), FPS limiter, turn off screen on connect, stay awake. |
| **Process Supervision**| Unmanaged CMD window | Background child process manager with PID tracking, crash recovery, and exit code handling. |
| **Recording & Screenshots**| Scrcpy CLI flag `--record` | In-app capture button, gallery viewer, timestamped naming, auto-opening folder. |
| **Diagnostics & Logcat**| Verbose raw terminal dump | Filtered live logcat viewer, search by package/tag, 1-click diagnostic bundle export. |
| **Workflow Automation**| None | Visual test recorder/runner: Tap, Swipe, Wait, Assert text, UI reports. |
| **AI Assistant** | Standalone Ollama/Tesseract | Screen OCR analyzer, UI element detection, log summarization, structured workflow generator. |
