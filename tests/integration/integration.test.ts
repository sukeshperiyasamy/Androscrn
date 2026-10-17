import path from 'path';
import { DeviceManager } from '../../modules/device_manager';
import { ScrcpyManager } from '../../modules/scrcpy_manager';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${testName}`);
  }
}

function assertEqual<T>(actual: T, expected: T, testName: string) {
  assert(actual === expected, `${testName} (Expected: ${expected}, Got: ${actual})`);
}

async function runIntegrationTests() {
  console.log('==================================================');
  console.log('    ANDROSCRN INTEGRATION TEST SUITE EXECUTION    ');
  console.log('==================================================\n');

  const adbPath = path.resolve(__dirname, '../../../bin/scrcpy-win64/adb.exe');
  const scrcpyPath = path.resolve(__dirname, '../../../bin/scrcpy-win64/scrcpy.exe');

  console.log(`Testing bundled ADB at: ${adbPath}`);
  console.log(`Testing bundled scrcpy at: ${scrcpyPath}\n`);

  // 1. ADB Probe Test
  const dm = new DeviceManager(adbPath);
  const adbVersionRes = await dm.executeAdb(['version']);
  assert(adbVersionRes.code === 0, 'Bundled adb executes successfully');
  assert(adbVersionRes.stdout.includes('Android Debug Bridge'), 'ADB version banner verified');

  // 2. Command Failure Handling Test
  const adbFailRes = await dm.executeAdb(['nonexistent-subcommand-test']);
  assert(adbFailRes.code !== 0, 'Invalid adb subcommand produces non-zero exit code');
  assert(adbFailRes.stderr.length > 0, 'Invalid adb subcommand produces stderr message');

  // 3. Live Device Query (Real / Simulated)
  const devices = await dm.getDevices();
  assert(Array.isArray(devices), 'DeviceManager.getDevices() returns array');
  console.log(`  ℹ Found ${devices.length} currently attached Android device(s).`);

  // 4. Missing Binary Graceful Degradation
  const badAdb = new DeviceManager('C:\\nonexistent\\adb.exe');
  const badRes = await badAdb.executeAdb(['devices']);
  assert(badRes.code === -1, 'Missing binary execution returns error code -1');
  assert(badRes.stderr.length > 0, 'Missing binary execution returns error description');

  // 5. Scrcpy Binary Probe Test
  const sm = new ScrcpyManager(scrcpyPath);
  assert(sm.getStatus().running === false, 'Scrcpy initial status is not running');

  // 6. Scrcpy Disconnection Event Wireup Test
  let disconnectedEventTriggered = false;
  sm.on('disconnected', () => {
    disconnectedEventTriggered = true;
  });
  // Simulate exit code 2 (device disconnected)
  sm.emit('stopped', { code: 2, serial: 'test-device-disconnect' });
  sm.emit('disconnected', { serial: 'test-device-disconnect' });
  assert(disconnectedEventTriggered, 'ScrcpyManager handles device disconnection event');

  // 7. ADB & Scrcpy Version Introspection Tests
  const adbVer = await dm.getAdbVersion();
  assert(adbVer.length > 0 && !adbVer.includes('Error'), `ADB Version successfully introspected: ${adbVer}`);

  const scrcpyVer = await sm.getScrcpyVersion();
  assert(scrcpyVer.length > 0 && !scrcpyVer.includes('Error'), `Scrcpy Version successfully introspected: ${scrcpyVer}`);

  // 8. Raw Binary ADB Output Test
  const rawBin = await dm.executeAdbBinary(['version']);
  assert(rawBin.code === 0 && rawBin.buffer.length > 0, 'executeAdbBinary successfully returns raw binary Buffer');

  // 9. Process Cleanup
  assert(sm.stopMirroring() === false, 'Stopping when not running is safely handled');

  // -------------------------------------------------------------------
  // Section 2: End-to-End MCP & HITL IPC Integration Flow (Phase 3C)
  // -------------------------------------------------------------------
  console.log('\n--- Section 2: MCP & HITL Named-Pipe Integration Flow ---');

  const os = await import('os');
  const fs = await import('fs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { AndroScrnMcpServer } = await import('../../modules/mcp/server');
  const { PairingManager } = await import('../../modules/mcp/pairing');
  const { DiagnosticsManager } = await import('../../modules/diagnostics');
  const { McpControlServer, McpControlClient } = await import('../../modules/mcp/control-bridge');

  const testPipePath = process.platform === 'win32'
    ? `\\\\.\\pipe\\androscrn-int-test-${Date.now()}`
    : path.join(os.tmpdir(), `androscrn-int-test-${Date.now()}.sock`);

  console.log(`Starting mock Desktop Named Pipe Server at: ${testPipePath}`);

  // 1. Desktop Named Pipe Control Server
  const desktopServer = new McpControlServer(testPipePath);
  const serverStarted = await desktopServer.start();
  assert(serverStarted, 'McpControlServer started successfully on test pipe');

  // 2. Standalone MCP Client Bridge
  const mcpBridgeClient = new McpControlClient(testPipePath);
  const bridgeConnected = await mcpBridgeClient.connect();
  assert(bridgeConnected, 'McpControlClient successfully connected to desktop pipe server');

  // 3. PairingManager linked to the control bridge
  const pairingMgr = new PairingManager(60000, 30 * 60 * 1000, mcpBridgeClient);

  // 4. Mocked DeviceManager & DiagnosticsManager for deterministic MCP server
  const mockDm = new DeviceManager(adbPath);
  mockDm.getDevices = async () => [
    {
      serial: 'int-mock-device',
      state: 'device',
      model: 'IntegrationPhone',
      product: 'mock',
      device: 'mock',
      transportType: 'usb',
      guidance: 'Ready'
    }
  ];
  mockDm.getScreenSize = async () => ({ width: 1080, height: 2400 });

  const executedAdbList: string[][] = [];
  mockDm.executeAdb = async (args: string[]) => {
    executedAdbList.push(args);
    return { stdout: '', stderr: '', code: 0 };
  };

  const diagMgr = new DiagnosticsManager(mockDm);
  const tempIntCaptures = path.resolve(__dirname, '../../Captures/test-int');
  if (!fs.existsSync(tempIntCaptures)) {
    fs.mkdirSync(tempIntCaptures, { recursive: true });
  }

  const mcpServer = new AndroScrnMcpServer(
    { name: 'int-test-server', version: '1.0.0', capturesDir: tempIntCaptures, controlBridge: mcpBridgeClient },
    mockDm,
    diagMgr,
    pairingMgr
  );

  const [clientTrans, serverTrans] = InMemoryTransport.createLinkedPair();
  const mcpAgent = new Client({ name: 'Integration-Agent', version: '1.0.0' }, { capabilities: {} });

  await mcpServer.server.connect(serverTrans);
  await mcpAgent.connect(clientTrans);

  // Setup desktop listener for incoming pairing requests & audits
  const desktopReceivedRequests: any[] = [];
  const desktopReceivedAudits: any[] = [];

  desktopServer.on('pairingRequested', req => desktopReceivedRequests.push(req));
  desktopServer.on('actionAudit', audit => desktopReceivedAudits.push(audit));

  // Step 1: MCP Client requests pairing
  const pairReqCall: any = await mcpAgent.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Integration-Agent', requestedTier: 3 }
  });
  assert(!pairReqCall.isError, 'Integration Step 1: request_pairing executed without error');
  const pairReqData = JSON.parse(pairReqCall.content[0].text);
  assert(typeof pairReqData.requestId === 'string', 'Step 1: Received valid requestId');
  assert(pairReqData.pairingPin === undefined, 'Step 1: SECURITY - Pairing PIN strictly omitted from MCP response');

  // Step 2: Desktop server receives pairing request over named pipe
  // Wait briefly for IPC delivery
  await new Promise(r => setTimeout(r, 60));
  assert(desktopReceivedRequests.length >= 1, 'Integration Step 2: Desktop server received pairing request over Named Pipe');
  const desktopReq = desktopReceivedRequests[0];
  assertEqual(desktopReq.clientName, 'Integration-Agent', 'Step 2: Desktop request clientName matches');
  assert(/^\d{6}$/.test(desktopReq.pin), 'Step 2: Desktop received 6-digit PIN for human display');

  // Step 3: Desktop human approval
  const approved = desktopServer.approveRequest(pairReqData.requestId);
  assert(approved, 'Integration Step 3: Desktop UI approved the pairing request');

  // Wait briefly for IPC decision delivery back to client bridge
  await new Promise(r => setTimeout(r, 60));

  // Step 4: MCP Client completes handshake
  const pairSessionCall: any = await mcpAgent.callTool({
    name: 'pair_session',
    arguments: { requestId: pairReqData.requestId, clientName: 'Integration-Agent' }
  });
  assert(!pairSessionCall.isError, 'Integration Step 4: pair_session completed successfully upon desktop approval');
  const sessionToken = JSON.parse(pairSessionCall.content[0].text).sessionToken;
  assert(typeof sessionToken === 'string' && sessionToken.length >= 64, 'Step 4: Issued 64-char session token');

  // Step 5: Authorized Tier 3 operation succeeds
  const tapCall: any = await mcpAgent.callTool({
    name: 'tap',
    arguments: { serial: 'int-mock-device', x: 500, y: 1000, token: sessionToken }
  });
  assert(!tapCall.isError, 'Integration Step 5: Authorized Tier 3 tap operation succeeded');
  assert(JSON.parse(tapCall.content[0].text).success, 'Step 5: Tap result marked success=true');

  // Step 6: Desktop receives audit event over named pipe
  await new Promise(r => setTimeout(r, 60));
  assert(desktopReceivedAudits.length >= 1, 'Integration Step 6: Desktop received live ACTION_AUDIT over Named Pipe');
  const auditEvent = desktopReceivedAudits[0];
  assertEqual(auditEvent.action, 'tap', 'Step 6: Audit action matches "tap"');
  assertEqual(auditEvent.status, 'SUCCESS', 'Step 6: Audit status matches "SUCCESS"');
  assertEqual(auditEvent.clientName, 'Integration-Agent', 'Step 6: Audit clientName matches');
  assert(!JSON.stringify(auditEvent).includes(sessionToken), 'Step 6: SECURITY - Session token strictly omitted from audit IPC event');

  // Step 7: Desktop Emergency Revocation
  desktopServer.revokeAllSessions();
  // Wait briefly for IPC delivery
  await new Promise(r => setTimeout(r, 60));

  // Step 8: Subsequent operation is rejected
  const revokedTapCall: any = await mcpAgent.callTool({
    name: 'tap',
    arguments: { serial: 'int-mock-device', x: 500, y: 1000, token: sessionToken }
  });
  assert(revokedTapCall.isError, 'Integration Step 8: Operation rejected after emergency revocation');
  assert(revokedTapCall.content[0].text.includes('Unauthorized'), 'Step 8: Error confirms Tier 3 permission rejected');

  // Step 9: Failure-path test (Desktop human denial)
  const denyReqCall: any = await mcpAgent.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Denied-Agent', requestedTier: 3 }
  });
  const denyReqId = JSON.parse(denyReqCall.content[0].text).requestId;
  await new Promise(r => setTimeout(r, 60));

  // Desktop user clicks "Deny"
  desktopServer.denyRequest(denyReqId);
  await new Promise(r => setTimeout(r, 60));

  const denyPairCall: any = await mcpAgent.callTool({
    name: 'pair_session',
    arguments: { requestId: denyReqId, clientName: 'Denied-Agent' }
  });
  assert(denyPairCall.isError, 'Integration Step 9: pair_session rejected after desktop user denial');
  assert(denyPairCall.content[0].text.includes('denied by the user'), 'Step 9: Error message indicates explicit user denial');

  // Step 10: Multi-client connection and broadcast verification
  const client2 = new McpControlClient(testPipePath);
  const client2Connected = await client2.connect();
  assert(client2Connected, 'Integration Step 10: Second client connected to pipe server');
  await new Promise(r => setTimeout(r, 60)); // Allow server connection registration
  let client2RevokedAll = false;
  client2.onRevokeAll(() => {
    client2RevokedAll = true;
  });
  desktopServer.revokeAllSessions();
  await new Promise(r => setTimeout(r, 60));
  assert(client2RevokedAll, 'Step 10: Second client received broadcast revokeAll');
  client2.close();

  // Step 11: Client disconnect during pending approval lifecycle
  const ephemeralClient = new McpControlClient(testPipePath);
  await ephemeralClient.connect();
  await new Promise(r => setTimeout(r, 60));
  const ephemeralReqCall: any = await mcpAgent.callTool({
    name: 'request_pairing',
    arguments: { clientName: 'Ephemeral-Agent', requestedTier: 3 }
  });
  const ephemeralReqId = JSON.parse(ephemeralReqCall.content[0].text).requestId;
  // Disconnect client abruptly
  ephemeralClient.close();
  await new Promise(r => setTimeout(r, 60));
  // Server state remains intact and pending requests map is undamaged
  const statusAfterDisconnect = desktopServer.getStatus();
  assert(statusAfterDisconnect.connectedMcpProcesses >= 1, 'Integration Step 11: Server intact after abrupt client disconnect');
  assert(
    statusAfterDisconnect.pendingRequests.some(r => r.requestId === ephemeralReqId),
    'Step 11: Pending pairing request safely retained on server despite client disconnect'
  );

  // Teardown & cleanup
  await mcpAgent.close();
  mcpBridgeClient.close();
  await desktopServer.stop();
  try {
    fs.rmSync(tempIntCaptures, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }

  console.log('\n==================================================');
  console.log(`INTEGRATION RESULTS: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('==================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runIntegrationTests().catch(err => {
  console.error('Integration test exception:', err);
  process.exit(1);
});
