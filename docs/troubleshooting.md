# AndroScrn Troubleshooting & Diagnostics Guide

This guide provides verified, actionable recovery procedures for hardware, software, transport, and vendor-specific edge cases in AndroScrn.

---

## 1. Diagnostics Quick-Start

Before manual troubleshooting, run the built-in diagnostic engine from PowerShell or Windows Terminal:

```powershell
# Run the automated 6-point system health check
androscrn doctor

# Inspect attached Android devices and their authorization status
androscrn devices
```

The `androscrn doctor` command systematically evaluates:
1. **Host Operating System:** Verifies Windows 10/11 x64 architecture.
2. **ADB Toolchain:** Verifies bundled or external `adb.exe` presence and version (>= 1.0.41).
3. **scrcpy Engine:** Verifies `scrcpy.exe` and Direct3D11 video decoding libraries.
4. **Hardware Connectivity:** Probes USB bus for authorized Android targets.
5. **IPC Boundary:** Verifies Win32 Named Pipe availability (`\\.\pipe\androscrn-mcp-control`).
6. **Environment PATH:** Confirms whether AndroScrn is in the Windows User PATH.

---

## 2. ADB Issues & Binary Resolution

### Symptom: "ADB binary not found" or `androscrn doctor` Check 2 Fails

**Cause:** The bundled `bin/scrcpy-win64/adb.exe` is missing from the application directory, or a custom portable installation directory was moved without preserving internal subfolders.

**Resolution:**
1. Ensure the `bin/scrcpy-win64` folder is present in the same directory as `AndroScrn.exe`. Required files:
   - `adb.exe`
   - `AdbWinApi.dll`
   - `AdbWinUsbApi.dll`
2. If using an external Android SDK:
   - Add `%ANDROID_HOME%\platform-tools` to your System or User `PATH`.
   - Verify by running `adb version` in a new PowerShell terminal.
3. If ADB daemon fails to bind to port 5037:
   ```powershell
   # Kill any conflicting or orphaned ADB processes
   adb kill-server
   adb start-server
   ```

---

## 3. Device Discovery: Unauthorized or Offline States

### Symptom: Device Shows as "Unauthorized"

```text
kjizrsgekfsglvgi       unauthorized usb:1-1
```

**Cause:** The phone has not accepted the RSA host authentication key from this Windows computer.

**Resolution:**
1. Unlock the phone screen.
2. Look for the system pop-up dialog: **"Allow USB debugging?"**.
3. Check **"Always allow from this computer"** to prevent future prompts.
4. Tap **Allow**.
5. If the dialog does not appear:
   - Disconnect and reconnect the USB cable.
   - Go to phone **Settings** -> **Developer options** -> **Revoke USB debugging authorizations**, then reconnect the cable.

---

### Symptom: Device Shows as "Offline"

```text
kjizrsgekfsglvgi       offline usb:1-1
```

**Cause:** The USB connection experienced a hardware reset, sleep-mode sleep state, or a loose USB port/cable.

**Resolution:**
1. Unplug the USB cable and firmly reconnect it, preferably to a rear motherboard USB port rather than an unpowered front-panel hub.
2. On the phone, toggle **Settings** -> **Developer options** -> **USB debugging** OFF, then back ON.
3. Restart the ADB daemon:
   ```powershell
   adb kill-server
   adb devices -l
   ```

---

## 4. USB Cables, Hubs, and Windows Driver Issues

### Symptom: Device Not Listed in `androscrn devices`

**Cause 1: Charge-Only USB Cable**
Many cheap micro-USB or USB-C cables lack data lines (D+ and D-). If your phone charges but does not prompt for USB connection mode, replace the cable with a known high-speed data sync cable.

**Cause 2: Missing Windows OEM USB Driver**
Windows Device Manager may show the device under **Other devices** as `Android` or `MTP` with a yellow exclamation mark.

