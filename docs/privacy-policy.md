# AndroScrn Privacy Policy

**Effective Date:** October 20, 2026  
**Last Updated:** October 20, 2026  
**Project:** AndroScrn (Desktop Workbench & Android Companion)  
**Repository:** [https://github.com/sukeshperiyasamy/Androscrn](https://github.com/sukeshperiyasamy/Androscrn)  
**Contact:** `[MAINTAINER_CONTACT_PLACEHOLDER: privacy@androscrn.org]` or [GitHub Issues](https://github.com/sukeshperiyasamy/Androscrn/issues)

---

## 1. Introduction & Core Principle: Local-First Architecture

AndroScrn is an open-source, local-first workbench designed for inspecting, mirroring, and automating Android devices from Windows desktops, paired with an optional lightweight Android camera companion application.

Our fundamental design principle is **complete data sovereignty**:
* **Zero Cloud Telemetry**: AndroScrn does not operate remote servers, tracking services, user telemetry, or analytics SDKs.
* **Zero Cloud Data Processing**: All video streaming, camera capture, screen mirroring, and optical character recognition (OCR) operations are executed 100% on your local hardware.
* **No User Accounts**: Neither the desktop application nor the Android companion app requires or supports user registration, cloud accounts, or third-party tracking.

This Privacy Policy explains how information is processed between the **AndroScrn Desktop Application** on Windows and the **AndroScrn Companion Application** on Android.

---

## 2. Desktop Application Data Practices

### 2.1 Device Information Accessed
When you connect an Android device via USB or local network ADB, the desktop application queries standard Android system properties through the Android Debug Bridge (ADB):
* **Device Identification**: Hardware serial number, device model (e.g., `ro.product.model`), manufacturer, and product codename.
* **Operating System Telemetry**: Android OS version, API level (e.g., `ro.build.version.sdk`), and connection transport type (USB, TCP/IP, or Wi-Fi).
* **System State**: Battery level percentage and authorization state (`device`, `unauthorized`, `offline`).

**Storage & Transmission**: This information is held in volatile desktop memory for the duration of your session to display device telemetry. It is never uploaded to any remote server. When exporting diagnostic bundles, sensitive device serials, IP addresses, MAC addresses, and Wi-Fi SSIDs are automatically masked by the built-in redaction engine (e.g., `[REDACTED_SERIAL]`).

### 2.2 Screen Mirroring & Display Capture
* **Processing**: Screen mirroring launches an embedded instance of `scrcpy` (v5.0.1). Display frames are hardware-decoded and rendered directly onto your Windows desktop display via DirectX/Direct3D11 or SDL3.
* **Storage**: Screen recordings (`.mp4` / `.mkv`) and screenshots (`.png`) are written exclusively to your local Windows storage in the user-selected captures directory (defaults to `Captures/` or your Windows Videos directory). No display data is ever transmitted across external networks.

### 2.3 Local Document Intelligence & OCR
* **Local Processing**: Document scanning and text extraction use an embedded, WebAssembly-compiled instance of Tesseract OCR (`tesseract.js`) with bundled offline English training data (`@tesseract.js-data/eng`).
* **Zero Network Requests**: Document images and extracted text never leave your computer. Network sockets are strictly forbidden during OCR execution (verified with 0 remote network connections in automated test suites).
* **Searchable PDF Output**: Exported searchable PDFs and text files are generated locally using the internal PDF synthesis engine.

### 2.4 Model Context Protocol (MCP) & Automation Logs
* **Security Gatekeeper**: Automated interactions (such as taps, swipes, and key events dispatched by local AI agents) use an inter-process communication (IPC) Windows Named Pipe (`\\.\pipe\androscrn-mcp-*`).
* **Audit Trail**: Every automated action creates an in-memory audit log recording the action type, client identifier, timestamp, and success state. Credentials and tokens are strictly excluded from audit events.
* **Human Approval**: High-privilege automation requires explicit human confirmation on the desktop UI, and active sessions can be revoked immediately with the one-click Emergency Revoke control.

---

## 3. Android Companion Application Data Practices

The companion app (`com.androscrn.companion`) is an optional lightweight helper installed on your physical Android device to provide enhanced CameraX sensor controls and multi-lens streaming.

### 3.1 Android Permissions Used & Justification
* **`android.permission.CAMERA`**: Required to capture camera frames, adjust digital zoom, toggle the hardware LED torch, and take high-resolution still photos.
* **`android.permission.INTERNET`**: Required **strictly** to operate an embedded localhost HTTP server (`NanoHTTPD`) that listens on loopback (`127.0.0.1`). The app does **not** connect to the public internet.
* **`android.permission.ACCESS_NETWORK_STATE`**: Used locally to determine network interface availability for ADB port forwarding.

### 3.2 Network Binding & Interface Isolation
* **Loopback Only (`127.0.0.1`)**: The companion HTTP server binds exclusively to `127.0.0.1:8080`. It never binds to wildcard `0.0.0.0` or public network adapters.
* **Physical Isolation**: External devices on your local Wi-Fi or cellular network cannot initiate connections to the companion app. Communication is bridged exclusively via ADB port-forwarding over a secure USB cable (`adb forward tcp:8080 tcp:8080`) or an authenticated local ADB TCP connection.

### 3.3 Out-of-Band Pairing & Authentication
* **6-Digit Verification PIN**: To prevent unauthorized local processes from accessing camera sensors over loopback, the companion app implements human-in-the-loop pairing. When a connection is initiated, the phone generates a cryptographically random 6-digit PIN using `java.security.SecureRandom`.
* **Phone Screen Display**: The PIN is displayed visually on the phone screen with a 60-second time-to-live (TTL). It is never returned in network HTTP responses.
* **Rate Limiting**: Failed attempts are restricted to a maximum of 3 tries. A 4th failed attempt triggers an immediate brute-force lockout.
* **Bearer Session Tokens**: Validating the correct PIN issues a single-use 64-character session token (32 bytes entropy). All subsequent camera control and streaming requests must provide this bearer token.
* **Emergency Revocation**: Revoking the session on the desktop client or closing the companion app immediately destroys the session token in memory and terminates the streaming thread within 33 milliseconds.

### 3.4 Camera Frames & Temporary Storage
* **MJPEG Live Stream**: Real-time camera frames are converted from NV21 YUV to JPEG in volatile memory and piped directly to the localhost HTTP socket. Frames are discarded immediately after transmission and never written to disk.
* **Anti-Covert Surveillance**: Whenever camera frames are being streamed, the phone displays a prominent, high-contrast visual banner ("LIVE FEED ACTIVE") to prevent background or hidden recording.
* **Full-Resolution Stills**: When you trigger a still photo capture, the image is written briefly to the application's private cache directory (`context.cacheDir`), read into memory for delivery over the authenticated ADB bridge, and **immediately deleted from Android disk storage**. Captured photos are stored permanently only on your PC.

---

## 4. Third-Party Libraries & Dependencies

AndroScrn incorporates verified open-source libraries:
* **scrcpy v5.0.1** (Apache License 2.0) — Screen mirroring engine.
* **Android Platform Tools / ADB** (Apache License 2.0) — Device communication bridge.
* **Electron & Chromium** (MIT License / BSD License) — Desktop runtime environment.
* **Tesseract.js** (Apache License 2.0) — Local optical character recognition.
* **NanoHTTPD** (Modified BSD License) — Localhost embedded companion HTTP server.
* **CameraX** (Apache License 2.0) — Android Jetpack camera hardware abstraction.

None of these bundled libraries transmit user data or telemetry to third parties.

---

## 5. Data Retention & Deletion

* **Volatile Memory**: Pairing PINs, bearer tokens, logcat stream buffers, and frame caches exist only in volatile RAM and are permanently purged when you disconnect or exit the applications.
* **User Captures**: All media captures (photos, videos, OCR text exports, and diagnostic reports) are stored under your direct control on your Windows PC. You can view, manage, or delete them at any time using Windows File Explorer.
* **Companion Cache**: The companion app retains zero photos or media files. Its private cache directory is purged automatically upon capture completion and app termination.

---

## 6. Security & User Responsibilities

While AndroScrn enforces strict local-first security controls (loopback binding, rate-limited pairing PINs, token authentication, and data redaction), security is a shared responsibility:
* **Physical Device Control**: Only connect Android devices that you own or have explicit authorization to inspect and control.
* **Host PC Security**: Protect your Windows host machine against unauthorized access or malware, as ADB access can grant elevated privileges over connected Android devices.
* **Revocation Hygiene**: Use the desktop app's "Emergency Revoke" or disconnect buttons when concluding automation sessions or when stepping away from your workstation.

---

## 7. Changes to This Privacy Policy

If our data practices change due to new features or regulatory requirements, we will update this document in the repository with a revised "Last Updated" date. Because AndroScrn does not collect user email addresses or maintain accounts, updates are published directly in the project repository and in-app documentation.

---

## 8. Privacy Inquiries & Contact

If you have questions, feedback, or concerns regarding this Privacy Policy or AndroScrn's local-first architecture, please reach out via:
* **Maintainer Contact Placeholder**: `[MAINTAINER_CONTACT_PLACEHOLDER: privacy@androscrn.org]`
* **GitHub Issues**: [https://github.com/sukeshperiyasamy/Androscrn/issues](https://github.com/sukeshperiyasamy/Androscrn/issues)
