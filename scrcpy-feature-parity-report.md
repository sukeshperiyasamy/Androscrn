# scrcpy Feature Parity Report

No earlier version of this file existed in the repository at audit time (2026-10-21), so no historical
content was preserved. Latest verification (bundled scrcpy 5.0.1, Xiaomi 21091116I):
mirroring SDK/UHID launch VERIFIED ON HARDWARE; SDK input BLOCKED by device security setting;
UHID input PARTIAL (launch only); camera, audio, recording, virtual display, clipboard UNTESTED.
See ANDROSCRN_FEATURE_TEST_MATRIX.md and ANDROSCRN_MASTER_AUDIT_REPORT.md.

## Update (round 2, 2026-10-21)
Recording (mirror and camera) now produces playable MP4 after the graceful-stop fix (previously the moov atom was missing).
Camera via scrcpy 5.0.1 on Xiaomi 21091116I: works at <=1920 px; requesting the sensor maximum 4000x3000 fails on this device's encoder.
UHID mouse is relative/captured: click, scroll and middle-click observed; typing and right-click Back not conclusively verified.

## Update (round 3, 2026-10-21)
UHID keyboard typing verified on hardware (Settings search field). Escape did not act as Back. Wireless TCP/IP and pairing blocked by campus Wi-Fi client isolation.
