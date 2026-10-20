# Android Companion App Submission Readiness & Google Play Compliance

**Document:** `docs/android-submission-readiness.md`  
**Application ID:** `com.androscrn.companion`  
**App Name:** AndroScrn Camera Companion  
**Version:** `1.0.0-alpha.1` (VersionCode: `1`)  
**Target SDK:** `34` (Android 14) | **Min SDK:** `26` (Android 8.0 Oreo)  
**Date:** October 20, 2026  
**Status:** Audit Completed — Ready for Store Preparation  

---

## 1. Executive Summary

This document provides a comprehensive readiness audit and compliance blueprint for publishing the **AndroScrn Companion** application (`com.androscrn.companion`) to Google Play Store and alternative Android distribution channels (e.g., F-Droid, GitHub Releases).

The companion application is designed as a local-first utility that exposes device camera sensors (via CameraX) to the AndroScrn desktop application over a secure ADB localhost socket (`127.0.0.1:8080`).

> [!IMPORTANT]
> The companion application connects **exclusively** to the local loopback interface (`127.0.0.1`). It contains **zero remote telemetry, zero analytics SDKs, zero third-party trackers, and zero user account infrastructure**.

---

## 2. Google Play Data Safety Declaration

Google Play requires all developers to complete the Data Safety questionnaire in Google Play Console. Based on code-level audit of `android/companion`, below are the exact answers to submit:

### 2.1 Data Collection & Sharing Overview

| Question | Assessment | Rationale / Source Verification |
| :--- | :--- | :--- |
| **Does your app collect or share any user data?** | **No** | Neither personal data, location, identifiers, nor device metadata is collected, transmitted off-device, or stored. |
| **Is all user data collected by your app encrypted in transit?** | **Yes (Not applicable / N/A)** | No data is transferred to external servers. Internal loopback traffic traverses the operating system IPC or encrypted ADB USB bridge. |
| **Do you provide a way for users to request data deletion?** | **Yes** | No persistent data is maintained on the device or servers. Closing the app or clearing app storage purges all volatile state immediately. |

### 2.2 Ephemeral Data Handling (Camera & Photos)

Under Google Play policies, temporary processing in memory that is discarded immediately does **not** constitute "data collection":
* **Camera Video Frames**: Transformed in volatile RAM from NV21 YUV to JPEG for the MJPEG stream and piped directly to the localhost socket. Frames are discarded within milliseconds and never written to persistent flash storage.
* **High-Resolution Stills**: Stills are saved temporarily to private cache (`context.cacheDir/temp_capture_*.jpg`), transmitted across the authenticated localhost socket, and deleted immediately using `tempFile.delete()`.
* **Pairing PINs & Tokens**: 6-digit PINs and 64-character bearer tokens exist strictly in volatile process memory (`PairingManager`) and are zeroed upon session termination or app close.

---

## 3. Permissions Audit & Justification

The companion application requests only 3 permissions in `AndroidManifest.xml`:

| Permission | Protection Level | Purpose & Justification | Runtime Consent Required? |
| :--- | :--- | :--- | :--- |
| `android.permission.CAMERA` | `dangerous` | Enables camera sensor capture, autofocus, zoom, and hardware LED torch via CameraX. | **Yes** (Requested dynamically via `ActivityResultContracts.RequestPermission`) |
| `android.permission.INTERNET` | `normal` | Required by Android OS to instantiate the embedded loopback HTTP server (`NanoHTTPD` on `127.0.0.1:8080`). No outbound public internet calls are made. | **No** (Granted at install time) |
| `android.permission.ACCESS_NETWORK_STATE` | `normal` | Allows checking network interface states to detect local ADB bridge availability. | **No** (Granted at install time) |

