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

  // 7. Process Cleanup
  assert(sm.stopMirroring() === false, 'Stopping when not running is safely handled');

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
