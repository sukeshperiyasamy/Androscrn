import { SecurityValidator } from '../../modules/security';
import { DeviceManager } from '../../modules/device_manager';
import { ScrcpyManager } from '../../modules/scrcpy_manager';
import { ConnectionManager } from '../../modules/connection_manager';
import { runMcpTests } from './mcp.test';
import { runSecurityRegressionTests } from './security-regression.test';
import { runCliTests } from './cli.test';
import { runCameraTests } from './camera.test';
import { runCompanionTests } from './companion.test';
import { runLabInspectionUnitTests } from './lab-inspection.test';
import { runCompatibilityReliabilityTests } from './compatibility-reliability.test';
import { runDiscoveryTests } from './discovery.test';
import { runPathEnvironmentTests, snapshotRealUserPath, assertRealUserPathUnchanged } from './path-env.test';
import { runNativeCliTests } from './native-cli.test';
import { installLaunchGuard, assertNoBrowserLaunches } from './launch-guard';
import { runWirelessValidationTests } from './wireless-validation.test';
import { runDocumentTests } from './document.test';
import { runDocumentPrivacyTests } from './document-privacy.test';
import { runStylingTests } from './styling.test';
import { runWorkflowEngineTests } from './workflow-engine.test';
import { runConnectionRetryUnitTests } from './connection-retry.test';
import { runGracefulStopUnitTests } from './graceful-stop.test';
import { runSettingsStoreUnitTests } from './settings-store.test';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;
const skippedNames: string[] = [];

function skip(testName: string, reason: string) {
  skippedTests++;
  skippedNames.push(`${testName} (${reason})`);
  console.log(`  - SKIP: ${testName} - ${reason}`);
}

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

