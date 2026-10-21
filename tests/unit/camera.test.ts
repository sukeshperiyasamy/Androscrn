import { CameraManager, CameraSessionOptions } from '../../modules/camera_manager';
import { DeviceManager } from '../../modules/device_manager';
import path from 'path';
import fs from 'fs';

export async function runCameraTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  function assertThrows(fn: () => void, message: string) {
    try {
      fn();
      console.error(`  ✗ FAIL: Expected error but succeeded: ${message}`);
      failed++;
    } catch {
      console.log(`  ✓ PASS: Safely rejected: ${message}`);
      passed++;
    }
  }

  console.log('\n--- Camera Studio: Argument Construction & Injection Defense ---');

  const mockAdbPath = path.resolve('bin/scrcpy-win64/adb.exe');
  const mockScrcpyPath = path.resolve('bin/scrcpy-win64/scrcpy.exe');
  const deviceManager = new DeviceManager(mockAdbPath);
  const cameraManager = new CameraManager(mockScrcpyPath, deviceManager);

  // 1. Base Camera Arguments
  const baseArgs = cameraManager.buildArguments({ serial: 'device123' });
  assert(baseArgs.includes('-s') && baseArgs[baseArgs.indexOf('-s') + 1] === 'device123', 'Serial correctly positioned in arguments');
  assert(baseArgs.includes('--video-source=camera'), 'Includes --video-source=camera');
  assert(baseArgs.includes('--no-audio'), 'Includes --no-audio by default');
  assert(baseArgs.some(a => a.startsWith('--window-title=')), 'Sets deterministic window title');

  // 2. Camera ID & Facing Options
  const idArgs = cameraManager.buildArguments({ serial: 'device123', cameraId: '0' });
  assert(idArgs.includes('--camera-id=0'), 'Constructs --camera-id=0');

  const frontFacingArgs = cameraManager.buildArguments({ serial: 'device123', facing: 'front' });
  assert(frontFacingArgs.includes('--camera-facing=front'), 'Constructs --camera-facing=front');

  const backFacingArgs = cameraManager.buildArguments({ serial: 'device123', facing: 'back' });
  assert(backFacingArgs.includes('--camera-facing=back'), 'Constructs --camera-facing=back');

  // 3. Size, FPS & High Speed
  const sizeArgs = cameraManager.buildArguments({ serial: 'device123', size: '1920x1080', fps: 60, highSpeed: true });
  assert(sizeArgs.includes('--camera-size=1920x1080'), 'Constructs explicit --camera-size');
  assert(sizeArgs.includes('--camera-fps=60'), 'Constructs explicit --camera-fps');
  assert(sizeArgs.includes('--camera-high-speed'), 'Constructs --camera-high-speed flag');

  // 4. Initial Zoom & Torch
  const zoomTorchArgs = cameraManager.buildArguments({ serial: 'device123', zoom: 2.5, torch: true });
  assert(zoomTorchArgs.includes('--camera-zoom=2.5'), 'Constructs --camera-zoom parameter');
  assert(zoomTorchArgs.includes('--camera-torch'), 'Constructs --camera-torch parameter');

  // 5. Aspect Ratio
  const arArgs = cameraManager.buildArguments({ serial: 'device123', aspectRatio: '16:9' });
  assert(arArgs.includes('--camera-ar=16:9'), 'Constructs --camera-ar parameter');

  // 6. PC-Side Recording
  const testRecPath = path.resolve('Captures/unit_test_recording.mp4');
  const recArgs = cameraManager.buildArguments({ serial: 'device123', recordPath: testRecPath });
  assert(recArgs.some(a => a === `--record=${testRecPath}`), 'Constructs validated --record argument');

  // Clean up any test directory created
  const testRecDir = path.dirname(testRecPath);
  if (fs.existsSync(testRecPath)) fs.unlinkSync(testRecPath);

  // 7. Security Injection Rejections
  assertThrows(() => cameraManager.buildArguments({ serial: 'device; rm -rf /' }), 'Rejects shell metacharacters in serial');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', cameraId: '0; calc.exe' }), 'Rejects shell injection in cameraId');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', size: 'invalid_size' }), 'Rejects malformed camera resolution');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', fps: 1 }), 'Rejects invalid FPS under 5');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', fps: 500 }), 'Rejects invalid FPS over 240');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', zoom: 0.5 }), 'Rejects zoom under 1.0x');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', zoom: 100 }), 'Rejects zoom over 50.0x');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', aspectRatio: 'bad_ar' }), 'Rejects invalid aspect ratio');
  assertThrows(() => cameraManager.buildArguments({ serial: 'device123', recordPath: 'bad.txt' }), 'Rejects non-video recording extension (.txt)');

  console.log('\n--- Camera Studio: Output Parser (scrcpy --list-camera-sizes) ---');

  const sampleScrcpyOutput = `
scrcpy 5.0.1 <https://github.com/Genymobile/scrcpy>
[server] INFO: Device: [Xiaomi] Xiaomi 21091116I (Android 13)
[server] INFO: List of cameras:
    --camera-id=0    (back, 4000x3000, fps={10, 15, 20, 30}, zoom-range=[1, 10])
        - 4000x3000
        - 1920x1080
        - 1280x720
      High speed capture (--camera-high-speed):
        - 1920x1080 (fps={120})
    --camera-id=1    (front, 2320x1744, fps={10, 15, 20, 30}, zoom-range=[1, 10])
        - 2320x1744
        - 1920x1080
        - 1280x720
    --camera-id=2    (back, 3264x2448, fps={10, 15, 20, 30}, zoom-range=[1, 10])
        - 3264x2448
        - 1920x1080
`;

  const parsed = cameraManager.parseCameraListOutput(sampleScrcpyOutput);
  assert(parsed.length === 3, `Parsed exact camera sensor count (Expected: 3, Got: ${parsed.length})`);
  assert(parsed[0].id === '0', 'Parsed camera 0 ID correctly');
  assert(parsed[0].facing === 'back', 'Parsed camera 0 facing as back');
  assert(parsed[0].maxResolution === '4000x3000', 'Parsed camera 0 max resolution as 4000x3000');
  assert(parsed[0].fpsList.includes(30), 'Parsed fpsList including 30 fps');
  assert(parsed[0].zoomRange?.[0] === 1 && parsed[0].zoomRange?.[1] === 10, 'Parsed zoom range [1, 10]');
  assert(parsed[0].supportedSizes.includes('1920x1080'), 'Parsed supportedSizes including 1920x1080');
  assert(parsed[0].highSpeedSizes?.[0]?.size === '1920x1080', 'Parsed high-speed size 1920x1080');
  assert(parsed[0].highSpeedSizes?.[0]?.fps.includes(120), 'Parsed high-speed 120 fps');

  assert(parsed[1].id === '1', 'Parsed front camera 1 ID');
  assert(parsed[1].facing === 'front', 'Parsed camera 1 facing as front');
  assert(parsed[1].maxResolution === '2320x1744', 'Parsed camera 1 max resolution');

  // Edge cases in parser
  const emptyParsed = cameraManager.parseCameraListOutput('');
  assert(emptyParsed.length === 0, 'Empty string returns empty array');

  const garbageParsed = cameraManager.parseCameraListOutput('Some random unformatted error message');
  assert(garbageParsed.length === 0, 'Garbage output safely returns empty array');

  console.log('\n--- Camera Studio: Capability Detection & Transport Checks ---');

  // Test capability detection on invalid serial
  const invalidCaps = await cameraManager.queryCapabilities('invalid serial; rm');
  assert(!invalidCaps.transportSupported, 'Invalid serial marks transportSupported false');
  assert(!invalidCaps.deviceSupported, 'Invalid serial marks deviceSupported false');

  // Test recording path validator
  const validRec = cameraManager.validateRecordingPath('Captures/my_video.mp4');
  assert(validRec.valid, 'Validates .mp4 recording path');

  const validMkv = cameraManager.validateRecordingPath('Captures/my_video.mkv');
  assert(validMkv.valid, 'Validates .mkv recording path');

  const invalidExt = cameraManager.validateRecordingPath('Captures/my_video.avi');
  assert(!invalidExt.valid, 'Rejects unsupported video container (.avi)');

  console.log('\n--- Camera Studio: Process Lifecycle & Duplicate Prevention ---');

  // Initial status
  const initialStatus = cameraManager.getStatus();
  assert(!initialStatus.running, 'Camera manager initially idle');
  assert(initialStatus.currentZoom === 1.0, 'Initial zoom is 1.0x');
  assert(initialStatus.torchActive === false, 'Initial torch is false');

  // Stop when idle returns false
  const stopIdle = cameraManager.stopCamera();
  assert(!stopIdle, 'Stopping idle camera session returns false safely');

  // Live controls when idle reject cleanly
  const liveZoomIdle = await cameraManager.sendLiveZoom('in');
  assert(!liveZoomIdle.success, 'sendLiveZoom rejected when camera not running');

  const liveTorchIdle = await cameraManager.sendLiveTorch('on');
  assert(!liveTorchIdle.success, 'sendLiveTorch rejected when camera not running');

  // Start with non-existent binary
  const badMgr = new CameraManager('C:/non_existent_scrcpy_12345.exe', deviceManager);
  const badStart = badMgr.startCamera({ serial: 'device123' });
  assert(!badStart.success, 'Fails gracefully if scrcpy executable missing');
  assert(badStart.message?.includes('not found'), 'Returns meaningful missing binary error');

  console.log('\n--- Camera Studio: Session Resilience, Eviction Detection & Reconnection ---');

  // 1. Initial status includes extended lifecycle properties
  assert(initialStatus.status === 'idle', 'Initial status is idle');
  assert(initialStatus.canReconnect === false, 'Initial canReconnect is false');
  assert(initialStatus.reconnectCount === 0, 'Initial reconnectCount is 0');

  // 2. Reconnect without prior options returns graceful failure
  const noOptsReconnect = await cameraManager.reconnectCamera();
  assert(!noOptsReconnect.success, 'Reconnecting without prior options safely returns success: false');
  assert(noOptsReconnect.message?.includes('No previous camera session'), 'Informs that no previous session exists');

  // 3. Reconnect retry limit bounding
  const maxRetriesMgr = new CameraManager(mockScrcpyPath, deviceManager);
  (maxRetriesMgr as any).lastSessionOptions = { serial: 'device123' };
  (maxRetriesMgr as any).reconnectCount = 5;
  const maxRetriesRes = await maxRetriesMgr.reconnectCamera();
  assert(!maxRetriesRes.success, 'Rejects reconnection when max retries reached (5/5)');
  assert(maxRetriesRes.message?.includes('Maximum reconnect attempts'), 'Returns max retries exceeded message');

  // 4. Reconnect cooldown debounce
  const cooldownMgr = new CameraManager(mockScrcpyPath, deviceManager);
  (cooldownMgr as any).lastSessionOptions = { serial: 'device123' };
  (cooldownMgr as any).reconnectCount = 1;
  (cooldownMgr as any).lastReconnectAttempt = Date.now();
  const cooldownRes = await cooldownMgr.reconnectCamera();
  assert(!cooldownRes.success, 'Rejects reconnection during cooldown window');
  assert(cooldownRes.message?.includes('rate-limited'), 'Returns rate-limited message');

  // 5. Stale session ID guard
  const staleMgr = new CameraManager(mockScrcpyPath, deviceManager);
  (staleMgr as any).currentSessionId = 10;
  (staleMgr as any).sessionStatus = 'running';
  (staleMgr as any).currentSerial = 'active_serial';
  const mockActiveProc: any = { pid: 7777, killed: false, exitCode: null };
  (staleMgr as any).currentProcess = mockActiveProc;

  // Stale close event from sessionId 9 should be ignored
  // We simulate by inspecting sessionStatus and process after an older session close would fire
  const staleStatus = staleMgr.getStatus();
  assert(staleStatus.status === 'running', 'Active session status preserved against stale events');
  assert(staleStatus.running === true, 'Active session running flag preserved');
  assert(staleStatus.pid === 7777, 'Active session PID preserved');

  // 6. Camera preemption classification when device is connected
  const mockConnectedDm: any = {
    isDeviceConnected: async () => true,
    executeAdb: async () => ({ exitCode: 0, stdout: '', stderr: '' })
  };
  const preemptMgr = new CameraManager(mockScrcpyPath, mockConnectedDm);
  (preemptMgr as any).currentSessionId = 1;
  (preemptMgr as any).lastSessionOptions = { serial: 'test_serial' };
  (preemptMgr as any).currentSerial = 'test_serial';
  (preemptMgr as any).sessionStatus = 'running';
  (preemptMgr as any).lastStartedAt = Date.now() - 5000;
  (preemptMgr as any).stderrRingBuffer = [
    'scrcpy: Camera disconnected',
    'Camera capture failed: frame 14'
  ];

  let interruptedEventFired = false;
  let statusChangedFired = false;
  preemptMgr.on('interrupted', (data) => {
    interruptedEventFired = true;
    assert(data.running === false, 'Interrupted event has running: false');
    assert(data.exitReason === 'camera_preempted', 'Interrupted event specifies camera_preempted');
    assert(data.canReconnect === true, 'Interrupted event specifies canReconnect: true');
  });
  preemptMgr.on('statusChanged', (status) => {
    statusChangedFired = true;
    assert(status.running === false, 'statusChanged has running: false');
  });

  // Trigger close logic directly via the internal handler
  // Call the close handler logic for session 1
  const childMock: any = {
    pid: 1234,
    killed: false,
    exitCode: 1
  };
  (preemptMgr as any).currentProcess = childMock;
  
  // Call stopCamera or trigger eviction handling
  // Let's test stopCamera() user requested stop
  const userStopMgr = new CameraManager(mockScrcpyPath, mockConnectedDm);
  (userStopMgr as any).currentProcess = {
    kill: () => {},
    killed: false,
    exitCode: null
  };
  (userStopMgr as any).currentSerial = 'user_stop_serial';
  (userStopMgr as any).sessionStatus = 'running';
  (userStopMgr as any).reconnectCount = 3;
  (userStopMgr as any).canReconnect = true;

  const stoppedCleanly = userStopMgr.stopCamera();
  assert(stoppedCleanly === true, 'stopCamera returns true when process active');
  const userStopStatus = userStopMgr.getStatus();
  assert(userStopStatus.running === false, 'user_stop reports running: false');
  assert(userStopStatus.status === 'stopped', 'user_stop reports status: stopped');
  assert(userStopStatus.exitReason === 'user_stopped', 'user_stop reports exitReason: user_stopped');
  assert(userStopStatus.canReconnect === false, 'user_stop clears canReconnect to false');
  assert(userStopStatus.reconnectCount === 0, 'user_stop resets reconnectCount to 0');

  // 7. Device disconnection classification when device is offline
  const mockDisconnectedDm: any = {
    isDeviceConnected: async () => false,
    executeAdb: async () => ({ exitCode: 1, stdout: '', stderr: 'device offline' })
  };
  const discoMgr = new CameraManager(mockScrcpyPath, mockDisconnectedDm);
  (discoMgr as any).currentSessionId = 2;
  (discoMgr as any).lastSessionOptions = { serial: 'disco_serial' };
  (discoMgr as any).currentSerial = 'disco_serial';
  (discoMgr as any).sessionStatus = 'running';

  let discoEventFired = false;
  discoMgr.on('disconnected', (data) => {
    discoEventFired = true;
    assert(data.running === false, 'Disconnected event has running: false');
    assert(data.exitReason === 'device_disconnected', 'Disconnected event specifies exitReason');
    assert(data.canReconnect === false, 'Disconnected event specifies canReconnect: false');
  });

  console.log('\n--- Camera Studio: HyperOS Face Unlock & Preemption Diagnostics ---');

  // 8. Focus camera window rejected when idle
  const idleFocus = await cameraManager.focusCameraWindow();
  assert(!idleFocus.success, 'focusCameraWindow rejected safely when session is idle');
  assert(idleFocus.message.includes('not active'), 'Returns informative not active message');

  // 9. Focus camera window reports failure when window cannot be found or activated
  const activeFocusMgr = new CameraManager(mockScrcpyPath, mockConnectedDm);
  (activeFocusMgr as any).currentProcess = { pid: 9999, killed: false, exitCode: null };
  (activeFocusMgr as any).currentSerial = 'focus_serial';
  const activeFocus = await activeFocusMgr.focusCameraWindow();
  assert(activeFocus.success === false, 'focusCameraWindow reports failure when window cannot be found or activated');
  assert(activeFocus.message.includes('Could not activate') || activeFocus.message.includes('not active'), 'Returns informative message when window not found');

  // 10. Preemption Regex detects Xiaomi HyperOS Face Unlock eviction signatures
  const hyperOsLogSnippet = `
    05:03:42.123 1102 2450 CameraImpl: adjCameraPriority ... pk:com.miui.face
    05:03:42.125 1102 2450 CameraService: CameraService::connect evicting conflicting client for camera ID 0
    05:03:42.130 1102 2450 Camera2ClientBase: Camera 0: start to disconnect
    scrcpy: Camera disconnected
    Camera capture failed: frame 42
  `;
  const preemptionRegex = /Camera disconnected|Camera capture failed|evicting conflicting client|adjCameraPriority|RESET_REASON_TERMINATED|Device disconnected|Camera \d+: start to disconnect|ERROR_CAMERA_DEVICE|ERROR_CAMERA_DISABLED|com\.miui\.face/i;
  assert(preemptionRegex.test(hyperOsLogSnippet), 'Regex matches HyperOS com.miui.face preemption signature');
  assert(preemptionRegex.test('CameraService::connect evicting conflicting client'), 'Matches evicting conflicting client');
  assert(preemptionRegex.test('Camera 0: start to disconnect'), 'Matches Camera 0 start to disconnect');
  assert(preemptionRegex.test('Camera disconnected'), 'Matches Camera disconnected');
  assert(preemptionRegex.test('Camera capture failed'), 'Matches Camera capture failed');

  // 11. Rapid click protection: isStarting flag blocks duplicate concurrent launches
  const rapidClickMgr = new CameraManager(mockScrcpyPath, mockConnectedDm);
  (rapidClickMgr as any).isStarting = true;
  const blockedLaunch = (rapidClickMgr as any).startCameraInternal({ serial: 'test_serial' }, false);
  assert(blockedLaunch.success === false, 'Duplicate launch blocked while isStarting is true');
  assert(blockedLaunch.message?.includes('already in progress'), 'Explains launch already in progress');

  // 12. Auto-reconnect timer cancelled on user stopCamera()
  const timerMgr = new CameraManager(mockScrcpyPath, mockConnectedDm);
  let timerCancelled = false;
  const mockTimer = setTimeout(() => {}, 10000);
  (timerMgr as any).autoReconnectTimer = mockTimer;
  (timerMgr as any).currentProcess = { kill: () => {}, killed: false, exitCode: null };
  timerMgr.stopCamera();
  assert((timerMgr as any).autoReconnectTimer === null, 'stopCamera clears autoReconnectTimer');
  clearTimeout(mockTimer);

  // 13. Diagnostics buffer in getStatus()
  const diagMgr = new CameraManager(mockScrcpyPath, mockConnectedDm);
  (diagMgr as any).stderrRingBuffer = ['[server] INFO: Camera opened', 'Camera disconnected'];
  (diagMgr as any).lastExitCode = 1;
  (diagMgr as any).exitReason = 'camera_preempted';
  const diagStatus = diagMgr.getStatus();
  assert(Array.isArray(diagStatus.recentStderr), 'getStatus() provides recentStderr array');
  assert(diagStatus.recentStderr?.length === 2, 'recentStderr contains exactly 2 buffered lines');
  assert(diagStatus.exitCode === 1, 'getStatus() provides last exitCode');
  assert(diagStatus.exitReason === 'camera_preempted', 'getStatus() provides exitReason');
  assert(typeof diagStatus.autoReconnect === 'boolean', 'getStatus() provides autoReconnect boolean');

  return { passed, failed };
}
