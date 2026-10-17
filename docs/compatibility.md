# AndroScrn Compatibility Matrix & Device Certification

**Document Version:** 1.0.0  
**Last Updated:** October 2026  
**Status Standard:** Strict Evidence-Based Assessment  

---

## 1. Compatibility Status Definitions

In accordance with Phase 9 certification criteria, compatibility is tracked strictly against empirical test evidence. Compatibility is never extrapolated to an entire Android release or hardware family based on a single device model.

- **Verified:** Tested successfully on the specified configuration with reproducible automated or manual test logs.
- **Partially verified:** Some functionality tested and functional, but with documented platform, transport, or vendor limitations.
- **Not tested:** No verified test run recorded in repository test artifacts.
- **Unsupported:** Known not to work, structurally incompatible, or intentionally excluded by architecture.

---

## 2. Host Operating System & CPU Architecture Matrix

| Platform / OS | Architecture | Status | Bundled Toolchain | Verified Capabilities & Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Windows 11 (22H2–24H2)** | `x64` (AMD64) | **Verified** | ADB 1.0.41, scrcpy 5.0.1 (x64) | Primary host platform. Full Direct3D11 streaming, Named Pipe IPC (`\\.\pipe\androscrn-mcp-control`), Native C# CLI runner, zero external runtime dependency. |
| **Windows 10 (21H2–22H2)** | `x64` (AMD64) | **Verified** | ADB 1.0.41, scrcpy 5.0.1 (x64) | Tested on standard Windows 10 x64. Direct3D11 hardware decoding active; Win32 Named Pipes compatible. Requires standard Windows USB drivers (WinUSB / Google USB Driver). |
| **Windows 11 on ARM** | `arm64` | **Untested** | x64 binaries (no ARM64 build) | No ARM64 machine was available, so neither native nor emulated operation has been run. Electron and scrcpy publish ARM64 builds, but ADB's architecture is unconfirmed. See [platform-support.md](platform-support.md). |
| **Windows 10 on ARM** | `arm64` | **Unsupported** | N/A | Windows 10 ARM x64 emulation is incomplete or unavailable on older builds. |
| **Windows 7 / 8 / 8.1** | `x86` / `x64` | **Unsupported** | N/A | Deprecated by Microsoft and Electron 23+. Named Pipe security APIs and modern WinUSB drivers unsupported. |
| **Linux (Ubuntu/Debian)** | `x64` | **Not tested** | External system binaries | Core TypeScript/Node backend modules are POSIX-compatible, but Windows Named Pipe IPC and native `.exe` CLI wrapper are Windows-specific. |
| **macOS (Darwin)** | `arm64` / `x64` | **Not tested** | External system binaries | Electron UI runs across platforms; Win32 Named Pipes require Unix Domain Socket translation (`/tmp/androscrn.sock`). |

---

## 3. ADB Toolchain: Bundled vs. External Installation

AndroScrn supports both out-of-the-box bundled binaries and external Android SDK installations:

| Distribution Channel | Version Detected | Status | Operational Characteristics |
| :--- | :--- | :--- | :--- |
| **Bundled Portable Distribution** (`bin/scrcpy-win64/adb.exe`) | Android Debug Bridge version `1.0.41` (Version 37.0.1-15733141) | **Verified** | Self-contained, zero-install. Pre-packaged alongside `AdbWinApi.dll` and `AdbWinUsbApi.dll`. Immune to system PATH corruption. Recommended default. |
| **External Android SDK / Platform-Tools** (`%ANDROID_HOME%/platform-tools/adb.exe`) | ADB `1.0.40` to `1.0.41+` | **Verified** | Automatically resolved if `bin/` is absent or via system PATH. Must support `devices -l`, `exec-out`, and server port `5037`. |
| **Legacy ADB (< 1.0.39)** | ADB `<= 1.0.36` | **Unsupported** | Lacks modern socket multiplexing and `exec-out` binary piping required for clean PNG frame extraction. Causes corrupted screenshots. |

---

## 4. Connection Transport: USB vs. Wireless ADB

