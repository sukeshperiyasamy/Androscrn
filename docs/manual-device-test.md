# AndroScrn — Manual Hardware Device Test Checklist

**Document Version:** 1.0.0  
**Target Milestone:** Phase 1 — Device & Mirroring Reliability  
**Date:** 2026-10-16  

> **Notice:** Automated tests verify protocol syntax, binary execution, process lifecycle, buffer boundaries, and input validation. However, physical USB streaming, hardware video decoding, touchscreen injection, and wireless handoffs require physical verification against a connected Android smartphone or tablet. Use this checklist whenever physical test hardware is available.

---

## 1. Test Environment Pre-Flight Checklist

Before testing, verify the host workstation environment:

- [ ] Host OS: Windows 10 or Windows 11 (64-bit).
- [ ] Bundled ADB executable verified: `bin/scrcpy-win64/adb.exe version` reports ADB 1.0.41.
- [ ] Bundled scrcpy executable verified: `bin/scrcpy-win64/scrcpy.exe --version` reports scrcpy 5.0.1.
- [ ] Target Android device: Android 10, 11, 12, 13, 14, or 15.
- [ ] Quality USB data cable (charge-only cables will not enumerate ADB).
- [ ] Host display scaling: 100%, 125%, or 150%.

---

## 2. Test Execution Matrix

### Test 1: Device Discovery & Unauthorized State Handling

**Objective:** Verify that unauthenticated or locked devices are detected with actionable guidance.

1. Connect the Android phone via USB without unlocking it, or revoke USB debugging authorizations on the phone (*Developer Options -> Revoke USB debugging authorizations*).
2. Launch AndroScrn (`AndroScrn.bat` or `npm --prefix apps/desktop run dev`).
3. Click **"Refresh Devices"**.
4. **Expected Results:**
   - [ ] Device dropdown displays the phone serial and transport type (USB).
   - [ ] Status badge shows **"UNAUTHORIZED"** with orange/amber styling.
   - [ ] Guidance banner displays: *"Unlock device screen and tap 'Always allow from this computer' on the RSA prompt."*
   - [ ] Mirroring and screenshot buttons are appropriately disabled.
5. Unlock phone and tap "Allow" on the RSA authorization prompt.
6. Click **"Refresh Devices"** again.
7. **Expected Results:**
   - [ ] Status badge transitions to **"READY"** (green).
   - [ ] Device model (e.g., Pixel 8, Galaxy S23) is retrieved and displayed.
   - [ ] Battery level query populates battery percentage.
   - [ ] Guidance banner transitions to *"Device ready for mirroring, remote control, and diagnostics."*
   - [ ] Action buttons are enabled.

---

### Test 2: Screen Mirroring Lifecycle & Duplicate Prevention

**Objective:** Verify low-latency mirror session launch, argument validity, process tracking, and clean teardown.

1. Select the authorized device.
2. Select preset **"Balanced (1080p · 8M · 60fps)"**.
3. Click **"Start Mirroring"**.
4. **Expected Results:**
   - [ ] scrcpy window opens titled `AndroScrn - <Model> (<Serial>)`.
   - [ ] Android home screen renders smoothly with interactive touch/mouse control.
   - [ ] UI reflects mirroring status with green pulse dot, active PID, and ticking duration counter.
   - [ ] **"Start Mirroring"** button changes to **"Active Mirroring"** and is disabled.
5. Attempt to trigger another mirroring session from keyboard or shortcuts.
6. **Expected Results:**
   - [ ] Backend duplicate guard prevents spawning a second scrcpy instance.
7. Click **"Stop Mirroring"**.
8. **Expected Results:**
   - [ ] scrcpy window terminates immediately.
   - [ ] Windows Task Manager shows 0 lingering `scrcpy.exe` child processes.
   - [ ] UI resets mirroring status to inactive without orphaned state.

---

### Test 3: Raw Binary Screenshot Integrity

**Objective:** Verify raw binary frame capture without UTF-8 string encoding corruption.

