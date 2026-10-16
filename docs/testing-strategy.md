# AndroScrn Testing Strategy & Quality Assurance

**Document:** `docs/testing-strategy.md`  
**Date:** 2026-10-16  

---

## 1. Test Pyramid & Methodologies

To ensure absolute reliability on Windows 11, AndroScrn employs a four-tiered testing framework:

1. **Unit Testing (`tests/unit/`):**
   * Device descriptor parser (`parseAdbDevicesOutput`).
   * Scrcpy command-line argument builder (validating bitrate, size, codec flags, and record paths).
   * Network address & gateway validator (IP range, port sanity checks).
   * Process lifecycle & exit code handler (0 = success, 1 = start fail, 2 = disconnected).
2. **Integration Testing (`tests/integration/`):**
   * ADB Client verification (version probing, binary resolution).
   * Child process supervisor resilience (ensuring child processes terminate cleanly when parent exits).
   * Scrcpy binary presence and hash integrity check.
   * Local OCR engine execution probe (`tesseract --version`).
   * Local Ollama engine probe (`ollama --version`).
3. **Simulated / Mock Device Testing:**
   * Virtual device simulation when no physical Android hardware is connected to allow complete UI/pipeline testing in CI/CD.
4. **End-to-End Verification:**
   * Full desktop application launch, device auto-discovery, mirror command trigger, and capture validation.

---

## 2. Test Execution Commands

```bash
# Run all unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run entire test suite with coverage
npm test
```
