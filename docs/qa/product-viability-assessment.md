# AndroScrn — Product Viability, Commercial & Engineering Assessment

**Date:** October 18, 2026  
**Auditor:** Senior Product Architect & Lead Systems Engineer (Phase 11.3 Independent Audit)  
**Evaluation Baseline:** `6f4a6eb` (working tree with Phase 10–11.3 hardening)  
**Target Market:** Windows Android Power Users, Mobile Developers, QA Automation Engineers, Hardware Inspection Labs, and AI Agent Integrators  
**Current Release Verdict:** **LIMITED PREVIEW / INTERNAL BETA (NOT GENERAL AVAILABILITY PRODUCTION READY)**

---

## 1. Executive Viability Scorecard

Evaluations are scored across 10 distinct architectural and commercial categories on a 0–10 scale using explicit scoring rubrics. No arbitrary composite score is computed; each subsystem is assessed on its individual evidence, maturity, and readiness for general distribution.

| Subsystem / Category | Score (0–10) | Rating | Key Strengths | Identified Blockers / Deductions | GA Readiness Gate |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **1. Screen Mirroring & Scrcpy Engine** | **9.0 / 10** | **Ready** | Bundled scrcpy 5.0.1; Direct3D11 60fps; audio forwarding; clean exit handling. | Dependent on OEM driver stability; Xiaomi MIUI input restrictions. | **PASS** |
| **2. Wireless Connectivity & Discovery** | **8.0 / 10** | **Beta** | 1-click USB-to-Wi-Fi handoff; mDNS discovery; Android 11+ TLS PIN pairing wizard. | mDNS multicast dependent on LAN topology; hotspot route discovery Windows-specific. | **PASS** |
| **3. Camera Streaming & Companion Client** | **7.0 / 10** | **Beta** | Scrcpy camera mirroring; companion HTTP API for lossless photo capture; lens switching. | Companion APK lacks Gradle wrapper; requires manual compilation in Android Studio. | **BLOCKED (APK)** |
| **4. Document Intelligence & Searchable PDF**| **7.5 / 10** | **Beta** | 100% offline OCR; manual quad corner editor; Type 0 Unicode PDF with Identity-H CMap. | Real phone photograph validation across varied camera resolutions is PENDING. | **BLOCKED (OCR)** |
| **5. Automation & Workflow Sequencer** | **8.5 / 10** | **Ready** | POSIX shell argument escaping; coordinate & keycode bounds; live cancellation; UI presets. | No multi-device concurrent sequencing; UI limited to single active device. | **PASS** |
| **6. MCP AI Agent & HITL Security** | **9.5 / 10** | **Ready** | Windows Named Pipe IPC; 3-tier dynamic security model; HITL desktop pairing; kill-switch. | Windows-only Named Pipe transport (not yet cross-platform to Unix sockets). | **PASS** |
| **7. Diagnostics & Privacy Protection** | **9.0 / 10** | **Ready** | Redacts serials, emails, Wi-Fi SSIDs, IPs, and tokens; offline logcat exporter; zero telemetry. | Diagnostic reports cannot capture kernel dmesg without root permissions. | **PASS** |
| **8. Desktop UI, Accessibility & Styling** | **9.0 / 10** | **Ready** | Tailwind v3.4 dark design system; zero external fonts; WCAG 2.2 AA compliant; Error Boundary. | Non-standard DPI scaling on multi-monitor setups requires further testing. | **PASS** |
| **9. Build Automation & Packaging** | **8.0 / 10** | **Beta** | 148.18 MB standalone portable ZIP; native CUI launcher; SHA-256 manifest; zero prereqs. | Automated CI does not package companion APK; Windows ARM64 build unverified. | **PASS (x64 only)** |
| **10. Hardware Compatibility & Real Devices**| **7.0 / 10** | **Beta** | Physical testing on Xiaomi HyperOS (Android 13); comprehensive OEM guidance engine. | Xiaomi touch injection blocked by MIUI carrier SIM policy; physical Wi-Fi untested. | **PENDING** |

---

## 2. Category Rubrics & Deep Engineering Evaluation

### Category 1: Screen Mirroring & Scrcpy Engine (9.0 / 10)
- **Rubric:** 10 = Flawless low-latency mirroring across all USB/Wi-Fi configurations with automatic recovery; 8 = Production-ready with minor OEM caveats; 6 = Functional but prone to stutter or disconnects.
- **Assessed Score:** 9.0 / 10.
- **Strengths:** Bundles official `scrcpy 5.0.1` and `adb 1.0.41`. Direct3D11 hardware acceleration delivers consistent 60 fps streaming over USB 3.0. Presets (`ultra`, `balanced`, `battery_saver`, `high_performance`) adjust bitrates, resolution caps, and audio forwarding cleanly.
- **Deductions (-1.0):** Physical touch injection on Xiaomi devices requires manual toggle of proprietary "USB debugging (Security settings)" requiring an active SIM card and Mi Account. While accurately diagnosed by OEM Guidance, it cannot be bypassed programmatically.

