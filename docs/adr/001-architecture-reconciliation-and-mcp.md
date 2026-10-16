# ADR 001: Architecture Reconciliation, Standalone MCP Server & Security Model

**Status:** Approved  
**Date:** 2026-10-16  
**Context:** Phase 1 Reliability & Phase 2 Read-Only MCP Integration  
**Deciders:** Senior Desktop & Security Systems Architect, Core Engineering Lead  

---

## 1. Context & Background

AndroScrn was originally envisioned with a high-performance, lightweight architecture based on **Tauri 2 + Rust**, utilizing Windows Named Pipes (`\\.\pipe\androscrn-ipc`) for low-latency inter-process communication, a separate Model Context Protocol (MCP) server for local AI automation, and a pairing-first authorization firewall.

During initial development and audit, the following host environment realities were established:
1. **Host Toolchain Limitations:** The target Windows machine has Node.js 20 LTS, npm 10.8, and Git installed. It does **not** have the Rust toolchain (`rustc`, `cargo`, `rustup`) or Microsoft Visual C++ Build Tools (`cl.exe`). Installing Rust and C++ toolchains requires administrative installation of multi-gigabyte build suites.
2. **Operational Prototype:** An operational, production-quality prototype was built using **Electron 31 + Node.js 20 LTS + React 18 + Vite 5 + TypeScript**, passing 105 unit, integration, and Playwright UI tests, bundling official `scrcpy 5.0.1` and `adb 1.0.41`, and successfully verified on physical Android hardware (Xiaomi Redmi Note 11 Pro+ 5G).
3. **Requirement:** Reconcile the working Electron prototype with the long-term Tauri 2 / Rust target architecture without discarding the working prototype or silently altering approved design principles.

---

## 2. Decision Summary

We adopt a **phased modular reconciliation strategy**:
1. **Maintain the Electron Desktop Workbench as the Provisional V1 Interface:**
   The Electron application provides an immediate, offline-capable Windows GUI for device management, scrcpy mirroring, wireless handoff, diagnostics, and capture browsing.
2. **Strict Core Modular Decoupling:**
   Core device and process management logic resides in decoupled TypeScript modules (`modules/device_manager`, `modules/scrcpy_manager`, `modules/connection_manager`, `modules/diagnostics`, `modules/security`). These modules depend only on Node.js core and child process primitives—never on Electron APIs.
3. **Implement MCP as an Independent Standalone Stdio Process:**
   The MCP server is implemented as a standalone Node.js CLI process (`modules/mcp/`) using the official `@modelcontextprotocol/sdk`. It executes over standard input/output (`stdio`), completely decoupled from the Electron GUI window lifecycle. It can be invoked directly by AI clients (Claude Desktop, Cursor, Antigravity, custom scripts) or launched alongside the desktop app.
4. **Architect Windows Named-Pipe IPC as the Future Daemon Bridge:**
   When transitioning to the target Tauri 2 / Rust backend, the core modules will be reimplemented as a Rust daemon exposing a Windows Named Pipe (`\\.\pipe\androscrn-ipc`). The standalone MCP server and the UI will connect to this same named pipe.
5. **Enforce a Pairing-First Security Model:**
   Access to Android devices through external AI tooling must adhere to an explicit permission model: read-only telemetry is safe by default, while any mutating actions (touch injection, shell commands, key events, package installs) require a 6-digit pairing code and explicit human-in-the-loop approval.

---

## 3. Detailed Architectural Specifications

### 3.1 Component Hierarchy & Inter-Process Architecture

```mermaid
graph TD
    subgraph External Clients
        AI_Client[AI Agent / Claude Desktop / Cursor / Antigravity]
    end

    subgraph MCP Server Process [Independent CLI - Stdio Transport]
        MCP_Core[AndroScrn MCP Server - @modelcontextprotocol/sdk]
        MCP_Tools[Read-Only Tools: list_devices, get_device_info, get_logcat, get_diagnostics, capture_screenshot]
        MCP_Gate[Pairing & Security Gatekeeper]
    end

    subgraph Desktop GUI Process [Electron 31 / React 18]
        GUI[AndroScrn Desktop Window]
        IPC_Main[Electron Main Process IPC Gateway]
    end

    subgraph Core Engine Modules [Pure Node/TS - Reusable & Rust-Ready]
        DM[DeviceManager]
        SM[ScrcpyManager]
        DX[DiagnosticsManager]
        CM[ConnectionManager]
        SEC[SecurityValidator]
    end

    subgraph Native Binaries & Host OS
        ADB[Bundled adb.exe v1.0.41]
        SCRCPY[Bundled scrcpy.exe v5.0.1]
        PIPE[Windows Named Pipe: \\.\pipe\androscrn-ipc]
    end

    subgraph Target Android Device
        DEV[Physical / Virtual Android Device]
    end

    AI_Client <== stdio JSON-RPC ==> MCP_Core
    MCP_Core --> MCP_Gate
    MCP_Gate --> MCP_Tools
    MCP_Tools --> Core Engine Modules
    
    GUI <== contextBridge / IPC ==> IPC_Main
    IPC_Main --> Core Engine Modules

    Core Engine Modules --> ADB
    Core Engine Modules --> SCRCPY
    ADB <== USB / TCP:5555 ==> DEV
    SCRCPY <== Video / Audio ==> DEV

    Core Engine Modules -. Future Migration .-> PIPE
```

