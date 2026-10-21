# AndroScrn

**An open-source Windows workbench for inspecting, mirroring and (with your approval) automating Android devices.**

[![Website](https://img.shields.io/badge/Website-sukeshperiyasamy.github.io%2FAndroscrn-0F766E.svg)](https://sukeshperiyasamy.github.io/Androscrn)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![AndroScrn CI](https://github.com/sukeshperiyasamy/Androscrn/actions/workflows/ci.yml/badge.svg)](https://github.com/sukeshperiyasamy/Androscrn/actions/workflows/ci.yml)

🌐 **Official Website & Documentation:** [https://sukeshperiyasamy.github.io/Androscrn](https://sukeshperiyasamy.github.io/Androscrn)

> **Status: alpha (v1.0.0-alpha.1).** Expect rough edges. See [Limitations](#supported-platforms-and-limitations).

AndroScrn brings the everyday Android debugging chores on Windows into one desktop app, built with Electron, React and
TypeScript. It bundles Google ADB and Genymobile scrcpy, so nothing else needs to be installed to use the portable build.

## Key features

- **Device discovery** - USB, TCP/IP and Wireless-debugging devices with state, model, Android version and API level, plus
  guidance for `unauthorized` / `offline` devices and vendor-specific restrictions.
- **Screen mirroring** - launches scrcpy's hardware-accelerated window with quality presets and per-device targeting.
- **Screenshots, logcat and diagnostics** - lossless PNG capture, a filtered logcat view, and exportable diagnostic
  reports with serials, IP addresses, Wi-Fi names and tokens redacted by default.
- **Wireless debugging helper** - an explicit "Discover Wireless Devices" action plus pairing-code pairing, always
  confirmed by you. *Not yet verified on a physical phone.*
- **Camera Studio** - stream, zoom, torch and record a phone camera (scrcpy on Android 12+, optional companion app).
- **Document scanner with local OCR** - import a photo or screenshot, straighten it, extract English text on your
  computer, edit it, and export text or a searchable PDF. Accuracy on real documents has not been measured.
- **Lab and inspection tools** - overlays, reference comparison and timelapse capture on top of camera snapshots.
- **Supervised AI automation (MCP)** - a stdio Model Context Protocol server whose input tools require a human-approved,
  expiring session. You can revoke all sessions with one click.
- **Command-line launcher** - `androscrn devices`, `doctor`, `docs`, and per-user PATH setup.

## Supported platforms and limitations

| Area | Status |
| :--- | :--- |
| Windows 10 / 11, x64 | Supported |
| Windows on ARM64 | Untested (see [platform support](docs/platform-support.md)) |
| Linux, macOS | Not supported |
| Android | 5.0+ for mirroring; 12+ for scrcpy camera; 11+ for wireless debugging |

Known limitations:

- Some vendors (for example certain Xiaomi/MIUI/HyperOS builds) block simulated touch and key input over ADB. AndroScrn
  reports this as a failure and shows guidance; it never changes phone settings for you.
- Wireless discovery depends on your network and on ADB's mDNS support; USB and manual pairing remain available.
- The portable build is not code-signed, so Windows SmartScreen may warn on first launch.
- Screenshots are not included here because real captures can contain personal data.

Details: [compatibility matrix](docs/compatibility.md).

## Quick start

**Prerequisites:** Windows 10/11 x64, an Android phone with USB debugging enabled and a data-capable USB cable.
Building from source additionally needs Node.js 20+.

**Install (portable build):** download `AndroScrn-portable-win-x64.zip` from the
[Releases](https://github.com/sukeshperiyasamy/Androscrn/releases) page if one is published, extract it anywhere, and run
`AndroScrn-gui.exe` or `androscrn.exe`.

**Install (from source):**

```bash
git clone https://github.com/sukeshperiyasamy/Androscrn.git
cd Androscrn
npm install
npm --prefix apps/desktop install
npm run build
npm run build:portable   # optional: produces dist-release/ (Windows only)
```

**First run:** connect the phone by USB, accept the "Allow USB debugging?" prompt on the phone, then open AndroScrn. Your
device appears in the device bar at the top. If it shows `unauthorized` or `offline`, expand the connection-help panel.

Full instructions: [getting started](docs/getting-started.md).

## Basic usage

```text
androscrn            # open the desktop app
androscrn devices    # list attached devices and their authorization state
androscrn doctor     # check ADB, scrcpy, devices, IPC and PATH
androscrn --help     # all commands
```

In the app: pick a device, press **Start** to mirror, use the other tabs for screenshots, logcat, diagnostics, wireless
connection, Camera Studio and the AI-agent security center. Workflows are described in [usage](docs/usage.md).

## Documentation

| Guide | Contents |
| :--- | :--- |
| [Getting started](docs/getting-started.md) | Prerequisites, installation, first connection, CLI and PATH setup |
| [Usage](docs/usage.md) | Everyday workflows, Camera Studio, wireless debugging, MCP setup |
| [Document intelligence](docs/document-intelligence.md) | Local OCR workflow, limits, size and licenses |
| [Compatibility](docs/compatibility.md) | Platforms, devices, vendor restrictions, verification status |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and recovery steps |
| [Security](docs/security.md) | Pairing, permissions, revocation, privacy |
| [MCP tool reference](docs/mcp-tool-reference.md) | Tool schemas and permission tiers |
| [Testing](docs/testing.md) | Test commands, prerequisites, skips, hardware procedures, validation status |
| [Platform support](docs/platform-support.md) | Windows ARM64 investigation and packaging notes |
| [Architecture](docs/architecture.md) | Modules, processes and data flow |
| [Privacy policy](docs/privacy-policy.md) | Local-first data practices and companion camera policies |
| [Terms of use](docs/terms-of-use.md) | Authorized device use, automation rules and warranty |
| [Android readiness](docs/android-submission-readiness.md) | Google Play Store Data safety and store guidelines |
| [Roadmap](docs/roadmap.md) | Completed and planned phases |

All documentation is indexed in [docs/README.md](docs/README.md).

## Security and privacy

- Everything runs locally; no cloud account or upload is needed.
- External programs are started with fixed argument lists, never through shell strings.
- AI agents get read-only tools by default. Input tools need a pairing you approve on the desktop, tokens expire, and
  one click revokes every session.
- Diagnostic exports redact serial numbers, IP and MAC addresses, Wi-Fi network names, email addresses and tokens.
- Discovery never connects on its own; pairing and connecting each need your confirmation.

Read the full model in [docs/security.md](docs/security.md) and our [Privacy Policy](docs/privacy-policy.md).

## Contributing and development

```bash
npm run dev:desktop   # start the Vite dev server for the UI (apps/desktop)
npm test              # unit + integration + UI tests (no phone needed)
```

Please keep child processes on discrete argument arrays, keep core features working without network access, and run
`npm test` before opening a pull request. More detail is in [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/testing.md](docs/testing.md).

## License

Released under the [MIT License](LICENSE). AndroScrn bundles [scrcpy](https://github.com/Genymobile/scrcpy) and the
[Android Debug Bridge](https://developer.android.com/tools/adb) (both Apache License 2.0); see
[docs/dependencies-and-licenses.md](docs/dependencies-and-licenses.md), [docs/terms-of-use.md](docs/terms-of-use.md) and `THIRD-PARTY-NOTICES.txt`.
