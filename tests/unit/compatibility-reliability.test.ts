import fs from 'fs';
import path from 'path';
import { DeviceManager, getDeviceStateGuidance } from '../../modules/device_manager';
import { ScrcpyManager } from '../../modules/scrcpy_manager';
import { CameraManager } from '../../modules/camera_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';

/**
 * Phase 9: Compatibility, Reliability & Device Certification Automated Unit Tests
 */
export async function runCompatibilityReliabilityTests(
  assert: (condition: boolean, testName: string) => void,
  assertEqual: <T>(actual: T, expected: T, testName: string) => void
) {
  console.log('\n==================================================');
  console.log('Test Group 17: Phase 9 Compatibility & Reliability Suite');
  console.log('==================================================');

  const dm = new DeviceManager('C:\\nonexistent\\adb_dummy.exe');

  // 1. ADB Output Parsing with Daemon Messages and Diverse Device States
  console.log('\n--- Section 1: Complex ADB Output & Daemon Message Parsing ---');
  const dirtyAdbOutput = `
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
EXAMPLE0SERIAL01       device product:pissarroin model:21091116I device:pissarro transport_id:1
192.168.1.150:5555     device product:starqlteue model:SM_G960U1 device:starqlte transport_id:2
unauth_dev_1           unauthorized usb:1-1 transport_id:3
offline_dev_2          offline usb:1-2 transport_id:4
authorizing_dev_3      authorizing usb:1-3 transport_id:5
perm_err_dev_4         no permissions (missing udev rules?); see [http://developer.android.com/tools/device.html] usb:1-4
recov_dev_5            recovery usb:1-5 transport_id:6
side_dev_6             sideload usb:1-6 transport_id:7
boot_dev_7             bootloader usb:1-7 transport_id:8
`;

  const parsed = dm.parseDevicesOutput(dirtyAdbOutput);
  assertEqual(parsed.length, 9, 'Parsed exactly 9 devices across all state categories');
  assertEqual(parsed[0].serial, 'EXAMPLE0SERIAL01', 'First device (physical reference) serial correctly extracted');
  assertEqual(parsed[0].state, 'device', 'First device state is authorized device');
  assertEqual(parsed[0].model, '21091116I', 'Model accurately extracted without underscores');

  assertEqual(parsed[1].transportType, 'wifi', 'IP serial recognized as Wi-Fi transport');
  assertEqual(parsed[2].state, 'unauthorized', 'Unauthorized state recognized');
  assertEqual(parsed[3].state, 'offline', 'Offline state recognized');
  assertEqual(parsed[4].state, 'authorizing', 'Authorizing state recognized');
  assertEqual(parsed[5].state, 'no permissions', 'No permissions state recognized');
  assertEqual(parsed[6].state, 'recovery', 'Recovery state recognized');
  assertEqual(parsed[7].state, 'sideload', 'Sideload state recognized');
  assertEqual(parsed[8].state, 'bootloader', 'Bootloader state recognized');

  // 2. Actionable State Guidance Tests
  console.log('\n--- Section 2: Actionable State Guidance ---');
  assert(getDeviceStateGuidance('unauthorized').includes('Allow USB debugging'), 'Unauthorized guidance mentions Allow USB debugging');
  assert(getDeviceStateGuidance('offline').includes('Reconnect the USB cable'), 'Offline guidance suggests reconnecting cable');
  assert(getDeviceStateGuidance('authorizing').includes('confirm the host key prompt'), 'Authorizing guidance instructs checking phone prompt');
  assert(getDeviceStateGuidance('no permissions').includes('drivers'), 'No permissions guidance mentions drivers or udev');
  assert(getDeviceStateGuidance('recovery').includes('Recovery mode'), 'Recovery guidance mentions rebooting');
  assert(getDeviceStateGuidance('device').includes('Ready'), 'Ready guidance confirms active state');

  // 3. Missing Binary Diagnostics
  console.log('\n--- Section 3: Missing ADB & Toolchain Diagnostics ---');
  const missingAdbVersion = await dm.getAdbVersion();
  assert(missingAdbVersion.includes('not found') || missingAdbVersion.includes('missing'), 'Missing ADB version reports descriptive not found message');

  const missingAdbExec = await dm.executeAdb(['version']);
  assertEqual(missingAdbExec.code, -1, 'Missing ADB execution returns -1 exit code');
  assert(missingAdbExec.stderr.includes('Ensure Android platform-tools or bundled binaries are installed'), 'Missing ADB includes actionable installation guidance');

  // 4. ScrcpyManager Overlapping Launch & Disconnect
  console.log('\n--- Section 4: Process Lifecycle & Overlapping Launch Prevention ---');
  const scrcpyMgr = new ScrcpyManager('C:\\nonexistent\\scrcpy_dummy.exe');
  
  // Starting when executable doesn't exist returns structured error
  const startRes1 = scrcpyMgr.startMirroring({ serial: 'test-device' });
  assertEqual(startRes1.success, false, 'Start mirroring fails gracefully when binary missing');
  assert(startRes1.message?.includes('scrcpy executable not found') === true, 'Error explains executable path');

  // Status query reflects non-running state
  const status = scrcpyMgr.getStatus();
  assertEqual(status.running, false, 'Status reports running: false');

  // Stopping when not running returns false without throwing
  const stopRes = scrcpyMgr.stopMirroring();
  assertEqual(stopRes, false, 'stopMirroring on inactive session returns false safely');

  // 5. CameraManager Overlapping Launch Guard
  console.log('\n--- Section 5: Camera Studio Overlapping Launch Guard ---');
  const cameraMgr = new CameraManager('C:\\nonexistent\\scrcpy_dummy.exe', dm);
  const camStart1 = cameraMgr.startCamera({ serial: 'test-device' });
  assertEqual(camStart1.success, false, 'startCamera fails cleanly when binary missing');
  assert(camStart1.message?.includes('scrcpy executable not found') === true, 'Camera error explains missing executable');

  // Argument builder validation
  assert(
    cameraMgr.buildArguments({ serial: 'test-device', size: '1920x1080', fps: 30 }).includes('--video-source=camera'),
    'Camera argument builder includes --video-source=camera'
  );

  let invalidSerialCaught = false;
  try {
    cameraMgr.buildArguments({ serial: 'bad;serial' });
  } catch {
    invalidSerialCaught = true;
  }
  assert(invalidSerialCaught, 'Camera argument builder strictly rejects injection in serial');

  // 6. Screenshot Error & Corrupted Output Cleanup
  console.log('\n--- Section 6: Screenshot Corrupted Output Cleanup ---');
  const diagMgr = new DiagnosticsManager(dm);
  const testCapturesDir = path.resolve(process.cwd(), 'Captures/test-corrupted-cleanup');

  if (!fs.existsSync(testCapturesDir)) {
    fs.mkdirSync(testCapturesDir, { recursive: true });
  }

  // Attempting screenshot with dummy/missing ADB fails and leaves no orphan files
  const shotRes = await diagMgr.captureDeviceScreenshot('EXAMPLE0SERIAL01', testCapturesDir);
  assertEqual(shotRes.success, false, 'Screenshot fails when ADB binary is missing');
  
  const filesInTestDir = fs.readdirSync(testCapturesDir);
  assertEqual(filesInTestDir.length, 0, 'No zero-byte or corrupt screenshot files left in captures directory');

  // Clean up directory
  try {
    fs.rmdirSync(testCapturesDir);
  } catch {}

  console.log('  ✓ Section 6 Completed: Zero orphan files left on disk after capture failures');
}
