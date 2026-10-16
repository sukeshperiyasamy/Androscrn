import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AndroScrnMcpServer } from '../../modules/mcp/server';
import { PairingManager } from '../../modules/mcp/pairing';
import { DeviceManager } from '../../modules/device_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';

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
      serial: 'kjizrsgekfsglvgi',
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

  // Mock diagnostic bundle
  diagnosticsManager.generateDiagnosticBundle = async () => {
    return '=== ANDROSCRN SYSTEM DIAGNOSTIC REPORT ===\nHost: win32 x64\nAdmin: support@androscrn.org with Bearer sec_tok_991827\nADB Version: 1.0.41';
  };

  // 2. Initialize MCP Server and Client
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

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

  await mcpServer.server.connect(serverTransport);
  await client.connect(clientTransport);

  // Test 1: Tool Listing
  const toolList = await client.listTools();
  assert(toolList.tools.length >= 8, `MCP Server exposes all required tools (Found: ${toolList.tools.length})`);

  const toolNames = toolList.tools.map(t => t.name);
  assert(toolNames.includes('list_devices'), 'Tool "list_devices" registered');
  assert(toolNames.includes('get_device_info'), 'Tool "get_device_info" registered');
  assert(toolNames.includes('get_logcat'), 'Tool "get_logcat" registered');
  assert(toolNames.includes('get_diagnostics'), 'Tool "get_diagnostics" registered');
  assert(toolNames.includes('capture_screenshot'), 'Tool "capture_screenshot" registered');
  assert(toolNames.includes('request_pairing'), 'Tool "request_pairing" registered');
  assert(toolNames.includes('pair_session'), 'Tool "pair_session" registered');
  assert(toolNames.includes('get_pairing_status'), 'Tool "get_pairing_status" registered');

  // Test 2: list_devices
  const devRes: any = await client.callTool({ name: 'list_devices', arguments: {} });
  assert(!devRes.isError, 'list_devices executed without error');
  const parsedDevices = JSON.parse(devRes.content[0].text);
  assertEqual(parsedDevices.length, 2, 'list_devices returned expected mock device count');
  assertEqual(parsedDevices[0].serial, 'kjizrsgekfsglvgi', 'list_devices first serial matches');

  // Test 3: get_device_info with valid serial
  const infoRes: any = await client.callTool({
    name: 'get_device_info',
    arguments: { serial: 'kjizrsgekfsglvgi' }
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
    arguments: { serial: 'kjizrsgekfsglvgi', lines: 10 }
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
    arguments: { serial: 'kjizrsgekfsglvgi', lines: 10, filterLevel: 'E' }
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
    arguments: { serial: 'kjizrsgekfsglvgi', format: 'base64' }
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

  // Test 12: Pairing Handshake - request_pairing
  const pairReqRes: any = await client.callTool({
    name: 'request_pairing',
    arguments: {}
  });
  assert(!pairReqRes.isError, 'request_pairing returned valid response');
  const pairReqJson = JSON.parse(pairReqRes.content[0].text);
  assert(/^\d{6}$/.test(pairReqJson.pairingPin), `Generated pairing PIN is a 6-digit number (${pairReqJson.pairingPin})`);
  assertEqual(pairReqJson.expiresInSeconds, 60, 'Pairing PIN TTL is 60 seconds');

  // Test 13: pair_session with invalid PIN
  const badPairRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { pin: '000000', clientName: 'Untrusted-Bot' }
  });
  assert(badPairRes.isError, 'pair_session rejected invalid PIN');
  assert(badPairRes.content[0].text.includes('Invalid PIN'), 'Invalid PIN error message returned');

  // Test 14: pair_session brute-force lockout
  await client.callTool({ name: 'pair_session', arguments: { pin: '000001' } });
  await client.callTool({ name: 'pair_session', arguments: { pin: '000002' } });
  const lockoutRes: any = await client.callTool({ name: 'pair_session', arguments: { pin: '000003' } });
  assert(lockoutRes.isError, 'Brute-force lockout triggered on 4th incorrect attempt');
  assert(lockoutRes.content[0].text.includes('Too many incorrect attempts'), 'Lockout message verified');

  // Test 15: pair_session success with fresh PIN
  const freshPinRes: any = await client.callTool({ name: 'request_pairing', arguments: {} });
  const freshPin = JSON.parse(freshPinRes.content[0].text).pairingPin;

  const validPairRes: any = await client.callTool({
    name: 'pair_session',
    arguments: { pin: freshPin, clientName: 'Verified-Agent' }
  });
  assert(!validPairRes.isError, 'pair_session succeeded with correct PIN');
  const validPairJson = JSON.parse(validPairRes.content[0].text);
  assert(validPairJson.success, 'Pairing marked as success');
  assert(validPairJson.sessionToken.length >= 64, 'High-entropy 64-char session token issued');

  // Test 16: get_pairing_status verification
  const statusRes: any = await client.callTool({
    name: 'get_pairing_status',
    arguments: { token: validPairJson.sessionToken }
  });
  const statusJson = JSON.parse(statusRes.content[0].text);
  assert(statusJson.valid, 'Active session token verified by get_pairing_status');
  assertEqual(statusJson.session.clientName, 'Verified-Agent', 'Session clientName preserved');

  // Test 17: Emergency Kill Switch (revokeAllSessions)
  pairingManager.revokeAllSessions();
  const killedStatusRes: any = await client.callTool({
    name: 'get_pairing_status',
    arguments: { token: validPairJson.sessionToken }
  });
  const killedStatusJson = JSON.parse(killedStatusRes.content[0].text);
  assert(!killedStatusJson.valid, 'Emergency Kill Switch successfully invalidated active session');

  // Clean up
  await client.close();
  try {
    fs.rmSync(tempCapturesDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}
