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

  // 2. Live Device Query
  const devices = await dm.getDevices();
  assert(Array.isArray(devices), 'DeviceManager.getDevices() returns array');
  console.log(`  ℹ Found ${devices.length} currently attached Android device(s).`);

  // 3. Scrcpy Binary Probe Test
  const sm = new ScrcpyManager(scrcpyPath);
  assert(sm.getStatus().running === false, 'Scrcpy initial status is not running');

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
