# AndroScrn — Standalone Portable Windows Distribution

**Document:** `docs/portable-packaging.md`  
**Target Platform:** Windows 10 / Windows 11 (x64)  
**Distribution Type:** Provisional Standalone Electron Distribution  
**Release Artifact:** `dist-release/AndroScrn-portable-win-x64.zip`  
**Executable:** `AndroScrn.exe`  
**Date:** 2026-10-16  

---

## 1. Executive Summary & Architecture Status

This release delivers a **genuine, offline-capable, standalone portable Windows distribution** of AndroScrn. Unlike early prototype builds that merely zipped source files and required `npx` or an external Node.js installation, this distribution is completely self-contained.

### Architecture Reconciliation & Provisional Status
> [!IMPORTANT]
> **Provisional Electron Distribution Notice:**  
> The approved target product baseline remains **Tauri 2 + Rust + React/TypeScript** with an out-of-process MCP server communicating over Windows Named Pipes (`\\.\pipe\androscrn-ipc`).  
> 
> Due to the host environment lacking installed Rust/Cargo toolchains and MSVC C++ build tools, the application is currently packaged as an Electron 31 standalone runtime. This distribution is explicitly designated as a **provisional Electron build** and does **not** claim to fulfill the long-term Tauri/Rust architecture specification. The long-term architecture decision remains unchanged for future releases when native compilation toolchains are provisioned.

---

## 2. Distribution Package Layout

The portable package extracted from `AndroScrn-portable-win-x64.zip` adheres to the following structure:

```
AndroScrn-portable-win-x64/
│
├── AndroScrn.exe                      # Standalone Electron 31 x64 application executable (172.5 MB)
├── AndroScrn.bat                      # Standalone launcher batch script (no external Node/npm)
├── LICENSE                            # AndroScrn MIT License
├── THIRD-PARTY-NOTICES.txt            # Full license attributions (scrcpy Apache 2.0, ADB, SDL3, FFmpeg, etc.)
├── README.md                          # Application readme and quick-start guide
├── CHANGELOG.md                       # Release notes and version history
│
├── ffmpeg.dll                         # Bundled FFmpeg media pipeline library
├── icudtl.dat                         # Unicode internationalization data
├── d3dcompiler_47.dll                 # Direct3D shader compiler
├── libEGL.dll / libGLESv2.dll         # OpenGL ES graphics acceleration libraries
├── vk_swiftshader.dll / vulkan-1.dll  # Vulkan software rendering fallbacks
├── chrome_100_percent.pak             # UI scale assets
├── chrome_200_percent.pak             # HiDPI UI scale assets
├── resources.pak                      # Core Electron application pack
├── snapshot_blob.bin                  # V8 engine snapshot
├── v8_context_snapshot.bin            # V8 context snapshot
├── version                            # Electron version identifier (v31.7.7)
├── locales/                           # Language localization packs
│
├── resources/
│   ├── app/                           # Packaged application bundle (loaded by Electron runtime)
│   │   ├── package.json               # Application manifest pointing to main.js
│   │   ├── dist/                      # Compiled React 18 + Vite frontend assets
│   │   │   ├── index.html             # Application HTML shell
│   │   │   └── assets/                # Minified React/Vite JavaScript and CSS bundles
│   │   └── dist-electron/             # Standalone bundled Electron processes (via esbuild)
│   │       ├── main.js                # Bundled main process + all modules (zero node_modules required)
│   │       └── preload.js             # Bundled typed contextBridge API
│   │
│   └── bin/scrcpy-win64/              # Secondary binary search location
│
├── bin/
│   └── scrcpy-win64/                  # Primary bundled Android engine binaries
│       ├── adb.exe                    # Google Android Debug Bridge v1.0.41 (platform-tools 37.0.1)
│       ├── AdbWinApi.dll              # Windows ADB USB interface library
│       ├── AdbWinUsbApi.dll           # Windows WinUSB support library
│       ├── scrcpy.exe                 # Genymobile scrcpy v5.0.1 video mirror & control client
│       ├── scrcpy-server              # scrcpy server JAR v5.0.1 (injected onto Android device)
│       ├── SDL3.dll                   # Simple DirectMedia Layer 3.4.18
│       ├── avcodec-63.dll             # FFmpeg video codec library
│       ├── avformat-63.dll            # FFmpeg container format library
│       ├── avutil-61.dll              # FFmpeg utilities library
│       ├── swresample-7.dll           # FFmpeg audio resampling library
│       └── libusb-1.0.dll             # Native USB interface library
│
└── docs/                              # Integrated technical documentation
    ├── portable-packaging.md          # Packaging layout and runtime specification
    ├── architecture.md                # System component and IPC architecture
    ├── security.md                    # Threat model and input validation policy
    └── dependencies-and-licenses.md   # SBOM and legal compliance
```

---

## 3. Build & Packaging Pipeline

The packaging workflow is fully automated and reproducible via `packaging/portable/package-portable.ps1`.

### Build Steps:
1. **Core Module Compilation:**
   ```powershell
   npm run build:modules
   ```
   Compiles TypeScript modules from `modules/` into `dist/modules/`.
