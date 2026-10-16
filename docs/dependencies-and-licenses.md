# Dependencies, Software Bill of Materials & Licensing

**Document:** `docs/dependencies-and-licenses.md`  
**Date:** 2026-10-16  

---

## 1. Software Bill of Materials (SBOM)

AndroScrn bundles or interfaces with multiple battle-tested open-source components. This document establishes full legal compliance, licensing terms, redistribution obligations, and attribution requirements.

| Component | Version | Origin / Vendor | License | Distribution Mode | Obligations & Notice |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **scrcpy** | 5.0.1 | Genymobile | Apache License 2.0 | Bundled binary | Retain Apache 2.0 Notice & copyright notices. Do not claim ownership of scrcpy. |
| **scrcpy-server** | 5.0.1 | Genymobile | Apache License 2.0 | Bundled JAR | Executed on Android device via app_process. Must retain Apache 2.0 license. |
| **Android ADB** | 1.0.41 (37.0.0) | Google AOSP | Apache License 2.0 | Bundled / System binary | Retain Google copyright and Apache 2.0 notice. |
| **SDL3** | 3.4.18 | SDL Community | zlib License | Bundled dynamic library | Permissive zlib license. Retain copyright notice. |
| **FFmpeg (libavcodec, libavformat, etc.)** | 63.x | FFmpeg Project | LGPL v2.1+ / GPL v2+ | Dynamic DLLs | Dynamically linked; source code of FFmpeg available at ffmpeg.org; no modifications to FFmpeg binaries. |
| **libusb** | 1.0.30 | libusb team | LGPL v2.1+ | Dynamic DLL | Dynamically linked. |
| **Electron** | Modern LTS | OpenJS Foundation | MIT License | Runtime framework | Retain MIT copyright notice. |
| **React** | 18.x / 19.x | Meta Platforms | MIT License | Bundled frontend | Retain MIT copyright notice. |
| **Lucide Icons** | Latest | Lucide Project | ISC License | Bundled UI assets | Permissive ISC license. |
| **Tesseract OCR** | 5.3.x | Google / Tesseract | Apache License 2.0 | External / Optional | Retain Apache 2.0 notice. |
| **Ollama** | 0.34.4 | Ollama Inc. | MIT License | External / Optional | Retain MIT notice. |

---

## 2. Redistribution & Compliance Policies

1. **Attribution Integrity:**
   * AndroScrn clearly displays an **"About & Licenses"** dialog crediting Genymobile (scrcpy), Google (AOSP adb), FFmpeg, SDL, and the REA research project.
   * AndroScrn never claims to be the original author of scrcpy or ADB. It is clearly designated as an independent control platform and orchestration interface.
2. **Dynamic Linking & Code Separation:**
   * Scrcpy and ADB are invoked as external child processes via official CLI contracts.
   * No proprietary code is statically compiled into scrcpy, preserving clean legal separation.
3. **No Private Keys or Proprietary Secrets:**
   * No private signing keys, sensitive device credentials, or hardcoded passwords are included in the repository or binary packages.
4. **Local-First Privacy:**
   * All device communications, screen streaming, and input handling remain strictly on the local host and local network. No telemetry or device screencasts are ever routed to cloud servers.