### 3.1 Prominent Disclosure & In-App Consent Flow
Google Play policy requires prominent in-app disclosure before requesting sensitive permissions (`CAMERA`). The companion application includes:
1. **Pre-Permission Educational Card**: Explains why camera access is required ("Connect your phone camera to AndroScrn on your PC for document scanning and multi-angle streaming").
2. **Foreground-Only Operation**: Camera preview is tied to `LifecycleOwner` (MainActivity). When the app is minimized or backgrounded, camera sensors are immediately released.
3. **Anti-Covert Banner**: A permanent, high-contrast banner ("LIVE FEED ACTIVE") remains visible on the device screen throughout any active streaming session.

---

## 4. Policy Compliance Checklist

| Policy Requirement | Target Status | Technical Evidence & Verification |
| :--- | :--- | :--- |
| **Target SDK 34+** | **Compliant** | `targetSdk = 34` in `android/companion/app/build.gradle.kts`. Satisfies Google Play's 2024–2026 requirement. |
| **64-bit Architecture** | **Compliant** | Pure Kotlin/Java with Android Jetpack CameraX and NanoHTTPD. Contains no native `.so` binaries; fully neutral across `arm64-v8a`, `armeabi-v7a`, `x86_64`. |
| **App Account Deletion** | **Exempt** | AndroScrn has no account registration, login, or cloud backend. Google Play Console question "Does your app allow users to create an account?" is answered **No**. |
| **Advertising Policy** | **Compliant** | Zero ads. Does not integrate Google Mobile Ads, AdMob, or third-party ad networks. |
| **Background Camera Access** | **Compliant** | Does not implement background camera services. `CameraX` binds strictly to `ProcessCameraProvider.bindToLifecycle(this, ...)`. |
| **Deceptive Behavior** | **Compliant** | Clearly designated as "AndroScrn Camera Companion". Does not imitate system apps or third-party camera applications. |
| **Public Privacy Policy** | **Required** | Must provide an active HTTPS privacy policy link in Google Play Console (see Section 6). |

---

## 5. Release Build & Signing Guide

### 5.1 Keystore Generation
For production releases, generate an upload key using standard `keytool`:

```bash
keytool -genkeypair -v -keystore androscrn-release-key.jks -alias androscrn -keyalg RSA -keysize 2048 -validity 10000
```

> [!WARNING]
> Never commit `androscrn-release-key.jks` or passwords to version control. Pass signing credentials via environment variables during CI/CD.

### 5.2 Building Android App Bundle (AAB)
Google Play requires `.aab` bundles rather than `.apk` packages for new app submissions:

```bash
cd android/companion
./gradlew :app:bundleRelease
```
The resulting bundle is generated at:
`android/companion/app/build/outputs/bundle/release/app-release.aab`

---

## 6. Store Listing Metadata & Required Assets

### 6.1 Listing Copy

* **App Title:** AndroScrn Camera Companion (25 / 30 characters)
* **Short Description:** Companion camera utility for the AndroScrn desktop workbench. (64 / 80 characters)
* **Full Description:**
```text
AndroScrn Camera Companion connects your Android device camera directly to the AndroScrn desktop workbench on Windows.

FEATURES:
- Local-First Architecture: Video frames are streamed exclusively over your secure USB cable or local ADB tunnel.
- Human-in-the-Loop Security: Out-of-band 6-digit PIN verification displayed on your phone prevents unauthorized local connections.
- Document Scanning & OCR: High-resolution captures for instant local OCR and searchable PDF creation on your PC.
- Complete Privacy: Zero cloud servers, zero analytics, and zero tracking. Captures are never stored on your phone.

REQUIREMENTS:
- AndroScrn Desktop Application for Windows.
- USB Debugging enabled in Android Developer Options.
```

### 6.2 Mandatory Store URLs
* **Privacy Policy URL:** `https://sukeshperiyasamy.github.io/Androscrn/#privacy-policy` (or dedicated `privacy-policy.html`)
* **Support Email Placeholder:** `[MAINTAINER_CONTACT_PLACEHOLDER: support@androscrn.org]`
* **Open-Source Repository:** `https://github.com/sukeshperiyasamy/Androscrn`
