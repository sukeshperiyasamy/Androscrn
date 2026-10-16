# Changelog

All notable changes to AndroScrn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-alpha.1] - 2026-10-16

### Added
- **Core Architecture:** Modular integration architecture coupling official `scrcpy v5.0.1` and Google `adb v1.0.41`.
- **Device Manager:** Automatic reactive device polling, hardware descriptor parsing, USB vs. Wi-Fi transport detection, and friendly alias customization.
- **Connection Manager:** 1-Click USB-to-WiFi handoff, Smart Hotspot Gateway auto-discovery, and Android 11+ PIN pairing wizard.
- **Process Supervisor:** Argument-vector isolation, PID lifecycle management, graceful shutdown, and exponential backoff auto-reconnect.
- **Recording & Media Center:** One-click MP4/MKV recording and PNG screenshots with zero CPU re-encoding overhead and automatic gallery organization in `Captures/`.
- **Diagnostics Studio:** Real-time logcat streamer with instant text filtering, tag filtering, severity levels, and 1-click diagnostic export.
- **Workflow Engine:** Reusable test automation runner for mobile testing (`tap`, `swipe`, `keyevent`, `input_text`, `wait`, `screenshot`, `assert_text`).
- **Local AI & OCR:** Tesseract OCR screen reading and Ollama local LLM diagnostic log summarization.
- **Desktop UI:** Modern glassmorphism / dark UI built with React, TypeScript, and Vite.
- **Documentation Suite:** Complete architecture, security, testing, licensing, gap analysis, and progress audit.
