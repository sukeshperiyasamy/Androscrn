# Technical Gaps & Architecture Solutions

**Document:** `docs/technical-gaps.md`  
**Date:** 2026-10-16  

---

## 1. Overview of Gaps Between Raw Tools and End-User Needs

While `scrcpy` and `adb` provide the underlying screen capture and device communication protocols, using them directly via the command line leaves critical gaps for typical desktop users and test engineers.

---

## 2. Comprehensive Gap Analysis

| Identified Gap | Problem in Raw scrcpy / ADB | AndroScrn Solution |
| :--- | :--- | :--- |
| **1. Device Discovery & Multi-device Selection** | Running `scrcpy` with multiple devices attached fails immediately with `adb: error: more than one device/emulator`. User must look up serial numbers manually. | Automatic background device polling. Visual device selector showing friendly names, battery level, serial numbers, and connection transport (USB vs Wi-Fi). |
| **2. Wireless Debugging Setup Complexity** | Connecting wirelessly requires running 3-4 separate terminal commands (`adb tcpip 5555`, finding IP via `ip addr`, `adb connect`). Rebooting the phone resets the port. | **1-Click Wireless Handoff**: AndroScrn automatically queries device IP over USB, sends `tcpip 5555`, connects over Wi-Fi, and prompts user when cable can be removed. |
| **3. Phone Hotspot Detection** | In mobile field environments where the laptop connects to the phone's hotspot, finding the phone's IP requires manual route checking. | **Smart Hotspot Discovery**: AndroScrn inspects the active Wi-Fi adapter's Default Gateway IP and probes port 5555 for instant connection. |
| **4. Process Supervision & Crash Recovery** | If scrcpy exits unexpectedly (e.g. Wi-Fi packet drop or unplug), the terminal window closes abruptly with no diagnostic explanation. | Supervised process manager tracks exit code (0 = clean, 1 = start fail, 2 = disconnected). Triggers automatic exponential backoff reconnection. |
| **5. Configuration & Quality Profiles** | Customizing bitrate, resolution, FPS, and display modes requires memorizing dozens of CLI switches (`--max-size`, `-b`, `--max-fps`, `--turn-screen-off`). | Visual preset switcher: "High Performance (60fps)", "Balanced (1080p)", "Battery Saver (720p 30fps)", plus custom sliders and toggles. |
| **6. Media & Recording Management** | Screen recordings and screenshots saved via CLI require specifying output paths and manual folder navigation. | Integrated Media Center: One-click screenshot, toggle recording, automatic timestamped organization (`Captures/`), thumbnail gallery, and explorer launcher. |
| **7. Device Diagnostics & Logcat** | `adb logcat` floods the screen with thousands of unformatted lines, overwhelming non-developers. | Filterable Logcat Studio: Search by app package, tag, or severity level (Error, Warn, Info). 1-click diagnostic zip export. |
| **8. Test Automation & Workflows** | No way to chain actions (e.g. wake phone -> launch app -> tap coordinate -> wait -> assert text) without writing custom bash or python scripts. | **Visual Workflow Runner**: Chain steps (Tap, Swipe, Input Text, Keyevent, Wait, Screenshot). Import/export JSON workflows. |
| **9. OCR & Intelligent Screen Analysis** | Scrcpy renders frames to an SDL window with no semantic or text access for automation. | Local OCR (Tesseract) integration: Snap device screen, extract text, locate bounding boxes, and find UI elements dynamically. |
| **10. Local AI Copilot** | No AI guidance for diagnosing errors or generating test steps without uploading confidential screenshots to the cloud. | Local Ollama integration: Private on-device analysis for log errors and test generation. Zero cloud data leaks. |
