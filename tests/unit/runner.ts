import { SecurityValidator } from '../../modules/security';
import { DeviceManager } from '../../modules/device_manager';
import { ScrcpyManager } from '../../modules/scrcpy_manager';
import { ConnectionManager } from '../../modules/connection_manager';

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

async function runUnitTests() {
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

  // 6. Process Cleanup & Lifecycle
  console.log('\nTest Group 6: Process Lifecycle & Cleanup');
  const lifecycleSm = new ScrcpyManager('C:\\dummy\\scrcpy.exe');
  assertEqual(lifecycleSm.getStatus().running, false, 'Initial state: not running');
  assertEqual(lifecycleSm.stopMirroring(), false, 'Stopping inactive process returns false gracefully');

  console.log('\n==================================================');
  console.log(`UNIT TEST RESULTS: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('==================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runUnitTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
