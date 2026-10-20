# AndroScrn Terms of Use

**Effective Date:** October 20, 2026  
**Last Updated:** October 20, 2026  
**Project:** AndroScrn (Desktop Workbench & Android Companion)  
**Repository:** [https://github.com/sukeshperiyasamy/Androscrn](https://github.com/sukeshperiyasamy/Androscrn)  
**Contact:** `[MAINTAINER_CONTACT_PLACEHOLDER: legal@androscrn.org]` or [GitHub Issues](https://github.com/sukeshperiyasamy/Androscrn/issues)

---

## 1. Acceptance of Terms

By downloading, installing, compiling, or using the **AndroScrn Desktop Application** or the **AndroScrn Companion Application** (collectively, "AndroScrn" or the "Software"), you agree to be bound by these Terms of Use ("Terms").

If you do not agree to these Terms, do not install, copy, or use the Software.

> [!NOTE]
> AndroScrn is open-source software licensed under the **MIT License**. These Terms govern operational use, user responsibilities, and guidelines for device interaction, and complement the underlying open-source license.

---

## 2. Authorized Use & Device Ownership

AndroScrn provides direct, low-level inspection, control, screen mirroring, and automation tools for Android devices via the Android Debug Bridge (ADB) and local companion services.

### 2.1 Device Authorization Requirement
You agree that you will **only** connect, mirror, inspect, automate, or control:
1. Devices that you personally own, or
2. Devices for which you have received express, unambiguous authorization from the rightful owner, employer, or device administrator.

### 2.2 Prohibited Uses
You may **not** use AndroScrn to:
* Engage in unauthorized surveillance, clandestine camera recording, or interception of communications.
* Access, extract, or monitor personal data from devices without the informed consent of the device user.
* Bypass Mobile Device Management (MDM), corporate security policies, or kiosk locks on unauthorized hardware.
* Develop, test, distribute, or execute malware, spyware, exploits, or malicious payloads.
* Violate any applicable municipal, state, national, or international privacy, wiretapping, computer crime, or intellectual property laws.

---

## 3. Responsible Use of Features & Automation

### 3.1 Screen Mirroring and Recording
* You are solely responsible for all content captured or recorded using the screen mirroring, video recording, or screenshot facilities.
* Be mindful of displaying personally identifiable information (PII), credentials, multi-factor authentication codes, or protected health information during shared desktop screens or presentations.

### 3.2 Camera Companion & Live Streaming
* The companion app activates camera sensors upon explicit user pairing. The on-screen "LIVE FEED ACTIVE" banner is an intentional safety feature designed to prevent covert background recording.
* You agree not to modify, conceal, or circumvent the on-screen camera active indicator, rate limits, or out-of-band PIN verification mechanisms.

### 3.3 Model Context Protocol (MCP) & Automated Inputs
* AndroScrn includes automation capabilities enabling local AI agents or programmatic scripts to dispatch touch events, swipes, and keypresses via ADB or companion APIs.
* **Autonomous Action Risk**: Automated inputs execute real physical or virtual actions on the connected device. You acknowledge that automation can trigger permanent operations (e.g., app deletion, data modification, or purchases).
* **Operator Responsibility**: You maintain full supervisory responsibility over all automation sessions. Always use AndroScrn's Emergency Revoke feature if an automation agent behaves unpredictably.

---

## 4. Credentials, PINs & Session Security

To protect your connected hardware and host computer:
* **Host Security**: You are responsible for maintaining the physical and logical security of the desktop workstation running AndroScrn and the ADB server.
* **Pairing PIN Protection**: Companion pairing PINs are short-lived (60 seconds) and displayed exclusively on the target device's physical screen. Do not expose pairing PINs in public communications or shared video feeds.
* **Session Tokens**: Do not log, distribute, or commit session tokens or ADB authorization keys (`adbkey`).

---

## 5. Open-Source Licensing & Third-Party Components

AndroScrn is released under the permissive **MIT License**. Third-party libraries and tools bundled or utilized with AndroScrn (including `scrcpy`, `adb`, `Electron`, `tesseract.js`, `CameraX`, and `NanoHTTPD`) remain subject to their respective open-source licenses (such as Apache 2.0 and BSD).

Review our [Dependencies and Licenses](dependencies-and-licenses.md) documentation for full license texts and attributions.

---

## 6. Disclaimers of Warranty

THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.

IN NO EVENT SHALL THE AUTHORS, MAINTAINERS, OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The authors do not warrant that:
* The Software will meet your specific operational or hardware requirements.
* Operation will be uninterrupted, error-free, or compatible with all Android OS versions, ROMs, or OEM vendor customizations.
* Data transmitted over local ADB tunnels will never experience frame loss or latency.

---

## 7. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE ANDROSCEN AUTHORS, MAINTAINERS, OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, LOSS OF DATA, DEVICE BRICKING OR MALFUNCTION, CORRUPTION OF OS FILES, LOSS OF PROFITS, BUSINESS INTERRUPTION, OR PRIVACY VIOLATIONS CAUSED BY IMPROPER DEVICE USAGE), REGARDLESS OF THE THEORY OF LIABILITY (CONTRACT, STRICT LIABILITY, OR TORT INCLUDING NEGLIGENCE).

---

## 8. Modifications to Terms & Termination

* **Modifications**: We reserve the right to revise or update these Terms at any time by publishing updated documentation in the project repository. Continued use of the Software following any changes constitutes acceptance of the modified Terms.
* **Termination**: You may terminate your agreement with these Terms at any time by stopping all use of AndroScrn and uninstalling the desktop and companion applications.

---

## 9. Contact Information

For inquiries, concerns, or bug reports regarding these Terms:
* **Maintainer Contact Placeholder**: `[MAINTAINER_CONTACT_PLACEHOLDER: legal@androscrn.org]`
* **Issue Tracker**: [https://github.com/sukeshperiyasamy/Androscrn/issues](https://github.com/sukeshperiyasamy/Androscrn/issues)

> [!IMPORTANT]
> This document serves as an operational policy and user terms for the open-source software project. It does not constitute formal legal counsel. Users and organizations should review their specific compliance requirements with legal advisors.