1. Ensure the device screen is on and displaying an identifiable screen.
2. Click **"Take Screenshot"**.
3. **Expected Results:**
   - [ ] Screenshot operation completes without error.
   - [ ] UI displays confirmation toast with target file path: `Captures/screenshot-<timestamp>.png`.
   - [ ] File size displayed is non-zero (typically 500 KB – 4 MB).
   - [ ] The new capture immediately appears in the **Recent Captures** gallery.
4. Click **"Open"** next to the capture entry in the gallery.
5. **Expected Results:**
   - [ ] Image opens in Windows Photos or default image viewer.
   - [ ] Image renders cleanly with zero artifacts, banding, or header corruption.
   - [ ] Hex inspection verifies first 4 bytes are `89 50 4E 47` (PNG magic number).

---

### Test 4: Screen Recording via scrcpy Pass-Through

**Objective:** Verify real MP4 container recording using scrcpy's native stream muxing.

1. Set quality preset to **"Fast (720p · 4M · 60fps)"**.
2. Click **"Record Session"** or configure record path.
3. Perform rapid UI interactions on the device for 15 seconds.
4. Stop mirroring session.
5. **Expected Results:**
   - [ ] Target file `Captures/recording-<timestamp>.mp4` is written to disk.
   - [ ] File size is non-zero (>1 MB for 15s).
   - [ ] File plays back smoothly in Windows Media Player / VLC with correct frame timing and zero dropped headers.

---

### Test 5: Quick Remote Navigation & Multi-Device Isolation

**Objective:** Verify remote key events target only the explicitly selected serial.

1. (Optional) Connect two devices (or 1 USB device + 1 emulator / Wi-Fi target).
2. Select Device A.
3. Click **"Home"** navigation button.
4. **Expected Results:**
   - [ ] Device A navigates to Home screen.
   - [ ] Device B remains unchanged (verifies `-s <serial>` scoping).
5. Click **"App Switch"** and **"Back"**.
6. **Expected Results:**
   - [ ] Device A responds accurately.

---

### Test 6: Sudden Disconnection & Reconnection Recovery

**Objective:** Verify application robustness when USB cable is abruptly unplugged during an active session.

1. Start mirroring session.
2. While streaming, physically pull the USB cable from the phone.
3. **Expected Results:**
   - [ ] scrcpy window terminates gracefully within 2 seconds.
   - [ ] Application does not crash, freeze, or hang.
   - [ ] UI receives disconnection notification (exit code 2 or error).
   - [ ] UI updates mirroring status to stopped.
   - [ ] Device list automatically flags device as disconnected/offline on next refresh.
4. Re-plug USB cable.
5. Click **"Refresh Devices"**.
6. **Expected Results:**
   - [ ] Device re-appears in **READY** state.
   - [ ] Mirroring can be restarted immediately.

---

### Test 7: Diagnostics & Log Export Verification

**Objective:** Verify diagnostics bundle generation and sensitive value redaction.

1. In the Diagnostics panel, review **System Diagnostics**:
   - [ ] ADB Path: points to bundled binary.
   - [ ] ADB Version: `ADB 1.0.41`.
   - [ ] scrcpy Path: points to bundled binary.
   - [ ] scrcpy Version: `scrcpy 5.0.1`.
2. Click **"Copy Diagnostic Report"**.
3. Paste clipboard into a text editor.
4. **Expected Results:**
   - [ ] Complete host, engine, device, and process diagnostic report is present.
   - [ ] No Wi-Fi passwords, authorization tokens, or sensitive MAC addresses are leaked in plaintext.
5. Toggle between **"Device Logcat"** and **"Application Log (androscrn.log)"**.
6. **Expected Results:**
   - [ ] Logcat displays live buffer from attached device.
   - [ ] Application log displays timestamped internal operational events.

---

### Test 8: Tier 3 MCP Controlled Device Input Verification (Hardware)

**Objective:** Verify that external MCP clients execute touchscreen taps, swipes, keyevents, and text input on a physical phone only through an authorized Tier 3 session.

