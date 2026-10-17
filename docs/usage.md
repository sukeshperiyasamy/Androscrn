# Usage

Everyday workflows in the AndroScrn desktop app. Setup is in [getting-started.md](getting-started.md).

## Device bar and connection help

The bar at the top lists connected devices with a state badge (Ready, Unauthorized, Offline) and the link type (USB or
Wi-Fi). With several devices attached, pick the target explicitly; AndroScrn never guesses between devices.

For the selected device, a compact **connection help** panel explains `unauthorized` / `offline` states and, separately,
vendor-specific input restrictions with an evidence level and the uncertainty that applies. **Retry** re-checks the
device. Guidance only tells you what to check; AndroScrn never changes phone settings.

## Mirroring

Choose a quality preset and start mirroring. scrcpy shows the phone screen in its own accelerated window and AndroScrn
supervises the process. Stop it from the app or by closing the scrcpy window.

## Screenshots, logcat and diagnostics

- **Screenshot** saves a lossless PNG into the `Captures/` folder, which is git-ignored.
- **Logcat** shows a filtered, redacted log stream.
- **Diagnostics** produces a copyable report. By default it redacts device serials, IPv4/MAC addresses, Wi-Fi network
  names, email addresses, tokens and pairing codes, and exported file names contain a short hash instead of the serial.

## Wireless debugging (Android 11+)

1. On the phone enable **Developer options -> Wireless debugging** yourself. AndroScrn never enables it.
2. Open the **Wireless & Hotspot** tab and press **Discover Wireless Devices**. Only local-network endpoints advertised
   through ADB's mDNS support are shown.
3. To pair, choose **Pair device with pairing code** on the phone, select the pairing endpoint, type the 6-digit code and
   confirm the dialog.
4. Discover again, select the connection endpoint and confirm to connect.

Discovery alone never connects or pairs. If discovery is unavailable on your PC, use USB, the 1-click handoff from a USB
connection, or manual pairing with the IP, pairing port and code. Status and limits: [compatibility.md](compatibility.md);
problems: [troubleshooting.md](troubleshooting.md).

## Documents & OCR

The **Documents & OCR** tab imports a photo or screenshot, detects and straightens the page, runs OCR locally and lets
you edit the text before saving it or exporting a searchable PDF. The original image is never modified. Supported input
is PNG and JPEG; the bundled language is English. Details and limitations: [document-intelligence.md](document-intelligence.md).

## Camera Studio

Camera Studio streams an Android camera to the PC. It supports:

| Feature | How |
| :--- | :--- |
| Sensor choice, resolution and frame rate | scrcpy camera options at stream start |
| Digital zoom (1x-10x) and torch | UI controls; live shortcuts while the preview window is focused |
| PC-side MP4 recording | Saved under `Captures/` |
| Full-resolution stills | Optional Camera Companion app (`android/companion`) |

The scrcpy camera path needs **Android 12 or newer** and cannot take still photos during a live stream or change lens
without restarting. Live shortcuts (preview window focused): `Alt+Up` / `Alt+Down` zoom, `Alt+T` / `Alt+Shift+T` torch,
`Ctrl+Q` close. Design background: [ADR 002](adr/002-camera-companion-architecture.md) and
[ADR 003](adr/003-multipurpose-camera-platform.md).

The **Lab & Inspection** tools add non-destructive overlays (thirds, grid, crosshair, reticle), reference comparison and
interval timelapse capture on top of camera snapshots. Overlay dimensions are uncalibrated pixels.

## AI agents (Model Context Protocol)

AndroScrn includes a stdio MCP server so assistants such as Claude Desktop can read device information and, with your
approval, send input.

Register the server in your MCP client configuration, replacing the folder with your own checkout or extraction path:

```json
{
  "mcpServers": {
    "androscrn": {
      "command": "node",
      "args": ["<AndroScrn folder>\\dist\\modules\\mcp\\cli.js"]
    }
  }
}
```

`bin\androscrn-mcp.bat` is an alternative launcher. Run `npm run build` first so `dist\modules\mcp\cli.js` exists.

**Pairing flow for input tools**

1. The agent calls `request_pairing`.
2. The desktop shows an **Incoming AI Pairing Request** card with the client name and requested tier.
3. You click **Approve Access** (or read the on-screen PIN to the agent).
4. The agent calls `pair_session` and receives an expiring session token required by `tap`, `swipe`, `keyevent` and
   `input_text`.
5. **Revoke All AI Sessions** in the AI Agent Security Center invalidates every token immediately.

Read-only tools (device list, device info, diagnostics, logcat, screenshot) need no pairing. Tool schemas and tiers:
[mcp-tool-reference.md](mcp-tool-reference.md). The threat model: [security.md](security.md).