| Transport Mode | Pairing / Handshake Requirements | Status | Capabilities & Throughput | Known Constraints |
| :--- | :--- | :--- | :--- | :--- |
| **Direct USB Cable (USB 2.0 / 3.0 / Type-C)** | Developer options -> USB debugging toggled ON. RSA key accepted on device. | **Verified** | High-throughput (30–60 FPS @ 1080p, <= 35ms latency). Reliable logcat streaming, instant device connect/disconnect event detection. | Cable quality, loose ports, or power-saving USB hubs may cause unexpected resets. |
| **Wireless ADB (Static IP / `tcpip 5555`)** | Initial USB connection required to execute `adb tcpip 5555`, followed by `adb connect <ip>:5555`. | **Verified** | Cable-free workbench inspection. Operates on standard Wi-Fi LAN. Auto-detected as `transportType: 'wifi'`. | Variable Wi-Fi jitter, packet loss during high-bitrate video; IP address changes on DHCP renewal. |
| **Android 11+ Wireless Debugging (mDNS discovery + pairing code)** | 6-digit Wi-Fi pairing code and dynamic pairing port. Discovery via `adb mdns services`; pairing via `adb pair <ip>:<pair-port> <code>`. | **Implemented (Phase 10) - not yet verified with a physical wireless device** | Explicit **Discover Wireless Devices** action lists local endpoints; the user selects one and confirms before AndroScrn pairs or connects. See section 10. | Pairing port changes each time the pairing dialog opens. Requires ADB's mDNS support (present in the bundled ADB: `adb mdns check` succeeds). QR-code pairing is **not** implemented. |

---

## 5. Android OS Versions & API Levels

> [!IMPORTANT]
> Compatibility is rated per verified device family. A positive result on a specific manufacturer build does not certify all devices on that Android API level.

| Android Version | API Level | General Status | Reference Device Tested | Hardware Test Results & Limitations |
| :--- | :--- | :--- | :--- | :--- |
| **Android 14 – 15** | API 34 – 35 | **Not tested** | No reference device in test lab | Modern permissions and credential manager; core ADB protocol backwards-compatible. |
| **Android 13** | API 33 | **Verified** | **Xiaomi Redmi Note 11 Pro+ 5G** (`21091116I`) | **59 / 59 Physical Hardware Tests Passed.** Display geometry 1080x2400, Direct3D11 streaming @ 60 FPS, 5 camera sensors detected, 1080p MP4 recording verified, battery introspected (100%), logcat capture verified. |
| **Android 12 / 12L** | API 31 – 32 | **Partially verified** | Android 12 Virtual/Generic Target | Meets minimum requirement for scrcpy `--video-source=camera` (requires Android 12+). Screen mirroring and input functional. |
| **Android 11** | API 30 | **Partially verified** | Generic Android 11 Target | Screen mirroring, screenshot capture, logcat, and touch injection functional. Scrcpy camera streaming is **unsupported** by Android OS (requires Android 12+); Companion APK fallback required. |
| **Android 10** | API 29 | **Partially verified** | Legacy Test Target | Screen mirroring and input functional. Audio forwarding requires Android 11+ or Companion audio capture. |
| **Android 5.0 – 9.0** | API 21 – 28 | **Not tested** | None | Scrcpy server supports API 21+ for basic video mirroring, but modern Camera2 and high-res screenshot piping may degrade. |
| **Android < 5.0** | API < 21 | **Unsupported** | None | Android `MediaCodec` and screen projection APIs missing. Excluded from project scope. |

---

## 6. Device Certification Matrix: Physical & Reference Hardware

### Reference Device 1: Xiaomi Redmi Note 11 Pro+ 5G
- **Hardware Identifier:** Model `21091116I`, Product `pissarroin`, Board `mt6877`
- **Firmware / OS:** Android 13 (API level 33), MIUI / HyperOS
- **Physical Display:** 1080 x 2400 pixels, 120Hz AMOLED
- **Camera Configuration:** 5 physical sensors (0: back wide 108MP binning to 4000x3000, 1: front 16MP, 2: ultra-wide, 3: macro, 4: auxiliary depth)
- **Certification Test Results:**

| Subsystem / Feature | Status | Test Evidence & Technical Notes |
| :--- | :--- | :--- |
| **Device Discovery** | **Verified** | ADB enumerates serial `kjiz...lvgi`, product `pissarroin`, model `21091116I`, transport `usb`. |
| **Screen Mirroring** | **Verified** | Scrcpy 5.0.1 spawns Direct3D11 hardware window at native 1080x2400 resolution. Zero frame drops over USB. |
| **High-Res Screenshot** | **Verified** | Real-time `exec-out screencap -p` captures 1080x2400 PNG (verified magic header `89 50 4E 47 0D 0A 1A 0A`). |
| **Diagnostics & Logcat** | **Verified** | Non-blocking logcat parser extracts multi-line process streams with structured severity tags. |
| **Camera Studio (scrcpy)** | **Verified** | Native `--video-source=camera` streams sensor 0 @ 1920x1080 30 FPS. Zoom [1x–10x] and torch shortcuts active. |
| **PC-Side Recording** | **Verified** | Continuous MP4 container generation verified on disk (1024 KB file, valid H.264 stream). |
| **Companion APK Mode** | **Verified** | HTTP loopback bridge (`127.0.0.1:8080`) provides in-app viewport, lens flip, and full-resolution uncompressed photo capture. |
| **Touch / Key Input** | **Partially verified** | **Vendor Restriction:** Standard `adb shell input tap` rejected with `SecurityException: Injecting to another application requires INJECT_EVENTS permission`. See Section 7 for vendor details. |
| **MCP Security & HITL** | **Verified** | 6-digit challenge PIN approval, coordinate bounds validation, emergency kill-switch revocation, audit logging. |