### Category 2: Wireless Connectivity & Discovery (8.0 / 10)
- **Rubric:** 10 = Zero-click seamless wireless handoff and mDNS discovery across all enterprise/home networks; 8 = Reliable standard Wi-Fi handoff with manual PIN pairing; 6 = Frequent connection drops or routing failures.
- **Assessed Score:** 8.0 / 10.
- **Strengths:** 1-click USB-to-Wi-Fi handoff switches port 5555 and establishes TCP/IP connection. Hotspot gateway auto-detection queries Windows default routes to prefill phone hotspot IPs. Smart mDNS discovery identifies Android 11+ pairing endpoints with Electron native OS confirmation dialogs. Disconnect button enables clean teardown.
- **Deductions (-2.0):** mDNS discovery relies on network routers permitting UDP multicast (mDNS port 5353). In enterprise or guest Wi-Fi networks with client isolation, automatic discovery fails, requiring manual IP fallback. Physical wireless pairing on a live phone remains hardware-pending.

### Category 3: Camera Streaming & Companion Device Client (7.0 / 10)
- **Rubric:** 10 = Zero-setup camera mirroring with automated companion APK install; 8 = Dual transport working with prebuilt companion APK; 6 = Companion app requires manual source compilation.
- **Assessed Score:** 7.0 / 10.
- **Strengths:** Scrcpy camera mirroring (`--video-source=camera`) streams front/back camera feeds with Direct3D11 acceleration. Companion HTTP client supports digital zoom, torch toggle, and lossless full-resolution shutter capture directly to PC disk.
- **Deductions (-3.0) — Release Blocker for GA:** The companion app Kotlin source code is complete, but `android/companion/` lacks Gradle wrapper files (`gradlew`). The prebuilt APK is not compiled by GitHub Actions CI or bundled into the portable ZIP release. Users must compile the APK in Android Studio to use companion mode.

### Category 4: Document Intelligence & Searchable PDF (7.5 / 10)
- **Rubric:** 10 = Validated on large real-world photo dataset with sub-5% CER/WER and Unicode PDF export; 8 = Working offline OCR engine, interactive quad correction, and valid PDF export; 6 = Frequent OCR crashes or text layer misalignment.
- **Assessed Score:** 7.5 / 10.
- **Strengths:** 100% offline OCR via local worker threads and bundled English data. Interactive SVG corner adjustment modal with mouse/touch pointer capture, 90° rotation, and accessible keyboard navigation (`role="slider"`). Generates dual-layer Type 0 Unicode searchable PDFs using `/Identity-H` and `/ToUnicode` CMap, preserving Latin-1 accents, currency, and CJK characters.
- **Deductions (-2.5) — Release Blocker for GA:** Synthetic image validation passes 100% (36/36 PDF checks), but real-world photographed page validation across phone cameras, uneven lighting, shadows, and low contrast is marked **PENDING** until a community dataset is collected.

### Category 5: Automation & Workflow Sequencer (8.5 / 10)
- **Rubric:** 10 = Hardened sequencer supporting complex conditionals, multi-device concurrency, and strict argument safety; 8 = Linear multi-step execution with parameter bounds and safe process escaping; 6 = Vulnerable to shell injection or lack of UI feedback.
- **Assessed Score:** 8.5 / 10.
- **Strengths:** Dispatches discrete process arguments (`shell: false`). For device-side input text, uses POSIX single-quote escaping (`escapeShellArg`) to preserve legitimate user punctuation (`!`, `@`, `#`, `$`, `&`, `(`, `)`, `[`, `]`, `{`, `}`, `;`, `:`, `'`, `"`, `/`, `?`) while neutralizing command injection. Coordinates bounded (`0 <= coord <= 20000`); keycodes bounded (`0 <= keycode <= 300`). UI features live execution progress, cancellation button (`cancelWorkflow`), and detailed audit records.
- **Deductions (-1.5):** Sequences are linear and execute on a single target device at a time; does not support branch logic, loops, or concurrent multi-device execution.