1. Connect physical Android phone via USB and unlock screen.
2. Launch MCP server or run paired AI agent.
3. Call `request_pairing({ clientName: "Hardware-Tester", requestedTier: 3 })`.
4. In desktop UI under **AI Agent & MCP Security Center**, click **Approve Access**.
5. Call `pair_session({ requestId, clientName: "Hardware-Tester" })` and obtain 64-character token.
6. **Test `tap`:**
   - Call `tap({ serial, x: 500, y: 1000, token })`.
   - **Expected Results:**
     - [ ] Visual touch ripple appears at coordinate (500, 1000) on physical phone screen (if "Show taps" is enabled in Developer Options).
     - [ ] Desktop UI Live Action Audit Log displays `SUCCESS` badge with `tap` action.
7. **Test `swipe`:**
   - Call `swipe({ serial, x1: 500, y1: 1600, x2: 500, y2: 400, durationMs: 400, token })`.
   - **Expected Results:**
     - [ ] Phone screen scrolls upward smoothly.
     - [ ] Desktop UI Live Action Audit Log displays `SUCCESS` badge with `swipe` action.
8. **Test `keyevent`:**
   - Call `keyevent({ serial, keyCode: 3, token })` (KEYCODE_HOME).
   - **Expected Results:**
     - [ ] Phone immediately returns to Home launcher.
     - [ ] Desktop UI Live Action Audit Log displays `SUCCESS` badge with `keyevent` action.
9. **Test `input_text`:**
   - Open a text field (e.g. search bar or messaging app) on the phone.
   - Call `input_text({ serial, text: "AndroScrn 2026 Test", token })`.
   - **Expected Results:**
     - [ ] Text `"AndroScrn 2026 Test"` is typed into the focused input field.
     - [ ] Spaces are preserved properly.
     - [ ] Desktop UI Live Action Audit Log displays `SUCCESS` badge with `input_text` action, showing character count without leaking the raw text payload.

---

### Test 9: Vendor ROM Security Settings Verification (Xiaomi MIUI / HyperOS)

**Objective:** Verify proper error handling and actionable guidance when vendor ROM blocks input injection.

1. On a Xiaomi, Redmi, or Poco device with MIUI/HyperOS, ensure **"USB debugging (Security Settings)"** is turned OFF.
2. Attempt to invoke `tap` or `keyevent`.
3. **Expected Results:**
   - [ ] Android OS rejects injection with `SecurityException: Permission Denial: injectInputEvent Requires INJECT_EVENTS permission`.
   - [ ] MCP tool response and Desktop Action Audit Log report:
     `Permission Denied: Android security settings require enabling "USB debugging (Security Settings)" in Developer Options to allow input event injection on this vendor ROM.`
4. Enable **"USB debugging (Security Settings)"** (requires Xiaomi SIM card verification on MIUI).
5. Re-run `tap`.
6. **Expected Results:**
   - [ ] Action succeeds cleanly with verified UI touch.

---

### Test 10: Real-Time Action Audit Log & Emergency Revocation During Operation

**Objective:** Verify that operations are audited in real time and emergency kill switch blocks pending actions immediately.

1. Open **AI Agent & MCP Security Center** tab.
2. Execute an input action with an invalid coordinate (e.g. `x: 5000, y: 9000`).
3. **Expected Results:**
   - [ ] Action is rejected immediately with bounds error.
   - [ ] Live Action Audit Log displays `REJECTED` badge.
4. Execute text input with semicolon (`test; rm -rf /`).
5. **Expected Results:**
   - [ ] Action is rejected immediately.
   - [ ] Live Action Audit Log displays `REJECTED` badge.
6. Click **"Revoke All AI Sessions"** emergency button.
7. Attempt any subsequent `tap` with the previous token.
8. **Expected Results:**
   - [ ] Action is rejected with `Unauthorized: Operation requires an active paired session with Tier 3`.
   - [ ] Live Action Audit Log displays `REJECTED` badge.

---

## 3. Physical Hardware Execution Record (Sprint Phase 3B)

- **Execution Date:** 2026-10-17
- **Workstation:** Windows 11 Enterprise (64-bit), Node.js v20.20.1
- **Attached Hardware Devices at Run Time:** 0 devices (`adb devices -l` returned empty list).
- **Physical Device Limitation Note:** Automated mock unit tests, integration tests, and Playwright UI tests verified complete protocol compliance (252/252 tests passing). Physical hardware validation requires attaching a physical device with USB debugging enabled.

