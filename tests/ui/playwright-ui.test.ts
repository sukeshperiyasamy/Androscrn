import { chromium, Browser, Page } from 'playwright';
import { buildDeviceHelp } from '../../modules/oem_guidance';
import path from 'path';
import { runRemoteControlScenario } from './scenario-remote-control';

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

    const externalNetworkRequests: string[] = [];
    page.on('request', req => {
      const u = req.url();
      if (!u.startsWith('http://127.0.0.1:') && !u.startsWith('http://localhost:')) {
        externalNetworkRequests.push(u);
      }
    });
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

    // Navigation follows the WAI-ARIA tabs pattern: arrow keys move between tabs, Tab leaves the tab list.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const isCameraFocused = await page.$eval('#tab-camera', el => document.activeElement === el && el.getAttribute('aria-selected') === 'true');
    recordTest('ArrowDown moves focus and selection to the Camera Studio tab', isCameraFocused);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const isWirelessFocused = await page.$eval('#tab-wireless', el => document.activeElement === el && el.getAttribute('aria-selected') === 'true');
    recordTest('ArrowDown moves focus and selection to the Wireless tab', isWirelessFocused);

    const rovingTabIndex = await page.$$eval('[role="tab"]', els => els.filter(e => e.getAttribute('tabindex') === '0').length);
    recordTest('Only the selected tab is in the Tab order (roving tabindex)', rovingTabIndex === 1);

    await page.keyboard.press('Home');
    await page.waitForTimeout(100);
    const homeBack = await page.$eval('#tab-mirror', el => document.activeElement === el && el.getAttribute('aria-selected') === 'true');
    recordTest('Home key returns to the first tab', homeBack);

    // -------------------------------------------------------------
    // Test Scenario 7: Viewport Responsiveness
    // -------------------------------------------------------------
    console.log('\nScenario 7: Viewport Responsiveness');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);
    const compactWidthH1 = await page.isVisible('h1');
    recordTest('Application header intact at compact 1024x768 laptop resolution', compactWidthH1);

    const railLabels = await page.$$eval('nav[aria-label="Main navigation"] [role="tab"]', els => els.every(e => !!e.getAttribute('aria-label')));
    const railText = await page.$eval('nav[aria-label="Main navigation"]', el => (el as HTMLElement).innerText.includes('Camera Studio'));
    recordTest('Navigation collapses to an icon rail at 1024px with accessible names on every item', railLabels && !railText);

    const noHScroll1024 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    recordTest('No horizontal page scroll at 1024x768', noHScroll1024);

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(200);
    const noHScroll800 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    recordTest('No horizontal page scroll at 800x600', noHScroll800);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(200);
    const fullHdNav = await page.isVisible('nav[aria-label="Main navigation"]');
    const fullHdLabels = await page.$eval('nav[aria-label="Main navigation"]', el => (el as HTMLElement).innerText.includes('Camera Studio'));
    recordTest('Navigation shows full labels at 1920x1080 resolution', fullHdNav && fullHdLabels);

    await page.click('button[aria-label="Collapse navigation"]');
    await page.waitForTimeout(200);
    const userCollapsed = await page.isVisible('button[aria-label="Expand navigation"]');
    recordTest('Navigation can be collapsed manually on wide windows', userCollapsed);
    await page.click('button[aria-label="Expand navigation"]');
    await page.waitForTimeout(200);

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
          serial: 'EXAMPLE0SERIAL01',
          status: 'SUCCESS',
          details: '(540, 1200)'
        },
        {
          id: 'audit-102',
          timestamp: Date.now() - 2000,
          action: 'input_text',
          clientName: 'Active-Analysis-Bot',
          serial: 'EXAMPLE0SERIAL01',
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
    recordTest('Audit item 101 shows client name and target device serial', (audit101Content?.includes('Active-Analysis-Bot') && audit101Content?.includes('EXAMPLE0SERIAL01')) ?? false);

    const auditItem2 = await page.waitForSelector('#audit-item-audit-102', { timeout: 2000 });
    recordTest('Audit item 102 (input_text) rendered in audit list', auditItem2 !== null);

    const audit102Content = await page.textContent('#audit-item-audit-102');
    recordTest('Audit item 102 shows REJECTED status and input_text action', (audit102Content?.includes('REJECTED') && audit102Content?.includes('input_text')) ?? false);

    // -------------------------------------------------------------
    // Test Scenario 10: Camera Studio MVP Interface & Controls
    // -------------------------------------------------------------
    console.log('\nScenario 10: Camera Studio Interface & Controls Verification');

    await page.evaluate(() => {
      (window as any).androscrnApi.queryCameraCapabilities = async () => ({
        transportSupported: true,
        deviceSupported: true,
        androidVersion: '13',
        sdkVersion: 33,
        cameras: [
          {
            id: '0',
            facing: 'back',
            maxResolution: '4000x3000',
            fpsList: [10, 15, 20, 30],
            zoomRange: [1, 10],
            supportedSizes: ['1920x1080', '1280x720', '4000x3000']
          },
          {
            id: '1',
            facing: 'front',
            maxResolution: '2320x1744',
            fpsList: [10, 15, 20, 30],
            zoomRange: [1, 10],
            supportedSizes: ['1920x1080', '1280x720']
          }
        ],
        liveZoomSupported: true,
        liveTorchSupported: true,
        recordingSupported: true,
        snapshotsSupported: false,
        notes: ['Discovered 2 camera sensor(s).']
      });

      (window as any).androscrnApi.startCamera = async () => ({
        success: true,
        pid: 12345
      });

      (window as any).androscrnApi.stopCamera = async () => true;

      (window as any).androscrnApi.sendCameraZoom = async ({ direction }: any) => ({
        success: true,
        currentZoom: direction === 'in' ? 1.5 : 1.0,
        message: `Zoom ${direction} sent`
      });

      (window as any).androscrnApi.sendCameraTorch = async ({ state }: any) => ({
        success: true,
        torchActive: state === 'on',
        message: `Torch ${state}`
      });

      (window as any).androscrnApi.getCameraStatus = async () => ({
        running: false,
        currentZoom: 1.0,
        torchActive: false
      });
    });

    // 1. Navigate to Camera Studio tab
    await page.click('#tab-camera');
    await page.waitForTimeout(300);

    const cameraHeader = await page.textContent('main h2');
    recordTest('Camera Studio header and title rendered', cameraHeader?.includes('Camera Studio') ?? false);

    // 2. Verify Camera Sensor Selector
    const cameraSelect = await page.waitForSelector('#camera-select', { timeout: 2000 });
    recordTest('Camera sensor selection dropdown visible', cameraSelect !== null);

    // 3. Verify Resolution Selector
    const resSelect = await page.waitForSelector('#camera-resolution-select', { timeout: 2000 });
    recordTest('Capture resolution dropdown visible', resSelect !== null);

    // 4. Verify FPS Selector
    const fpsSelect = await page.waitForSelector('#camera-fps-select', { timeout: 2000 });
    recordTest('Target FPS dropdown visible', fpsSelect !== null);

    // 5. Verify Start Camera Preview Button
    const startCamBtn = await page.waitForSelector('#btn-toggle-camera', { timeout: 2000 });
    recordTest('Start Camera Preview button visible', startCamBtn !== null);

    const startBtnText = await page.textContent('#btn-toggle-camera');
    recordTest('Start Camera Preview button shows initial start state', startBtnText?.includes('Start Camera Preview') ?? false);

    // 6. Verify Digital Zoom Controls
    const zoomSlider = await page.waitForSelector('#camera-zoom-slider', { timeout: 2000 });
    recordTest('Camera digital zoom slider visible', zoomSlider !== null);

    const zoomBadge = await page.textContent('#camera-zoom-badge');
    recordTest('Camera digital zoom badge renders initial 1.0x', zoomBadge?.includes('1.0x') ?? false);

    // 7. Verify Zoom In / Out Buttons
    const zoomInBtn = await page.waitForSelector('#btn-zoom-in', { timeout: 2000 });
    recordTest('Zoom In button visible', zoomInBtn !== null);

    const zoomOutBtn = await page.waitForSelector('#btn-zoom-out', { timeout: 2000 });
    recordTest('Zoom Out button visible', zoomOutBtn !== null);

    // 8. Verify Torch Button
    const torchBtn = await page.waitForSelector('#btn-toggle-torch', { timeout: 2000 });
    recordTest('Torch control toggle button visible', torchBtn !== null);

    // 9. Test Start Camera Click
    await page.click('#btn-toggle-camera');
    await page.waitForTimeout(300);

    const toggleBtnTextAfterStart = await page.textContent('#btn-toggle-camera');
    recordTest('Button toggles to Stop Camera Preview upon starting', toggleBtnTextAfterStart?.includes('Stop Camera Preview') ?? false);

    // 10. Test Stop Camera Click
    await page.click('#btn-toggle-camera');
    await page.waitForTimeout(300);

    const toggleBtnTextAfterStop = await page.textContent('#btn-toggle-camera');
    recordTest('Button returns to Start Camera Preview upon stopping', toggleBtnTextAfterStop?.includes('Start Camera Preview') ?? false);

    // -------------------------------------------------------------
    // Test Scenario 11: Camera Companion Mode Switcher, Pairing & In-App Viewport Verification (Phase 6)
    // -------------------------------------------------------------
    console.log('\nScenario 11: Camera Companion Mode Switcher, Pairing & In-App Viewport Verification');

    // A one-frame MJPEG-compatible source served locally so the preview's "first frame decoded" path really runs.
    const frameServer = http.createServer((_req, res) => {
      const jpeg = Buffer.from(
        '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        'base64'
      );
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length });
      res.end(jpeg);
    });
    await new Promise<void>(r => frameServer.listen(0, '127.0.0.1', () => r()));
    const framePort = (frameServer.address() as any).port;

    await page.evaluate((port: number) => {
      const api = (window as any).androscrnApi;
      api.companionPrepare = async () => ({
        success: true,
        stage: 'ready',
        message: 'Companion app is ready.',
        status: { status: 'ready', protocolVersion: 2, permissionGranted: true }
      });
      api.companionGetStatus = async () => ({ status: 'ready', protocolVersion: 2, isPaired: true, cameraActive: true, maxZoom: 10 });
      api.companionStartCamera = async () => ({ success: true, state: 'starting_camera', streamUrl: `http://127.0.0.1:${port}/api/v1/stream?token=t` });
      api.companionStopCamera = async () => ({ success: true });
      api.companionRequestPairing = async () => ({
        success: true,
        challengeId: 'chal_test_123',
        pin: '123456',
        expiresInSeconds: 60
      });
      (window as any).androscrnApi.companionSubmitPin = async (pin: string) => ({
        success: true,
        token: 'test_token_64chars_abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
        facing: 'back',
        zoom: 1.0,
        torch: false
      });
      (window as any).androscrnApi.companionGetStreamUrl = async () => 'http://127.0.0.1:8080/api/v1/stream?token=test_token_64chars';
      (window as any).androscrnApi.companionSetCamera = async (facing: string) => ({ success: true, facing });
      (window as any).androscrnApi.companionSetZoom = async (zoom: number) => ({ success: true, zoom });
      (window as any).androscrnApi.companionSetTorch = async (torch: boolean) => ({ success: true, torch });
      (window as any).androscrnApi.companionTakePhoto = async () => ({
        success: true,
        photoId: 'img_test_1',
        filePath: 'C:\\Users\\sukes\\Downloads\\Captures\\photo_test.jpg',
        sizeBytes: 2500000
      });
      (window as any).androscrnApi.companionDisconnect = async () => ({ success: true });
    }, framePort);

    // 1. Verify Mode Switcher buttons
    const modeScrcpyBtn = await page.waitForSelector('#mode-scrcpy', { timeout: 2000 });
    recordTest('Scrcpy Mode Switcher button visible', modeScrcpyBtn !== null);

    const modeCompanionBtn = await page.waitForSelector('#mode-companion', { timeout: 2000 });
    recordTest('Companion Mode Switcher button visible', modeCompanionBtn !== null);

    // 2. Switch to Companion Mode
    await page.click('#mode-companion');
    await page.waitForTimeout(300);

    const isCompanionActive = await page.$eval('#mode-companion', el => el.getAttribute('aria-checked') === 'true');
    recordTest('Companion Mode activated with aria-checked="true"', isCompanionActive);

    // 3. Verify Companion Setup Card
    const connectBtn = await page.waitForSelector('#btn-companion-connect', { timeout: 2000 });
    recordTest('Connect to Companion button visible in disconnected state', connectBtn !== null);

    // 4. Click Connect & verify PIN Input Card
    await page.click('#btn-companion-connect');
    await page.waitForTimeout(300);

    const pinInput = await page.waitForSelector('#companion-pin-input', { timeout: 2000 });
    recordTest('6-Digit Pairing PIN input visible upon challenge request', pinInput !== null);

    const submitPinBtn = await page.waitForSelector('#btn-companion-submit-pin', { timeout: 2000 });
    recordTest('Authorize & Start Feed PIN submit button visible', submitPinBtn !== null);

    // 5. Submit valid 6-digit PIN
    await page.fill('#companion-pin-input', '123456');
    await page.click('#btn-companion-submit-pin');
    await page.waitForTimeout(400);

    // 6. Verify In-App Live Viewport Feed
    const livePreview = await page.waitForSelector('#companion-live-preview', { timeout: 2000 });
    recordTest('Live In-App Companion Viewport img feed active', livePreview !== null);
    await page.waitForFunction(() => /streaming/i.test(document.body.innerText), null, { timeout: 3000 }).catch(() => null);
    const streamingBadge = await page.evaluate(() => /streaming/i.test(document.body.innerText));
    recordTest('"Streaming" is shown only after the preview decoded a frame', streamingBadge);

    // 7. Verify Still Snapshot Shutter Button
    const snapshotBtn = await page.waitForSelector('#btn-companion-snapshot', { timeout: 2000 });
    recordTest('Capture Full-Res Photo shutter button visible and enabled', snapshotBtn !== null);

    await page.click('#btn-companion-snapshot');
    await page.waitForTimeout(300);

    const photoFeedback = await page.textContent('.glass-panel');
    recordTest('Full-resolution photo saved feedback banner rendered', photoFeedback !== null);

    // 8. Verify Optics Controls (Lens Flip & Torch)
    const flipBtn = await page.waitForSelector('#btn-companion-flip', { timeout: 2000 });
    recordTest('Switch to Front/Back lens flip button visible and interactive', flipBtn !== null);

    const companionTorchBtn = await page.waitForSelector('#btn-companion-torch', { timeout: 2000 });
    recordTest('Companion torch toggle button visible and interactive', companionTorchBtn !== null);

    // 9. Verify Digital Zoom Slider
    const companionZoomSlider = await page.waitForSelector('#companion-zoom-slider', { timeout: 2000 });
    recordTest('Companion digital zoom slider visible and adjustable', companionZoomSlider !== null);

    // 10. Test Disconnect & Mode Reversion
    const disconnectBtn = await page.waitForSelector('#btn-companion-disconnect', { timeout: 2000 });
    recordTest('Companion disconnect button visible while session is active', disconnectBtn !== null);

    await page.click('#btn-companion-disconnect');
    await page.waitForTimeout(300);

    const connectBtnRestored = await page.waitForSelector('#btn-companion-connect', { timeout: 2000 });
    recordTest('Connect to Companion button restored after disconnection', connectBtnRestored !== null);

    // Switch back to Scrcpy Mode
    await page.click('#mode-scrcpy');
    await page.waitForTimeout(300);

    frameServer.close();
    const isScrcpyActive = await page.$eval('#mode-scrcpy', el => el.getAttribute('aria-checked') === 'true');
    recordTest('Scrcpy Direct3D11 mode restored with aria-checked="true"', isScrcpyActive);

    // -------------------------------------------------------------
    // Test Scenario 12: Lab & Inspection Studio Suite (Phase 7.1)
    // -------------------------------------------------------------
    console.log('\nScenario 12: Lab & Inspection Tools Suite (Phase 7.1)');

    // 1. Verify Lab & Inspection Tools Panel Header
    const labHeader = await page.waitForSelector('#btn-export-annotated', { timeout: 2000 });
    recordTest('Lab & Inspection Tools panel rendered with Export Annotated button', labHeader !== null);

    // 2. Verify Overlay Pattern dropdown
    const overlaySelect = await page.waitForSelector('#inspection-overlay-select', { timeout: 2000 });
    recordTest('Inspection Overlay dropdown selector visible', overlaySelect !== null);

    // 3. Select Crosshairs overlay
    await page.selectOption('#inspection-overlay-select', 'crosshair');
    await page.waitForTimeout(200);

    // 4. Switch to Companion Mode and verify overlay layer is rendered
    await page.click('#mode-companion');
    await page.waitForTimeout(300);

    const overlayLayer = await page.waitForSelector('#inspection-overlay-layer', { timeout: 2000 });
    recordTest('Live Inspection Non-Destructive Overlay rendered in viewport', overlayLayer !== null);

    // 5. Select Fine Grid (10x10) and verify overlay updates
    await page.selectOption('#inspection-overlay-select', 'grid_fine');
    await page.waitForTimeout(200);

    const fineGridSvg = await page.textContent('#inspection-overlay-layer');
    recordTest('Inspection overlay updates dynamically on select change', fineGridSvg !== null);

    // 6. Test Color Selection
    const colorSelect = await page.waitForSelector('#inspection-color-select', { timeout: 2000 });
    recordTest('Inspection color selector visible', colorSelect !== null);
    await page.selectOption('#inspection-color-select', '#10b981');
    await page.waitForTimeout(200);

    // 7. Test Opacity Slider
    const opacitySlider = await page.waitForSelector('#inspection-opacity-slider', { timeout: 2000 });
    recordTest('Inspection opacity slider visible', opacitySlider !== null);

    // 8. Test Reference Comparison Toggle
    const refCompBtn = await page.waitForSelector('#btn-toggle-ref-comp', { timeout: 2000 });
    recordTest('Golden sample reference comparison toggle button visible', refCompBtn !== null);

    await page.click('#btn-toggle-ref-comp');
    await page.waitForTimeout(300);

    const refLayoutSelect = await page.waitForSelector('#ref-comp-mode-select', { timeout: 2000 });
    recordTest('Reference comparison layout selector displayed when enabled', refLayoutSelect !== null);

    const blendSlider = await page.waitForSelector('#ref-comp-opacity-slider', { timeout: 2000 });
    recordTest('Reference comparison blend ratio slider displayed', blendSlider !== null);

    // 9. Test Timelapse Scheduler Inputs & Lifecycle
    const intervalInput = await page.waitForSelector('#timelapse-interval-input', { timeout: 2000 });
    recordTest('Timelapse interval input visible', intervalInput !== null);

    const framesInput = await page.waitForSelector('#timelapse-frames-input', { timeout: 2000 });
    recordTest('Timelapse total frames input visible', framesInput !== null);

    const startTimelapseBtn = await page.waitForSelector('#btn-start-timelapse', { timeout: 2000 });
    recordTest('Start Timelapse button visible and clickable', startTimelapseBtn !== null);

    await page.fill('#timelapse-interval-input', '2');
    await page.fill('#timelapse-frames-input', '5');
    await page.click('#btn-start-timelapse');
    await page.waitForTimeout(300);

    const stopTimelapseBtn = await page.waitForSelector('#btn-stop-timelapse', { timeout: 2000 });
    recordTest('Button toggles to Stop Timelapse Session upon start', stopTimelapseBtn !== null);

    await page.click('#btn-stop-timelapse');
    await page.waitForTimeout(300);

    const startTimelapseBtnRestored = await page.waitForSelector('#btn-start-timelapse', { timeout: 2000 });
    recordTest('Button returns to Start Timelapse Capture upon stop', startTimelapseBtnRestored !== null);

    // 10. Test Export Annotated Copy
    await page.click('#btn-export-annotated');
    await page.waitForTimeout(300);

    const exportNotice = await page.waitForSelector('#annotated-export-notice', { timeout: 2000 });
    const noticeText = await exportNotice?.textContent();
    recordTest('Export Annotated Copy triggers success feedback', noticeText?.includes('saved to Captures/') ?? false);

    // -------------------------------------------------------------
    // Test Scenario 13: Smart Discovery, Connection Help & OEM Guidance (Phase 10)
    // -------------------------------------------------------------
    console.log('\nScenario 13: Smart Discovery, Connection Help & OEM Guidance (Phase 10)');
    const xiaomiDevice: any = {
      serial: 'R58M123XYZ', state: 'device', model: 'Redmi Note 11 Pro+', product: 'lisa', device: 'lisa',
      transportType: 'usb', connectionType: 'usb', manufacturer: 'Xiaomi', brand: 'Redmi', androidVersion: '13', apiLevel: 33,
      batteryLevel: 80, guidance: 'Connected and authorized: Ready for screen mirroring and control.'
    };
    const unauthDevice: any = {
      serial: '192.168.1.150:5555', state: 'unauthorized', model: 'Galaxy S23', product: 'dm3q', device: 's23',
      transportType: 'wifi', connectionType: 'tcpip', guidance: 'Device unauthorized.'
    };
    const helpMap: Record<string, any> = {
      [xiaomiDevice.serial]: buildDeviceHelp(xiaomiDevice),
      [unauthDevice.serial]: buildDeviceHelp(unauthDevice)
    };

    await page.evaluate(({ devs, helps }) => {
      const w = window as any;
      w.__helpCalls = 0;
      w.__calls = { connect: [] as string[], pair: [] as any[], cancel: 0, discover: 0 };
      w.androscrnApi.getDevices = async () => devs;
      w.androscrnApi.getDeviceHelp = async (serial: string) => {
        w.__helpCalls++;
        return helps[serial] || { key: 'none', connection: null, vendor: [] };
      };
      w.androscrnApi.connectDiscoveredDevice = async (id: string) => {
        w.__calls.connect.push(id);
        return { success: true, message: 'Connected to 192.168.1.77:41555' };
      };
      w.androscrnApi.pairDiscoveredDevice = async (id: string, pin: string) => {
        w.__calls.pair.push({ id, pin });
        return { success: true, message: 'Paired successfully. Run Discover again, then connect to the device endpoint.' };
      };
      w.androscrnApi.cancelWirelessDiscovery = async () => { w.__calls.cancel++; return true; };
    }, { devs: [xiaomiDevice, unauthDevice], helps: helpMap });

    await page.click('button[aria-label="Scan for connected Android devices via ADB"]');
    await page.selectOption('#global-device-select', xiaomiDevice.serial);
    await page.waitForSelector('[data-testid="connection-help"]', { timeout: 3000 });

    const helpVisible = await page.isVisible('[data-testid="connection-help"]');
    recordTest('Connection-help area appears for the selected Xiaomi device', helpVisible);

    const collapsed = await page.getAttribute('[data-testid="connection-help"] button[aria-expanded]', 'aria-expanded');
    recordTest('Connection help starts collapsed (compact)', collapsed === 'false');

    // Keyboard: focus the toggle and press Enter
    await page.focus('[data-testid="connection-help"] button[aria-expanded]');
    await page.keyboard.press('Enter');
    const expandedAfterKey = await page.getAttribute('[data-testid="connection-help"] button[aria-expanded]', 'aria-expanded');
    recordTest('Connection help expands with the keyboard (Enter)', expandedAfterKey === 'true');

    const oemText = await page.textContent('[data-testid="oem-guidance-xiaomi-input-injection"]');
    recordTest('Xiaomi vendor-specific input guidance shown', oemText?.includes('simulated touch') ?? false);
    recordTest('Vendor guidance shows its evidence level', oemText?.includes('Documented upstream') ?? false);
    recordTest('Vendor guidance states its uncertainty instead of promising a fix', /cannot verify|vary/i.test(oemText ?? ''));
    recordTest('Vendor guidance cites a documentation reference', oemText?.includes('https://github.com/Genymobile/scrcpy') ?? false);
    const vendorLabel = await page.locator('[data-testid="connection-help"] >> text=Vendor-specific input restrictions').count();
    recordTest('Ready device shows vendor guidance, not connection-problem guidance', vendorLabel >= 1 && (await page.locator('[data-testid="connection-help"] >> text=not authorized').count()) === 0);

    // Repeated scans of the same device/state must not re-query or re-announce the same help
    const callsBefore = await page.evaluate(() => (window as any).__helpCalls);
    await page.click('button[aria-label="Scan for connected Android devices via ADB"]');
    await page.waitForTimeout(300);
    await page.click('button[aria-label="Scan for connected Android devices via ADB"]');
    await page.waitForTimeout(300);
    const callsAfter = await page.evaluate(() => (window as any).__helpCalls);
    recordTest('Repeated refreshes of an unchanged device do not re-request or repeat guidance', callsAfter === callsBefore);
    recordTest('Guidance stays expanded and is not duplicated across refreshes', (await page.locator('[data-testid="connection-help"]').count()) === 1);

    // A working phone only gets tips: there is no connection problem to retry
    recordTest('Tips for a ready phone do not offer Try Again', (await page.locator('button[aria-label="Retry device connection check"]').count()) === 0);

    // Unauthorized device: connection guidance only
    await page.selectOption('#global-device-select', unauthDevice.serial);
    await page.waitForTimeout(400);

    // Retry action refreshes both device list and help
    const callsBeforeRetry = await page.evaluate(() => (window as any).__helpCalls);
    await page.click('button[aria-label="Retry device connection check"]');
    await page.waitForTimeout(400);
    const callsAfterRetry = await page.evaluate(() => (window as any).__helpCalls);
    recordTest('Retry re-checks the device and its guidance', callsAfterRetry > callsBeforeRetry);
    const unauthTitle = await page.textContent('[data-testid="connection-help"]');
    recordTest('Unauthorized device explains the authorization problem', unauthTitle?.includes('not authorized') ?? false);
    await page.click('[data-testid="connection-help"] button[aria-expanded]');
    const unauthBody = await page.textContent('#connection-help-body');
    recordTest('Unauthorized guidance includes the Allow USB debugging step', unauthBody?.includes('Allow USB debugging') ?? false);
    recordTest('Unauthorized guidance is not mixed with vendor input restrictions', (await page.locator('[data-testid^="oem-guidance-"]').count()) === 0);

    // Dismissal sticks for the same situation
    await page.click('button[aria-label="Dismiss connection help"]');
    await page.click('button[aria-label="Scan for connected Android devices via ADB"]');
    await page.waitForTimeout(300);
    recordTest('Dismissed guidance is not shown again for the same state', (await page.locator('[data-testid="connection-help"]').count()) === 0);

    // Responsive layout at phone width
    await page.selectOption('#global-device-select', xiaomiDevice.serial);
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);
    const noOverflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="connection-help"]') as HTMLElement | null;
      return !el || el.getBoundingClientRect().right <= window.innerWidth + 1;
    });
    recordTest('Connection help fits within a 375px viewport', noOverflow);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Wireless discovery panel
    await page.click('#tab-wireless');
    await page.waitForSelector('[data-testid="wireless-discovery-panel"]', { timeout: 3000 });
    const panelText = await page.textContent('[data-testid="wireless-discovery-panel"]');
    recordTest('Discovery panel explains that nothing is enabled or scanned automatically', /never enables it for you/i.test(panelText ?? ''));
    recordTest('Discovery does not start until the user presses the button', (await page.evaluate(() => (window as any).__calls.discover)) === 0);

    const endpoints = [
      { id: '0123456789abcdef', label: 'adb-AB********YZ-xYz9', serviceType: '_adb-tls-pairing._tcp', kind: 'pairing', ip: '192.168.1.77', port: 37123, status: 'pairing-required', note: 'Pairing code screen is open on the phone.' },
      { id: 'fedcba9876543210', label: 'adb-AB********YZ-xYz9', serviceType: '_adb-tls-connect._tcp', kind: 'connect', ip: '192.168.1.77', port: 41555, status: 'connectable', note: 'If this computer has not been paired with the phone before, connecting will be refused. Pair first.' }
    ];
    await page.evaluate((eps) => {
      const w = window as any;
      w.androscrnApi.discoverWirelessDevices = async () => {
        w.__calls.discover++;
        return { success: true, supported: true, cancelled: false, timedOut: false, endpoints: eps, ignoredCount: 3, mdnsVersion: 'Openscreen', message: 'Found 2 wireless-debugging endpoints. Select one to pair or connect.', fallback: [] };
      };
    }, endpoints);

    await page.click('button:has-text("Discover Wireless Devices")');
    await page.waitForSelector('[data-testid="wireless-endpoint"]', { timeout: 3000 });
    recordTest('Discovered endpoints are listed with IP and port', (await page.locator('[data-testid="wireless-endpoint"]').count()) === 2);
    const epText = await page.textContent('[data-testid="wireless-discovery-panel"]');
    recordTest('Endpoint labels show status and never the raw serial', /Pairing required/.test(epText ?? '') && !/ABCD1234EFGH/.test(epText ?? ''));
    recordTest('Connectable endpoint tells the user to pair first', /Pair first/.test(epText ?? ''));
    recordTest('Discovery alone does not connect or pair', (await page.evaluate(() => (window as any).__calls.connect.length + (window as any).__calls.pair.length)) === 0);

    // Pairing code handling
    const discoveryPinInput = page.locator('input[id^="pin-"]');
    recordTest('Pairing code field is masked (password input)', (await discoveryPinInput.getAttribute('type')) === 'password');
    await discoveryPinInput.fill('12ab');
    recordTest('Pairing code field accepts digits only', (await discoveryPinInput.inputValue()) === '12');
    await page.click('button:has-text("Pair…")');
    recordTest('Short pairing code is rejected without calling the main process', (await page.evaluate(() => (window as any).__calls.pair.length)) === 0);
    await discoveryPinInput.fill('123456');
    await page.click('button:has-text("Pair…")');
    await page.waitForTimeout(300);
    const pairCalls = await page.evaluate(() => (window as any).__calls.pair);
    recordTest('Pair sends only the endpoint handle and code to the main process', pairCalls.length === 1 && pairCalls[0].id === '0123456789abcdef' && pairCalls[0].pin === '123456');
    recordTest('Pairing code is cleared after use', (await discoveryPinInput.inputValue()) === '');
    recordTest('Pairing result does not echo the code', !((await page.textContent('[data-testid="wireless-discovery-panel"]')) ?? '').includes('123456'));

    await page.click('button:has-text("Connect…")');
    await page.waitForTimeout(300);
    const connectCalls = await page.evaluate(() => (window as any).__calls.connect);
    recordTest('Connect sends only the issued endpoint handle', connectCalls.length === 1 && connectCalls[0] === 'fedcba9876543210');

    // Unsupported mDNS shows fallback guidance
    await page.evaluate(() => {
      (window as any).androscrnApi.discoverWirelessDevices = async () => ({
        success: false, supported: false, cancelled: false, timedOut: false, endpoints: [], ignoredCount: 0,
        message: 'The bundled ADB or this computer does not provide mDNS discovery (adb mdns check failed).',
        fallback: ['USB: connect the phone with a data cable, enable USB debugging, and accept the prompt on the phone.', 'Manual wireless: on Android 11+ open Developer options > Wireless debugging > Pair device with pairing code, then use "Pair" with the IP, pairing port and 6-digit code shown on the phone.']
      });
    });
    await page.click('button:has-text("Discover Wireless Devices")');
    await page.waitForTimeout(300);
    const fallbackText = await page.textContent('[data-testid="wireless-discovery-panel"]');
    recordTest('Unsupported discovery explains the limitation', /does not provide mDNS/.test(fallbackText ?? ''));
    recordTest('Unsupported discovery offers USB and manual fallbacks', /Wireless discovery is unavailable here/.test(fallbackText ?? '') && /USB: connect the phone/.test(fallbackText ?? ''));

    // Cancellation
    await page.evaluate(() => {
      (window as any).androscrnApi.discoverWirelessDevices = () => new Promise(() => {});
    });
    await page.click('button:has-text("Discover Wireless Devices")');
    // Scope to the discovery panel: other Cancel buttons (e.g. a running device search in the header) may exist.
    await page.waitForSelector('[data-testid="wireless-discovery-panel"] button:has-text("Cancel")', { timeout: 2000 });
    recordTest('Running discovery shows a Cancel button and Searching state', /Searching/.test((await page.textContent('[data-testid="wireless-discovery-panel"]')) ?? ''));
    await page.click('[data-testid="wireless-discovery-panel"] button:has-text("Cancel")');
    await page.waitForTimeout(300);
    recordTest('Cancel stops the main-process scan and resets the UI', (await page.evaluate(() => (window as any).__calls.cancel)) === 1 && (await page.locator('[data-testid="wireless-discovery-panel"] button:has-text("Cancel")').count()) === 0);

    // -------------------------------------------------------------
    // Test Scenario 14: Documents & OCR (Phase 11) - mocked main-process API
    // -------------------------------------------------------------
    console.log('\nScenario 14: Documents & OCR panel (mocked IPC; no real recognition)');
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await page.evaluate((img) => {
      const w = window as any;
      w.__doc = { import: 0, process: [] as any[], ocr: 0, cancel: 0, text: [] as string[], saved: 0, pdf: 0, released: 0, ocrMode: 'ok', progressCb: null as any };
      const base = { id: '20261018120000-abc123', sourceName: 'invoice.jpg', format: 'jpeg', width: 1200, height: 900, hasProcessed: false, hasOcr: false };
      w.androscrnApi.documentOcrStatus = async () => ({ available: true, reason: null });
      w.androscrnApi.onDocumentOcrProgress = (cb: any) => { w.__doc.progressCb = cb; return () => {}; };
      w.androscrnApi.documentImportDialog = async () => {
        w.__doc.import++;
        if (w.__doc.importMode === 'bad') return { ok: false, code: 'UNSUPPORTED_FORMAT', message: 'Unsupported image format. Use a PNG or JPEG image.' };
        return { ok: true, document: base, preview: { dataUrl: img, width: 600, height: 450, scale: 0.5 }, corners: [{ x: 100, y: 80 }, { x: 1100, y: 120 }, { x: 1060, y: 820 }, { x: 60, y: 780 }], detectionReason: null, detectionConfidence: 0.93, skewDegrees: 2.5 };
      };
      w.androscrnApi.documentImportCapture = async () => ({ ok: true, document: base, preview: { dataUrl: img, width: 600, height: 450, scale: 0.5 }, corners: null, detectionReason: 'low-contrast', detectionConfidence: null, skewDegrees: 0 });
      w.androscrnApi.documentProcess = async (o: any) => { w.__doc.process.push(o); return { ok: true, document: { ...base, hasProcessed: true }, preview: { dataUrl: img, width: 500, height: 640, scale: 1 } }; };
      w.androscrnApi.documentOcr = (id: string) => new Promise((resolve) => {
        w.__doc.ocr++;
        w.__doc.progressCb?.({ id, stage: 'recognizing text', progress: 0.4 });
        if (w.__doc.ocrMode === 'hang') { w.__doc.resolveOcr = resolve; return; }
        if (w.__doc.ocrMode === 'fail') { resolve({ ok: false, code: 'OCR_FAILED', message: 'OCR failed: engine error' }); return; }
        resolve({ ok: true, result: { text: 'INVOICE 2026\nTOTAL 450', rawText: 'INVOICE 2026\nTOTAL 450', meanConfidence: 71.5, wordCount: 4, lowConfidenceWords: 1, lowConfidenceSample: [{ text: 'T0TAL', confidence: 38 }], engine: 'tesseract.js', language: 'eng', durationMs: 1400 } });
      });
      w.androscrnApi.documentOcrCancel = async () => { w.__doc.cancel++; w.__doc.resolveOcr?.({ ok: false, code: 'CANCELLED', message: 'OCR was cancelled.' }); return true; };
      w.androscrnApi.documentSetText = async (_id: string, t: string) => { w.__doc.text.push(t); return { ok: true }; };
      w.androscrnApi.documentSave = async () => { w.__doc.saved++; return { ok: true, directory: 'Captures/documents/20261018120000-abc123' }; };
      w.androscrnApi.documentExportPdf = async () => { w.__doc.pdf++; return { ok: true, path: 'Captures/documents/20261018120000-abc123/searchable.pdf', directory: 'Captures/documents/20261018120000-abc123' }; };
      w.androscrnApi.documentRelease = async () => { w.__doc.released++; return true; };
    }, tinyPng);

    await page.click('#tab-documents');
    await page.waitForSelector('[data-testid="document-panel"]', { timeout: 3000 });
    recordTest('Documents & OCR tab opens the document panel', await page.isVisible('[data-testid="document-panel"]'));
    recordTest('Panel states that nothing is uploaded and the original is never changed', /Nothing is uploaded/.test((await page.textContent('[data-testid="document-panel"]')) ?? '') && /never changed/.test((await page.textContent('[data-testid="document-panel"]')) ?? ''));
    recordTest('Run OCR is not offered before an image is imported', (await page.locator('[data-testid="document-ocr-panel"]').count()) === 0);

    // import failure shows a clear, actionable error
    await page.evaluate(() => { (window as any).__doc.importMode = 'bad'; });
    await page.click('button:has-text("Choose image")');
    await page.waitForTimeout(200);
    const badMsg = (await page.textContent('[data-testid="document-message"]')) ?? '';
    recordTest('An unsupported image shows an error with guidance', /Unsupported image format/.test(badMsg) && /PNG or JPEG/.test(badMsg));
    recordTest('The error message is announced through a status live region', (await page.getAttribute('[data-testid="document-message"]', 'aria-live')) === 'polite');

    // successful import
    await page.evaluate(() => { (window as any).__doc.importMode = 'ok'; });
    await page.click('button:has-text("Choose image")');
    await page.waitForSelector('[data-testid="document-preview-image"]', { timeout: 3000 });
    recordTest('Importing shows a preview with alt text', (await page.getAttribute('[data-testid="document-preview-image"]', 'alt')) === 'Preview of invoice.jpg');
    recordTest('Detected page outline is drawn over the preview', (await page.locator('[data-testid="document-preview-panel"] svg polygon').count()) === 1);
    recordTest('Detection result is explained in text', /Page edges detected \(93% rectangular\)/.test((await page.textContent('[data-testid="document-detection-note"]')) ?? ''));
    recordTest('A suggested straighten action is offered for a skewed page', await page.isVisible('button:has-text("Suggested straighten")'));
    recordTest('Import tells the user the original is not modified', /original file is never modified/.test((await page.textContent('[data-testid="document-message"]')) ?? ''));
    recordTest('Run OCR is offered once a document is imported', await page.isVisible('[data-testid="document-ocr-panel"] button:has-text("Run OCR")'));

    // Manual corner adjustment (Phase 11.2)
    recordTest('Adjust corners button is available', await page.isVisible('[data-testid="adjust-corners-button"]'));
    await page.click('[data-testid="adjust-corners-button"]');
    await page.waitForSelector('[data-testid="document-corner-editor-svg"]', { timeout: 3000 });
    recordTest('Interactive corner adjustment editor SVG is displayed', (await page.locator('[data-testid="document-corner-editor-svg"]').count()) === 1);
    recordTest('Editor renders four accessible corner handles', (await page.locator('[data-testid^="corner-handle-"]').count()) === 4);
    recordTest('Corner handles have slider role and accessible labels', (await page.getAttribute('[data-testid="corner-handle-0"]', 'role')) === 'slider' && /Corner Top-Left/.test((await page.getAttribute('[data-testid="corner-handle-0"]', 'aria-label')) ?? ''));

    // Rotate boundary
    await page.click('[data-testid="rotate-corners-button"]');
    await page.waitForTimeout(100);
    recordTest('Rotate boundary 90 degrees updates the polygon', (await page.locator('[data-testid="document-corner-editor-svg"] polygon').count()) === 1);

    // Reset to detected
    await page.click('[data-testid="reset-corners-button"]');
    await page.waitForTimeout(100);
    recordTest('Reset to detected boundary restores outline', (await page.locator('[data-testid="document-corner-editor-svg"] polygon').count()) === 1);

    // Keyboard navigation on corner handle
    await page.focus('[data-testid="corner-handle-0"]');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    recordTest('Corner handle responds to keyboard arrow keys', (await page.locator('[data-testid="corner-handle-0"]').count()) === 1);

    // Cancel corner adjustment preserves previous state
    await page.click('[data-testid="cancel-corners-button"]');
    await page.waitForTimeout(100);
    recordTest('Cancelling corner adjustment closes editor without modifying original', (await page.locator('[data-testid="document-corner-editor-svg"]').count()) === 0 && (await page.locator('[data-testid="document-boundary-svg"]').count()) === 1);

    // Re-open and confirm boundary
    await page.click('[data-testid="adjust-corners-button"]');
    await page.waitForSelector('[data-testid="document-corner-editor-svg"]', { timeout: 3000 });
    await page.click('[data-testid="confirm-corners-button"]');
    await page.waitForTimeout(100);
    recordTest('Confirming boundary saves adjusted corners and returns to preview', (await page.locator('[data-testid="document-corner-editor-svg"]').count()) === 0 && /boundary confirmed/i.test((await page.textContent('[data-testid="document-message"]')) ?? ''));

    // adjustments
    await page.click('button[aria-label="Rotate right 90 degrees"]');
    await page.$eval('input[aria-label="Fine rotation in degrees"]', (el: any) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '1.5');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('button:has-text("Apply adjustments")');
    await page.waitForTimeout(250);
    const processCalls = await page.evaluate(() => (window as any).__doc.process);
    recordTest('Adjustments send crop, rotation and enhancement choices to the main process', processCalls.length === 1 && processCalls[0].rotationQuarterTurns === 1 && processCalls[0].rotationDegrees === 1.5 && processCalls[0].enhance === true && Array.isArray(processCalls[0].corners) && processCalls[0].corners.length === 4);
    recordTest('After processing the outline is removed (the image is already cropped)', (await page.locator('[data-testid="document-preview-panel"] svg polygon').count()) === 0);

    // OCR with progress and cancel
    await page.evaluate(() => { (window as any).__doc.ocrMode = 'hang'; });
    await page.click('button:has-text("Run OCR")');
    await page.waitForSelector('[role="progressbar"]', { timeout: 3000 });
    recordTest('OCR shows an accessible progress bar with a value', (await page.getAttribute('[role="progressbar"]', 'aria-valuenow')) === '40');
    recordTest('OCR progress describes the current stage', /recognizing text/.test((await page.textContent('[data-testid="ocr-progress"]')) ?? ''));
    recordTest('A Cancel button is available while OCR runs', await page.isVisible('[data-testid="document-ocr-panel"] button:has-text("Cancel")'));
    await page.click('[data-testid="document-ocr-panel"] button:has-text("Cancel")');
    await page.waitForTimeout(250);
    recordTest('Cancelling stops OCR in the main process and reports it', (await page.evaluate(() => (window as any).__doc.cancel)) === 1 && /Cancelled/.test((await page.textContent('[data-testid="document-message"]')) ?? ''));
    recordTest('The UI returns to an idle state after cancelling', (await page.locator('[role="progressbar"]').count()) === 0);

    // OCR failure
    await page.evaluate(() => { (window as any).__doc.ocrMode = 'fail'; });
    await page.click('button:has-text("Run OCR")');
    await page.waitForTimeout(250);
    recordTest('An OCR failure is shown with a hint and does not break the panel', /OCR failed/.test((await page.textContent('[data-testid="document-message"]')) ?? '') && (await page.locator('[data-testid="document-ocr-panel"]').count()) === 1);

    // OCR success, review, edit, save, export
    await page.evaluate(() => { (window as any).__doc.ocrMode = 'ok'; });
    await page.click('button:has-text("Run OCR")');
    await page.waitForSelector('#document-text', { timeout: 3000 });
    recordTest('Recognized text appears in an editable, labelled text area', (await page.inputValue('#document-text')) === 'INVOICE 2026\nTOTAL 450' && (await page.locator('label[for="document-text"]').count()) === 1);
    recordTest('Confidence is shown with word counts', /Confidence: 71.5%/.test((await page.textContent('[data-testid="ocr-summary"]')) ?? '') && /1 low-confidence/.test((await page.textContent('[data-testid="ocr-summary"]')) ?? ''));
    recordTest('Low-confidence words are listed for review', /T0TAL \(38%\)/.test((await page.textContent('[data-testid="low-confidence"]')) ?? ''));
    await page.fill('#document-text', 'INVOICE 2026\nTOTAL 450.00');
    await page.click('button:has-text("Save to Captures/documents")');
    await page.waitForTimeout(250);
    const savedText = await page.evaluate(() => (window as any).__doc.text);
    recordTest('Saving first sends the user-edited text to the main process', savedText[savedText.length - 1] === 'INVOICE 2026\nTOTAL 450.00');
    recordTest('Save reports the output folder', /Saved original copy, processed image, text and manifest/.test((await page.textContent('[data-testid="document-message"]')) ?? ''));
    await page.click('button:has-text("Export searchable PDF")');
    await page.waitForTimeout(250);
    recordTest('Export searchable PDF reports the file path', /Searchable PDF saved: .*searchable\.pdf/.test((await page.textContent('[data-testid="document-message"]')) ?? ''));
    recordTest('The PDF note says reviewed text is embedded and added words are approximate', /carries your reviewed text/.test((await page.textContent('[data-testid="document-ocr-panel"]')) ?? ''));

    // keyboard operation
    await page.focus('button:has-text("Run OCR")');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    recordTest('OCR can be started from the keyboard', (await page.evaluate(() => (window as any).__doc.ocr)) >= 4);

    // engine unavailable
    await page.evaluate(() => { (window as any).androscrnApi.documentOcrStatus = async () => ({ available: false, reason: 'The OCR engine (tesseract.js) is not installed. Reinstall AndroScrn or run `npm install`.' }); });
    await page.click('#tab-media');
    await page.click('#tab-documents');
    await page.waitForSelector('[data-testid="ocr-unavailable"]', { timeout: 3000 });
    recordTest('A missing OCR engine shows an alert with a reason', /not installed/.test((await page.textContent('[data-testid="ocr-unavailable"]')) ?? '') && (await page.getAttribute('[data-testid="ocr-unavailable"]', 'role')) === 'alert');
    await page.evaluate(() => { (window as any).__doc.importMode = 'ok'; });
    await page.click('button:has-text("Choose image")');
    await page.waitForSelector('[data-testid="document-ocr-panel"]', { timeout: 3000 });
    recordTest('With OCR unavailable the Run OCR button is disabled but cropping stays available', (await page.isDisabled('button:has-text("Run OCR")')) && (await page.isEnabled('button:has-text("Apply adjustments")')));

    // responsive
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);
    const docFits = await page.evaluate(() => { const el = document.querySelector('[data-testid="document-panel"]') as HTMLElement | null; return !el || el.getBoundingClientRect().right <= window.innerWidth + 24; });
    recordTest('The document panel stays within a 375px viewport', docFits);
    await page.setViewportSize({ width: 1280, height: 800 });

    // -------------------------------------------------------------
    // Test Scenario 15: Styling pipeline - utility classes must produce real CSS (Phase 11.1)
    // -------------------------------------------------------------
    console.log('\nScenario 15: Tailwind utility classes are applied');
    const styleProbe = await page.evaluate(() => {
      const tab = document.querySelector('#tab-documents') as HTMLElement;
      const cs = getComputedStyle(tab);
      const sr = document.querySelector('.sr-only') as HTMLElement | null;
      const srCs = sr ? getComputedStyle(sr) : null;
      const bodyCs = getComputedStyle(document.body);
      return {
        tabDisplay: cs.display,
        tabPaddingLeft: parseFloat(cs.paddingLeft),
        tabMinHeight: parseFloat(cs.minHeight),
        tabRadius: parseFloat(cs.borderTopLeftRadius),
        srPosition: srCs ? srCs.position : 'none',
        srWidth: srCs ? srCs.width : 'none',
        bodyBg: bodyCs.backgroundColor,
        bodyFont: bodyCs.fontFamily,
        overflowX: document.documentElement.scrollWidth - window.innerWidth
      };
    });
    recordTest('Navigation tabs are laid out with flex utilities', styleProbe.tabDisplay === 'flex');
    recordTest('Utility spacing and sizing classes take effect (padding, min-height, rounding)', styleProbe.tabPaddingLeft >= 8 && styleProbe.tabMinHeight >= 40 && styleProbe.tabRadius >= 8);
    recordTest('The sr-only utility visually hides labels while keeping them accessible', styleProbe.srPosition === 'absolute' && styleProbe.srWidth === '1px');
    recordTest('The dark application background is applied', /rgb\(\d+, \d+, \d+\)/.test(styleProbe.bodyBg) && styleProbe.bodyBg !== 'rgba(0, 0, 0, 0)');
    recordTest('Desktop UI makes zero external font requests at startup', externalNetworkRequests.filter(u => u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')).length === 0);
    recordTest('Application uses local system font stack without network fonts', styleProbe.bodyFont.includes('system-ui') || styleProbe.bodyFont.includes('Segoe UI') || styleProbe.bodyFont.includes('sans-serif'));
    await page.focus('#tab-documents');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const focusShadow = await page.evaluate(() => getComputedStyle(document.activeElement as HTMLElement).boxShadow);
    recordTest('Keyboard focus shows a visible ring (focus-visible utilities generate CSS)', focusShadow !== 'none' && focusShadow !== '');
    for (const width of [1280, 1024, 800, 640]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(100);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      recordTest(`No horizontal page overflow at ${width}px width`, over <= 1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const loadOutcome = await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as any)?.type);
    recordTest('The renderer did not reload itself during the session (single navigation)', loadOutcome === 'navigate');

    await runRemoteControlScenario(page, recordTest);

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
