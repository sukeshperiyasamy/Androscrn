# AndroScrn Platform Support & Windows ARM64 Feasibility

_Last reviewed: Phase 10. Facts below were checked on an x64 Windows 11 host (AMD64) unless a row says otherwise._

## 1. Current support

| Platform | Status | Evidence |
| :--- | :--- | :--- |
| Windows 10/11 **x64** | **Supported** | Built, unit/integration/UI tested, and hardware-validated on x64 (see [compatibility.md](compatibility.md)). |
| Windows 11 **ARM64** | **Untested** | No ARM64 machine or VM was available. The only expectation (x64 emulation) comes from Microsoft's general documentation, not from running AndroScrn. |
| Windows 10 ARM64 | **Unsupported** | Not evaluated. |
| Linux / macOS | **Not tested** | Windows-only features (named pipe, `.exe` launcher) are not ported. |

The portable ZIP (`AndroScrn-portable-win-x64`) contains an x64 Electron runtime, an x64 `adb.exe` and an x64 `scrcpy.exe`.
On Windows 11 ARM64 the expected fallback is x64 emulation, but this has **not** been run or measured for AndroScrn.

## 2. Windows ARM64 feasibility investigation

| Question | Finding | How it was established |
| :--- | :--- | :--- |
| Can Electron be packaged for Windows ARM64? | **Probably yes.** Electron 31.7.7 (the version in `apps/desktop/package.json`) publishes `electron-v31.7.7-win32-arm64.zip` (~112 MB) alongside the x64 build. | GitHub release asset listing for `electron/electron` tag `v31.7.7`. The archive was **not** downloaded or run. |
| Is a native ARM64 scrcpy available? | **Yes, for scrcpy itself.** scrcpy v5.0.1 publishes `scrcpy-winarm64-v5.0.1.zip` (~9.8 MB) next to the win32/win64 archives. | GitHub release asset listing for `Genymobile/scrcpy`. Not downloaded. |
| Is a native ARM64 `adb.exe` available? | **Unknown.** Google's `platform-tools-latest-windows.zip` is distributed as one Windows package; no separate ARM64 build was found. Whether the `adb.exe` inside `scrcpy-winarm64` is native ARM64 or x64 has not been checked. | Not verified. Needs the PE machine type of the bundled `adb.exe` (`0xAA64` = ARM64, `0x8664` = x64). |
| Native modules / subprocess architecture assumptions? | **No native Node addons** (runtime deps are `@modelcontextprotocol/sdk` and `zod`; `esbuild` bundles Electron main/preload). Subprocesses are `adb.exe` and `scrcpy.exe`, launched by path with discrete arguments, so mixed x64/ARM64 processes would work as long as each binary runs. | Reading `package.json` files and `modules/` sources. |
| Packaging script assumptions | **x64 is hard-wired.** `packaging/portable/package-portable.ps1` names output `AndroScrn-portable-win-x64`, copies Electron from the host-installed `apps/desktop/node_modules/electron/dist` (an x64 install on an x64 host), and compiles `androscrn.exe` with `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` without a `/platform` switch. | Reading the script. |
| Is x64 emulation the current fallback? | **Expected, not verified.** | See section 1. |
| Signing / runtime dependencies | The portable build performs no code signing step, so Windows SmartScreen may warn on first launch. ARM64-specific signing and runtime-dependency requirements were not investigated. | Reading the packaging output and README. |

## 3. Why no ARM64 build target was added

A target should only be added when the dependencies exist **and the result can be validated**. Neither condition is fully met:

1. **Validation is impossible on this x64 host.** An ARM64 `AndroScrn-gui.exe` cannot be launched here, so a build would ship untested.
2. **ADB architecture is unconfirmed**, and ADB is required for every feature.
3. The packaging script depends on the host's installed Electron architecture and the x64 `Framework64` compiler path.

The x64 distribution is unchanged.

## 4. Implementation plan (when ARM64 hardware is available)

1. On a Windows 11 ARM64 machine, run the existing x64 portable build under emulation and record: launch, `androscrn doctor`, device discovery, mirroring latency, named-pipe MCP pairing. This establishes the real baseline.
2. Inspect `adb.exe` inside `scrcpy-winarm64-v5.0.1.zip` with a PE header reader. Decide whether to bundle it or the x64 `adb.exe`.
3. Parameterize `package-portable.ps1` with `-Arch x64|arm64`: output name, Electron download (`npm_config_arch=arm64 npm install` in `apps/desktop`, or `@electron/get` with `arch: 'arm64'`), scrcpy bundle, and `csc.exe` platform (`/platform:arm64` or `anycpu`).
4. Add a CI job on `windows-11-arm` runners if available to the repository, running `npm test` and the portable build.
5. Run the hardware validation suite on ARM64 with a physical phone before declaring support.
6. Only then update the status tables in `README.md` and `docs/compatibility.md`.

## 5. Open questions

- Does ADB's mDNS discovery (`adb mdns check` / `adb mdns services`) work on ARM64 hosts?
- Is there an ARM64 USB driver story for vendor phones (WinUSB vs. vendor drivers)?
- Should an ARM64 build be signed?
