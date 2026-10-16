# AndroScrn

<div align="center">

# 📱 AndroScrn
### Next-Generation Android Control, Automation & MCP Platform for Windows

[![Windows 11](https://img.shields.io/badge/Windows-11%20%7C%2010%20x64-0078d4?style=for-the-badge&logo=windows&logoColor=white)](https://microsoft.com/windows)
[![scrcpy v5.0.1](https://img.shields.io/badge/Engine-scrcpy%20v5.0.1-brightgreen?style=for-the-badge)](https://github.com/Genymobile/scrcpy)
[![ADB Verified](https://img.shields.io/badge/Bridge-Google%20ADB%201.0.41-orange?style=for-the-badge)](https://developer.android.com/tools/adb)
[![MCP Server](https://img.shields.io/badge/MCP-Official%20SDK%20v1.32-purple?style=for-the-badge)](https://modelcontextprotocol.io)
[![Tests Passing](https://img.shields.io/badge/Tests-200%20Passed-brightgreen?style=for-the-badge)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

*Ultra-low latency screen mirroring, 1-click wireless handoff, phone-hotspot discovery, raw binary screenshot capture, filtered logcat diagnostics, test automation workflows, and official Model Context Protocol (MCP) server for AI agents.*

</div>

---

## 🏗️ Architecture Status: Provisional Electron Workbench & Standalone Stdio MCP

> **Architecture Reconciliation ([ADR-001](docs/adr/001-architecture-reconciliation-and-mcp.md)):**  
> The approved target architecture is **Tauri 2 + Rust + React/TypeScript** with an out-of-process daemon communicating via Windows Named Pipes (`\\.\pipe\androscrn-ipc`).  
> Because the current development machine lacks the MSVC C++ build environment and Rust compiler, the desktop workbench is distributed as a **provisional standalone Electron 31 + Node.js 20 LTS** portable package.  
> The **Model Context Protocol (MCP) server** runs as a **completely decoupled, standalone CLI process over standard I/O (`stdio`)**, using the official `@modelcontextprotocol/sdk`. It bridges securely to the Electron GUI over a local Windows Named Pipe (`\\.\pipe\androscrn-mcp-control`) for Human-in-the-Loop approval.

---

## 📊 Feature Status Matrix (Evidence-Based Classification)

In compliance with strict verification standards, every capability is classified according to its verified operational status:

| Feature | Scope / Engine | Status | Notes |
| :--- | :--- | :--- | :--- |
| **USB Device Discovery & State Guidance** | Bundled ADB 1.0.41 parser | **Implemented & hardware-verified** | Verified on Xiaomi Redmi Note 11 Pro+ 5G (`21091116I`, Android 13). |
| **Multi-Device Serial Scoping** | `-s <serial>` argument isolation | **Implemented & tested** | Commands strictly target selected device; avoids multi-device collisions. |
| **Raw Binary Screenshot Capture** | `adb exec-out screencap -p` | **Implemented & hardware-verified** | Streamed directly from physical hardware; PNG header (`89 50 4E 47`) verified. |
| **Captures Gallery & Folder Explorer** | Real filesystem scan of `Captures/` | **Implemented & tested** | Dynamic list of `.png` and `.mp4` files with system viewer launch. |
| **System Diagnostics & Report Export** | Bundled binary introspection | **Implemented & hardware-verified** | Introspects live ADB 1.0.41 and scrcpy 5.0.1; exports redacted reports. |
| **Dual Log Streamer** | Device Logcat + Application Log | **Implemented & hardware-verified** | Streamed live logcat from physical hardware with threadtime parsing. |
| **Quality Preset Switching** | Scrcpy argument composition | **Implemented & tested** | High (1080p·12M·60fps), Balanced, Fast presets verified. |
| **Screen Mirroring Lifecycle** | Bundled scrcpy 5.0.1 child process | **Implemented & hardware-verified** | Scrcpy pushed server JAR and initialized Direct3D11 streaming on hardware. |
| **Quick Remote Navigation** | ADB `input keyevent` with `-s` | **Implemented & tested** | Home, Back, App Switch, Power verified via CLI argument vectors. |
| **1-Click Wireless Handoff** | TCP/IP port 5555 configuration | **Implemented & tested** | Automatic gateway probe and handoff sequence verified in tests. |
| **Android 11+ PIN Pairing** | `adb pair <ip>:<port> <pin>` | **Implemented & tested** | Regex & command syntax verified; defensive rejection of invalid ports. |
| **Video Recording via scrcpy** | Pass-through `--record` muxing | **Implemented & tested** | Scrcpy recording flag composition with zero CPU re-encoding overhead. |
| **Automation Workflow Runner** | Step sequencer (`WorkflowEngine`) | **Implemented & tested** | Core execution loop verified with coordinate validation. |
| **MCP Stdio Server (Read-Only)** | `@modelcontextprotocol/sdk` | **Implemented & tested** | 8 tools: devices, info, logcat, diagnostics, screenshot, pairing handshake. |
| **Human-in-the-Loop (HITL) Gatekeeper** | Windows Named Pipe Bridge | **Implemented & tested** | PIN never returned to AI agent; desktop Approve/Deny buttons & out-of-band PIN. |
| **Emergency Revocation Kill Switch** | Global token invalidation | **Implemented & tested** | Real-time "Revoke All AI Sessions" button in desktop UI and IPC command. |
| **Tesseract OCR Analysis** | Tesseract 5.3 CLI on host | **Mocked / Preview** | Engine installed on host; renderer currently uses mock preview. |
| **Ollama Local AI Summary** | Local Ollama 0.34 API on host | **Mocked / Preview** | Engine installed on host; renderer currently uses mock preview. |

---

## 🤖 Model Context Protocol (MCP) Server for AI Agents

AndroScrn exposes a standard, high-performance **Model Context Protocol (MCP)** server over standard input/output (`stdio`), enabling external AI assistants (such as Claude Desktop, Cursor, Antigravity, or custom agents) to inspect, diagnose, and securely request pairing to attached Android devices.

### Registered MCP Tools

| Tool Name | Tier | Capability Description | Input Parameters |
| :--- | :---: | :--- | :--- |
| `list_devices` | 0 | Lists all connected Android devices with model, state, and transport. | None |
| `get_device_info` | 0 | Retrieves hardware details, battery percentage, and connection state. | `serial` (string) |
| `get_logcat` | 1 | Fetches bounded recent logcat lines with automatic sensitive-data redaction. | `serial` (string), `lines` (number 1-500), `filterLevel` (V, D, I, W, E, F) |
| `get_diagnostics` | 0 | Generates full host OS, toolchain version, and system diagnostic bundle. | None |
| `capture_screenshot`| 2 | Captures verified raw PNG frame buffer with embedded base64 image block. | `serial` (string), `format` ('base64' \| 'file') |
| `request_pairing` | — | Registers a pairing request via Named Pipe to Desktop UI. Never leaks PIN! | `clientName` (string), `requestedTier` (1-4) |
| `pair_session` | — | Exchanges approved `requestId` or screen-displayed PIN for 64-char token. | `requestId` (string), `pin` (optional string), `clientName` (string) |
| `get_pairing_status` | — | Checks validity and granted permission tiers of an active session token. | `token` (string, optional) |

### Claude Desktop Configuration

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "androscrn": {
      "command": "C:\\Users\\sukes\\Downloads\\scrcpy-master\\AndroScrn\\bin\\androscrn-mcp.bat",
      "args": []
    }
  }
}
```

Or execute directly with Node:
```json
{
  "mcpServers": {
    "androscrn": {
      "command": "node",
      "args": [
        "C:\\Users\\sukes\\Downloads\\scrcpy-master\\AndroScrn\\dist\\modules\\mcp\\cli.js"
      ]
    }
  }
}
```

---

## 🔒 Pairing-First Security Model

External AI agents have significant automation capabilities. To prevent unauthorized device control, AndroScrn enforces a strict permission model:

1. **Read-Only Telemetry (Tiers 0–2):** Safe, observational tools (`list_devices`, `get_device_info`, `get_diagnostics`, `capture_screenshot`, and redacted `get_logcat`) execute without requiring user confirmation.
2. **Credential Redaction:** All diagnostic reports and logcat entries pass through `SecurityValidator.redactSensitiveText`, ensuring emails, bearer tokens, API keys, and pairing codes never leak to AI prompts.
3. **Mutating Action Gate (Tier 3 & 4):** Any future device-modifying actions (touch injection, shell commands, APK installation) require completing a 6-digit PIN handshake via `request_pairing` and `pair_session`.
4. **Brute-Force Protection:** The pairing PIN is invalidated after 3 incorrect attempts.
5. **Emergency Kill Switch:** The desktop application and `PairingManager.revokeAllSessions()` immediately revoke all issued tokens in real time.

---

## 🚀 Quick Start (Development & Testing)

### Prerequisites
* Windows 10 or Windows 11 (x64)
* Node.js v20+ LTS (`npm install`)
* Android device with **USB Debugging** enabled (*Settings -> Developer Options -> USB Debugging*)

### Running Tests
Execute the comprehensive 200-test validation suite:
```bash
npm test
```
* **Unit Tests (149):** Protocol sanitization, argument composition, PNG magic byte validation, redaction, and MCP protocol assertions.
* **Integration Tests (13):** Bundled binary smoke tests (`adb.exe` 1.0.41, `scrcpy.exe` 5.0.1, live daemon communication).
* **Playwright UI Tests (38):** Automated headless browser tests verifying empty states, multi-device dropdowns, quality presets, captures gallery, responsive layouts, HITL pairing banner, and emergency revocation controls.

### Running Desktop Workbench
```bash
# Start desktop development mode
npm run dev:desktop
```

### Building Standalone Portable Package
```bash
npm run build:portable
```

---

## 📄 Licensing & Acknowledgments

AndroScrn is an independent open-source project licensed under the [MIT License](LICENSE).
It integrates with and attributes:
* **[scrcpy](https://github.com/Genymobile/scrcpy)** by Genymobile (Apache License 2.0).
* **[Android Debug Bridge](https://developer.android.com/tools/adb)** by Google Android Open Source Project (Apache License 2.0).
* **[Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)** by Anthropic (MIT License).
* **[REA](https://github.com/morluto/rea)** by morluto (MIT License).
* **[FFmpeg](https://ffmpeg.org)** (LGPL v2.1+).
* **[SDL3](https://libsdl.org)** (zlib License).
