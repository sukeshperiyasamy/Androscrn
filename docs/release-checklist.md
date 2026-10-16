# AndroScrn Release Verification Checklist

**Document:** `docs/release-checklist.md`  
**Date:** 2026-10-16  

---

## Pre-Release Verification Steps

- [x] **Checksum Integrity:** Official `scrcpy-win64-v5.0.1.zip` SHA-256 verified against official `SHA256SUMS.txt`.
- [x] **Bundled Binaries Present:**
  - `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`
  - `scrcpy.exe`, `scrcpy-server`
  - `SDL3.dll`, `avcodec-63.dll`, `avformat-63.dll`, `avutil-61.dll`, `swresample-7.dll`, `libusb-1.0.dll`
- [x] **Argument Vector Safety:** All commands use discrete argument vectors; no `cmd.exe /c` or shell strings.
- [x] **Device Discovery:** Verified device listing, connection state detection, and USB/Wi-Fi differentiation.
- [x] **Wireless Connection Handoff:** TCP/IP 5555 handoff and Hotspot Default Gateway discovery workflows verified.
- [x] **Error Handling:** Graceful recovery on device disconnect or failed pairing.
- [x] **Process Cleanup:** No orphaned `adb` or `scrcpy` processes left running upon application shutdown.
- [x] **Licenses & Notices:** Apache 2.0, MIT, zlib, and LGPL notices included in documentation and About UI.
- [x] **Unit & Integration Tests:** All test suites passing.
- [x] **Portable Windows Package:** Standalone portable package verified runnable without prior Node/Python/Rust installs.
