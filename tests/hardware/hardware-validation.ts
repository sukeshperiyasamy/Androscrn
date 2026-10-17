import path from 'path';
import fs from 'fs';
import { DeviceManager } from '../../modules/device_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';
import { ScrcpyManager } from '../../modules/scrcpy_manager';
import { CameraManager } from '../../modules/camera_manager';
import { AndroScrnMcpServer } from '../../modules/mcp/server';
import { PairingManager } from '../../modules/mcp/pairing';
import { McpControlServer, McpControlClient } from '../../modules/mcp/control-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

export interface HardwareTestRecord {
  id: string;
  category: string;
  requiredHardwareAndPermissions: string;
  operation: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  isSecurityNegative?: boolean;
  diagnostics?: string;
}

const testRecords: HardwareTestRecord[] = [];
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let blockedTests = 0;
let currentTestIdx = 0;

export function recordTest(record: HardwareTestRecord) {
  totalTests++;
  testRecords.push(record);
  if (record.status === 'PASS') {
    passedTests++;
    const secTag = record.isSecurityNegative ? ' [SECURITY-NEGATIVE]' : '';
    console.log(`  ✓ [${record.id}] PASS: ${record.operation}${secTag}`);
  } else if (record.status === 'BLOCKED') {
    blockedTests++;
    console.log(`  ⊘ [${record.id}] BLOCKED: ${record.operation}`);
    if (record.diagnostics) {
      console.log(`      ↳ Diagnostic: ${record.diagnostics}`);
    }
  } else {
    failedTests++;
    console.error(`  ✗ [${record.id}] FAIL: ${record.operation} (Expected: ${record.expected}, Got: ${record.actual})`);
  }
}

function assert(condition: boolean, testName: string, category = 'HARDWARE', reqs = 'Physical Device + Authorized ADB') {
  currentTestIdx++;
  const id = `HW-VAL-${currentTestIdx.toString().padStart(2, '0')}`;
  recordTest({
    id,
    category,
    requiredHardwareAndPermissions: reqs,
    operation: testName,
    expected: 'Condition evaluated to true',
    actual: condition ? 'Condition evaluated to true' : 'Condition evaluated to false',
    status: condition ? 'PASS' : 'FAIL'
  });
}

function assertEqual<T>(actual: T, expected: T, testName: string, category = 'HARDWARE', reqs = 'Physical Device + Authorized ADB') {
  currentTestIdx++;
  const id = `HW-VAL-${currentTestIdx.toString().padStart(2, '0')}`;
  const cond = actual === expected;
  recordTest({
    id,
    category,
    requiredHardwareAndPermissions: reqs,
    operation: testName,
    expected: String(expected),
    actual: String(actual),
    status: cond ? 'PASS' : 'FAIL'
  });
}

