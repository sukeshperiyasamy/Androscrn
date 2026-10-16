# Architectural Integration Decision

**Document:** `docs/integration-decision.md`  
**Date:** 2026-10-16  
**Status:** Approved & Adopted  

---

## 1. Context and Problem Statement

To deliver AndroScrn as a premier, high-performance Android control platform on Windows, we must establish how the system interfaces with the underlying Android screen-streaming and device-communication layers.

We evaluated three potential architectural integration models:
* **Option A:** Thin CLI Wrapper.
* **Option B:** Modular Integration with Specialized Management Subsystems (Recommended).
* **Option C:** Full Native Reimplementation of scrcpy Streaming Protocol.

---

## 2. Evaluation of Architectural Options

### Option A: Thin Wrapper
* **Description:** A simple graphical front-end that only assembles command-line strings and launches standard `scrcpy.exe` and `adb.exe` in detached windows.
* **Pros:** Rapid initial prototype; very low code volume.
* **Cons & Risks:**
  * Highly brittle: Cannot reliably track subprocess lifecycles or catch mid-stream socket disconnections.
  * Poor user experience: Unhandled crashes, detached console flickers, and unhelpful exit errors.
  * Inability to support advanced features: Cannot coordinate OCR, workflow automation, custom overlays, or filtered logcat diagnostics.
* **Verdict:** **REJECTED** as insufficient for a commercial-grade product.

### Option B: Modular Integration Architecture (Chosen Strategy)
* **Description:** 
  Utilizes official, verified `scrcpy` (v5.0.1) and `adb` (v1.0.41) binaries as decoupled engine services, while surrounding them with an independent, robust application platform:
  * **Device Manager Module:** Dedicated polling, USB descriptor & TCP/IP discovery, state machine (offline, unauthorized, connected).
  * **Connection Manager Module:** USB-to-WiFi handoff, Android 11+ wireless pairing wizard, phone-hotspot gateway resolver, exponential backoff reconnect logic.
  * **Process Supervision & Lifecycle Module:** Clean process tree ownership, argument-vector isolation (no shell injection), pipe management, non-blocking asynchronous event streaming, graceful shutdown.
  * **Screen & Control Manager:** Quality profile presets, window geometry persistence, recording management, screenshot acquisition.
  * **Workflow & Automation Engine:** Programmatic step execution (tap, swipe, keyevent, text assertion).
  * **Local Intelligence Layer:** On-device OCR (Tesseract) and offline AI (Ollama).
* **Evidence & Benefits:**
  * **Low Latency & High Frame Rate:** Leverages Genymobile's heavily optimized C/SDL3/FFmpeg video pipeline (35-70ms latency, up to 120fps hardware acceleration via Intel Iris Xe).
  * **Rock-Solid Stability:** Eliminates protocol maintenance overhead while providing deep application control, rich UX, and resilience.
  * **Security & Portability:** Bounded, local-first execution with pinned binaries and verified checksums.
* **Verdict:** **SELECTED (APPROVED)**

### Option C: Native Reimplementation of scrcpy Protocol
* **Description:** Writing a custom video decoder and Android server daemon from scratch in Rust, C++, or C#.
* **Evaluation:**
  * *Limitation Addressed:* None. Official scrcpy already supports H.264, H.265, AV1, audio capture, virtual displays, and raw HID injection.
  * *Cost & Complexity:* Extremely high (estimated 6-12 months of protocol maintenance, Android NDK compatibility across Android versions 5.0 through 15).
  * *Security Risks:* High probability of introducing buffer overflows, frame desynchronization, and compatibility regressions across Android vendors (Samsung, Xiaomi, Google, etc.).
* **Verdict:** **REJECTED** as wasteful re-inventing of the wheel with strictly inferior stability.

---

## 3. Technology Stack Selection

Targeting Windows 11 x64, with development toolchain verified in Phase 0:
* **Host Desktop Framework:** Electron with Node.js 20 LTS.
* **Frontend:** React + TypeScript + Modern Dark/Glassmorphic CSS Design System.
* **Inter-Process Communication:** Strongly typed IPC channels (`ipcRenderer` <-> `ipcMain`) with strict payload validation.
* **Engine Binaries:** Official pinned `scrcpy-win64-v5.0.1` and `platform-tools adb`.
* **Packaging:** Self-contained Windows Portable ZIP and Standalone Executable (zero host dependencies on target machines).