### Category 6: MCP AI Agent Integration & Security Boundaries (9.5 / 10)
- **Rubric:** 10 = Formally verified inter-process isolation with mandatory human authorization, dynamic permissions, and instant kill-switch; 8 = Token-authenticated agent bridge; 6 = Unauthenticated network sockets.
- **Assessed Score:** 9.5 / 10.
- **Strengths:** Communicates exclusively over Windows Named Pipes (`\\.\pipe\androscrn-mcp-control`) with strict DACL security. Human-in-the-Loop pairing requires physical user desktop approval of a 6-digit PIN before issuing 64-char session tokens. 3-tier dynamic security permissions enforce read-only (Tier 1), screen observation (Tier 2), and physical input injection (Tier 3). Emergency Kill Switch revokes all tokens and severs pipes instantly.
- **Deductions (-0.5):** Named Pipe transport is Windows-specific and would require domain-socket abstraction if ported to Linux/macOS in the future.

### Category 7: Diagnostics, Logging & System Reporting (9.0 / 10)
- **Rubric:** 10 = Zero-leakage diagnostic bundle with automated PII masking and complete subsystem tracing; 8 = Structured logcat and device state exporter; 6 = Unredacted logs leaking tokens or serials.
- **Assessed Score:** 9.0 / 10.
- **Strengths:** Automated redaction strips device serials, emails, Wi-Fi SSIDs, BSSIDs, IP addresses, pairing codes, and MCP session tokens from logs and exports. Captures device properties, battery levels, display metrics, and logcat buffers into dated ZIP bundles.
- **Deductions (-1.0):** Kernel `dmesg` buffers cannot be collected on unrooted retail Android devices due to Android SELinux restrictions.

### Category 8: Desktop UI, Accessibility & Styling Architecture (9.0 / 10)
- **Rubric:** 10 = Fully responsive, accessible, zero-network design system with comprehensive error boundaries; 8 = Modern UI with minor accessibility gaps; 6 = Inconsistent styling or white-screen crash risks.
- **Assessed Score:** 9.0 / 10.
- **Strengths:** Tailwind CSS v3.4 (`v3.4.17`) custom dark theme with zero external font requests. Wrapped with root `ErrorBoundary` in `main.tsx` providing crash containment and reload options. Full WCAG 2.2 AA compliance: keyboard focus rings, screen reader announcements (`aria-live`), and slider controls.
- **Deductions (-1.0):** Multi-monitor setups with mixed DPI scaling (e.g. 100% on 1080p and 200% on 4K) may exhibit minor window-drag artifacts in Electron.

### Category 9: Build Automation, Packaging & Portability (8.0 / 10)
- **Rubric:** 10 = Fully automated multi-platform CI generating signed installers, portable packages, and mobile APKs; 8 = Standalone portable distribution with automated integrity hashes; 6 = Manual build steps required.
- **Assessed Score:** 8.0 / 10.
- **Strengths:** Automated PowerShell packaging script generates a 148.18 MB standalone ZIP containing the Electron runtime, bundled ADB, scrcpy, offline OCR models, native CUI launcher (`androscrn.exe`), and SHA-256 checksum manifest. Runs immediately without installation or system modification.
- **Deductions (-2.0) — Release Blocker for GA:** Companion APK is omitted from portable release artifacts. Windows ARM64 builds are unverified due to lack of ARM64 test hardware.

### Category 10: Hardware Compatibility & Real-World Validation (7.0 / 10)
- **Rubric:** 10 = Validated on 10+ hardware models across Android 10–15, multiple OEMs, and wireless configurations; 7 = Tested on 1 physical flagship device with documented OEM guidance; 5 = Simulator-only testing.
- **Assessed Score:** 7.0 / 10.
- **Strengths:** Physical USB hardware validation conducted in Phase 10.1 on Xiaomi `21091116I` (Android 13, HyperOS). Built-in OEM Guidance engine accurately diagnoses vendor quirks across Xiaomi, Samsung, Huawei, Vivo, and Oppo. Note: Phase 11.2–11.4 test validations used automated suites, device mocks, and headless test harnesses unless a live physical phone was attached.
- **Deductions (-3.0) — Release Blocker for GA:** Testing on physical Wi-Fi pairing and wireless streaming is pending real hardware environment setup. Testing across Samsung Knox, Google Pixel, and Motorola devices remains unverified on physical hardware.

---

## 3. Commercial & Competitor Analysis (With Explicit Caveats)

> [!NOTE]
> Competitor pricing, features, and policy details cited below reflect publicly advertised product information and documentation as of late 2025/2026. Licensing tiers, cloud dependencies, and feature bundles are subject to change by respective vendors.