export async function runHardwareValidation() {
  console.log('==================================================');
  console.log('   ANDROSCRN PHYSICAL HARDWARE VALIDATION SUITE   ');
  console.log('==================================================\n');

  const adbPath = path.resolve(process.cwd(), 'bin/scrcpy-win64/adb.exe');
  const scrcpyPath = path.resolve(process.cwd(), 'bin/scrcpy-win64/scrcpy.exe');
  const tempCapturesDir = path.resolve(process.cwd(), 'Captures/test-hardware');

  if (!fs.existsSync(tempCapturesDir)) {
    fs.mkdirSync(tempCapturesDir, { recursive: true });
  }

  const deviceManager = new DeviceManager(adbPath);
  const diagnosticsManager = new DiagnosticsManager(deviceManager);
  const scrcpyManager = new ScrcpyManager(scrcpyPath);
  const cameraManager = new CameraManager(scrcpyPath, deviceManager);

  // -------------------------------------------------------------
  // Stage 1: Device Preflight & Hardware Discovery
  // -------------------------------------------------------------
  console.log('--- Stage 1: Physical Device Preflight & Discovery ---');

  const adbVer = await deviceManager.getAdbVersion();
  assert(adbVer.includes('ADB'), `Introspected ADB Version: ${adbVer}`);

  const scrcpyVer = await scrcpyManager.getScrcpyVersion();
  assert(scrcpyVer.includes('scrcpy'), `Introspected scrcpy Version: ${scrcpyVer}`);

  const devices = await deviceManager.getDevices();
  console.log(`Attached Android devices count: ${devices.length}`);

  if (devices.length === 0) {
    console.warn('\n[BLOCKED] No physical Android device attached over USB.');
    console.warn('Physical hardware testing cannot proceed without an active device.');
    return;
  }

  const authorizedDevices = devices.filter(d => d.state === 'device');
  if (authorizedDevices.length === 0) {
    const unauth = devices.find(d => d.state === 'unauthorized');
    if (unauth) {
      console.warn(`\n[BLOCKED] Device attached (${unauth.serial.slice(0, 4)}...) but UNAUTHORIZED.`);
      console.warn('Please unlock the device and accept the RSA host authorization dialog on screen.');
    } else {
      console.warn(`\n[BLOCKED] Devices found, but none in ready 'device' state.`);
    }
    return;
  }

  // Multi-device ambiguity guard
  let targetDevice: any = undefined;
  if (process.env.TEST_DEVICE_SERIAL) {
    targetDevice = authorizedDevices.find(d => d.serial === process.env.TEST_DEVICE_SERIAL);
    if (!targetDevice) {
      console.error(`\n[ERROR] Specified TEST_DEVICE_SERIAL="${process.env.TEST_DEVICE_SERIAL}" not found among authorized devices.`);
      return;
    }
  } else if (authorizedDevices.length > 1) {
    console.error(`\n[AMBIGUITY GUARD] Multiple authorized devices detected (${authorizedDevices.map(d => d.serial.slice(0, 4) + '...').join(', ')}).`);
    console.error('To prevent accidental execution on the wrong device, specify TEST_DEVICE_SERIAL=<serial>');
    return;
  } else {
    targetDevice = authorizedDevices[0];
  }

  // Reject accidental emulator targeting when physical device is requested
  const isEmulator = targetDevice.serial.startsWith('emulator-') || targetDevice.model.toLowerCase().includes('sdk');
  if (isEmulator && !process.env.ALLOW_EMULATOR_TESTING) {
    console.error(`\n[SAFETY BLOCKED] Target device (${targetDevice.serial}) is an Android Emulator.`);
    console.error('Physical hardware validation requires physical hardware. Set ALLOW_EMULATOR_TESTING=1 to override.');
    return;
  }

  const serial = targetDevice.serial;
  const maskedSerial = serial.length > 8 ? `${serial.slice(0, 4)}...${serial.slice(-4)}` : '****';
  assert(targetDevice.state === 'device', `Device state is verified 'device' (authorized) [ID: ${maskedSerial}]`);
  assert(targetDevice.model.length > 0, `Introspected device model: ${targetDevice.model}`);
  assert(targetDevice.product.length > 0, `Introspected device product: ${targetDevice.product}`);
  assert(targetDevice.transportType === 'usb', `Device transport verified as USB connection`);

  // Query hardware specs
  const osVerRes = await deviceManager.executeAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.release']);
  const osVersion = osVerRes.stdout.trim();
  assert(osVersion.length > 0, `Android OS Release Version: Android ${osVersion}`);

  const sdkRes = await deviceManager.executeAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']);
  const sdkVersion = sdkRes.stdout.trim();
  assert(parseInt(sdkVersion, 10) >= 21, `Android SDK API level verified: API ${sdkVersion}`);

  const mfgRes = await deviceManager.executeAdb(['-s', serial, 'shell', 'getprop', 'ro.product.manufacturer']);
  const manufacturer = mfgRes.stdout.trim();
  assert(manufacturer.length > 0, `Hardware Manufacturer: ${manufacturer}`);

  const screenSize = await deviceManager.getScreenSize(serial);
  assert(screenSize !== null, `Introspected Display Geometry: ${screenSize?.width}x${screenSize?.height}`);
  assert(screenSize!.width > 0 && screenSize!.height > 0, 'Screen dimensions are positive integers');

  // -------------------------------------------------------------
  // Stage 2: Baseline Device Operations (Info, Battery, Logs, Screenshot, Mirroring)
  // -------------------------------------------------------------
  console.log('\n--- Stage 2: Baseline Physical Device Operations ---');

  let mcpClient: Client | null = null;
  let controlClient: McpControlClient | null = null;
  let desktopServer: McpControlServer | null = null;

  try {

  // Battery Level
  const batteryLevel = await deviceManager.getBatteryLevel(serial);
  assert(batteryLevel !== undefined && batteryLevel >= 0 && batteryLevel <= 100, `Introspected Battery Level: ${batteryLevel}%`);

  // Logcat stream
  const logs = await diagnosticsManager.getRecentLogs(serial, 25);
  assert(logs.length > 0, `Retrieved recent logcat stream entries: ${logs.length} lines`);
  assert(logs[0].level !== undefined, `Parsed logcat entry level: ${logs[0].level}`);

  // Screenshot Capture & Genuine PNG verification
  const screenshotRes = await diagnosticsManager.captureDeviceScreenshot(serial, tempCapturesDir);
  assert(screenshotRes.success === true, `Captured frame buffer screenshot from real device`);
  assert(screenshotRes.filePath !== undefined && fs.existsSync(screenshotRes.filePath), `Screenshot file persisted to disk`);
  assert(screenshotRes.size! > 10000, `Screenshot file size verified non-trivial: ${screenshotRes.size} bytes`);

  // Verify PNG Magic Header in raw file bytes
  const fileBytes = fs.readFileSync(screenshotRes.filePath!);
  const isGenuinePng = fileBytes.length >= 8 &&
    fileBytes[0] === 0x89 &&
    fileBytes[1] === 0x50 &&
    fileBytes[2] === 0x4e &&
    fileBytes[3] === 0x47 &&
    fileBytes[4] === 0x0d &&
    fileBytes[5] === 0x0a &&
    fileBytes[6] === 0x1a &&
    fileBytes[7] === 0x0a;
  assert(isGenuinePng, `Verified genuine PNG binary magic header (89 50 4E 47 0D 0A 1A 0A)`);

  // Native scrcpy Screen Mirroring Process Lifecycle
  console.log('\nTesting scrcpy mirroring process startup on physical device...');
  const mirrorRes = scrcpyManager.startMirroring({
    serial,
    preset: 'battery_saver',
    noAudio: true,
    windowTitle: 'AndroScrn Hardware Test Display'
  });
  assert(mirrorRes.success === true, `scrcpy mirroring process spawned (PID: ${mirrorRes.pid})`);
  assert(scrcpyManager.getStatus().running === true, `ScrcpyManager reports mirroring status is RUNNING`);

  // Allow mirroring window to run for 2.5 seconds
  await new Promise(r => setTimeout(r, 2500));

  // Clean exit
  const stopRes = scrcpyManager.stopMirroring();
  assert(stopRes === true, `scrcpy mirroring stopped cleanly`);
  assert(scrcpyManager.getStatus().running === false, `ScrcpyManager reports mirroring status returned to STOPPED`);

  // -------------------------------------------------------------
  // Stage 3: Controlled Input & Vendor ROM Security Detection
  // -------------------------------------------------------------
  console.log('\n--- Stage 3: Controlled Input & Security Verification ---');

  const capturedAudits: any[] = [];
  const pairingManager = new PairingManager(60000, 30 * 60 * 1000);
  const mcpServer = new AndroScrnMcpServer(
    { name: 'hardware-test-server', version: '1.0.0', capturesDir: tempCapturesDir },
    deviceManager,
    diagnosticsManager,
    pairingManager
  );
  mcpServer.onActionAudit = audit => capturedAudits.push(audit);

  const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
  await mcpServer.server.connect(sTrans);
  mcpClient = new Client({ name: 'hardware-test-client', version: '1.0.0' }, { capabilities: {} });
  await mcpClient.connect(cTrans);

  // Test 3.1: Reject unauthenticated input operation (Security-negative test)
  const unauthTap: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial, x: 500, y: 500, token: 'invalid-token-123' }
  });
  recordTest({
    id: 'HW-SEC-01',
    category: 'SECURITY_NEGATIVE',
    requiredHardwareAndPermissions: 'Physical Device + MCP Server',
    operation: 'Unauthenticated tap operation strictly rejected at gate',
    expected: 'Rejection with Tier 3 write:input required',
    actual: unauthTap.isError ? (unauthTap.content[0].text.includes('Tier 3') ? 'Tier 3 authorization required' : 'Error returned') : 'Operation permitted',
    status: (unauthTap.isError && unauthTap.content[0].text.includes('Tier 3')) ? 'PASS' : 'FAIL',
    isSecurityNegative: true
  });

  // Test 3.2: Reject out-of-bounds coordinates (Security-negative test)
  const pairReq = await pairingManager.requestPairing('Hardware-Client', 3);
  pairingManager.approveRequest(pairReq.requestId!);
  const pairSession = pairingManager.pairSession(pairReq.requestId!, undefined, 'Hardware-Client');
  const validToken = pairSession.token!;

  const oobTap: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial, x: screenSize!.width + 100, y: screenSize!.height + 100, token: validToken }
  });
  recordTest({
    id: 'HW-SEC-02',
    category: 'SECURITY_NEGATIVE',
    requiredHardwareAndPermissions: 'Physical Device + Valid Tier 3 Token',
    operation: `Out-of-bounds tap coordinates (${screenSize!.width + 100}, ${screenSize!.height + 100}) rejected`,
    expected: 'Rejection by coordinate boundary validator',
    actual: (oobTap.isError && oobTap.content[0].text.includes('Out-of-bounds')) ? 'Out-of-bounds error' : 'Allowed',
    status: (oobTap.isError && oobTap.content[0].text.includes('Out-of-bounds')) ? 'PASS' : 'FAIL',
    isSecurityNegative: true
  });

  // Test 3.3: Reject malicious shell injection in input_text (Security-negative test)
  const injText: any = await mcpClient.callTool({
    name: 'input_text',
    arguments: { serial, text: 'hello;reboot', token: validToken }
  });
  recordTest({
    id: 'HW-SEC-03',
    category: 'SECURITY_NEGATIVE',
    requiredHardwareAndPermissions: 'Physical Device + Valid Tier 3 Token',
    operation: 'Input text with shell injection metacharacter \';\' rejected at gate',
    expected: 'Sanitization failure for shell metacharacter',
    actual: injText.isError ? 'Metacharacter rejected' : 'Command executed',
    status: injText.isError ? 'PASS' : 'FAIL',
    isSecurityNegative: true
  });

  // Test 3.4: Test physical input execution and vendor ROM security detection
  const tapAttempt: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial, x: Math.floor(screenSize!.width / 2), y: Math.floor(screenSize!.height / 2), token: validToken }
  });

  if (tapAttempt.isError) {
    const errText = tapAttempt.content[0].text;
    if (errText.includes('USB debugging (Security Settings)')) {
      recordTest({
        id: 'HW-INJ-01',
        category: 'PHYSICAL_INPUT_INJECTION',
        requiredHardwareAndPermissions: 'Xiaomi Device + Developer Options + "USB debugging (Security Settings)" enabled via SIM',
        operation: 'Physical touch injection via adb shell input tap',
        expected: 'Physical touch event injected into window manager',
        actual: 'Blocked by Xiaomi MIUI/HyperOS security subsystem (missing USB security settings permission)',
        status: 'BLOCKED',
        isSecurityNegative: false,
        diagnostics: 'Xiaomi requires "USB debugging (Security Settings)" enabled with an active SIM card. Physical touch injection blocked by vendor policy; injection is NOT claimed as verified.'
      });

      recordTest({
        id: 'HW-SEC-04',
        category: 'VENDOR_SECURITY_DETECTION',
        requiredHardwareAndPermissions: 'Physical Device + MCP Server',
        operation: 'Vendor ROM security exception correctly caught with actionable guidance',
        expected: 'Exception trapped and actionable recovery returned to user',
        actual: 'Detected Xiaomi security restriction; guidance provided',
        status: 'PASS',
        isSecurityNegative: true,
        diagnostics: 'Instructions: Settings -> Developer Options -> USB debugging (Security Settings) -> Enable'
      });
    } else {
      recordTest({
        id: 'HW-INJ-01',
        category: 'PHYSICAL_INPUT_INJECTION',
        requiredHardwareAndPermissions: 'Physical Device + Authorized ADB',
        operation: 'Physical touch event injection via adb shell input tap',
        expected: 'Touch event accepted',
        actual: errText,
        status: 'FAIL',
        diagnostics: errText
      });
    }
  } else {
    recordTest({
      id: 'HW-INJ-01',
      category: 'PHYSICAL_INPUT_INJECTION',
      requiredHardwareAndPermissions: 'Physical Device + Authorized ADB + Touch Permissions',
      operation: 'Physical touch event injection via adb shell input tap',
      expected: 'Touch event injected successfully',
      actual: 'Touch event accepted by device',
      status: 'PASS',
      isSecurityNegative: false
    });
  }

  // Verify Audit Log Redaction
  assert(capturedAudits.length > 0, `Live action audit records generated: ${capturedAudits.length}`);
  const hasTokenLeak = capturedAudits.some(a => JSON.stringify(a).includes(validToken));
  assert(!hasTokenLeak, `SECURITY VERIFIED: Audit log records strictly omit session tokens`);

  // -------------------------------------------------------------
  // Stage 4: Named-Pipe HITL Pairing & Emergency Revocation on Hardware
  // -------------------------------------------------------------
  console.log('\n--- Stage 4: Named-Pipe HITL Pairing & Revocation Flow ---');

  const testPipeName = `\\\\.\\pipe\\androscrn-hw-pipe-${Date.now()}`;
  desktopServer = new McpControlServer(testPipeName);
  await desktopServer.start();

  controlClient = new McpControlClient(testPipeName);
  const clientConnected = await controlClient.connect(5000);
  assert(clientConnected, `McpControlClient successfully connected to Desktop Named Pipe Server`);

  const hwPairingMgr = new PairingManager(60000, 30 * 60 * 1000, controlClient);
  const pendingRequests: any[] = [];
  desktopServer.on('pairingRequested', req => pendingRequests.push(req));

  const hwReq = await hwPairingMgr.requestPairing('QA-Hardware-Agent', 3);
  assert(typeof hwReq.requestId === 'string', `Registered pairing request over Named Pipe (ID: ${hwReq.requestId})`);

  await new Promise(r => setTimeout(r, 60));
  assert(pendingRequests.length >= 1, `Desktop Server received pairing request notification over Named Pipe`);
  assert(pendingRequests[0].pin !== undefined && pendingRequests[0].pin.length === 6, `Desktop received 6-digit verification PIN`);

  // Desktop user approves access
  const approved = desktopServer.approveRequest(hwReq.requestId!);
  assert(approved, `Desktop user clicked "Approve Access" in UI`);

  await new Promise(r => setTimeout(r, 60));
  const hwSessionRes = hwPairingMgr.pairSession(hwReq.requestId!, undefined, 'QA-Hardware-Agent');
  assert(hwSessionRes.success === true, `Exchanged approved request for authorized Tier 3 token`);
  const hwToken = hwSessionRes.token!;
  assert(hwToken.length === 64, `Received 64-character high-entropy hex session token`);

  // Emergency Kill Switch
  desktopServer.revokeAllSessions();
  await new Promise(r => setTimeout(r, 60));

  assert(!hwPairingMgr.isTierAllowed(hwToken, 3), `SECURITY VERIFIED: Session immediately invalidated after Emergency Kill Switch`);

  // -------------------------------------------------------------
  // Stage 5: Disconnect & Failure Boundaries
  // -------------------------------------------------------------
  console.log('\n--- Stage 5: Disconnect & Failure Boundaries ---');

  // Query non-existent serial
  const nonExistentTap: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial: 'non-existent-device-999', x: 100, y: 100, token: validToken }
  });
  assert(nonExistentTap.isError === true, `Operation on non-existent or disconnected serial cleanly rejected`);
  assert(
    nonExistentTap.content[0].text.includes('not attached or was disconnected'),
    `Descriptive disconnection error returned to MCP client`
  );

  // -------------------------------------------------------------
  // Stage 6: Camera Studio Hardware Pipeline Validation
  // -------------------------------------------------------------
  console.log('\n--- Stage 6: Camera Studio Hardware Pipeline Validation ---');

  // 1. Query Real Camera Capabilities
  console.log('Querying physical camera sensors and Direct3D11 streaming capabilities...');
  const realCaps = await cameraManager.queryCapabilities(serial);

  assert(realCaps.transportSupported, `Transport supported: Android ${realCaps.androidVersion} (API ${realCaps.sdkVersion}) >= Android 12`);
  assert(realCaps.deviceSupported, `Physical camera sensors accessible: ${realCaps.cameras.length} camera(s) detected`);
  assert(realCaps.cameras.length >= 2, `Both back and front cameras discovered (Found: ${realCaps.cameras.map(c => `${c.id}:${c.facing}`).join(', ')})`);

  const primaryCam = realCaps.cameras.find(c => c.id === '0') || realCaps.cameras[0];
  assert(primaryCam !== undefined, `Primary camera sensor ID 0 detected`);
  assert(primaryCam.maxResolution !== undefined, `Primary camera reports max sensor resolution: ${primaryCam.maxResolution}`);
  assert(primaryCam.fpsList.includes(30), `Primary camera supports standard 30 FPS`);
  assert(primaryCam.zoomRange !== undefined, `Primary camera reports hardware zoom range: [${primaryCam.zoomRange?.[0]}x, ${primaryCam.zoomRange?.[1]}x]`);
  assert(primaryCam.supportedSizes.includes('1920x1080') || primaryCam.supportedSizes.includes('1280x720'), `Primary camera supports HD video stream resolution`);

  // 2. Verified Capabilities Flags
  assert(realCaps.liveZoomSupported === true, `Live Zoom verified supported via native scrcpy shortcut`);
  assert(realCaps.liveTorchSupported === true, `Live Torch verified supported via native scrcpy shortcut`);
  assert(realCaps.recordingSupported === true, `Continuous MP4 video recording verified supported via scrcpy`);
  assert(realCaps.snapshotsSupported === false, `Direct single-frame snapshot accurately reported as unsupported by current transport (requires companion APK)`);

  // 3. Short Live Camera Preview Execution (Hardware Direct3D11)
  console.log('Executing 2-second physical camera preview stream...');
  const camStartRes = cameraManager.startCamera({
    serial,
    cameraId: '0',
    size: '1280x720',
    fps: 30,
    zoom: 1.0,
    noAudio: true,
    windowTitle: 'AndroScrn Camera Hardware Validation'
  });

  assert(camStartRes.success === true, `Native camera preview stream launched successfully (PID: ${camStartRes.pid})`);
  assert(cameraManager.getStatus().running === true, `Camera manager confirms streaming active on hardware`);

  // Allow stream to run for 1.5 seconds, then stop
  await new Promise(r => setTimeout(r, 1500));
  const camStopOk = cameraManager.stopCamera();
  assert(camStopOk === true, `Camera streaming stopped cleanly`);
  assert(cameraManager.getStatus().running === false, `Camera manager confirms process termination`);

  // 4. PC-Side MP4 Recording Test
  console.log('Executing 2-second PC-side hardware camera recording...');
  const hwRecPath = path.join(tempCapturesDir, 'hardware_cam_test.mp4');
  const camRecRes = cameraManager.startCamera({
    serial,
    cameraId: '0',
    size: '1280x720',
    fps: 30,
    recordPath: hwRecPath,
    noAudio: true,
    windowTitle: 'AndroScrn Camera Record Validation'
  });

  assert(camRecRes.success === true, `Camera recording session started (PID: ${camRecRes.pid})`);
  await new Promise(r => setTimeout(r, 2000));
  cameraManager.stopCamera();
  await new Promise(r => setTimeout(r, 500));

  assert(fs.existsSync(hwRecPath), `Recording MP4 file successfully created at: ${hwRecPath}`);
  const recStats = fs.statSync(hwRecPath);
  assert(recStats.size > 0, `Recording contains verified video data (${Math.round(recStats.size / 1024)} KB)`);
  if (fs.existsSync(hwRecPath)) {
    try {
      fs.unlinkSync(hwRecPath);
    } catch {
      // Windows file lock may release asynchronously after process exit
    }
  }

  } finally {
    // Guaranteed process termination & resource cleanup
    if (scrcpyManager.getStatus().running) {
      try {
        scrcpyManager.stopMirroring();
      } catch {
        // ignore
      }
    }
    if (cameraManager.getStatus().running) {
      try {
        cameraManager.stopCamera();
      } catch {
        // ignore
      }
    }
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch {
        // ignore
      }
    }
    if (controlClient) {
      try {
        controlClient.close();
      } catch {
        // ignore
      }
    }
    if (desktopServer) {
      try {
        await desktopServer.stop();
      } catch {
        // ignore
      }
    }
    try {
      fs.rmSync(tempCapturesDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log('\n==================================================');
  console.log(`HARDWARE VALIDATION RESULTS: ${passedTests}/${totalTests} Passed (${blockedTests} Blocked, ${failedTests} Failed)`);
  console.log('==================================================\n');

  const reportDir = path.resolve(process.cwd(), 'Captures');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, 'hardware-certification-report.json');
  try {
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        total: totalTests,
        passed: passedTests,
        blocked: blockedTests,
        failed: failedTests
      },
      records: testRecords
    }, null, 2), 'utf8');
    console.log(`Hardware certification report persisted: ${reportPath}`);
  } catch {}

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runHardwareValidation().catch(err => {
    console.error('Hardware validation error:', err);
    process.exit(1);
  });
}