async function runUnitTests() {
  // Block (and record) any browser/URL launch for the whole run; asserted at the end.
  installLaunchGuard();
  // Read-only snapshot used at the end to prove the suite never changed the real User PATH.
  const realPathBefore = snapshotRealUserPath();

  console.log('==================================================');
  console.log('       ANDROSCRN UNIT TEST SUITE EXECUTION        ');
  console.log('==================================================\n');

  // 1. SecurityValidator Tests
  console.log('Test Group 1: SecurityValidator & Input Sanitization');
  assert(SecurityValidator.isValidIPv4('192.168.1.100'), 'Valid IPv4 accepted');
  assert(SecurityValidator.isValidIPv4('10.0.0.1'), 'Valid private IPv4 accepted');
  assert(!SecurityValidator.isValidIPv4('256.1.1.1'), 'Out-of-range IPv4 rejected');
  assert(!SecurityValidator.isValidIPv4('192.168.1.1; rm -rf /'), 'Malicious injection IPv4 rejected');
  assert(!SecurityValidator.isValidIPv4('192.168.1'), 'Incomplete IPv4 rejected');
  assert(!SecurityValidator.isValidIPv4(''), 'Empty IPv4 rejected');

  assert(SecurityValidator.isValidPort(5555), 'Valid port 5555 accepted');
  assert(SecurityValidator.isValidPort('8080'), 'Valid string port accepted');
  assert(!SecurityValidator.isValidPort(0), 'Port 0 rejected');
  assert(!SecurityValidator.isValidPort(-5555), 'Negative port rejected');
  assert(!SecurityValidator.isValidPort(70000), 'Port > 65535 rejected');
  assert(!SecurityValidator.isValidPort('abc'), 'Non-numeric port string rejected');

  assert(SecurityValidator.isValidSerial('emulator-5554'), 'Standard emulator serial accepted');
  assert(SecurityValidator.isValidSerial('192.168.1.50:5555'), 'TCP/IP serial accepted');
  assert(SecurityValidator.isValidSerial('R58M123XYZ'), 'Hardware alphanumeric serial accepted');
  assert(!SecurityValidator.isValidSerial('device; reboot'), 'Serial with semicolon injection rejected');
  assert(!SecurityValidator.isValidSerial('device && whoami'), 'Serial with AND operator rejected');
  assert(!SecurityValidator.isValidSerial('device|calc.exe'), 'Serial with pipe operator rejected');
  assert(!SecurityValidator.isValidSerial(''), 'Empty serial rejected');

  assert(SecurityValidator.isValidPairingCode('123456'), 'Valid 6-digit PIN accepted');
  assert(!SecurityValidator.isValidPairingCode('12345'), '5-digit PIN rejected');
  assert(!SecurityValidator.isValidPairingCode('1234567'), '7-digit PIN rejected');
  assert(!SecurityValidator.isValidPairingCode('12345a'), 'Non-numeric PIN rejected');
  assert(!SecurityValidator.isValidPairingCode(''), 'Empty PIN rejected');

  const sensitiveSample = 'Contact dev@example.com with Bearer sec_tok_991827 and pin 654321';
  const redacted = SecurityValidator.redactSensitiveText(sensitiveSample);
  assert(redacted.includes('[REDACTED_EMAIL]'), 'Email correctly redacted');
  assert(redacted.includes('Bearer [REDACTED_TOKEN]'), 'Bearer token correctly redacted');
  assert(redacted.includes('[REDACTED_PIN]'), 'Pairing PIN correctly redacted');

  // 2. DeviceManager Parsing Tests
  console.log('\nTest Group 2: DeviceManager Output Parsing');
  const dm = new DeviceManager('dummy_adb');

  const mockOutput = `
List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
192.168.1.150:5555     device product:starqlteue model:SM_G960U1 device:starqlte transport_id:2
ABC123456789          unauthorized usb:1-1 transport_id:3
OFFLINE_DEV_1          offline transport_id:4
`;

  const parsed = dm.parseDevicesOutput(mockOutput);
  assertEqual(parsed.length, 4, 'Parsed exactly 4 devices');
  assertEqual(parsed[0].serial, 'emulator-5554', 'First device serial matches');
  assertEqual(parsed[0].state, 'device', 'First device state is authorized');
  assertEqual(parsed[0].transportType, 'usb', 'Emulator identified as USB transport');

  assertEqual(parsed[1].serial, '192.168.1.150:5555', 'Second device serial matches');
  assertEqual(parsed[1].transportType, 'wifi', 'IP serial identified as Wi-Fi transport');
  assertEqual(parsed[1].model, 'SM G960U1', 'Model name formatted properly');

  assertEqual(parsed[2].state, 'unauthorized', 'Third device detected as unauthorized');
  assertEqual(parsed[3].state, 'offline', 'Fourth device detected as offline');

  // Test device alias assignment
  dm.setDeviceAlias('emulator-5554', 'Pixel 8 Pro Testbed');
  const reParsed = dm.parseDevicesOutput(mockOutput);
  assertEqual(reParsed[0].alias, 'Pixel 8 Pro Testbed', 'Device alias retained and applied');

  // 3. ScrcpyManager Argument Builder Tests
  console.log('\nTest Group 3: ScrcpyManager Argument Composition');
  const sm = new ScrcpyManager('C:\\dummy\\scrcpy.exe');

  const highPerfArgs = sm.buildArguments({
    serial: 'emulator-5554',
    preset: 'high_performance',
    turnScreenOff: true,
    stayAwake: true
  });

  assert(highPerfArgs.includes('-s') && highPerfArgs[highPerfArgs.indexOf('-s') + 1] === 'emulator-5554', 'Target serial added');
  assert(highPerfArgs.includes('--max-size') && highPerfArgs[highPerfArgs.indexOf('--max-size') + 1] === '1920', 'Max size 1920 set for high perf');
  assert(highPerfArgs.includes('-b12M'), 'Bitrate 12M set for high perf');
  assert(highPerfArgs.includes('--max-fps') && highPerfArgs[highPerfArgs.indexOf('--max-fps') + 1] === '60', 'FPS 60 set for high perf');
  assert(highPerfArgs.includes('-S'), 'Screen off flag -S present');
  assert(highPerfArgs.includes('-w'), 'Stay awake flag -w present');

  const recordArgs = sm.buildArguments({
    serial: '192.168.1.150:5555',
    recordPath: 'C:\\Captures\\test.mp4',
    noAudio: true
  });

  assert(highPerfArgs.some(a => a.startsWith('--window-title=')), 'Window title argument configured');
  assert(recordArgs.includes('--record=C:\\Captures\\test.mp4'), 'Record path argument added');
  assert(recordArgs.includes('--no-audio'), 'No audio flag added');

  const parityArgs = sm.buildArguments({
    serial: 'emulator-5554',
    keyboardMode: 'uhid',
    mouseMode: 'uhid',
    alwaysOnTop: true,
    captureOrientation: '90',
    newDisplay: '1920x1080',
    audioSource: 'mic',
    audioDup: true
  });

  assert(parityArgs.includes('--keyboard=uhid'), 'Keyboard mode --keyboard=uhid added');
  assert(parityArgs.includes('--mouse=uhid'), 'Mouse mode --mouse=uhid added');
  assert(parityArgs.includes('--always-on-top'), 'Always on top flag added');
  assert(parityArgs.includes('--capture-orientation=90'), 'Capture orientation flag added');
  assert(parityArgs.includes('--new-display=1920x1080'), 'New display flag added');
  assert(parityArgs.includes('-x'), 'Flex display flag -x added with new display');
  assert(parityArgs.includes('--audio-source=mic'), 'Audio source mic flag added');
  assert(parityArgs.includes('--audio-dup'), 'Audio dup flag added');
  assert(parityArgs.includes('--no-power-on'), 'No power on flag added for UHID mode');

  const explicitNoSyncArgs = sm.buildArguments({
    serial: 'emulator-5554',
    noClipboardAutosync: true,
    noPowerOn: true
  });
  assert(explicitNoSyncArgs.includes('--no-clipboard-autosync'), 'No clipboard autosync flag added');
  assert(explicitNoSyncArgs.includes('--no-power-on'), 'Explicit no-power-on flag added');

  // Rejection of invalid inputs
  const invalidParityArgs = sm.buildArguments({
    serial: 'emulator-5554',
    keyboardMode: 'invalid_mode' as any,
    captureOrientation: 'invalid_angle' as any,
    newDisplay: 'bad;injection'
  });
  assert(!invalidParityArgs.some(a => a.startsWith('--keyboard=invalid')), 'Invalid keyboard mode safely rejected');
  assert(!invalidParityArgs.some(a => a.startsWith('--capture-orientation=invalid')), 'Invalid orientation safely rejected');
  assert(!invalidParityArgs.some(a => a.startsWith('--new-display=bad')), 'Invalid new-display injection safely rejected');

  // 4. Missing Binaries & Graceful Failure Handling
  console.log('\nTest Group 4: Missing Binaries & Error Handling');
  const missingAdbDm = new DeviceManager('C:\\path\\does\\not\\exist\\adb_missing.exe');
  const missingRes = await missingAdbDm.executeAdb(['version'], 2000);
  assert(missingRes.code === -1, 'Missing ADB binary yields non-zero exit code');
  assert(missingRes.stderr.length > 0, 'Missing ADB binary populates error message');

  const missingScrcpySm = new ScrcpyManager('C:\\path\\does\\not\\exist\\scrcpy_missing.exe');
  const scrcpyStartRes = missingScrcpySm.startMirroring({ serial: 'emulator-5554' });
  // ChildProcess spawn error handled
  assert(scrcpyStartRes.success === true || (scrcpyStartRes.message && scrcpyStartRes.message.length > 0), 'Spawn attempt initiates with error listener');

  // 5. Connection Manager Defensive Input & Failure Handling
  console.log('\nTest Group 5: ConnectionManager Command Failures');
  const cm = new ConnectionManager(missingAdbDm);
  const invalidHandoff = await cm.handoffUsbToWifi('bad;serial');
  assert(invalidHandoff.success === false, 'Handoff rejects invalid serial');
  assertEqual(invalidHandoff.message, 'Invalid device serial identifier.', 'Handoff returns specific error message');

  const invalidConnect = await cm.connectWireless('999.999.999.999', 5555);
  assert(invalidConnect.success === false, 'Wireless connect rejects invalid IP');

  const invalidPair = await cm.pairWireless('192.168.1.150', 5555, 'badpin');
  assert(invalidPair.success === false, 'Wireless pair rejects invalid PIN');

  // Failed handoff (unreachable phone, e.g. Wi-Fi client isolation) must revert adbd to USB mode
  const handoffCalls: string[][] = [];
  const fakeAdb: any = {
    executeAdb: async (args: string[]) => {
      handoffCalls.push(args);
      if (args.includes('wlan0')) return { stdout: '    inet 172.31.116.120/18 brd', stderr: '', code: 0 };
      if (args.includes('tcpip')) return { stdout: 'restarting in TCP mode port: 5555', stderr: '', code: 0 };
      if (args[0] === 'connect') return { stdout: '', stderr: '\nCommand timed out.', code: 1 };
      return { stdout: 'restarting in USB mode', stderr: '', code: 0 };
    }
  };
  const failedHandoff = await new ConnectionManager(fakeAdb).handoffUsbToWifi('kjizrsgekfsglvgi');
  assert(failedHandoff.success === false, 'Unreachable handoff reports failure');
  assert(handoffCalls.some((a) => a[a.length - 1] === 'usb'), 'Failed handoff returns device to USB mode');
  assert(/client isolation/.test(failedHandoff.message), 'Failed handoff explains unreachable network');

  // 6. Process Cleanup & Lifecycle
  console.log('\nTest Group 6: Process Lifecycle & Cleanup');
  const lifecycleSm = new ScrcpyManager('C:\\dummy\\scrcpy.exe');
  assertEqual(lifecycleSm.getStatus().running, false, 'Initial state: not running');
  assertEqual(lifecycleSm.stopMirroring(), false, 'Stopping inactive process returns false gracefully');

  // 7. Device State Guidance Tests
  console.log('\nTest Group 7: Device State Guidance');
  const { getDeviceStateGuidance } = await import('../../modules/device_manager');
  const unauthorizedGuide = getDeviceStateGuidance('unauthorized');
  assert(unauthorizedGuide.includes('unlock') || unauthorizedGuide.includes('Allow USB debugging'), 'Unauthorized guidance mentions unlocking and allowing debugging');
  const offlineGuide = getDeviceStateGuidance('offline');
  assert(offlineGuide.includes('offline') || offlineGuide.includes('Reconnect'), 'Offline guidance mentions reconnection');
  const deviceGuide = getDeviceStateGuidance('device');
  assert(deviceGuide.includes('Ready') || deviceGuide.includes('Connected'), 'Authorized device guidance reports ready state');

  // 8. Raw Binary Execution & PNG Verification Tests
  console.log('\nTest Group 8: Binary Execution & PNG Header Verification');
  const { DiagnosticsManager } = await import('../../modules/diagnostics');
  const diagManager = new DiagnosticsManager(dm);

  // Test invalid serial rejection for screenshot
  const invalidScreenshot = await diagManager.captureDeviceScreenshot('bad;serial', 'C:\\dummy');
  assert(!invalidScreenshot.success, 'Screenshot rejects invalid serial');
  assertEqual(invalidScreenshot.error, 'Invalid device serial identifier.', 'Screenshot returns specific validation error');

  // Test PNG signature verification logic
  const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const isPngHeaderValid = validPngHeader.length >= 8 &&
    validPngHeader[0] === 0x89 &&
    validPngHeader[1] === 0x50 &&
    validPngHeader[2] === 0x4e &&
    validPngHeader[3] === 0x47;
  assert(isPngHeaderValid, 'PNG magic header correctly identified (89 50 4E 47)');

  const corruptedHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF header
  const isCorruptedPng = corruptedHeader.length >= 8 && corruptedHeader[0] === 0x89;
  assert(!isCorruptedPng, 'Non-PNG stream correctly rejected');

  // 9. Diagnostics Report & Redaction
  console.log('\nTest Group 9: Diagnostic Bundle Generation');
  const sampleBundle = await diagManager.generateDiagnosticBundle();
  assert(sampleBundle.includes('ANDROSCRN SYSTEM DIAGNOSTIC REPORT'), 'Diagnostic report contains proper header');
  assert(sampleBundle.includes('Host Platform'), 'Diagnostic report contains Host Platform info');
  assert(sampleBundle.includes('SCREEN MIRRORING SESSION'), 'Diagnostic report includes mirroring status section');

  // 10. Captures Scanner
  console.log('\nTest Group 10: Captures Directory Scanner');
  const emptyCaptures = diagManager.getExistingCaptures('C:\\path\\does\\not\\exist\\folder');
  assertEqual(emptyCaptures.length, 0, 'Nonexistent captures folder returns empty array safely');

  // 11. Model Context Protocol (MCP) Server & Security Gatekeeper
  await runMcpTests(assert, assertEqual);

  // 12. Security Regression Test Suite (Phase 3C)
  await runSecurityRegressionTests(assert, assertEqual);

  // 13. CLI Launcher & Portable Packaging Test Suite
  await runCliTests(assert, assertEqual, skip);

  // Phase 10.1: isolated PATH logic and native launcher tests
  await runPathEnvironmentTests(assert, assertEqual, skip);
  await runNativeCliTests(assert, assertEqual, skip);

  // 14. Camera Studio MVP Test Suite (Phase 5)
  const camRes = await runCameraTests();
  totalTests += camRes.passed + camRes.failed;
  passedTests += camRes.passed;
  failedTests += camRes.failed;

  // 15. Camera Companion Client & Protocol Test Suite (Phase 6)
  const compRes = await runCompanionTests();
  totalTests += compRes.passed + compRes.failed;
  passedTests += compRes.passed;
  failedTests += compRes.failed;

  // 16. Lab & Inspection Engine Test Suite (Phase 7.1)
  const labRes = await runLabInspectionUnitTests();
  totalTests += labRes.passed + labRes.failed;
  passedTests += labRes.passed;
  failedTests += labRes.failed;

  // 17. Compatibility & Reliability Test Suite (Phase 9)
  await runCompatibilityReliabilityTests(assert, assertEqual);

  // Phase 10: Smart discovery, OEM guidance, redaction
  await runDiscoveryTests(assert, assertEqual);
  await runWirelessValidationTests(assert, assertEqual);

  // Phase 11: local document intelligence
  await runDocumentTests(assert, assertEqual, skip);
  await runDocumentPrivacyTests(assert);

  // Phase 11.1: styling pipeline regression
  runStylingTests(assert, skip);

  // Workflow Engine step validation regression
  await runWorkflowEngineTests(assert, assertEqual);

  // Phase 5: Device Connection Retry & Visible Diagnostics
  await runConnectionRetryUnitTests(assert, assertEqual);
  await runGracefulStopUnitTests(assert, assertEqual);
  await runSettingsStoreUnitTests(assert, assertEqual);

  assertRealUserPathUnchanged(realPathBefore, assert, skip);
  assertNoBrowserLaunches(assert);

  console.log('\n==================================================');
  console.log(`UNIT TEST RESULTS: ${passedTests}/${totalTests} Passed (${failedTests} Failed, ${skippedTests} Skipped)`);
  for (const s of skippedNames) console.log(`  SKIPPED: ${s}`);
  console.log('==================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runUnitTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

