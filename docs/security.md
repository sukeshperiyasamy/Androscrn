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

## 2. Model Context Protocol (MCP) Human-in-the-Loop (HITL) Pairing Model

External AI agents (such as Claude Desktop, Cursor, or autonomous test runners) interface with AndroScrn via the Model Context Protocol. To ensure absolute user sovereignty and prevent AI agents from acquiring remote control without human authorization, AndroScrn enforces a strict **Human-in-the-Loop (HITL)** pairing gatekeeper backed by local Windows Named Pipe IPC.

### 2.1 Multi-Tier Permission Matrix

| Tier | Scope | Capabilities | Default Authorization |
| :---: | :--- | :--- | :--- |
| **0** | `read:telemetry` | `list_devices`, `get_device_info`, `get_diagnostics` | **Always Permitted** (Sanitized metadata) |
| **1** | `read:logs` | `get_logcat` (bounded 1–500 lines) | **Permitted with Automatic Redaction** |
| **2** | `read:screen` | `capture_screenshot` | **Permitted** (Local visual inspection, PNG verified) |
| **3** | `write:input` | `tap`, `swipe`, `keyevent`, `input_text` | **Requires Human-in-the-Loop Paired Session** |
| **4** | `write:admin` | `shell`, `install_app`, `reboot`, `file_push` | **Requires Interactive Human GUI Confirmation** |

### 2.2 Security Defect Remediation: Prevention of Self-Authentication

* **Vulnerability Identified:** In initial prototypes, `request_pairing` returned `{ pairingPin: pin }` directly in the JSON-RPC response to the calling MCP client. An autonomous AI agent could immediately call `pair_session({ pin })` with the returned PIN, completely bypassing the human.
* **Remediation Implemented (Phase 3A):**
  1. `request_pairing` generates a unique `requestId` (UUIDv4) and a cryptographically secure 6-digit numeric PIN.
  2. The PIN is pushed exclusively across the Windows Named Pipe (`\\.\pipe\androscrn-mcp-control`) to the trusted Electron desktop process.
  3. The JSON-RPC tool response returned to the AI agent contains **only** `{ requestId, status: "pending_desktop_approval", expiresInSeconds: 60 }`. The PIN is **never** leaked or returned in the MCP protocol response.
  4. If the desktop application is not open or the Named Pipe is disconnected, pairing requests are refused with an explicit error requiring an active desktop session.

### 2.3 Dual-Path Human-in-the-Loop Verification

1. **Path A — Desktop Interactive Approval (Recommended):**
   * The user observes an incoming pairing card in the desktop application showing the client name, requested tier, and expiry countdown.
   * The user clicks **Approve Access** directly in the UI.
   * The desktop sends `PAIRING_DECISION (APPROVED)` over the Named Pipe to the MCP process.
   * The AI agent completes pairing by calling `pair_session({ requestId })` without needing to handle the PIN.

2. **Path B — Out-of-Band PIN Submission:**
   * The user reads the 6-digit verification PIN displayed on their physical desktop monitor.
   * The user manually dictates or pastes the PIN to the agent.
   * The AI agent calls `pair_session({ requestId, pin })`.
   * A strict maximum of 3 incorrect attempts is enforced; on the 4th incorrect attempt, the request is permanently purged (brute-force lockout).

3. **Path C — Desktop Denial:**
   * If the user clicks **Deny**, the request is immediately transitioned to `DENIED` status. Any subsequent `pair_session` attempt by the agent is rejected with an explicit user denial error.

### 2.4 Emergency Kill Switch & Session Revocation

* **Instantaneous Global Revocation:** The desktop UI features a prominent red **"Revoke All AI Sessions"** emergency button. When clicked, it broadcasts a `REVOKE_ALL_SESSIONS` IPC message over the Named Pipe, instantly clearing all active session tokens and purging all pending pairing requests.
* **Granular Session Revocation:** Each active session is listed in the desktop UI with its client name, granted tiers, creation timestamp, and an individual **Revoke** button (`REVOKE_SESSION`).
* **High-Entropy Tokens:** Approved sessions receive a 256-bit (64-character hex) cryptographically random token (`crypto.randomBytes(32)`).
* **Automatic Expiry:** Sessions have an absolute 30-minute validity window, after which re-authorization is mandatory.

---

## 3. Windows Named-Pipe IPC Control Architecture

AndroScrn decouples the UI process from external AI agents using a local Windows Named Pipe:

