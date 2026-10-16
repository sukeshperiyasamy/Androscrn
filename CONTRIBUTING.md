# Contributing to AndroScrn

Thank you for your interest in contributing to AndroScrn!

## Development Guidelines

1. **Security First:** Never interpolate shell strings or pass unsanitized input to external processes. All child processes must be spawned via discrete argument arrays.
2. **Defensive Error Handling:** Handle device disconnections, unauthorized states, and network drops gracefully with informative UI alerts and automatic retry logic.
3. **Attribution & Licenses:** Maintain Apache 2.0 attribution for `scrcpy` and `adb`, and respect all third-party license boundaries.
4. **Testing:** Ensure all unit and integration tests pass before submitting changes (`npm test`).
5. **No Cloud Dependency:** Core features must remain 100% functional locally without requiring cloud logins, API tokens, or internet access.
