import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AndroScrnMcpServer } from '../../modules/mcp/server';
import { PairingManager } from '../../modules/mcp/pairing';
import { DeviceManager } from '../../modules/device_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';
import { NdjsonFramer } from '../../modules/mcp/control-bridge';

export async function runMcpTests(
  assert: (condition: boolean, testName: string) => void,
  assertEqual: <T>(actual: T, expected: T, testName: string) => void
) {
  console.log('\nTest Group 11: Model Context Protocol (MCP) Server & Security Gatekeeper');

  // 1. Setup Mock Managers
  const mockAdbPath = path.resolve(__dirname, '../../bin/scrcpy-win64/adb.exe');
  const tempCapturesDir = path.resolve(__dirname, '../../Captures/test-mcp');

  if (!fs.existsSync(tempCapturesDir)) {
    fs.mkdirSync(tempCapturesDir, { recursive: true });
  }

  const deviceManager = new DeviceManager(mockAdbPath);
  const diagnosticsManager = new DiagnosticsManager(deviceManager);
  const pairingManager = new PairingManager(60000, 30 * 60 * 1000);

  // Mock getDevices
  deviceManager.getDevices = async () => [
    {
      serial: 'EXAMPLE0SERIAL01',
      state: 'device',
      model: '21091116I',
      product: 'pissarroin',
      device: 'pissarroin',
      transportType: 'usb',
      guidance: 'Connected and authorized: Ready for screen mirroring and control.',
      batteryLevel: 88
    },
    {
      serial: '192.168.1.150:5555',
      state: 'device',
      model: 'SM-G960U1',
      product: 'starqlteue',
      device: 'starqlteue',
      transportType: 'wifi',
      guidance: 'Connected via Wi-Fi.',
      batteryLevel: 65
    }
  ];

  // Mock getRecentLogs with sensitive credentials
  diagnosticsManager.getRecentLogs = async (serial: string, count = 50) => [
    {
      raw: '10-16 12:00:00.100  1000  1000 I Auth: Authenticated admin@corp.net with Bearer eyJhbGciOiJIUzI1NiJ9.test and pin 987654',
      level: 'I',
      message: 'Authenticated admin@corp.net with Bearer eyJhbGciOiJIUzI1NiJ9.test and pin 987654'
    },
    {
      raw: '10-16 12:00:01.200  1000  1000 E CrashHandler: Fatal NullPointerException in user profile token secret_abc123',
      level: 'E',
      message: 'Fatal NullPointerException in user profile token secret_abc123'
    }
  ];

  // Mock screenshot capture: create real sample PNG
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const samplePngPath = path.join(tempCapturesDir, 'sample_test.png');
  fs.writeFileSync(samplePngPath, validPngBuffer);

  diagnosticsManager.captureDeviceScreenshot = async (serial: string, destFolder: string) => {
    if (serial === 'invalid_serial; rm') {
      return { success: false, error: 'Invalid device serial identifier.' };
    }
    return {
      success: true,
      filePath: samplePngPath,
      size: validPngBuffer.length
    };
  };

  // Mock ADB execution and screen size
  const executedAdbArgs: string[][] = [];
  deviceManager.executeAdb = async (args: string[], timeoutMs = 10000) => {
    executedAdbArgs.push(args);
    if (args.includes('9999')) {
      return { stdout: '', stderr: 'Command timed out.', code: -1 };
    }
    if (args.includes('82')) {
      return { stdout: '', stderr: 'SecurityException: Permission Denial: injectInputEvent Requires INJECT_EVENTS permission', code: 1 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  deviceManager.getScreenSize = async (serial: string) => {
    if (serial === 'EXAMPLE0SERIAL01') {
      return { width: 1080, height: 2400 };
    }
    return null;
  };

  // Mock diagnostic bundle
  diagnosticsManager.generateDiagnosticBundle = async () => {
    return '=== ANDROSCRN SYSTEM DIAGNOSTIC REPORT ===\nHost: win32 x64\nAdmin: support@androscrn.org with Bearer sec_tok_991827\nADB Version: 1.0.41';
  };

  // 2. Initialize MCP Server and Client
  const capturedAudits: any[] = [];
  const mcpServer = new AndroScrnMcpServer(
    {
      name: 'androscrn-mcp-test',
      version: '1.0.0',
      capturesDir: tempCapturesDir
    },
    deviceManager,
    diagnosticsManager,
    pairingManager
  );
  mcpServer.onActionAudit = (audit: any) => {
    capturedAudits.push(audit);
  };

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

  await mcpServer.server.connect(serverTransport);
  await client.connect(clientTransport);

  // Test 1: Tool Listing
  const toolList = await client.listTools();
  assert(toolList.tools.length >= 12, `MCP Server exposes all required tools (Found: ${toolList.tools.length})`);

  const toolNames = toolList.tools.map(t => t.name);
  assert(toolNames.includes('list_devices'), 'Tool "list_devices" registered');
  assert(toolNames.includes('get_device_info'), 'Tool "get_device_info" registered');
  assert(toolNames.includes('get_logcat'), 'Tool "get_logcat" registered');
  assert(toolNames.includes('get_diagnostics'), 'Tool "get_diagnostics" registered');
  assert(toolNames.includes('capture_screenshot'), 'Tool "capture_screenshot" registered');
  assert(toolNames.includes('request_pairing'), 'Tool "request_pairing" registered');
  assert(toolNames.includes('pair_session'), 'Tool "pair_session" registered');
  assert(toolNames.includes('get_pairing_status'), 'Tool "get_pairing_status" registered');
  assert(toolNames.includes('tap'), 'Tool "tap" registered');
  assert(toolNames.includes('swipe'), 'Tool "swipe" registered');
  assert(toolNames.includes('keyevent'), 'Tool "keyevent" registered');
  assert(toolNames.includes('input_text'), 'Tool "input_text" registered');

  // Test 2: list_devices
  const devRes: any = await client.callTool({ name: 'list_devices', arguments: {} });
  assert(!devRes.isError, 'list_devices executed without error');
  const parsedDevices = JSON.parse(devRes.content[0].text);
  assertEqual(parsedDevices.length, 2, 'list_devices returned expected mock device count');
  assertEqual(parsedDevices[0].serial, 'EXAMPLE0SERIAL01', 'list_devices first serial matches');

  // Test 3: get_device_info with valid serial
  const infoRes: any = await client.callTool({
    name: 'get_device_info',
    arguments: { serial: 'EXAMPLE0SERIAL01' }
  });
  assert(!infoRes.isError, 'get_device_info executed successfully for valid serial');
  const infoJson = JSON.parse(infoRes.content[0].text);
  assertEqual(infoJson.model, '21091116I', 'get_device_info returned model 21091116I');
  assertEqual(infoJson.batteryLevel, 88, 'get_device_info returned battery level 88');

  // Test 4: get_device_info input validation defense (Injection attempt)
  const malInfoRes: any = await client.callTool({
    name: 'get_device_info',
    arguments: { serial: 'serial; rm -rf /' }
  });
  assert(malInfoRes.isError, 'get_device_info rejected command injection serial');
  assert(malInfoRes.content[0].text.includes('Invalid device serial format'), 'Proper validation error returned for injection serial');

  // Test 5: get_device_info non-existent device
  const notFoundRes: any = await client.callTool({
    name: 'get_device_info',
    arguments: { serial: 'nonexistent-device' }
  });
  assert(notFoundRes.isError, 'get_device_info returned error for non-existent device');
  assert(notFoundRes.content[0].text.includes('was not found'), 'Device not found message verified');

  // Test 6: get_logcat with sensitive data redaction
  const logcatRes: any = await client.callTool({
    name: 'get_logcat',
    arguments: { serial: 'EXAMPLE0SERIAL01', lines: 10 }
  });
  assert(!logcatRes.isError, 'get_logcat executed successfully');
  const logcatText = logcatRes.content[0].text;
  assert(!logcatText.includes('admin@corp.net'), 'Raw email redacted from logcat output');
  assert(logcatText.includes('[REDACTED_EMAIL]'), 'Redacted email token placeholder present in logcat');
  assert(!logcatText.includes('Bearer eyJhbGciOiJIUzI1NiJ9.test'), 'Raw bearer token redacted from logcat output');
  assert(logcatText.includes('Bearer [REDACTED_TOKEN]'), 'Redacted bearer token placeholder present in logcat');
  assert(!logcatText.includes('987654'), 'Raw 6-digit PIN redacted from logcat output');
  assert(logcatText.includes('[REDACTED_PIN]'), 'Redacted PIN token placeholder present in logcat');

  // Test 7: get_logcat level filtering
  const errLogRes: any = await client.callTool({
    name: 'get_logcat',
    arguments: { serial: 'EXAMPLE0SERIAL01', lines: 10, filterLevel: 'E' }
  });
  const errLogs = JSON.parse(errLogRes.content[0].text);
  assertEqual(errLogs.length, 1, 'get_logcat filtered to 1 Error log');
  assertEqual(errLogs[0].level, 'E', 'Filtered log item has level E');

  // Test 8: get_logcat injection serial rejection
  const malLogRes: any = await client.callTool({
    name: 'get_logcat',
    arguments: { serial: 'dev|reboot', lines: 10 }
  });
  assert(malLogRes.isError, 'get_logcat rejected pipe operator injection');

  // Test 9: get_diagnostics redaction
  const diagRes: any = await client.callTool({
    name: 'get_diagnostics',
    arguments: {}
  });
  assert(!diagRes.isError, 'get_diagnostics executed successfully');
  const diagText = diagRes.content[0].text;
  assert(diagText.includes('ANDROSCRN SYSTEM DIAGNOSTIC REPORT'), 'Diagnostic report header present');
  assert(!diagText.includes('support@androscrn.org'), 'Diagnostic report email redacted');
  assert(!diagText.includes('sec_tok_991827'), 'Diagnostic report bearer token redacted');

  // Test 10: capture_screenshot verified PNG content block
  const snapRes: any = await client.callTool({
    name: 'capture_screenshot',
    arguments: { serial: 'EXAMPLE0SERIAL01', format: 'base64' }
  });
  assert(!snapRes.isError, 'capture_screenshot executed successfully');
  assertEqual(snapRes.content[0].type, 'image', 'capture_screenshot returned image content block');
  assertEqual(snapRes.content[0].mimeType, 'image/png', 'capture_screenshot returned image/png mimeType');
  assert(snapRes.content[0].data.length > 0, 'capture_screenshot returned non-empty base64 payload');
  const decodedHeader = Buffer.from(snapRes.content[0].data, 'base64');
  assert(
    decodedHeader[0] === 0x89 && decodedHeader[1] === 0x50 && decodedHeader[2] === 0x4e && decodedHeader[3] === 0x47,
    'Decoded base64 payload possesses valid PNG signature (89 50 4E 47)'
  );

  // Test 11: capture_screenshot invalid serial rejection
  const malSnapRes: any = await client.callTool({
    name: 'capture_screenshot',
    arguments: { serial: 'device & calc.exe' }
  });
  assert(malSnapRes.isError, 'capture_screenshot rejected ampersand injection');

  // Test 12: Pairing Handshake - request_pairing never leaks PIN to MCP client
  const pairReqRes: any = await client.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'AI-Audit-Agent', requestedTier: 3 }
  });
  assert(!pairReqRes.isError, 'request_pairing returned valid response');
  const pairReqJson = JSON.parse(pairReqRes.content[0].text);
  assert(
    typeof pairReqJson.requestId === 'string' && pairReqJson.requestId.length >= 32,
    `request_pairing returned valid requestId (${pairReqJson.requestId})`
  );
  assertEqual(pairReqJson.status, 'pending_desktop_approval', 'Status is pending_desktop_approval');
  assert(
    pairReqJson.pairingPin === undefined,
    'SECURITY REGRESSION CHECK: Pairing PIN is NOT leaked in the JSON-RPC response to the MCP client'
  );
  assertEqual(pairReqJson.expiresInSeconds, 60, 'Pairing PIN TTL is 60 seconds');

  // Test 13: pair_session rejected without prior approval or PIN
  const unapprovedRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: pairReqJson.requestId }
  });
  assert(unapprovedRes.isError, 'pair_session rejected unapproved request without PIN');
  assert(
    unapprovedRes.content[0].text.includes('pending user approval'),
    'Error indicates pending desktop user approval'
  );

  // Test 14A: Imposter client cannot claim pairing request
  const hijackRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: pairReqJson.requestId, pin: '000000', clientName: 'Untrusted-Bot' }
  });
  assert(hijackRes.isError, 'pair_session rejected client identity mismatch');
  assert(
    hijackRes.content[0].text.includes('Client identity mismatch'),
    'Explicit client identity mismatch error returned'
  );

  // Test 14B: Legitimate client with invalid PIN decrements remaining attempts
  const badPinRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: pairReqJson.requestId, pin: '000000', clientName: 'AI-Audit-Agent' }
  });
  assert(badPinRes.isError, 'pair_session rejected invalid PIN');
  assert(
    badPinRes.content[0].text.includes('Invalid PIN. 3 attempt(s) remaining.'),
    'Invalid PIN error message shows correct remaining attempts'
  );

  // Test 15: pair_session brute-force lockout after repeated incorrect attempts
  await client.callTool({ name: 'pair_session', arguments: { requestId: pairReqJson.requestId, pin: '000001', clientName: 'AI-Audit-Agent' } });
  await client.callTool({ name: 'pair_session', arguments: { requestId: pairReqJson.requestId, pin: '000002', clientName: 'AI-Audit-Agent' } });
  const lockoutRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: pairReqJson.requestId, pin: '000003', clientName: 'AI-Audit-Agent' }
  });
  assert(lockoutRes.isError, 'Brute-force lockout triggered after 4 incorrect attempts');
  assert(
    lockoutRes.content[0].text.includes('Too many incorrect PIN attempts'),
    'Lockout message verified'
  );

  // Test 16: Path A - Desktop UI approval enables pairing without PIN
  const reqARes: any = await client.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Desktop-Approved-Agent', requestedTier: 3 }
  });
  const reqA = JSON.parse(reqARes.content[0].text);
  assert(reqA.requestId, 'Path A request created');

  // Desktop user clicks "Approve Access"
  const approved = pairingManager.approveRequest(reqA.requestId);
  assert(approved, 'Desktop user approved request in UI');

  const pairSuccessA: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: reqA.requestId }
  });
  assert(!pairSuccessA.isError, 'pair_session succeeded with desktop approval (no PIN required)');
  const pairSuccessAJson = JSON.parse(pairSuccessA.content[0].text);
  assert(pairSuccessAJson.success, 'Pairing marked as success');
  assert(
    typeof pairSuccessAJson.sessionToken === 'string' && pairSuccessAJson.sessionToken.length >= 64,
    'High-entropy 64-char session token issued upon desktop approval'
  );

  // Test 17: get_pairing_status verification and permission tier enforcement
  const statusRes: any = await client.callTool({
    name: 'get_pairing_status',
    arguments: { token: pairSuccessAJson.sessionToken }
  });
  const statusJson = JSON.parse(statusRes.content[0].text);
  assert(statusJson.valid, 'Active session token verified by get_pairing_status');
  assertEqual(statusJson.session.clientName, 'Desktop-Approved-Agent', 'Session clientName preserved');
  assert(pairingManager.isTierAllowed(pairSuccessAJson.sessionToken, 0), 'Tier 0 permitted');
  assert(pairingManager.isTierAllowed(pairSuccessAJson.sessionToken, 1), 'Tier 1 permitted');
  assert(pairingManager.isTierAllowed(pairSuccessAJson.sessionToken, 2), 'Tier 2 permitted');
  assert(pairingManager.isTierAllowed(pairSuccessAJson.sessionToken, 3), 'Tier 3 permitted');
  assert(!pairingManager.isTierAllowed(pairSuccessAJson.sessionToken, 4), 'Tier 4 denied without admin grant');
  assert(!pairingManager.isTierAllowed('invalid-token-12345', 3), 'Invalid token denied for Tier 3');
  assert(!pairingManager.isTierAllowed(undefined, 3), 'Undefined token denied for Tier 3');

  // Test 18: Path B - Out-of-band PIN verification
  const reqBRes: any = await client.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Pin-Verified-Agent', requestedTier: 3 }
  });
  const reqB = JSON.parse(reqBRes.content[0].text);

  // Desktop screen displays the 6-digit PIN
  const pendingRequests = pairingManager.getPendingRequests();
  const matchB = pendingRequests.find(r => r.requestId === reqB.requestId);
  assert(matchB !== undefined, 'Pending request found on desktop side');
  assert(/^\d{6}$/.test(matchB!.pin), `Desktop screen displays 6-digit PIN (${matchB?.pin})`);

  const pairSuccessB: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: reqB.requestId, pin: matchB!.pin }
  });
  assert(!pairSuccessB.isError, 'pair_session succeeded with desktop-displayed PIN');
  const pairSuccessBJson = JSON.parse(pairSuccessB.content[0].text);
  assert(pairSuccessBJson.success, 'PIN-verified session issued');

  // Test 19: Path C - Desktop User Denial
  const reqCRes: any = await client.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Denied-Agent', requestedTier: 3 }
  });
  const reqC = JSON.parse(reqCRes.content[0].text);
  const denied = pairingManager.denyRequest(reqC.requestId);
  assert(denied, 'Desktop user clicked "Deny" in UI');

  const pairDeniedRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: reqC.requestId }
  });
  assert(pairDeniedRes.isError, 'pair_session rejected denied request');
  assert(
    pairDeniedRes.content[0].text.includes('denied by the user in the desktop application'),
    'Explicit desktop denial error message returned'
  );

  // Test 20: Individual Session Revocation
  const revokedOne = pairingManager.revokeSession(pairSuccessBJson.sessionToken);
  assert(revokedOne, 'Individual session token successfully revoked');
  assert(
    !pairingManager.isTierAllowed(pairSuccessBJson.sessionToken, 3),
    'Revoked session no longer permitted for Tier 3'
  );

  // Test 21: Emergency Kill Switch (revokeAllSessions)
  pairingManager.revokeAllSessions();
  const killedStatusRes: any = await client.callTool({
    name: 'get_pairing_status',
    arguments: { token: pairSuccessAJson.sessionToken }
  });
  const killedStatusJson = JSON.parse(killedStatusRes.content[0].text);
  assert(!killedStatusJson.valid, 'Emergency Kill Switch successfully invalidated active session');
  assertEqual(pairingManager.getActiveSessions().length, 0, 'All active sessions cleared');
  assertEqual(pairingManager.getPendingRequests().length, 0, 'All pending requests cleared');

  // Test 22: Control Bridge NdjsonFramer message framing and chunking
  const framer = new NdjsonFramer();
  const receivedMessages: any[] = [];
  const parseErrors: any[] = [];
  framer.on('message', msg => receivedMessages.push(msg));
  framer.on('parseError', err => parseErrors.push(err));

  framer.handleData(Buffer.from('{"type":"PAIR'));
  assertEqual(receivedMessages.length, 0, 'Incomplete JSON chunk yields 0 messages');

  framer.handleData(Buffer.from('ING_REQUEST","payload":{"req":1}}\n{"type":"REV'));
  assertEqual(receivedMessages.length, 1, 'Completed newline delimited message parsed correctly');
  assertEqual(receivedMessages[0].type, 'PAIRING_REQUEST', 'First parsed message type matches');

  framer.handleData(Buffer.from('OKE_ALL_SESSIONS"}\n'));
  assertEqual(receivedMessages.length, 2, 'Second message parsed correctly after split chunk');
  assertEqual(receivedMessages[1].type, 'REVOKE_ALL_SESSIONS', 'Second parsed message type matches');

  // ---------------------------------------------------------
  // Tier 3 Controlled Device Input Tests (Stage 2 & Stage 4)
  // ---------------------------------------------------------

  // Setup Tier 3 session token for testing input operations
  const reqTier3Res: any = await client.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Tier3-Automation-Agent', requestedTier: 3 }
  });
  const reqTier3 = JSON.parse(reqTier3Res.content[0].text);
  pairingManager.approveRequest(reqTier3.requestId);
  const pairTier3Res: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: reqTier3.requestId, clientName: 'Tier3-Automation-Agent' }
  });
  const tier3Token = JSON.parse(pairTier3Res.content[0].text).sessionToken;
  assert(typeof tier3Token === 'string' && tier3Token.length >= 64, 'Active Tier 3 session token issued');

  // Setup Tier 2 session token (insufficient permission for input)
  const reqTier2Res: any = await client.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Tier2-ReadOnly-Agent', requestedTier: 2 }
  });
  const reqTier2 = JSON.parse(reqTier2Res.content[0].text);
  pairingManager.approveRequest(reqTier2.requestId);
  const pairTier2Res: any = await client.callTool({
    name: 'pair_session',
    arguments: { requestId: reqTier2.requestId, clientName: 'Tier2-ReadOnly-Agent' }
  });
  const tier2Token = JSON.parse(pairTier2Res.content[0].text).sessionToken;

  // Test 23: tap success with valid token and coordinates
  executedAdbArgs.length = 0;
  capturedAudits.length = 0;
  const tapRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 540, y: 1200, token: tier3Token }
  });
  assert(!tapRes.isError, 'tap executed successfully with Tier 3 token');
  const tapJson = JSON.parse(tapRes.content[0].text);
  assert(tapJson.success, 'tap returned success=true');
  assertEqual(tapJson.x, 540, 'tap coordinate X matches');
  assertEqual(tapJson.y, 1200, 'tap coordinate Y matches');
  assert(
    executedAdbArgs.some(a => a.join(' ').includes('shell input tap 540 1200')),
    'ADB shell input tap command invoked with fixed argument array'
  );

  // Test 24: tap rejects missing, invalid, and insufficient permission tokens
  const tapNoTokRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 540, y: 1200, token: '' }
  });
  assert(tapNoTokRes.isError, 'tap rejected empty token');
  assert(tapNoTokRes.content[0].text.includes('Tier 3'), 'Requires Tier 3 permission');

  const tapBadTokRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 540, y: 1200, token: 'fake-token-12345' }
  });
  assert(tapBadTokRes.isError, 'tap rejected invalid token');

  const tapTier2Res: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 540, y: 1200, token: tier2Token }
  });
  assert(tapTier2Res.isError, 'tap rejected Tier 2 token (insufficient privileges)');

  // Test 25: tap rejects invalid serials and disconnected devices
  const tapBadSerialRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'serial; reboot', x: 100, y: 100, token: tier3Token }
  });
  assert(tapBadSerialRes.isError, 'tap rejected command injection in serial');

  const tapNotFoundRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'nonexistent_serial_123', x: 100, y: 100, token: tier3Token }
  });
  assert(tapNotFoundRes.isError, 'tap rejected non-existent device');

  // Test 26: tap rejects out-of-bounds coordinates
  const tapOutOfBoundsRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 1500, y: 3000, token: tier3Token }
  });
  assert(tapOutOfBoundsRes.isError, 'tap rejected out-of-bounds coordinates (1500, 3000)');
  assert(
    tapOutOfBoundsRes.content[0].text.includes('Out-of-bounds'),
    'Detailed bounds error returned'
  );

  // Test 27: tap handles execution timeout
  const tapTimeoutRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 9999, y: 9999, token: tier3Token }
  });
  assert(tapTimeoutRes.isError, 'tap handles command timeout safely');

  // Test 28: swipe success
  executedAdbArgs.length = 0;
  const swipeRes: any = await client.callTool({
    name: 'swipe',
    arguments: { serial: 'EXAMPLE0SERIAL01', x1: 500, y1: 1500, x2: 500, y2: 300, durationMs: 400, token: tier3Token }
  });
  assert(!swipeRes.isError, 'swipe executed successfully');
  const swipeJson = JSON.parse(swipeRes.content[0].text);
  assert(swipeJson.success, 'swipe returned success=true');
  assert(
    executedAdbArgs.some(a => a.join(' ').includes('shell input swipe 500 1500 500 300 400')),
    'ADB swipe executed with verified coordinates and duration'
  );

  // Test 29: swipe rejects invalid duration and out-of-bounds coordinates
  const swipeFastRes: any = await client.callTool({
    name: 'swipe',
    arguments: { serial: 'EXAMPLE0SERIAL01', x1: 100, y1: 100, x2: 200, y2: 200, durationMs: 20, token: tier3Token }
  });
  assert(swipeFastRes.isError, 'swipe rejected duration under 50ms');

  const swipeBadEndRes: any = await client.callTool({
    name: 'swipe',
    arguments: { serial: 'EXAMPLE0SERIAL01', x1: 100, y1: 100, x2: 2000, y2: 5000, durationMs: 300, token: tier3Token }
  });
  assert(swipeBadEndRes.isError, 'swipe rejected out-of-bounds endpoint coordinates');

  // Test 30: keyevent success (BACK key = 4)
  executedAdbArgs.length = 0;
  const keyRes: any = await client.callTool({
    name: 'keyevent',
    arguments: { serial: 'EXAMPLE0SERIAL01', keyCode: 4, token: tier3Token }
  });
  assert(!keyRes.isError, 'keyevent executed successfully for keyCode 4');
  assert(
    executedAdbArgs.some(a => a.join(' ').includes('shell input keyevent 4')),
    'ADB keyevent invoked with keycode 4'
  );

  // Test 31: keyevent rejects invalid keycode and handles vendor ROM permissions
  const keyNegativeRes: any = await client.callTool({
    name: 'keyevent',
    arguments: { serial: 'EXAMPLE0SERIAL01', keyCode: -5, token: tier3Token }
  });
  assert(keyNegativeRes.isError, 'keyevent rejected negative keycode');

  const keyHugeRes: any = await client.callTool({
    name: 'keyevent',
    arguments: { serial: 'EXAMPLE0SERIAL01', keyCode: 9999, token: tier3Token }
  });
  assert(keyHugeRes.isError, 'keyevent rejected keycode > 300');

  const keyMiuiRes: any = await client.callTool({
    name: 'keyevent',
    arguments: { serial: 'EXAMPLE0SERIAL01', keyCode: 82, token: tier3Token }
  });
  assert(keyMiuiRes.isError, 'keyevent handles vendor ROM injection permission denial');
  assert(
    keyMiuiRes.content[0].text.includes('USB debugging (Security Settings)'),
    'Vendor ROM permission error guides user to enable security settings'
  );

  // Test 32: input_text success with spaces encoded as %s
  executedAdbArgs.length = 0;
  const textRes: any = await client.callTool({
    name: 'input_text',
    arguments: { serial: 'EXAMPLE0SERIAL01', text: 'Hello World 2026', token: tier3Token }
  });
  assert(!textRes.isError, 'input_text executed successfully');
  const textJson = JSON.parse(textRes.content[0].text);
  assert(textJson.success, 'input_text returned success=true');
  assertEqual(textJson.length, 16, 'Character length verified');
  assert(
    executedAdbArgs.some(a => a.join(' ').includes('shell input text Hello%sWorld%s2026')),
    'ADB input text encoded spaces as %s'
  );

  // Test 33: input_text rejects shell injection attempts
  const textSemicolonRes: any = await client.callTool({
    name: 'input_text',
    arguments: { serial: 'EXAMPLE0SERIAL01', text: 'test; rm -rf /', token: tier3Token }
  });
  assert(textSemicolonRes.isError, 'input_text rejected semicolon injection');

  const textPipeRes: any = await client.callTool({
    name: 'input_text',
    arguments: { serial: 'EXAMPLE0SERIAL01', text: 'test | whoami', token: tier3Token }
  });
  assert(textPipeRes.isError, 'input_text rejected pipe injection');

  const textDollarRes: any = await client.callTool({
    name: 'input_text',
    arguments: { serial: 'EXAMPLE0SERIAL01', text: 'hello $(calc.exe)', token: tier3Token }
  });
  assert(textDollarRes.isError, 'input_text rejected command substitution injection');

  // Test 34: input_text rejects Unicode / non-ASCII gracefully
  const textUnicodeRes: any = await client.callTool({
    name: 'input_text',
    arguments: { serial: 'EXAMPLE0SERIAL01', text: 'Café au lait', token: tier3Token }
  });
  assert(textUnicodeRes.isError, 'input_text rejected Unicode text');
  assert(
    textUnicodeRes.content[0].text.includes('only supports ASCII characters'),
    'Explicit ASCII explanation returned for Unicode'
  );

  const textEmojiRes: any = await client.callTool({
    name: 'input_text',
    arguments: { serial: 'EXAMPLE0SERIAL01', text: 'Hello 😊', token: tier3Token }
  });
  assert(textEmojiRes.isError, 'input_text rejected emoji input');

  // Test 35: Action audit log redaction and integrity
  assert(capturedAudits.length > 0, `Captured action audit events (${capturedAudits.length})`);
  // Verify NO audit contains raw text payload or session token
  const hasRawSensitiveData = capturedAudits.some(a =>
    (a.details && (a.details.includes('Hello World 2026') || a.details.includes(tier3Token))) ||
    (a.error && a.error.includes(tier3Token))
  );
  assert(!hasRawSensitiveData, 'SECURITY: Action audit log strictly omits sensitive text and session tokens');

  // Verify audit events recorded correct statuses
  assert(capturedAudits.some(a => a.status === 'SUCCESS' && a.action === 'tap'), 'Tap recorded SUCCESS status');
  assert(capturedAudits.some(a => a.status === 'REJECTED' && a.action === 'tap'), 'Tap recorded REJECTED status for bad auth/bounds');
  assert(capturedAudits.some(a => a.status === 'SUCCESS' && a.action === 'input_text'), 'input_text recorded SUCCESS status');

  // Test 36: Revoked session rejects subsequent operations
  pairingManager.revokeSession(tier3Token);
  const revokedTapRes: any = await client.callTool({
    name: 'tap',
    arguments: { serial: 'EXAMPLE0SERIAL01', x: 500, y: 500, token: tier3Token }
  });
  assert(revokedTapRes.isError, 'tap rejected after session token was revoked');

  // Clean up
  await client.close();
  try {
    fs.rmSync(tempCapturesDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}