**Resolution:**
1. Open Windows **Device Manager** (`devmgmt.msc`).
2. Locate the device under **Portable Devices** or **Other devices**.
3. Right-click -> **Update driver** -> **Search automatically for drivers**.
4. If not found, download and install the official manufacturer driver:
   - **Google Pixel / Generic:** [Google USB Driver](https://developer.android.com/studio/run/win-usb)
   - **Samsung:** Samsung Android USB Composite Device Driver via Smart Switch or Samsung Developers.
   - **Xiaomi / Redmi / POCO:** Xiaomi ADB / Fastboot Driver.
   - **Motorola / OnePlus:** Official OEM device driver suite.

---

## 5. Multiple Connected Devices

### Symptom: "Error: more than one device/emulator" or Ambiguity Guard Triggered

**Cause:** When multiple devices are plugged in (or an emulator is running simultaneously), ADB commands require explicit serial targeting.

**Resolution:**
1. List all connected serials:
   ```powershell
   androscrn devices
   ```
2. In the AndroScrn desktop GUI, select the target device from the top-left dropdown selector.
3. For hardware testing scripts, specify the serial explicitly:
   ```powershell
   $env:TEST_DEVICE_SERIAL = "kjizrsgekfsglvgi"
   npm run test:hardware
   ```

---

## 6. scrcpy Mirroring Launch Failures

### Symptom: Mirroring Window Fails to Open or Closes Immediately

**Cause 1: Display Off / Video Encoder Failure**
Certain budget Android chipsets cannot initialize H.264 encoders while the display is powered off or locked.

**Resolution:**
- Unlock the phone screen before starting screen mirroring.
- In the AndroScrn desktop application, switch the quality preset from **Ultra** or **High Performance** to **Balanced** (1920 max size @ 8 Mbps) or **Battery Saver** (1280 max size @ 4 Mbps).

**Cause 2: Direct3D11 Driver Crash on Windows Host**
If running inside a virtual machine or over Remote Desktop (RDP) without hardware acceleration:
- Launch scrcpy with the software OpenGL or GDI renderer:
  ```powershell
  # Test directly via scrcpy arguments
  bin\scrcpy-win64\scrcpy.exe --render-driver=software
  ```

---

## 7. Vendor-Specific ROM Security Restrictions

### Xiaomi / POCO / Redmi (MIUI & HyperOS)

**Symptom:** Screen mirroring works, but clicking or typing produces:
```text
java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission
```

**Root Cause:** Xiaomi firmware blocks simulated touch and key input injection unless a special carrier-authenticated developer option is toggled on.

**Resolution:**
1. Ensure the phone has an active SIM card inserted (required by Xiaomi security verification).
2. Ensure you are signed into your Xiaomi Mi Account.
3. Open Android **Settings** -> **Additional Settings** -> **Developer options**.
4. Locate **USB debugging (Security settings)** (Allow granting permissions and simulating input via USB debugging).
5. Toggle this option ON. Accept the three 5-second countdown warnings.
6. Input injection will now function without limitations.

---

### Samsung (One UI 6+ / Knox Auto Blocker)

**Symptom:** ADB disconnects immediately after screen lock, or USB commands are rejected.

**Resolution:**
1. Open **Settings** -> **Security and privacy** -> **Auto Blocker**.
2. Toggle OFF or configure **Maximum restrictions** to allow USB software debugging when connected to your workstation.

---

### Huawei / Honor (EMUI / MagicOS)

**Symptom:** ADB works briefly, then device state switches to `offline`.

**Resolution:**
1. In **Developer options**, enable **"Allow ADB debugging in charge only mode"**.
2. In USB connection notification, select **Transfer files (MTP)** instead of Charge only.

---

## 8. AI Agent & MCP Pairing Failures

### Symptom: `pair_session` Rejected with "PIN challenge required" or "Invalid or expired request"

**Cause 1: Challenge PIN Not Entered**
Tier 3 (write/input injection) requires human-in-the-loop desktop confirmation.
- The AI client must prompt the human for the 6-digit PIN displayed on the desktop screen.
- Call `pair_session` with `{ requestId, pin: "123456" }`.

**Cause 2: 60-Second Challenge Expiration**
Unapproved pairing requests expire after 60 seconds to prevent unauthorized background access.
- Have the AI agent request pairing again via `request_pairing`.

**Cause 3: Brute-Force Lockout**
4 consecutive incorrect PIN attempts permanently invalidate the pairing request.
- Request a fresh pairing session from the AI agent.

---

## 9. Windows Named Pipe Connection Errors

### Symptom: MCP Server Reports "Named Pipe Server unavailable — fallback to standalone mode"

**Cause 1: Desktop Application Not Running**
The Named Pipe IPC channel (`\\.\pipe\androscrn-mcp-control`) is hosted by the Electron desktop workbench.
- Launch the desktop app:
  ```powershell
  androscrn
  ```
- If the desktop app is not running, the MCP server runs in headless fallback mode with isolated local security approval.

**Cause 2: Privilege / Elevation Disparity (UAC)**
If the desktop workbench is launched as standard user, but the AI agent or PowerShell terminal is running As Administrator (elevated), Windows Named Pipe security descriptors may reject cross-integrity connections.
- Launch both processes under the same Windows user session.

---

## 10. Camera Studio Limitations

### Symptom: Camera Stream Fails with "scrcpy camera mirroring requires Android 12 or higher"

**Cause:** The native scrcpy camera transport (`--video-source=camera`) relies on the Android `Camera2` framework NDK stream extension introduced in Android 12 (API level 31).

**Resolution:**
- For **Android 12 & 13+**: Camera Studio Direct3D11 streaming is fully supported.
- For **Android 5.0 through 11**: Use the **Companion App Mode** in Camera Studio, which connects to the lightweight Android CameraX companion APK over loopback port `127.0.0.1:8080`.
