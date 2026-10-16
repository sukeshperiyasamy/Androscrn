# AndroScrn Security & Privacy Policy

**Document:** `docs/security.md`  
**Date:** 2026-10-16  
**Status:** Active  
**Author:** AndroScrn Security Engineering & Architecture Group  
**Related Architecture Records:** [ADR-001: Architecture Reconciliation, Standalone MCP Server & Security Model](adr/001-architecture-reconciliation-and-mcp.md)

---

## 1. Threat Model & Security Principles

AndroScrn interacts directly with Android debugging interfaces (`adbd`), OS process execution APIs, and external AI agents via the Model Context Protocol (MCP). It is engineered around the core principle of **Defensive Execution & Local Sovereignty**.

### Key Threats Addressed:

1. **Remote Code Execution & Shell Injection:**
   * *Mitigation:* Shell command strings and shell interpolation (`cmd.exe /c`, `sh -c`) are strictly prohibited across the codebase.
   * All external commands invoke `child_process.spawn` using structured, immutable argument arrays (e.g. `['spawn', 'adb.exe', ['-s', serial, 'shell', 'input', 'tap', x, y]]`) with `shell: false` and `windowsHide: true`.
   * Input identifiers (serials, IP addresses, ports) pass strict regular expression sanitization before reaching child process composition.

2. **Public Network Exposure & Port Sniffing:**
   * *Mitigation:* ADB daemon server exclusively binds to loopback `127.0.0.1:5037`.
   * Wireless debugging connections (`TCP 5555`) are strictly restricted to verified private network ranges (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) or local Wi-Fi hotspot links.
   * AndroScrn never binds proxies, web sockets, or mirroring relays to `0.0.0.0` or public internet interfaces.

3. **Sensitive Credential & Secret Exfiltration:**
   * *Mitigation:* All telemetry, diagnostic reports, and logcat streams pass through `SecurityValidator.redactSensitiveText`.
   * Automatically replaces email addresses with `[REDACTED_EMAIL]`, bearer/API authorization tokens with `Bearer [REDACTED_TOKEN]`, and 6-digit numeric pairing PINs with `[REDACTED_PIN]`.
   * Redaction is enforced in unit tests and applied before data is returned to MCP AI clients or exported to disk.

4. **Malicious Screenshot & Media Payloads:**
   * *Mitigation:* Screen capture avoids string conversions that corrupt raw image bytes.
   * Raw binary streams returned by `adb exec-out screencap -p` are inspected for the canonical PNG magic header (`89 50 4E 47 0D 0A 1A 0A`).
   * Any non-PNG data or truncated streams are immediately rejected.

5. **Path Traversal & Destination Escape:**
   * *Mitigation:* Capture and diagnostic file paths pass through `SecurityValidator.resolveSafePath(baseDir, filename)`.
   * Filenames are stripped of path delimiters (`..`, `/`, `\`) and non-alphanumeric characters, guaranteeing files are only written inside intended destination folders.

---

## 2. Model Context Protocol (MCP) Pairing-First Security Model

External AI agents (such as Claude Desktop, Cursor, or Antigravity) interface with AndroScrn via the Model Context Protocol. Because autonomous agents can execute rapidly, a multi-tier permission matrix and pairing gatekeeper are enforced:

### 2.1 Multi-Tier Permission Matrix

| Tier | Scope | Capabilities | Default Authorization |
| :---: | :--- | :--- | :--- |
| **0** | `read:telemetry` | `list_devices`, `get_device_info`, `get_diagnostics` | **Always Permitted** (Sanitized metadata) |
| **1** | `read:logs` | `get_logcat` (bounded 1–500 lines) | **Permitted with Automatic Redaction** |
| **2** | `read:screen` | `capture_screenshot` | **Permitted** (Local visual inspection, PNG verified) |
| **3** | `write:input` | `tap`, `swipe`, `keyevent`, `input_text` | **Requires 6-Digit PIN Paired Token** |
| **4** | `write:admin` | `shell`, `install_app`, `reboot`, `file_push` | **Requires Interactive Human GUI Confirmation** |

### 2.2 Pairing Handshake Protocol

1. **PIN Generation:** The client requests a pairing code via `request_pairing`. The `PairingManager` generates a cryptographically random 6-digit numeric PIN with a strict **60-second Time-To-Live (TTL)**.
2. **Brute-Force Lockout:** The pairing request allows a maximum of 3 failed PIN attempts. Upon the 4th incorrect attempt, the PIN is permanently invalidated, requiring a fresh request.
3. **Session Issuance:** Upon successful verification (`pair_session`), a high-entropy 64-character session token (`x-androscrn-session`) is issued with a 30-minute validity window.
4. **Emergency Kill Switch:** Both the desktop application and `PairingManager.revokeAllSessions()` provide an immediate revocation mechanism that invalidates all active session tokens in real time.

---

## 3. Windows Named-Pipe Security (Target Architecture)

For the target Tauri 2 / Rust daemon migration:
* **Pipe Namespace:** `\\.\pipe\androscrn-ipc`
* **Access Control Lists (ACLs):** Configured with discretionary access control lists granting read/write access solely to the `CURRENT_USER_SID`. Unprivileged local background services or other local user accounts cannot open or inject commands into the pipe.
* **Message Framing:** Length-delimited JSON-RPC 2.0 messages with strict payload length caps (maximum 16 MB per frame for binary screencap transfer).
