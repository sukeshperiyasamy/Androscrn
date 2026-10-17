# Roadmap

Status of the phased plan. A checked item means the code exists and is covered by automated tests; it does not mean
every item has been verified on physical hardware. Hardware status is tracked in [compatibility.md](compatibility.md)
and [testing.md](testing.md). The original milestone plan is in [development-plan.md](development-plan.md).

- [x] **Phase 1 - Device and mirroring reliability:** bundled ADB and scrcpy, device discovery with state guidance,
  per-device targeting, mirroring presets, raw PNG screenshots, redacted diagnostics.
- [x] **Phase 2 - Packaging:** portable Electron distribution and launchers.
- [x] **Phase 3 - MCP and security:** stdio MCP server, named-pipe control bridge, human-in-the-loop pairing,
  emergency revocation, Tier 3 input tools with bounds checking and a live audit log.
- [x] **Phase 4 - CLI launcher:** `androscrn` with `devices`, `doctor`, `docs`, PATH setup.
- [x] **Phase 5 - Camera Studio (scrcpy camera mode).**
- [x] **Phase 6 - Camera Companion app** and in-app viewport.
- [x] **Phase 7 - Lab and inspection tools.**
- [x] **Phase 9 - Compatibility and reliability hardening.**
- [x] **Phase 10 - Smart discovery:** richer device data, wireless discovery, OEM guidance, diagnostic redaction.
  Wireless behavior on a physical phone is not yet verified.
- [x] **Phase 10.1 / 10.2 - Stabilization:** isolated PATH and native launcher tests, browser-launch regression guard.
- [x] **Phase 11 - Local document intelligence:** import, page detection, perspective correction, local OCR, review and
  export (English only; accuracy on real documents unmeasured). See [document-intelligence.md](document-intelligence.md).
- [ ] **Tier 4 administrative tools** (`shell`, `install_app`, `reboot`, `file_push`) with interactive confirmation.
- [ ] **Workflow sequencer** with screenshot assertions.
- [ ] **Recorded wireless-debugging hardware validation.**
- [ ] **Windows ARM64** investigation follow-up ([platform-support.md](platform-support.md)).
- [ ] **Tauri 2 + Rust migration** considered in [ADR 001](adr/001-architecture-reconciliation-and-mcp.md).