2. **Frontend & Electron Process Bundling:**
   ```powershell
   npm --prefix apps/desktop run build
   ```
   - Vite minifies React 18 and Lucide icons into `apps/desktop/dist/`.
   - `esbuild` bundles `apps/desktop/electron/main.ts` and all imported backend modules into a single standalone `apps/desktop/dist-electron/main.js` (43 KB).
   - `esbuild` bundles `apps/desktop/electron/preload.ts` into `apps/desktop/dist-electron/preload.js` (1.5 KB).
   - **Result:** No production `node_modules` folder is needed at runtime.
3. **Packaging Assembly:**
   ```powershell
   npm run build:portable
   ```
   Executes `packaging/portable/package-portable.ps1`:
   - Clones the Electron x64 binary distribution to `dist-release/AndroScrn-portable-win-x64`.
   - Renames `electron.exe` to `AndroScrn.exe`.
   - Deploys `resources/app/` containing `dist/`, `dist-electron/`, and `package.json`.
   - Bundles official `scrcpy-win64` and `adb` binaries with supporting DLLs.
   - Creates `AndroScrn.bat` launcher.
   - Compresses the folder into `AndroScrn-portable-win-x64.zip` via Windows native `tar.exe`.
   - Calculates SHA-256 hashes for the ZIP archive and executable using universal .NET cryptography and writes `dist-release/SHA256SUMS.txt`.

---

## 4. Runtime Requirements & Prerequisites

### Bundled (No Installation Required)
* **Node.js runtime:** Fully embedded inside `AndroScrn.exe`.
* **npm / npx:** Completely eliminated from runtime execution.
* **Android Debug Bridge (ADB):** Bundled (`adb.exe` v1.0.41).
* **scrcpy Engine:** Bundled (`scrcpy.exe` v5.0.1 + SDL3 + FFmpeg DLLs).
* **Python / Java / Rust:** Not required to run the application.

### Genuine Host Prerequisites
1. **Operating System:** Windows 10 (version 1809 or later) or Windows 11, 64-bit (x64 architecture).
2. **Device Connection:**
   * An Android device running Android 5.0 (API level 21) or higher.
   * **USB Debugging** enabled in *Developer Options* on the Android device.
   * For wireless pairing, Android 11 or higher is required.
   * OEM Windows USB Drivers: If Windows does not recognize the device over USB, the manufacturer's Google/OEM USB driver (e.g. Google USB Driver, Samsung Smart Switch / USB driver) must be installed.

---

## 5. Launch Instructions

1. Download or locate `AndroScrn-portable-win-x64.zip`.
2. Extract the archive to any folder (e.g., `C:\Tools\AndroScrn` or a USB drive).
3. Launch the application using either method:
   * **Method A:** Double-click `AndroScrn.exe`.
   * **Method B:** Double-click `AndroScrn.bat`.
4. Connect an Android phone via USB cable and accept the USB Debugging RSA prompt on the phone screen.
5. AndroScrn automatically detects the device and allows 1-click mirroring, quality preset adjustments, wireless handoff, screenshot capture, and diagnostics.

### Logging & Diagnostics
* Application logs are written automatically to `androscrn.log` inside the application folder.
* If the application folder is write-protected (e.g., extracted to `C:\Program Files`), logs fall back automatically to `%APPDATA%\androscrn\androscrn.log`.

---

## 6. Verification Results

Verification was performed on 2026-10-16 in an isolated temporary environment (`%TEMP%\androscrn-isolated-test`) outside the repository with a restricted `$env:PATH` containing only Windows system directories.

| Verification Item | Test Method | Result | Notes |
| :--- | :--- | :--- | :--- |
| **No Node/npm dependency** | Stripped `$env:PATH`, verified `node` and `npm` return `$null` | **PASS** | `AndroScrn.exe` runs without external runtimes |
| **Clean directory extraction** | Extracted `AndroScrn-portable-win-x64.zip` via native `tar.exe` | **PASS** | Complete tree restored |
| **Bundled ADB execution** | Ran `& bin\scrcpy-win64\adb.exe version` in isolated directory | **PASS** | Reports ADB 1.0.41 (platform-tools 37.0.1) |
| **Bundled scrcpy execution** | Ran `& bin\scrcpy-win64\scrcpy.exe --version` | **PASS** | Reports scrcpy 5.0.1, SDL 3.4.18, libavcodec 63.1.102 |
| **Application launch** | Spawned `AndroScrn.exe` in restricted PATH environment | **PASS** | Process ran cleanly with PID 33416 |
| **Launcher script** | Executed `AndroScrn.bat` via `cmd.exe /c` | **PASS** | Successfully spawned application process |
| **Binary path resolution** | Inspected `androscrn.log` output | **PASS** | `adb.exe` and `scrcpy.exe` resolved relative to isolated app root |
| **Empty device handling** | Launched with 0 attached devices | **PASS** | `get-devices` returned `[]` without crash; UI showed empty state |
| **Existing test suite** | Ran `npm test` across unit and integration suites | **PASS** | 65 / 65 tests passed (55 unit, 10 integration) |
| **Physical device verification** | Hardware USB / touch / wireless streaming | **UNVERIFIED** | Requires physical Android device connected to host |

> [!WARNING]
> **Hardware Verification Notice:**  
> While all binaries, process supervision, argument vectors, and socket adapters have been verified through automated integration testing, physical USB video streaming, touchscreen injection, and wireless PIN pairing require a connected physical Android device and are therefore marked as **unverified in this headless environment**.
