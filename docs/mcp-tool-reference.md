# AndroScrn MCP Tool Reference

**Document:** `docs/mcp-tool-reference.md`  
**Date:** 2026-10-17  
**Version:** 1.1.0 (Phase 3B — Controlled Device Input)  
**Protocol:** Model Context Protocol (MCP) Standard  
**Transport:** Stdio (`npx -y @modelcontextprotocol/sdk`) with Named-Pipe Desktop Control Bridge (`\\.\pipe\androscrn-mcp-control`)

---

## 1. Overview & Multi-Tier Authorization Model

AndroScrn exposes 12 specialized tools to external AI agents (e.g. Claude Desktop, Cursor, and custom automation scripts). To preserve host security and user privacy, access is gated by a **Human-in-the-Loop Pairing Gatekeeper**.

### Permission Tier Matrix

| Tier | Scope | Capabilities / Tools | Authorization Gate |
| :---: | :--- | :--- | :--- |
| **0** | `read:telemetry` | `list_devices`, `get_device_info`, `get_diagnostics` | Unconditional (Sanitized metadata) |
| **1** | `read:logs` | `get_logcat` | Permitted with automated regex credential redaction |
| **2** | `read:screen` | `capture_screenshot` | Permitted (Direct PNG stream introspection) |
| **3** | `write:input` | `tap`, `swipe`, `keyevent`, `input_text` | **Strictly Requires Active Tier 3 Paired Session Token** |
| **4** | `write:admin` | `shell`, `install_app`, `reboot`, `file_push` | Planned Phase 4 (Interactive Human Desktop Confirmation) |

---

## 2. Pairing & Session Management Tools

### `request_pairing`
Initiates a Human-in-the-Loop pairing handshake between the external AI agent and the AndroScrn desktop application.

* **Tier Requirement:** None (Public gatekeeper entry point)
* **Arguments:**
  * `clientName` *(string, required)*: Descriptive client identifier (e.g. `"Claude-Desktop"`, `"Cursor-IDE"`).
  * `requestedTier` *(number, optional, default: 3)*: Highest permission tier requested (0–4).
* **Return Schema:**
  ```json
  {
    "requestId": "9ecb9119-bd88-46f7-a991-5311c1caf053",
    "status": "pending_desktop_approval",
    "expiresInSeconds": 60,
    "message": "Pairing request created. Please have the user approve the request in the AndroScrn desktop application, or enter the 6-digit PIN displayed on the desktop screen."
  }
  ```
* **Security Guard:** The 6-digit verification PIN is **never** returned in the MCP JSON-RPC response; it is pushed solely over the local Windows Named Pipe to the physical desktop display.

---

### `pair_session`
Exchanges an approved `requestId` (and optional PIN) for a cryptographically secure 256-bit session token.

* **Tier Requirement:** None
* **Arguments:**
  * `requestId` *(string, required)*: The UUIDv4 returned by `request_pairing`.
  * `pin` *(string, optional)*: 6-digit numeric verification PIN displayed on the user's desktop monitor (required only if user does not click Desktop Approve).
  * `clientName` *(string, optional)*: The client identity; must match the identity in `request_pairing`.
* **Return Schema:**
  ```json
  {
    "success": true,
    "sessionToken": "4e7f3...64-hex-characters...",
    "expiresAt": 1729145600000,
    "grantedTiers": [0, 1, 2, 3],
    "clientName": "Claude-Desktop"
  }
  ```
* **Security Guards:**
  * **Client Identity Binding:** If `clientName` mismatches the initial request, it is rejected immediately.
  * **Brute-Force Lockout:** More than 3 incorrect PIN attempts permanently invalidates the request.
  * **Token TTL:** Session tokens automatically expire after 30 minutes.

---

### `get_pairing_status`
Queries the validity, remaining TTL, and permission tiers of an issued session token.

* **Tier Requirement:** None
* **Arguments:**
  * `token` *(string, required)*: The 64-character session token.
* **Return Schema:**
  ```json
  {
    "valid": true,
    "session": {
      "sessionId": "4e7f3...",
      "clientName": "Claude-Desktop",
      "tiers": [0, 1, 2, 3],
      "expiresInSeconds": 1740
    }
  }
  ```

---

## 3. Tier 0–2: Telemetry, Logs & Screen Tools

### `list_devices`
Lists all currently connected Android devices, hardware models, and connection states.

* **Tier:** 0 (`read:telemetry`)
* **Arguments:** None
* **Return:** Array of `AndroidDevice` objects containing `serial`, `model`, `state` (`device`, `unauthorized`, `offline`), `transportType` (`usb` or `wifi`), and battery level.

---

### `get_device_info`
Retrieves detailed hardware specifications, battery status, and OS build properties for a specified device.

* **Tier:** 0 (`read:telemetry`)
* **Arguments:**
  * `serial` *(string, required)*: Target device serial identifier.
* **Security Guard:** Rejects invalid serial formats and command injection metacharacters.

---

### `get_diagnostics`
Retrieves the complete host system diagnostic report, including introspected ADB and scrcpy binary paths and versions.

* **Tier:** 0 (`read:telemetry`)
* **Arguments:** None
* **Security Guard:** Automatically redacts host auth tokens, usernames, and email addresses.

---

### `get_logcat`
Streams recent logcat entries from the target device.

* **Tier:** 1 (`read:logs`)
* **Arguments:**
  * `serial` *(string, required)*: Target device serial.
  * `lines` *(number, optional, default: 50, max: 500)*: Number of log lines.
  * `filterLevel` *(string, optional)*: Filter by severity (`V`, `D`, `I`, `W`, `E`, `F`).
* **Security Guard:** Automatically redacts email addresses, authorization bearer tokens, and 6-digit pairing PINs using `SecurityValidator.redactSensitiveText`.