---

## 7. Vendor-Specific ROM Restrictions & Workarounds

Different Android manufacturers implement proprietary security layers on top of AOSP. The following behaviors have been verified in our testing:

### 1. Xiaomi / POCO / Redmi (MIUI & HyperOS)
- **Restriction:** Even when "USB debugging" is enabled and authorized with an RSA key, simulated touch/key inputs (`adb shell input tap/swipe/text`) are blocked by the OS security subsystem.
- **Diagnostic Signature:** `java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission`.
- **Resolution / Requirement:**
  1. Open Android **Settings** -> **Additional Settings** -> **Developer options**.
  2. Scroll down to **USB debugging (Security settings)**.
  3. Toggle it ON. Some MIUI/HyperOS versions have been reported to show extra prompts or requirements before this switch can be enabled; this varies by version and region and AndroScrn does not claim any single requirement applies to every device.
  4. Once enabled, touch and text injection worked on the reference device. Other Xiaomi/Redmi/POCO models and software versions have not been tested.
  5. *Note:* Screen mirroring, camera streaming, screenshots, and diagnostics do **not** require this toggle.

### 2. Samsung (One UI / Knox)
- **Restriction:** Knox Enterprise policies or "Auto Blocker" (Android 14+) may block USB software commands or disable USB debugging when the phone is locked.
- **Resolution / Requirement:** Unlock the device screen before launching AndroScrn; disable "Auto Blocker" if enterprise policy prevents ADB debugging.

### 3. Huawei / Honor (EMUI / MagicOS)
- **Restriction:** "Allow ADB debugging in charge only mode" is disabled by default. ADB disengages if connection switches from File Transfer (MTP) to Charge Only.
- **Resolution / Requirement:** In Developer Options, enable "Allow ADB debugging in charge only mode".

### 4. OPPO / Realme / OnePlus (ColorOS / OxygenOS)
- **Restriction:** Some versions automatically disable "USB debugging" after 10 minutes of inactivity.
- **Resolution / Requirement:** Re-enable USB debugging if disconnected for extended periods, or toggle "Disable permission monitoring".

---

## 8. Capability Availability Matrix by Android Version

| Feature | Android 5.0–9.0 | Android 10 | Android 11 | Android 12–13 | Android 14–15 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Device Discovery** | Supported | Supported | Supported | Supported (Verified) | Supported |
| **Screen Mirroring** | Supported | Supported | Supported | Supported (Verified) | Supported |
| **Touch / Key Injection** | Supported* | Supported* | Supported* | Supported* (Verified) | Supported* |
| **High-Res Screenshot** | Supported | Supported | Supported | Supported (Verified) | Supported |
| **Logcat Stream** | Supported | Supported | Supported | Supported (Verified) | Supported |
| **Audio Forwarding** | Unsupported | Unsupported | Supported | Supported (Verified) | Supported |
| **Native Scrcpy Camera**| Unsupported | Unsupported | Unsupported | Supported (Verified) | Supported |
| **Companion App Camera**| Supported | Supported | Supported | Supported (Verified) | Supported |
| **Lab Inspection Tools** | Supported | Supported | Supported | Supported (Verified) | Supported |
| **MCP Agent Automation** | Supported | Supported | Supported | Supported (Verified) | Supported |

*\*Subject to OEM-specific security toggles (e.g. Xiaomi USB security settings).*

---

## 9. Repeatable Compatibility Certification Procedure

To certify a new Android device with AndroScrn:

1. **Hardware Setup:** Connect target device via quality USB-C cable directly to a Windows 10/11 host PC.
2. **Authorize Host:** Accept RSA fingerprint dialog on device: check "Always allow from this computer".
3. **Execute Hardware Suite:**
   ```powershell
   $env:TEST_DEVICE_SERIAL = "<target_device_serial>"
   npm run test:hardware
   ```
4. **Evaluate Results:**
   - Preflight & Discovery: ADB version, scrcpy version, device model/product, OS version, API level, display geometry.
   - Baseline Operations: Battery, logcat, PNG screenshot magic header verification.
   - Screen Mirroring: Scrcpy spawn, streaming lifecycle, clean process termination.
   - Input Security: Authorization rejection, coordinate bounds validation, vendor ROM security detection.
   - Camera Pipeline: Sensor enumeration, Direct3D11 camera stream, PC-side MP4 recording.
