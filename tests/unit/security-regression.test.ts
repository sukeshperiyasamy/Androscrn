import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AndroScrnMcpServer } from '../../modules/mcp/server';
import { PairingManager } from '../../modules/mcp/pairing';
import { DeviceManager } from '../../modules/device_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';
import { SecurityValidator } from '../../modules/security';
import { NdjsonFramer, McpControlServer, McpControlClient } from '../../modules/mcp/control-bridge';

/**
 * Phase 3C: Security Regression Test Suite
 * Validates pairing expiration, single-use consumption, identity isolation,
 * token non-revivability, bounds boundaries, input sanitization,
 * audit log data leak prevention, and named-pipe message handling.
 */
export async function runSecurityRegressionTests(
  assert: (condition: boolean, testName: string) => void,
  assertEqual: <T>(actual: T, expected: T, testName: string) => void
) {
  console.log('\n==================================================');
  console.log('Test Group 12: MCP Security Regression Suite (Phase 3C)');
  console.log('==================================================');

  // -------------------------------------------------------------
  // Section A: Pairing & Identity Security Regressions
  // -------------------------------------------------------------
  console.log('\n--- Section A: Pairing & Identity Regressions ---');

  // Test A1: Pairing request expiration window
  // Use a short-lived PairingManager (50ms TTL)
  const shortTtlPairingManager = new PairingManager(50, 100);
  const reqExp = await shortTtlPairingManager.requestPairing('Expiring-Agent', 3);
  assert(reqExp.requestId !== undefined, 'Pairing request created with short TTL');
  
  // Wait for 70ms to allow expiration
  await new Promise(r => setTimeout(r, 70));
  
  const expPairRes = shortTtlPairingManager.pairSession(reqExp.requestId!, undefined, 'Expiring-Agent');
  assert(!expPairRes.success, 'Pairing request rejected after configured TTL expires');
  assert(
    expPairRes.error?.includes('expired') === true,
    'Specific expiration error message returned'
  );

  // Test A2: Single-use consumption (A pairing request CANNOT be consumed more than once)
  const freshManager = new PairingManager(60000, 30 * 60 * 1000);
  const reqOnce = await freshManager.requestPairing('SingleUse-Agent', 3);
  freshManager.approveRequest(reqOnce.requestId!);

  // First consumption: Should succeed
  const consume1 = freshManager.pairSession(reqOnce.requestId!, undefined, 'SingleUse-Agent');
  assert(consume1.success && typeof consume1.token === 'string', 'First pairSession call successfully consumed request');

  // Second consumption: MUST fail
  const consume2 = freshManager.pairSession(reqOnce.requestId!, undefined, 'SingleUse-Agent');
  assert(!consume2.success, 'SECURITY: Consumed pairing request cannot be reused (replay rejected)');
  assert(
    consume2.error?.includes('Invalid or expired') === true,
    'Error confirms pairing requestId is no longer valid after consumption'
  );

  // Test A3: Cross-client identity isolation
  // Client A requests pairing, Client B attempts to exchange it
  const reqIdentity = await freshManager.requestPairing('Legitimate-Client', 3);
  freshManager.approveRequest(reqIdentity.requestId!);

  const hijackAttempt = freshManager.pairSession(reqIdentity.requestId!, undefined, 'Attacker-Client');
  assert(!hijackAttempt.success, 'SECURITY: Client B cannot claim pairing request initiated by Client A');
  assert(
    hijackAttempt.error?.includes('Client identity mismatch') === true,
    'Explicit client identity mismatch error returned'
  );

  // Test A4: Invalid and malformed requestId rejection
  const badReq1 = freshManager.pairSession('non-existent-uuid-1234', undefined, 'Agent');
  assert(!badReq1.success, 'Non-existent requestId rejected');

  const badReq2 = freshManager.pairSession('', undefined, 'Agent');
  assert(!badReq2.success, 'Empty requestId rejected');

  // Test A5: Repeated failed PIN attempts trigger lockout
  const reqPinLock = await freshManager.requestPairing('PinLock-Agent', 3);
  // 4 bad attempts
  freshManager.pairSession(reqPinLock.requestId!, '000001', 'PinLock-Agent');
  freshManager.pairSession(reqPinLock.requestId!, '000002', 'PinLock-Agent');
  freshManager.pairSession(reqPinLock.requestId!, '000003', 'PinLock-Agent');
  const lockoutRes = freshManager.pairSession(reqPinLock.requestId!, '000004', 'PinLock-Agent');
  assert(!lockoutRes.success, 'Brute-force lockout triggered on 4th invalid attempt');
  assert(
    lockoutRes.error?.includes('Too many incorrect PIN attempts') === true,
    'Request invalidated after repeated incorrect PINs'
  );

  // Confirm request was deleted from memory
  const retryAfterLockout = freshManager.pairSession(reqPinLock.requestId!, '000000', 'PinLock-Agent');
  assert(!retryAfterLockout.success, 'Subsequent attempts after lockout are rejected as invalid/expired');

  // -------------------------------------------------------------
  // Section B: Session Authorization & Revocation Regressions
  // -------------------------------------------------------------
  console.log('\n--- Section B: Session Authorization & Revocation Regressions ---');

  // Test B1: Short-lived session token expiration
  const shortSessionManager = new PairingManager(60000, 60); // 60ms session TTL
  const reqShortSess = await shortSessionManager.requestPairing('ShortSession-Agent', 3);
  shortSessionManager.approveRequest(reqShortSess.requestId!);
  const pairShortSess = shortSessionManager.pairSession(reqShortSess.requestId!, undefined, 'ShortSession-Agent');
  const shortToken = pairShortSess.token!;

  assert(shortSessionManager.isTierAllowed(shortToken, 3), 'Token valid immediately after issuance');

  // Wait 80ms for session expiration
  await new Promise(r => setTimeout(r, 80));

  assert(!shortSessionManager.isTierAllowed(shortToken, 3), 'Token rejected after session TTL expires');
  assertEqual(shortSessionManager.getSession(shortToken), undefined, 'getSession returns undefined for expired token');

  // Test B2: Expired tokens CANNOT be revived by retrying
  assert(!shortSessionManager.isTierAllowed(shortToken, 3), 'Expired token remains invalid on retry (cannot be revived)');
  assertEqual(shortSessionManager.getActiveSessions().length, 0, 'Expired token was purged from active sessions map');

  // Test B3: Emergency kill switch invalidates all active sessions across multiple clients
  const multiClientManager = new PairingManager(60000, 3600000);
  
  const reqM1 = await multiClientManager.requestPairing('Client-Alpha', 3);
  multiClientManager.approveRequest(reqM1.requestId!);
  const tokenM1 = multiClientManager.pairSession(reqM1.requestId!, undefined, 'Client-Alpha').token!;

  const reqM2 = await multiClientManager.requestPairing('Client-Beta', 3);
  multiClientManager.approveRequest(reqM2.requestId!);
  const tokenM2 = multiClientManager.pairSession(reqM2.requestId!, undefined, 'Client-Beta').token!;

  assertEqual(multiClientManager.getActiveSessions().length, 2, 'Two active sessions registered');
  assert(multiClientManager.isTierAllowed(tokenM1, 3), 'Client-Alpha authorized');
  assert(multiClientManager.isTierAllowed(tokenM2, 3), 'Client-Beta authorized');

  // Trigger Emergency Revoke
  multiClientManager.revokeAllSessions();

  assertEqual(multiClientManager.getActiveSessions().length, 0, 'Emergency kill switch cleared all active sessions');
  assertEqual(multiClientManager.getPendingRequests().length, 0, 'Emergency kill switch cleared all pending requests');
  assert(!multiClientManager.isTierAllowed(tokenM1, 3), 'Client-Alpha immediately rejected after kill switch');
  assert(!multiClientManager.isTierAllowed(tokenM2, 3), 'Client-Beta immediately rejected after kill switch');

  // -------------------------------------------------------------
  // Section C: Input Validation & Boundary Regressions
  // -------------------------------------------------------------
  console.log('\n--- Section C: Input Validation & Boundary Regressions ---');

  // Setup Mock Device & Diagnostics Managers
  const mockAdbPath = path.resolve(__dirname, '../../bin/scrcpy-win64/adb.exe');
  const tempCapturesDir = path.resolve(__dirname, '../../Captures/test-regression');

  if (!fs.existsSync(tempCapturesDir)) {
    fs.mkdirSync(tempCapturesDir, { recursive: true });
  }

  const deviceManager = new DeviceManager(mockAdbPath);
  const diagnosticsManager = new DiagnosticsManager(deviceManager);
  const regressionPairingManager = new PairingManager(60000, 30 * 60 * 1000);

  deviceManager.getDevices = async () => [
    {
      serial: 'test-device-reg',
      state: 'device',
      model: 'TestPhone',
      product: 'test',
      device: 'test',
      transportType: 'usb',
      guidance: 'Ready'
    }
  ];

  deviceManager.getScreenSize = async (serial: string) => {
    if (serial === 'test-device-reg') {
      return { width: 1080, height: 2400 };
    }
    return null;
  };

  const executedAdbCommands: string[][] = [];
  deviceManager.executeAdb = async (args: string[]) => {
    executedAdbCommands.push(args);
    return { stdout: '', stderr: '', code: 0 };
  };

  const capturedAuditLogs: any[] = [];
  const server = new AndroScrnMcpServer(
    { name: 'regression-server', version: '1.0.0', capturesDir: tempCapturesDir },
    deviceManager,
    diagnosticsManager,
    regressionPairingManager
  );
  server.onActionAudit = audit => capturedAuditLogs.push(audit);

  const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'reg-client', version: '1.0.0' }, { capabilities: {} });

  await server.server.connect(sTransport);
  await mcpClient.connect(cTransport);

  // Create authorized Tier 3 token for input testing
  const regPairReq = await regressionPairingManager.requestPairing('Input-Tester', 3);
  regressionPairingManager.approveRequest(regPairReq.requestId!);
  const validTier3Token = regressionPairingManager.pairSession(regPairReq.requestId!, undefined, 'Input-Tester').token!;

  // Test C1: Coordinate Boundaries: (0, 0) is valid lower boundary
  const tapZero: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial: 'test-device-reg', x: 0, y: 0, token: validTier3Token }
  });
  assert(!tapZero.isError, 'Coordinate boundary (0, 0) accepted');

  // Test C2: Coordinate Boundaries: (width-1, height-1) is valid upper boundary
  const tapUpper: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial: 'test-device-reg', x: 1079, y: 2399, token: validTier3Token }
  });
  assert(!tapUpper.isError, 'Coordinate upper boundary (1079, 2399) accepted');

  // Test C3: Coordinate Boundaries: (width, height) is strictly out-of-bounds (0-indexed)
  const tapExactMax: any = await mcpClient.callTool({
    name: 'tap',
    arguments: { serial: 'test-device-reg', x: 1080, y: 2400, token: validTier3Token }
  });
  assert(tapExactMax.isError, 'Exact boundary (1080, 2400) rejected as out-of-bounds');
  assert(tapExactMax.content[0].text.includes('Out-of-bounds'), 'Out-of-bounds error message verified');

  // Test C4: Swipe duration boundaries (50ms is valid, 49ms is rejected, 10000ms is valid, 10001ms is rejected)
  const swipe50: any = await mcpClient.callTool({
    name: 'swipe',
    arguments: { serial: 'test-device-reg', x1: 100, y1: 100, x2: 200, y2: 200, durationMs: 50, token: validTier3Token }
  });
  assert(!swipe50.isError, 'Swipe duration boundary 50ms accepted');

  const swipe10000: any = await mcpClient.callTool({
    name: 'swipe',
    arguments: { serial: 'test-device-reg', x1: 100, y1: 100, x2: 200, y2: 200, durationMs: 10000, token: validTier3Token }
  });
  assert(!swipe10000.isError, 'Swipe duration boundary 10000ms accepted');

  const swipeTooLong: any = await mcpClient.callTool({
    name: 'swipe',
    arguments: { serial: 'test-device-reg', x1: 100, y1: 100, x2: 200, y2: 200, durationMs: 10001, token: validTier3Token }
  });
  assert(swipeTooLong.isError, 'Swipe duration 10001ms rejected');

  // Test C5: Keycode boundary values (0 is valid, 300 is valid, 301 is rejected)
  const key0: any = await mcpClient.callTool({
    name: 'keyevent',
    arguments: { serial: 'test-device-reg', keyCode: 0, token: validTier3Token }
  });
  assert(!key0.isError, 'Keycode boundary 0 accepted');

  const key300: any = await mcpClient.callTool({
    name: 'keyevent',
    arguments: { serial: 'test-device-reg', keyCode: 300, token: validTier3Token }
  });
  assert(!key300.isError, 'Keycode boundary 300 accepted');

  const key301: any = await mcpClient.callTool({
    name: 'keyevent',
    arguments: { serial: 'test-device-reg', keyCode: 301, token: validTier3Token }
  });
  assert(key301.isError, 'Keycode 301 rejected (> 300)');

  // Test C6: Comprehensive Shell Injection Character Matrix
  const shellMetachars = [';', '&', '|', '`', '$', '<', '>', '(', ')', '{', '}', '[', ']', '\\', '"'];
  let allMetacharsRejected = true;
  for (const char of shellMetachars) {
    const res: any = await mcpClient.callTool({
      name: 'input_text',
      arguments: { serial: 'test-device-reg', text: `test${char}injection`, token: validTier3Token }
    });
    if (!res.isError) {
      allMetacharsRejected = false;
      console.error(`FAILED to reject shell metacharacter: ${char}`);
    }
  }
  assert(allMetacharsRejected, 'SECURITY: All 15 shell metacharacters strictly rejected in input_text');

  // Test C7: Input text length boundary (500 chars accepted, 501 chars rejected)
  const text500 = 'A'.repeat(500);
  const text501 = 'A'.repeat(501);

  const res500: any = await mcpClient.callTool({
    name: 'input_text',
    arguments: { serial: 'test-device-reg', text: text500, token: validTier3Token }
  });
  assert(!res500.isError, 'Input text 500-char maximum length boundary accepted');

  const res501: any = await mcpClient.callTool({
    name: 'input_text',
    arguments: { serial: 'test-device-reg', text: text501, token: validTier3Token }
  });
  assert(res501.isError, 'Input text 501-char length rejected (> 500 characters)');

  // Test C8: Control character rejection (e.g. \r, \n, \t)
  const resNewline: any = await mcpClient.callTool({
    name: 'input_text',
    arguments: { serial: 'test-device-reg', text: 'Line1\nLine2', token: validTier3Token }
  });
  assert(resNewline.isError, 'Input text with control character newline (code 10) rejected');

  // -------------------------------------------------------------
  // Section D: Audit & Sensitive Data Leak Regressions
  // -------------------------------------------------------------
  console.log('\n--- Section D: Audit & Sensitive Data Leak Regressions ---');

  // Verify that all captured audit records strictly omit sensitive tokens and payloads
  assert(capturedAuditLogs.length > 0, `Audit records produced during test run: ${capturedAuditLogs.length}`);
  
  const leakedRecord = capturedAuditLogs.find(a => {
    const stringified = JSON.stringify(a);
    return (
      stringified.includes(validTier3Token) ||
      stringified.includes('test;injection') ||
      stringified.includes(text500)
    );
  });
  assert(leakedRecord === undefined, 'SECURITY REGRESSION: Audit records strictly omit session tokens and text payloads');

  // Verify audit records have valid timestamp and actionId
  const allRecordsHaveMetadata = capturedAuditLogs.every(a => 
    typeof a.action === 'string' &&
    ['PENDING', 'SUCCESS', 'FAILED', 'REJECTED'].includes(a.status)
  );
  assert(allRecordsHaveMetadata, 'All audit records contain valid action and status fields');

  // -------------------------------------------------------------
  // Section E: Named-Pipe IPC Protocol & Framing Regressions
  // -------------------------------------------------------------
  console.log('\n--- Section E: Named-Pipe IPC Protocol Regressions ---');

  const pipeFramer = new NdjsonFramer();
  const pipeMsgs: any[] = [];
  const pipeErrors: any[] = [];

  pipeFramer.on('message', m => pipeMsgs.push(m));
  pipeFramer.on('parseError', (err, raw) => pipeErrors.push({ err, raw }));

  // Test E1: Malformed JSON handling without crashing
  pipeFramer.handleData('{ corrupt json string\n');
  assertEqual(pipeErrors.length, 1, 'Malformed JSON emits parseError without uncaught exception');
  assertEqual(pipeMsgs.length, 0, 'No message emitted for corrupted JSON line');

  // Test E2: Fragmented multiple frames across chunks
  pipeFramer.handleData('{"type":"PING"}\n{"type":"PO');
  assertEqual(pipeMsgs.length, 1, 'First complete message parsed from multi-message chunk');
  assertEqual(pipeMsgs[0].type, 'PING', 'First message type is PING');

  pipeFramer.handleData('NG"}\n');
  assertEqual(pipeMsgs.length, 2, 'Second message parsed after boundary chunk completion');
  assertEqual(pipeMsgs[1].type, 'PONG', 'Second message type is PONG');

  // Test E3: Empty lines and whitespace-only chunks ignored safely
  pipeFramer.handleData('   \n\n\n');
  assertEqual(pipeMsgs.length, 2, 'Whitespace lines safely ignored without errors');

  // -------------------------------------------------------------
  // Section F: Phase 3D IPC Protocol Hardening & Race Regressions
  // -------------------------------------------------------------
  console.log('\n--- Section F: Phase 3D IPC Protocol Hardening & Race Regressions ---');

  // Test F1: Maximum message buffer limit defense (NdjsonFramer)
  const cappedFramer = new NdjsonFramer(100);
  let capError: any = null;
  cappedFramer.on('parseError', err => {
    capError = err;
  });
  cappedFramer.handleData('A'.repeat(150));
  assert(capError !== null, 'NdjsonFramer emits parseError when buffer exceeds maxMessageBytes');
  assert(
    capError?.message?.includes('exceeded limit') === true,
    'Buffer overflow error indicates payload exceeded maximum limit'
  );

  // Test F2: Oversized single line rejection (NdjsonFramer)
  const lineFramer = new NdjsonFramer(60);
  let lineError: any = null;
  lineFramer.on('parseError', err => {
    lineError = err;
  });
  lineFramer.handleData('{"type":"TEST","data":"' + 'X'.repeat(80) + '"}\n');
  assert(lineError !== null, 'NdjsonFramer rejects individual message lines exceeding maxMessageBytes');

  // Test F3: Non-object or missing type JSON shapes rejected safely
  const shapeFramer = new NdjsonFramer(1024);
  const shapeErrors: any[] = [];
  shapeFramer.on('parseError', err => {
    shapeErrors.push(err);
  });
  shapeFramer.handleData('12345\n');
  shapeFramer.handleData('"plain string"\n');
  shapeFramer.handleData('[1, 2, 3]\n');
  shapeFramer.handleData('{"data":"no type"}\n');
  assertEqual(shapeErrors.length, 4, 'NdjsonFramer safely rejects primitive, array, and missing-type JSON frames');

  // Test F4: TOCTOU Race Condition: Revocation between initial authorization and device execution
  // Set up dedicated MCP server with intercepted getScreenSize that revokes the session in-flight
  const racePairingManager = new PairingManager(60000, 30 * 60 * 1000);
  const raceDeviceManager = new DeviceManager(mockAdbPath);
  raceDeviceManager.getDevices = async () => [
    {
      serial: 'race-device-01',
      state: 'device',
      model: 'RacePhone',
      product: 'race',
      device: 'race',
      transportType: 'usb',
      guidance: 'Ready'
    }
  ];
  let inFlightAdbExecuted = false;
  raceDeviceManager.executeAdb = async (args: string[]) => {
    inFlightAdbExecuted = true;
    return { stdout: '', stderr: '', code: 0 };
  };

  const raceMcpServer = new AndroScrnMcpServer(
    { name: 'race-server', version: '1.0.0', capturesDir: tempCapturesDir },
    raceDeviceManager,
    diagnosticsManager,
    racePairingManager
  );
  const [raceClientTransport, raceServerTransport] = InMemoryTransport.createLinkedPair();
  await raceMcpServer.server.connect(raceServerTransport);

  const raceMcpClient = new Client({ name: 'race-test-client', version: '1.0.0' }, { capabilities: {} });
  await raceMcpClient.connect(raceClientTransport);

  const racePairReq = await racePairingManager.requestPairing('Race-Agent', 3);
  racePairingManager.approveRequest(racePairReq.requestId!);
  const raceSession = racePairingManager.pairSession(racePairReq.requestId!, undefined, 'Race-Agent');
  const raceToken = raceSession.token!;

  // Simulate in-flight revocation during async screen query
  raceDeviceManager.getScreenSize = async (serial: string) => {
    // Revoke the session mid-operation
    racePairingManager.revokeAllSessions();
    return { width: 1080, height: 2400 };
  };

  const raceTapRes: any = await raceMcpClient.callTool({
    name: 'tap',
    arguments: { serial: 'race-device-01', x: 200, y: 300, token: raceToken }
  });
  assert(raceTapRes.isError === true, 'SECURITY: In-flight revoked session is rejected prior to ADB execution (TOCTOU defense)');
  assert(
    raceTapRes.content[0].text.includes('revoked or expired prior to execution dispatch'),
    'Error message confirms pre-dispatch authorization check aborted execution'
  );
  assert(!inFlightAdbExecuted, 'ADB command was NOT dispatched to the device after in-flight revocation');

  // Test F5: Concurrent pairing attempts on the same requestId
  const concurrentManager = new PairingManager(60000, 30 * 60 * 1000);
  const concReq = await concurrentManager.requestPairing('Concurrent-Agent', 3);
  concurrentManager.approveRequest(concReq.requestId!);

  const [pResult1, pResult2] = await Promise.all([
    Promise.resolve(concurrentManager.pairSession(concReq.requestId!, undefined, 'Concurrent-Agent')),
    Promise.resolve(concurrentManager.pairSession(concReq.requestId!, undefined, 'Concurrent-Agent'))
  ]);

  const successCount = (pResult1.success ? 1 : 0) + (pResult2.success ? 1 : 0);
  assertEqual(successCount, 1, 'Exactly one concurrent pairing request succeeds; duplicate/race attempts are rejected');

  // Test F6: McpControlServer static limits & client connection bounding
  assertEqual(McpControlServer.MAX_CLIENTS, 10, 'McpControlServer enforces maximum 10 concurrent clients');
  assertEqual(McpControlServer.MAX_PENDING_REQUESTS, 25, 'McpControlServer enforces maximum 25 pending requests');
  assertEqual(McpControlServer.MAX_AUDIT_LOGS, 50, 'McpControlServer bounds audit event buffer to 50 items');

  // Test F7: Unexpected pipe server shutdown and client disconnect cleanup
  const testPipeName = `\\\\.\\pipe\\androscrn-test-f7-${Date.now()}`;
  const testServer = new McpControlServer(testPipeName);
  await testServer.start();

  const testClient = new McpControlClient(testPipeName);
  const connectOk = await testClient.connect(3000);
  assert(connectOk, 'McpControlClient successfully established connection to test pipe');

  // Shutdown server abruptly
  await testServer.stop();
  // Client close cleans up listeners and resources safely
  testClient.close();
  assert(!testClient.isConnected(), 'McpControlClient closed and cleanly dissociated from defunct pipe');

  await raceMcpClient.close();

  // Clean up
  await mcpClient.close();
  try {
    fs.rmSync(tempCapturesDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
}