### 3.2 MCP Process Ownership & Lifecycle

- **Decoupled Lifecycle:** The MCP server does not require the Electron desktop application to be running. If the desktop app is closed, the MCP server can autonomously spawn and manage bundled `adb.exe` commands.
- **Single Source of Truth:** Both the Electron desktop application and the MCP server utilize the exact same compiled modules (`dist/modules/`), ensuring identical device parsing, validation, sanitization, and binary resolution logic.
- **Binary Resolution Strategy:** The MCP server dynamically locates bundled binaries:
  1. Relative to `__dirname` in `bin/scrcpy-win64/` (development / repository root).
  2. Relative to the portable root in `resources/bin/scrcpy-win64/` (packaged release).
  3. System `PATH` as a fallback.

### 3.3 Named-Pipe IPC Architecture (Target Daemon Model)

To transition to the target Tauri 2 / Rust architecture without breaking external AI clients:
- **Pipe Name:** `\\.\pipe\androscrn-ipc`
- **Protocol:** Length-delimited JSON-RPC 2.0 messages over Windows Named Pipes with `PIPE_ACCESS_DUPLEX` and `PIPE_TYPE_MESSAGE`.
- **Security:** Access Control Lists (ACLs) restricted to current user token (`CURRENT_USER_SID`) to prevent local unprivileged processes from hijacking the Android device bridge.
- **Migration Boundary:** The MCP server will support a transport flag `--transport=named-pipe --pipe=\\.\pipe\androscrn-ipc` to delegate device operations to the Rust daemon once available.

### 3.4 Permissions & Pairing-First Security Model

External AI agents have powerful automation potential, which introduces severe security risks if malicious prompts or hijacked agents attempt unvetted shell execution or screen tapping.

We define four distinct permission tiers:

| Tier | Name | Capabilities | Default Authorization |
| :---: | :--- | :--- | :--- |
| **0** | `read:telemetry` | `list_devices`, `get_device_info`, `get_diagnostics` | **Always Allowed** (Read-only, sanitized) |
| **1** | `read:logs` | `get_logcat` (bounded lines, regex redacted) | **Allowed with Redaction** |
| **2** | `read:screen` | `capture_screenshot` (raw frame buffer, PNG verified) | **Allowed** (Local inspection only) |
| **3** | `write:input` | `tap`, `swipe`, `keyevent`, `input_text` | **Requires Paired Session (6-digit PIN)** |
| **4** | `write:admin` | `shell`, `install_app`, `reboot`, `file_push` | **Requires Interactive GUI Confirmation** |

#### Pairing Handshake Specification:
1. When an AI client requests a mutating tool (Tier 3/4), the MCP server generates a cryptographically random 6-digit numeric PIN with a 60-second TTL.
2. The PIN is presented in the AndroScrn desktop GUI (and logged to stderr/system tray).
3. The AI agent must supply the PIN via `pair_session(pin)`.
4. Upon successful pairing, a session token (`x-androscrn-session`) is issued with a configurable expiration (default 30 minutes).
5. The desktop GUI maintains an immediate **Emergency Kill Switch** ("Revoke All AI Sessions") that instantly invalidates all active tokens.

### 3.5 Packaging Implications

In the portable Windows distribution:
- A dedicated launcher `bin/androscrn-mcp.bat` is bundled alongside `AndroScrn.exe`.
- AI configurations (e.g., `claude_desktop_config.json`) can point directly to:
  ```json
  {
    "mcpServers": {
      "androscrn": {
        "command": "C:\\Path\\To\\AndroScrn\\bin\\androscrn-mcp.bat",
        "args": []
      }
    }
  }
  ```
- The batch launcher utilizes the bundled Node.js runtime inside the portable distribution, guaranteeing that the MCP server runs on a target PC even if Node.js is not globally installed in Windows.

---

## 4. Consequences & Migration Roadmap

### Positive Consequences
- Immediate AI integration capability using the industry-standard Model Context Protocol.
- Zero disruption to the working Electron prototype or test suite.
- Uncompromised security: read-only tools allow safe agent perception without risk of unauthorized device state mutation.
- Strict architectural boundaries preserve a clean future migration path to Tauri 2 / Rust.

### Next Implementation Steps
1. Implement `modules/mcp/` with read-only tools and pairing interfaces.
2. Add comprehensive automated protocol tests via `InMemoryTransport` and the official MCP `Client`.
3. Add security regression tests verifying input sanitization, timeout defense, and token redaction.
4. Update release artifacts and packaging scripts.