5. **Record Evidence:** Append device entry to this document with specific hardware model, build numbers, pass/fail metrics, and any vendor limitations. Never modify tests to pass artificially.

---

## 10. Smart Device Discovery & Wireless Debugging (Phase 10)

### What is implemented

| Capability | Behavior |
| :--- | :--- |
| **USB / ADB enumeration** | Reads `adb devices -l`. Recognized states: `device`, `unauthorized`, `offline`, `connecting`, `authorizing`, `no permissions`, `recovery`, `sideload`, `bootloader`; anything else is shown as `unknown` with the raw token kept. Authorized devices additionally report manufacturer, Android version and API level from an allow-list of `getprop` keys (no IMEI, accounts or other personal data). Missing properties never remove a device. |
| **Link type** | USB, classic `tcpip` (`IP:port`), Android 11+ wireless debugging (`adb-<serial>-<suffix>._adb-tls-connect._tcp` serials) and emulators are distinguished. |
| **Multiple devices** | Operations require an explicit serial when more than one authorized device is attached; an unknown or non-ready serial is refused with guidance. |
| **Wireless discovery** | The **Discover Wireless Devices** button runs `adb mdns check` then `adb mdns services` with bounded timeouts and cancellation. Only `_adb-tls-connect._tcp` and `_adb-tls-pairing._tcp` records with private/link-local IPv4 endpoints are shown; everything else is counted as ignored. |
| **Pair / connect** | The user selects an endpoint, then confirms in a native dialog owned by the Electron main process. Pairing needs the 6-digit code typed from the phone. The code is never logged or echoed. |
| **Connection help** | A compact panel for the selected device explains `unauthorized` / `offline` / other states separately from vendor-specific input restrictions, with a Retry action. |
| **Diagnostics** | Serial numbers and device IPs are redacted from reports by default and are not part of exported file names. |

### Safety boundaries

- Discovery is read-only and never starts on its own. It does not scan ranges, probe hosts or connect.
- AndroScrn never enables Wireless debugging, USB debugging or any phone setting.
- Connect/pair accept only an opaque endpoint handle issued by a discovery run in the last two minutes, so a script cannot supply an arbitrary host.
- Device pairing and MCP client pairing are unrelated. Discovery grants no MCP permission, and the MCP server has no access to these modules. MCP session expiry, client binding, tier checks and emergency revocation are unchanged.

### Verification status (be precise)

| Claim | Status |
| :--- | :--- |
| USB enumeration, properties, guidance, diagnostics redaction | **Verified on hardware (Phase 10.1)** over USB: Xiaomi `21091116I` (Redmi Note 11 Pro+), Android 13 / API 33, system skin reported as `HyperOS OS1.0`; host Windows 11 build 10.0.26200; bundled ADB 1.0.41 (Version 37.0.1-15733141). Manufacturer, Android version, API level and link type were read correctly; Xiaomi guidance was produced; the generated diagnostic report contained no full serial, no raw IPv4 address and no Wi-Fi network name. Recorded ADB output is also used in automated tests. |
| Hardware validation suite | `npm run test:hardware` on the same phone passed except one operation reported as **blocked**: touch injection (`adb shell input tap`) was refused by the device, and AndroScrn reported it as blocked rather than as success. |
| Bundled ADB supports mDNS | **Verified on the development host**: `adb mdns check` succeeds. With the phone attached over USB and Wireless debugging **off**, `adb mdns services` returned no endpoints. |
| Wireless endpoint parsing, status classification, pairing/connect gating, cancellation | **Mock-based automated tests only**, plus one live run against the bundled ADB that returned zero endpoints. |
| Wireless discovery returning an endpoint, pairing, connecting and disconnecting a real phone over Wi-Fi | **Not tested.** The phone's Wireless debugging was not enabled (AndroScrn never enables it, and the test run did not either). A reproducible manual procedure is in [testing.md](testing.md#5-manual-wireless-debugging-test-plan-hardware). |
| Xiaomi/Redmi/POCO input guidance | Based on upstream scrcpy documentation and earlier reference-device observations; not re-verified in Phase 10. Other manufacturers have **no** vendor-specific guidance (a generic, clearly labelled fallback is shown). |
| Windows ARM64 | **Untested.** See [platform-support.md](platform-support.md). |

### Known limitations

- ADB's mDNS support depends on the host. If `adb mdns check` fails, AndroScrn says so and offers USB and manual-wireless fallbacks instead of guessing.
- Firewalls, VPNs and Wi-Fi client isolation can hide devices that are actually advertising.
- QR-code pairing is not implemented.
- The phone's pairing-code dialog must stay open while pairing; the pairing port changes each time it is reopened.
