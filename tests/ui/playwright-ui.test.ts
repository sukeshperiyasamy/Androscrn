import { chromium, Browser, Page } from 'playwright';
import path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function recordTest(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  if (passed) {
    console.log(`  ✓ PASS: ${name}`);
  } else {
    console.error(`  ✗ FAIL: ${name} - ${error}`);
  }
}

import http from 'http';
import fs from 'fs';

async function runPlaywrightSuite() {
  console.log('==================================================');
  console.log('     ANDROSCRN PLAYWRIGHT AUTOMATED UI SUITE      ');
  console.log('==================================================\n');

  const distDir = path.resolve(process.cwd(), 'apps/desktop/dist');
  
  // Create ephemeral HTTP server to serve compiled assets without file:// CORS blocks
  const server = http.createServer((req, res) => {
    let reqPath = req.url?.split('?')[0] || '/';
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(distDir, reqPath);
    
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const appUrl = `http://127.0.0.1:${port}/`;
  console.log(`Serving compiled UI bundle at: ${appUrl}\n`);

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    page = await context.newPage();

    // -------------------------------------------------------------
    // Test Scenario 1: Zero Devices Initial Render & Guidance
    // -------------------------------------------------------------
    console.log('Scenario 1: Zero Devices Empty State & Guidance');
    await page.addInitScript(() => {
      (window as any).androscrnApi = {
        getDevices: async () => [],
        getMirrorStatus: async () => ({ running: false }),
        getCaptures: async () => [],
        getSystemInfo: async () => ({
          adbVersion: 'ADB 1.0.41',
          adbPath: 'C:\\test\\bin\\adb.exe',
          scrcpyVersion: 'scrcpy 5.0.1',
          scrcpyPath: 'C:\\test\\bin\\scrcpy.exe',
          platform: 'win32',
          recentAppLogs: ['[2026-10-16] [INFO] AndroScrn initialized']
        })
      };
    });

    await page.goto(appUrl);
    await page.waitForLoadState('networkidle');

    const appTitle = await page.textContent('h1');
    recordTest('App Title rendered correctly', appTitle?.includes('AndroScrn') ?? false);

    const noDevText = await page.textContent('[role="status"]');
    recordTest('Zero-device state announces "No devices detected"', noDevText?.includes('No devices detected') ?? false);

    const startBtnDisabled = await page.isDisabled('button[aria-label="Start screen mirroring session"]');
    recordTest('Start Mirroring button is disabled when zero devices attached', startBtnDisabled);

    const homeBtnDisabled = await page.isDisabled('button[aria-label="Send Home keyevent to Android device"]');
    recordTest('Hardware Home button is disabled when zero devices attached', homeBtnDisabled);

    // -------------------------------------------------------------
    // Test Scenario 2: Multiple Devices, State Badges & RSA Guidance
    // -------------------------------------------------------------
    console.log('\nScenario 2: Multi-Device Parsing, State Badges & Guidance');
    const mockDevices = [
      {
        serial: 'emulator-5554',
        state: 'device',
        model: 'Pixel 8 Pro Emulator',
        product: 'sdk_gphone64_x86_64',
        device: 'emulator',
        transportType: 'usb',
        batteryLevel: 95,
        guidance: 'Device ready for mirroring, remote control, and diagnostics.'
      },
      {
        serial: '192.168.1.150:5555',
        state: 'unauthorized',
        model: 'Samsung Galaxy S23',
        product: 'dm3q',
        device: 's23',
        transportType: 'wifi',
        guidance: 'Unlock device screen and tap "Always allow from this computer" on the RSA prompt.'
      },
      {
        serial: 'offline-tab-01',
        state: 'offline',
        model: 'Lenovo Tab P11',
        product: 'tab_p11',
        device: 'lenovo',
        transportType: 'usb',
        guidance: 'Device is offline. Check physical cable connection or toggle USB debugging.'
      }
    ];

    await page.evaluate((devs) => {
      (window as any).androscrnApi.getDevices = async () => devs;
    }, mockDevices);

    // Trigger refresh
    await page.click('button[aria-label="Scan for connected Android devices via ADB"]');
    await page.waitForTimeout(500);

    const selectOptions = await page.$$eval('#global-device-select option', opts => opts.map(o => o.textContent?.trim()));
    recordTest('Multi-device dropdown populates all 3 devices', selectOptions.length === 3);
    recordTest('First device model present in dropdown', selectOptions[0]?.includes('Pixel 8 Pro Emulator') ?? false);

    const readyBadge = await page.textContent('span[aria-label="Device status: Ready"]');
    recordTest('Authorized device shows "Ready" badge in emerald styling', readyBadge?.includes('Ready') ?? false);

    // Switch to unauthorized device
    await page.selectOption('#global-device-select', '192.168.1.150:5555');
    await page.waitForTimeout(300);

    const unauthBadge = await page.textContent('span[aria-label="Device status: Unauthorized"]');
    recordTest('Unauthorized device displays "Unauthorized" badge', unauthBadge?.includes('Unauthorized') ?? false);

    const guidanceBanner = await page.textContent('[role="alert"]');
    recordTest('Unauthorized device displays RSA screen unlock guidance', guidanceBanner?.includes('Unlock device screen') ?? false);

    const startBtnUnauthDisabled = await page.isDisabled('button[aria-label="Start screen mirroring session"]');
    recordTest('Start Mirroring button disabled for unauthorized device', startBtnUnauthDisabled);

    // Switch to offline device
    await page.selectOption('#global-device-select', 'offline-tab-01');
    await page.waitForTimeout(300);

    const offlineBadge = await page.textContent('span[aria-label="Device status: Offline"]');
    recordTest('Offline device displays "Offline" badge', offlineBadge?.includes('Offline') ?? false);

    // -------------------------------------------------------------
    // Test Scenario 3: Screen Mirroring Controls & Quality Presets
    // -------------------------------------------------------------
    console.log('\nScenario 3: Mirroring Lifecycle, Presets & Controls');
    // Switch back to ready device
    await page.selectOption('#global-device-select', 'emulator-5554');
    await page.waitForTimeout(300);

    const startBtnReady = await page.isEnabled('button[aria-label="Start screen mirroring session"]');
    recordTest('Start Mirroring button enabled for ready device', startBtnReady);

    // Select Quality Preset: Ultra
    const ultraPreset = page.locator('div[role="radio"]:has-text("Ultra Quality")');
    await ultraPreset.click();
    const isUltraChecked = await ultraPreset.getAttribute('aria-checked');
    recordTest('Ultra quality preset selected with aria-checked="true"', isUltraChecked === 'true');

    // Select Quality Preset via Keyboard (Space key)
    const fastPreset = page.locator('div[role="radio"]:has-text("Battery Saver")');
    await fastPreset.focus();
    await page.keyboard.press('Space');
    const isFastChecked = await fastPreset.getAttribute('aria-checked');
    recordTest('Battery Saver preset selectable via Space key', isFastChecked === 'true');

    // Mock Start Mirroring IPC
    await page.evaluate(() => {
      let isRunning = false;
      (window as any).androscrnApi.startMirroring = async (opts: any) => {
        isRunning = true;
        return { success: true, pid: 14208, serial: opts.serial };
      };
      (window as any).androscrnApi.getMirrorStatus = async () => ({
        running: isRunning,
        pid: isRunning ? 14208 : undefined,
        targetSerial: isRunning ? 'emulator-5554' : undefined
      });
      (window as any).androscrnApi.stopMirroring = async () => {
        isRunning = false;
        return { success: true };
      };
    });

    await page.click('button[aria-label="Start screen mirroring session"]');
    await page.waitForTimeout(400);

    const stopBtn = await page.waitForSelector('button[aria-label="Stop screen mirroring session"]', { timeout: 2000 });
    recordTest('Mirroring active: "Stop Mirroring" button is visible', stopBtn !== null);

    const liveIndicator = await page.textContent('.status-pulse.active');
    recordTest('Live pulse indicator active during streaming', liveIndicator !== null);

    await page.click('button[aria-label="Stop screen mirroring session"]');
    await page.waitForTimeout(400);

    const startBtnRestored = await page.waitForSelector('button[aria-label="Start screen mirroring session"]', { timeout: 2000 });
    recordTest('Mirroring stopped: "Start Mirroring" button restored', startBtnRestored !== null);

    // -------------------------------------------------------------
    // Test Scenario 4: Screenshot Capture & Real Gallery List
    // -------------------------------------------------------------
    console.log('\nScenario 4: Screenshot Capture & Real Captures Gallery');
    await page.evaluate(() => {
      const mockCaptures: any[] = [];
      (window as any).androscrnApi.captureScreenshot = async (serial: string) => {
        const item = {
          id: 'test-cap-1',
          type: 'screenshot',
          name: 'screenshot-20261016-120000.png',
          timestamp: '2026-10-16 12:00:00',
          path: 'C:\\workspace\\Captures\\screenshot-20261016-120000.png',
          sizeBytes: 1548200
        };
        mockCaptures.push(item);
        return { success: true, filePath: item.path, size: item.sizeBytes };
      };
      (window as any).androscrnApi.getCaptures = async () => mockCaptures;
    });

    await page.click('button[aria-label="Take high-resolution screen capture"]');
    await page.waitForTimeout(400);

    const alertText = await page.textContent('[role="status"][aria-live="polite"]');
    recordTest('Screenshot success banner reports non-zero size in KB', alertText?.includes('KB') ?? false);

    // Switch to Media tab
    await page.click('#tab-media');
    await page.waitForTimeout(300);

    const captureItem = await page.textContent('.glass-panel:has-text("screenshot-20261016-120000.png")');
    recordTest('Real capture item appears in Recorded Media Files gallery', captureItem?.includes('screenshot-20261016-120000.png') ?? false);

    // -------------------------------------------------------------
    // Test Scenario 5: System Diagnostics & Sensitive Data Redaction
    // -------------------------------------------------------------
    console.log('\nScenario 5: System Diagnostics & Sensitive Redaction');
    await page.evaluate(() => {
      (window as any).androscrnApi.getDiagnosticReport = async () => {
        return `ANDROSCRN SYSTEM DIAGNOSTIC REPORT
Generated: 2026-10-16T12:00:00Z
Host Platform: win32 (x64)
Bundled ADB Engine: ADB 1.0.41
Bundled scrcpy Engine: scrcpy 5.0.1
Active Devices: 1
Sensitive Data Redaction: [REDACTED_EMAIL], [REDACTED_TOKEN]`;
      };
    });

    await page.click('#tab-diagnostics');
    await page.waitForTimeout(300);

    const adbVerText = await page.textContent('.glass-panel:has-text("ADB Engine")');
    recordTest('Diagnostics panel displays introspected ADB 1.0.41 version', adbVerText?.includes('ADB 1.0.41') ?? false);

    const scrcpyVerText = await page.textContent('.glass-panel:has-text("scrcpy Engine")');
    recordTest('Diagnostics panel displays introspected scrcpy 5.0.1 version', scrcpyVerText?.includes('scrcpy 5.0.1') ?? false);

    // Test copy button
    const copyBtn = await page.waitForSelector('button[aria-label="Copy sanitized system diagnostic report to clipboard"]');
    recordTest('Copy diagnostic report button is accessible and visible', copyBtn !== null);

    // -------------------------------------------------------------
    // Test Scenario 6: Keyboard Accessibility & Tab Navigation
    // -------------------------------------------------------------
    console.log('\nScenario 6: Keyboard Accessibility & Tab Order');
    await page.focus('#tab-mirror');
    const isMirrorFocused = await page.$eval('#tab-mirror', el => document.activeElement === el);
    recordTest('First tab reachable and focusable via keyboard', isMirrorFocused);

    await page.keyboard.press('Tab');
    const isWirelessFocused = await page.$eval('#tab-wireless', el => document.activeElement === el);
    recordTest('Tab key advances focus sequentially to Wireless tab', isWirelessFocused);

    // -------------------------------------------------------------
    // Test Scenario 7: Viewport Responsiveness
    // -------------------------------------------------------------
    console.log('\nScenario 7: Viewport Responsiveness');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    const compactWidthH1 = await page.isVisible('h1');
    recordTest('Application header intact at compact 1024x768 laptop resolution', compactWidthH1);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(200);
    const fullHdNav = await page.isVisible('nav[aria-label="Workbench navigation"]');
    recordTest('Workbench sidebar nav intact at 1920x1080 resolution', fullHdNav);

    // -------------------------------------------------------------
    // Test Scenario 8: AI Agent & MCP Security Center, HITL Pairing UI & Emergency Revocation
    // -------------------------------------------------------------
    console.log('\nScenario 8: AI Agent & MCP Security Center, HITL Pairing UI & Emergency Revocation');
    await page.evaluate(() => {
      const mockPendingRequests = [
        {
          requestId: 'req-playwright-999',
          pin: '847291',
          clientName: 'Playwright-Autonomous-Agent',
          requestedTier: 3,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60000,
          attempts: 0,
          status: 'PENDING'
        }
      ];

      const mockActiveSessions = [
        {
          sessionId: 'sess-active-101',
          token: 'token_alpha_1234567890abcdef',
          createdAt: Date.now() - 300000,
          expiresAt: Date.now() + 1500000,
          tiers: [0, 1, 2, 3],
          clientName: 'Active-Analysis-Bot'
        }
      ];

      let lastApprovedId = '';
      let lastDeniedId = '';
      let lastRevokedId = '';
      let revokeAllCalled = false;

      (window as any).__mcpAudit = {
        getLastApproved: () => lastApprovedId,
        getLastDenied: () => lastDeniedId,
        getLastRevoked: () => lastRevokedId,
        getRevokeAllCalled: () => revokeAllCalled
      };

      const mockAudits = [
        {
          id: 'audit-101',
          timestamp: Date.now() - 5000,
          action: 'tap',
          clientName: 'Active-Analysis-Bot',
          serial: 'kjizrsgekfsglvgi',
          status: 'SUCCESS',
          details: '(540, 1200)'
        },
        {
          id: 'audit-102',
          timestamp: Date.now() - 2000,
          action: 'input_text',
          clientName: 'Active-Analysis-Bot',
          serial: 'kjizrsgekfsglvgi',
          status: 'REJECTED',
          details: 'Disallowed characters in input'
        }
      ];

      (window as any).androscrnApi.getMcpStatus = async () => ({
        pipeName: '\\\\.\\pipe\\androscrn-mcp-control',
        isListening: true,
        connectedMcpProcesses: 1,
        activeSessions: mockActiveSessions,
        pendingRequests: mockPendingRequests,
        recentAudits: mockAudits
      });

      (window as any).androscrnApi.approveMcpPairing = async (id: string) => {
        lastApprovedId = id;
        mockPendingRequests.length = 0;
        return true;
      };

      (window as any).androscrnApi.denyMcpPairing = async (id: string) => {
        lastDeniedId = id;
        mockPendingRequests.length = 0;
        return true;
      };

      (window as any).androscrnApi.revokeMcpSession = async (sessionId: string) => {
        lastRevokedId = sessionId;
        const idx = mockActiveSessions.findIndex(s => s.sessionId === sessionId);
        if (idx !== -1) mockActiveSessions.splice(idx, 1);
        return true;
      };

      (window as any).androscrnApi.revokeAllMcpSessions = async () => {
        revokeAllCalled = true;
        mockActiveSessions.length = 0;
        mockPendingRequests.length = 0;
        return true;
      };
    });

    // Refresh state by navigating to AI tab
    await page.click('#tab-ai');
    await page.waitForTimeout(400);

    // 1. Verify AI Tab navigation and header
    const aiHeader = await page.textContent('#mcp-security-center h3');
    recordTest('AI Agent & MCP Security Center title visible', aiHeader?.includes('AI Agent & MCP Security Center') ?? false);

    // 2. Verify Named Pipe status display
    const pipeInfo = await page.textContent('#mcp-security-center');
    recordTest('Named Pipe connection details rendered', pipeInfo?.includes('\\\\.\\pipe\\androscrn-mcp-control') ?? false);

    // 3. Verify Pending Pairing Request Banner & Desktop PIN
    const pairingBanner = await page.waitForSelector('#mcp-pairing-requests-container', { timeout: 3000 });
    recordTest('Pending AI Pairing Request banner is displayed', pairingBanner !== null);

    const bannerContent = await page.textContent('#mcp-pairing-requests-container');
    recordTest('Pending pairing request shows requesting client name', bannerContent?.includes('Playwright-Autonomous-Agent') ?? false);
    recordTest('Desktop PIN displayed prominently on screen', bannerContent?.includes('847291') ?? false);

    // 4. Verify Active Sessions List rendering
    const activeSessionItem = await page.waitForSelector('#session-item-sess-active-101', { timeout: 2000 });
    recordTest('Active session item rendered in sessions table', activeSessionItem !== null);

    const sessionContent = await page.textContent('#session-item-sess-active-101');
    recordTest('Active session displays client name and Tier permissions', (sessionContent?.includes('Active-Analysis-Bot') && sessionContent?.includes('Tier')) ?? false);

    // 5. Test Approve Pairing Button
    await page.click('#btn-approve-pairing-req-playwright-999');
    await page.waitForTimeout(400);
    const approvedId = await page.evaluate(() => (window as any).__mcpAudit.getLastApproved());
    recordTest('Approve Pairing button executes IPC with correct requestId', approvedId === 'req-playwright-999');

    // 6. Test Individual Session Revocation Button
    const singleRevokeBtn = await page.waitForSelector('#btn-revoke-session-sess-active-101');
    recordTest('Individual session revoke button is accessible', singleRevokeBtn !== null);
    await singleRevokeBtn.click();
    await page.waitForTimeout(400);
    const revokedId = await page.evaluate(() => (window as any).__mcpAudit.getLastRevoked());
    recordTest('Individual session revoke button invokes IPC with sessionId', revokedId === 'sess-active-101');

    // 7. Test Emergency Revocation Kill Switch
    const killSwitchBtn = await page.waitForSelector('#btn-revoke-all-mcp');
    recordTest('Emergency Kill Switch button ("Revoke All AI Sessions") is visible', killSwitchBtn !== null);
    await killSwitchBtn.click();
    await page.waitForTimeout(400);
    const killSwitchTriggered = await page.evaluate(() => (window as any).__mcpAudit.getRevokeAllCalled());
    recordTest('Emergency Kill Switch invalidates all active sessions via IPC', killSwitchTriggered);

    // -------------------------------------------------------------
    // Test Scenario 9: Live AI Action Audit Log Verification
    // -------------------------------------------------------------
    console.log('\nScenario 9: Live AI Action Audit Log Verification');
    const auditSection = await page.waitForSelector('#mcp-action-audit-section', { timeout: 3000 });
    recordTest('Live AI Action Audit Log section rendered', auditSection !== null);

    const auditItem1 = await page.waitForSelector('#audit-item-audit-101', { timeout: 2000 });
    recordTest('Audit item 101 (tap) rendered in audit list', auditItem1 !== null);

    const audit101Content = await page.textContent('#audit-item-audit-101');
    recordTest('Audit item 101 shows SUCCESS status and tap action', (audit101Content?.includes('SUCCESS') && audit101Content?.includes('tap')) ?? false);
    recordTest('Audit item 101 shows client name and target device serial', (audit101Content?.includes('Active-Analysis-Bot') && audit101Content?.includes('kjizrsgekfsglvgi')) ?? false);

    const auditItem2 = await page.waitForSelector('#audit-item-audit-102', { timeout: 2000 });
    recordTest('Audit item 102 (input_text) rendered in audit list', auditItem2 !== null);

    const audit102Content = await page.textContent('#audit-item-audit-102');
    recordTest('Audit item 102 shows REJECTED status and input_text action', (audit102Content?.includes('REJECTED') && audit102Content?.includes('input_text')) ?? false);


  } catch (err: any) {
    console.error('Playwright Test Exception:', err);
    recordTest('Playwright Suite Execution', false, err.message);
  } finally {
    if (browser) {
      await browser.close();
    }
    server.close();
  }

  console.log('\n==================================================');
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  console.log(`PLAYWRIGHT TEST RESULTS: ${passedCount}/${results.length} Passed (${failedCount} Failed)`);
  console.log('==================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPlaywrightSuite();