---

### `capture_screenshot`
Captures a raw binary framebuffer frame from the target Android device and returns it as an MCP image content block.

* **Tier:** 2 (`read:screen`)
* **Arguments:**
  * `serial` *(string, required)*: Target device serial.
* **Return:** MCP image content block with `data` (Base64 PNG) and `mimeType: "image/png"`.
* **Security Guard:** Validates PNG 8-byte magic signature (`89 50 4E 47 0D 0A 1A 0A`) directly from raw stdout buffer without lossy string conversion.

---

## 4. Tier 3: Controlled Device Input Tools

> **Prerequisite:** All Tier 3 tools require an active session token authorized for Tier 3 (`write:input`). Every call logs a privacy-redacted event to the desktop application's **Live Action Audit Log**.

### `tap`
Simulates a single touchscreen tap gesture at specific display coordinates `(x, y)`.

* **Tier:** 3 (`write:input`)
* **Arguments:**
  * `token` *(string, required)*: Active paired session token with Tier 3 permission.
  * `serial` *(string, required)*: Target Android device serial identifier.
  * `x` *(integer, required, min: 0)*: Horizontal screen coordinate in pixels.
  * `y` *(integer, required, min: 0)*: Vertical screen coordinate in pixels.
* **Return Schema:**
  ```json
  {
    "success": true,
    "action": "tap",
    "serial": "kjizrsgekfsglvgi",
    "x": 540,
    "y": 1200,
    "coordinates": { "x": 540, "y": 1200 },
    "durationMs": 42,
    "status": "completed"
  }
  ```
* **Security Guards:**
  * **Screen Bounds Verification:** Queries device physical/override dimensions via `wm size` and rejects out-of-bounds coordinates before executing ADB.
  * **Safe Invocation:** Uses fixed argument vector `['shell', 'input', 'tap', x, y]` without shell interpolation.
  * **Vendor ROM Permission Handling:** Detects MIUI / HyperOS `INJECT_EVENTS` security denials and returns clear guidance.
  * **Timeout:** Enforces strict 5000ms bounded child process execution.

---

### `swipe`
Simulates a directional touchscreen drag/swipe gesture from `(x1, y1)` to `(x2, y2)` over a specified duration.

* **Tier:** 3 (`write:input`)
* **Arguments:**
  * `token` *(string, required)*: Active paired session token with Tier 3 permission.
  * `serial` *(string, required)*: Target Android device serial identifier.
  * `x1` *(integer, required, min: 0)*: Starting horizontal coordinate in pixels.
  * `y1` *(integer, required, min: 0)*: Starting vertical coordinate in pixels.
  * `x2` *(integer, required, min: 0)*: Ending horizontal coordinate in pixels.
  * `y2` *(integer, required, min: 0)*: Ending vertical coordinate in pixels.
  * `durationMs` *(integer, optional, default: 300, min: 50, max: 10000)*: Swipe duration in milliseconds.
* **Return Schema:**
  ```json
  {
    "success": true,
    "action": "swipe",
    "serial": "kjizrsgekfsglvgi",
    "from": { "x": 500, "y": 1600 },
    "to": { "x": 500, "y": 400 },
    "durationMs": 300,
    "status": "completed"
  }
  ```
* **Security Guards:** Both starting and ending endpoints are validated against device display geometry. Duration is strictly clamped between 50ms and 10,000ms.

---

### `keyevent`
Injects an Android hardware or navigation key event code into the target device.

* **Tier:** 3 (`write:input`)
* **Arguments:**
  * `token` *(string, required)*: Active paired session token with Tier 3 permission.
  * `serial` *(string, required)*: Target Android device serial identifier.
  * `keyCode` *(integer, required, min: 0, max: 300)*: Android `KeyEvent` integer code.
* **Common Android KeyCodes:**
  * `3` = `KEYCODE_HOME`
  * `4` = `KEYCODE_BACK`
  * `24` = `KEYCODE_VOLUME_UP`
  * `25` = `KEYCODE_VOLUME_DOWN`
  * `26` = `KEYCODE_POWER`
  * `66` = `KEYCODE_ENTER`
  * `82` = `KEYCODE_MENU`
  * `187` = `KEYCODE_APP_SWITCH` (Recents)
* **Return Schema:**
  ```json
  {
    "success": true,
    "action": "keyevent",
    "serial": "kjizrsgekfsglvgi",
    "keyCode": 4,
    "durationMs": 38,
    "status": "completed"
  }
  ```

---

### `input_text`
Injects alphanumeric text into the currently focused input field on the device.

* **Tier:** 3 (`write:input`)
* **Arguments:**
  * `token` *(string, required)*: Active paired session token with Tier 3 permission.
  * `serial` *(string, required)*: Target Android device serial identifier.
  * `text` *(string, required, max: 500)*: Text string to enter.
* **Return Schema:**
  ```json
  {
    "success": true,
    "action": "input_text",
    "serial": "kjizrsgekfsglvgi",
    "charactersInjected": 16,
    "length": 16,
    "durationMs": 52,
    "status": "completed"
  }
  ```
* **Security Guards & Encoding Rules:**
  * **Shell Metacharacter Defense:** Strings containing `[;&|`$<>(){}[\]\\"]` are rejected immediately.
  * **Space Encoding:** Spaces are automatically encoded as `%s` for Android `/system/bin/input text`.
  * **Unicode / Non-ASCII Handling:** Android ADB input text natively only supports ASCII (32–126). Characters with code point `> 127` are rejected with an explicit explanation instructing the use of clipboard or an IME.
  * **Audit Log Privacy:** Raw text strings and typed passwords are **never** logged to disk or sent over IPC; only character length and timing metadata are recorded.
