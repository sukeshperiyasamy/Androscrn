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

  return { passed, failed };
}