| Feature / Metric | AndroScrn (Phase 11.3) | scrcpy (Official CLI) | Vysor (Commercial) | QtScrcpy / scrcpy-gui |
| :--- | :--- | :--- | :--- | :--- |
| **License & Price** | **100% Free & Open Source (MIT)** | Free & Open Source (Apache 2.0) | Proprietary Freemium ($2.50/mo or $40 lifetime)* | Free & Open Source |
| **User Interface** | **Full React Workbench + Native CLI** | Command Line Only | Electron Desktop App | Basic Qt/C++ GUI Wrapper |
| **High-Res Mirroring**| **Included (Direct3D11 60fps)** | Included (CLI Flags) | Paid Pro Subscription Required* | Included |
| **Privacy & Cloud** | **100% Local / Zero Network Leakage**| 100% Local | Cloud Account & Telemetry Used* | 100% Local |
| **AI Agent MCP Bridge**| **Built-in (Named Pipe + HITL)** | None | None | None |
| **Document OCR & PDF** | **Built-in (Offline + Searchable PDF)**| None | None | None |
| **Inspection Overlays** | **Built-in (Grid/Crosshair/Diff)** | None | None | None |
| **Wireless Discovery** | **Built-in (mDNS + Hotspot)** | Manual IP (`adb connect`) | Built-in (mDNS) | Manual IP |

*\* Caveat: Vysor pricing and feature gating based on public commercial tiers. Users should consult vendor websites for current commercial licensing terms.*

---

## 4. General Availability (GA) Release Readiness Gate Checklist

To transition from the current **Limited Preview / Internal Beta** to **General Availability (GA) Production Release**, the engineering team must satisfy the following mandatory gates:

### Gate 1: Mobile Companion Build Automation
- [ ] Add Gradle wrapper files (`gradlew`, `gradlew.bat`, `gradle/wrapper/`) to `android/companion/`.
- [ ] Add GitHub Actions CI workflow step to compile `androscrn-companion-release.apk` (or signed debug APK).
- [ ] Bundle the compiled companion APK into `dist-release/` and include it in `AndroScrn-portable-win-x64.zip`.

### Gate 2: Real-World Camera Photo OCR Validation
- [ ] Collect a non-sensitive corpus of 20+ printed document photographs taken with standard smartphone cameras under varied conditions (clean lighting, uneven shadows, perspective skew, low contrast).
- [ ] Execute `npm run validate:ocr:real` against the dataset.
- [ ] Measure and document Character Error Rate (CER) and Word Error Rate (WER) with documented normalization policies.
- [ ] Update [qa/real-photo-validation.md](real-photo-validation.md) with empirical real-camera results.

### Gate 3: Physical Wireless Hardware Validation
- [ ] Execute wireless pairing and streaming on a physical Android 11+ device across a standard 5 GHz Wi-Fi network.
- [ ] Measure frame latency, packet loss, and reconnection behavior on router channel hopping.
- [ ] Verify hot-reconnect when device toggles Wi-Fi off and on.

### Gate 4: Windows ARM64 Certification
- [ ] Run test suite on a physical Windows on ARM device (e.g. Snapdragon X Elite or Surface Pro 11).
- [ ] Validate native ARM64 or x64 emulation execution of bundled `adb.exe`, `scrcpy.exe`, and the Electron workbench.

---

## 5. Formal Tiered Release Verdicts (Phase 11.5)

| Release Tier | Verdict | Rationale & Gate Criteria |
| :--- | :---: | :--- |
| **1. Internal Development Build** | **APPROVED** | **Criteria Met:** 1,315 unique automated tests passing (1,068 unit, 39 integration, 172 UI, 36 PDF; styling suite verified within unit suite), 0 failures. Typechecking clean across root and desktop. Clean architecture, isolated processes, memory leak guards, and byte-for-byte PATH invariance. Recommended for daily engineering iteration and feature work. |
| **2. Limited Preview / Internal Beta** | **APPROVED (RECOMMENDED)** | **Criteria Met:** Standalone 148.18 MB portable release artifact (`AndroScrn-portable-win-x64.zip`) with native CUI launcher (`androscrn.exe`), bundled scrcpy 5.0.1, adb 1.0.41, and SHA-256 manifest. Hardened workflow engine with POSIX shell quoting, bounded inputs, and synchronized cancellation. UI Error Boundary protects against unhandled render crashes. Suitable for power users, QA automation teams, and developer preview. |
| **3. Public Release Candidate (RC)** | **BLOCKED** | **Blockers:** Gated on packaging the Android companion APK (`androscrn-companion-release.apk`) with a Gradle wrapper into the release bundle, and collecting an empirical real-camera photographed document dataset to benchmark OCR Character Error Rate (CER) and Word Error Rate (WER). |
| **4. General Availability (GA)** | **BLOCKED** | **Blockers:** Gated on: (1) Companion APK automated CI build and distribution; (2) Real-photo OCR validation benchmark report; (3) Physical wireless debugging validation across retail Wi-Fi router configurations; (4) Windows on ARM (ARM64) hardware verification. |