* **Pipe Name:** `\\.\pipe\androscrn-mcp-control`
* **Transport:** Windows Named Pipe using newline-delimited JSON (`NdjsonFramer`) framing.
* **Server:** Hosted inside the trusted Electron main process (`McpControlServer`).
* **Client:** Connects from the standalone stdio MCP process (`McpControlClient`) with automated reconnection (5-second backoff).
* **Security Controls:**
  * Only accepts local connections on the local machine.
  * Payloads are strictly schema-validated (`McpIpcMessage`).
  * Malformed or oversized frames are discarded safely without disrupting the IPC channel.
  * Device-modifying commands (`tap`, `swipe`, `keyevent`, `input_text`) are completely barred until the session token is verified against the active session store.

---

## 4. Tier 3 Controlled Device Input & Execution Hardening (Phase 3B)

Phase 3B activates the four narrowly scoped Tier 3 device-control tools: `tap(serial, x, y, token)`, `swipe(serial, x1, y1, x2, y2, durationMs, token)`, `keyevent(serial, keyCode, token)`, and `input_text(serial, text, token)`. Every invocation traverses strict security verification gates before contacting the Android operating system.

### 4.1 Client Identity Binding & Anti-Hijacking
* Pairing requests bind the calling client identity (`clientName`). When `pair_session` is called, the provided `clientName` must strictly match the identity established during `request_pairing`.
* Imposter clients cannot claim an approved request or hijack a pending pairing token established by another client.

### 4.2 Safe Process Execution & Non-Interpolated Command Arrays
* Unrestricted shell commands and string interpolation (`cmd.exe /c`, `sh -c`) are strictly prohibited.
* Input commands are dispatched using immutable argument vectors:
  * `tap`: `['spawn', 'adb.exe', ['-s', serial, 'shell', 'input', 'tap', x.toString(), y.toString()]]`
  * `swipe`: `['spawn', 'adb.exe', ['-s', serial, 'shell', 'input', 'swipe', x1.toString(), y1.toString(), x2.toString(), y2.toString(), durationMs.toString()]]`
  * `keyevent`: `['spawn', 'adb.exe', ['-s', serial, 'shell', 'input', 'keyevent', keyCode.toString()]]`
  * `input_text`: `['spawn', 'adb.exe', ['-s', serial, 'shell', 'input', 'text', encodedText]]`
* All operations run with `windowsHide: true`, explicit process timeout (5000ms), and automated process termination on timeout.

### 4.3 Screen Dimension Bounds Verification
* Prior to dispatching touch injection (`tap` and `swipe`), AndroScrn queries the device screen geometry via `adb shell wm size`.
* Both physical screen dimensions (`Physical size: 1080x2400`) and display override dimensions (`Override size: ...`) are parsed and validated.
* Out-of-bounds coordinates (e.g. `x < 0`, `x >= width`, `y < 0`, `y >= height`) are rejected at the gate before any ADB command is executed, preventing anomalous driver states or accidental out-of-screen clicks.

### 4.4 ADB Text Input Sanitization & Encoding
* Android's `/system/bin/input text` utility runs inside Android's shell environment and has critical encoding limitations:
  1. **Shell Injection Prevention:** Text strings containing shell metacharacters (`[;&|`$<>(){}[\]\\"]`) are rejected immediately, preventing command injection in `adbd`.
  2. **Space Encoding:** Spaces are automatically encoded as `%s`, matching the Android input binary syntax without loss or corrupted splits.
  3. **Unicode / Non-ASCII Handling:** Android's native `input text` does not support multi-byte Unicode or emoji and silently drops or corrupts characters. AndroScrn detects characters with code points `> 127` and returns an explicit, actionable error explaining that non-ASCII characters require clipboard paste or an IME rather than silent corruption.

### 4.5 Vendor ROM Security Guidance (MIUI / HyperOS)
* On Xiaomi (MIUI / HyperOS), Meizu, and certain custom vendor distributions, Android blocks input injection via ADB by default and throws `SecurityException: Permission Denial: injectInputEvent Requires INJECT_EVENTS permission`.
* When this condition is detected from ADB stderr, AndroScrn provides targeted user guidance:
  `Permission Denied: Android security settings require enabling "USB debugging (Security Settings)" in Developer Options to allow input event injection on this vendor ROM.`

### 4.6 Redacted Live Action Audit Log
* Every Tier 3 device-control operation emits an `ACTION_AUDIT` IPC message across the Named Pipe.
* The Electron UI displays actions in the **Live Action Audit Log** with real-time status transitions:
  * `PENDING`: Command accepted and execution underway.
  * `SUCCESS`: Command completed with verified exit code 0.
  * `FAILED`: Command exited with non-zero code, execution timeout, or vendor permission denial.
  * `REJECTED`: Request rejected at authorization gate (invalid token, missing token, revoked token, out-of-bounds coordinates, or injection attempt).
* **Privacy & Token Redaction:** Authentication tokens and raw input text (such as passwords or typed messages) are **never** logged or broadcast across IPC. Only sanitized metadata (e.g., character length, coordinates, and keyCode) is retained.

