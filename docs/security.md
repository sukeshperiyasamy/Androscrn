# AndroScrn Security & Privacy Policy

**Document:** `docs/security.md`  
**Date:** 2026-10-16  

---

## 1. Threat Model & Security Principles

AndroScrn interacts directly with Android debugging interfaces (`adbd`) and OS process execution APIs. It is designed around the principle of **Defensive Execution & Local Sovereignty**.

### Key Threats Addressed:
1. **Remote Code Execution / Shell Injection:**
   * *Mitigation:* Shell command strings are prohibited. All external commands execute via structured argument arrays (`spawn('adb.exe', ['-s', serial, 'shell', 'input', 'tap', x, y])`).
2. **Public Network Exposure:**
   * *Mitigation:* Debugging ports (`5555`) are strictly used over trusted local subnets or direct Wi-Fi hotspot links. AndroScrn never binds remote-control proxies to `0.0.0.0` or public cloud relays.
3. **Sensitive Credential Exposure:**
   * *Mitigation:* Android 11+ pairing codes (6-digit PINs) are treated as single-use ephemeral tokens. They are never cached to disk or written to application log files.
4. **Data Exfiltration:**
   * *Mitigation:* Screen captures, recordings, and diagnostic logs remain 100% on local storage. No analytics or cloud telemetry are transmitted.
5. **Path Traversal & Malicious Files:**
   * *Mitigation:* Output paths for screenshots, recordings, and logs are strictly resolved against validated destination folders using canonical path resolution.

---

## 2. Permissions & Safe Defaults

* **User Confirmation for Destructive Actions:**
  * Installing APKs, deleting files, or running arbitrary shell commands through the developer console requires explicit confirmation dialogs.
* **Redaction of Diagnostic Logs:**
  * The log export feature applies regex patterns to strip authorization tokens, email addresses, and IMSI/IMEI identifiers before archiving.
