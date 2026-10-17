import path from 'path';
import fs from 'fs';
import {
  generateSvgOverlay,
  createSnapshotMetadata,
  TimelapseScheduler,
  OverlayConfig,
  TimelapseConfig
} from '../../modules/lab_inspection';

export async function runLabInspectionUnitTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed++;
      console.log(`  ✓ PASS: ${message}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL: ${message}`);
    }
  }

  function assertEqual<T>(actual: T, expected: T, message: string) {
    assert(actual === expected, `${message} (Expected: ${expected}, Got: ${actual})`);
  }

  console.log('\n--- Section: Lab & Inspection Engine Unit Tests (Phase 7.1) ---');

  // Test 1: Overlay generation - none
  const emptySvg = generateSvgOverlay(1920, 1080, {
    type: 'none',
    color: '#38bdf8',
    opacity: 0.8,
    showTimestamp: false,
    showCoordinates: false
  });
  assert(emptySvg.includes('<svg') && emptySvg.includes('viewBox="0 0 1920 1080"'), 'Empty overlay produces valid root SVG container');
  assert(!emptySvg.includes('<line'), 'None overlay contains zero grid lines');

  // Test 2: Overlay generation - Rule of Thirds
  const thirdsConfig: OverlayConfig = {
    type: 'grid_thirds',
    color: '#38bdf8',
    opacity: 0.8,
    lineWidth: 2,
    showTimestamp: true,
    showCoordinates: true,
    customLabel: 'DUT Sample Alignment'
  };
  const thirdsSvg = generateSvgOverlay(1920, 1080, thirdsConfig, {
    timestamp: '2026-10-17 21:00:00'
  });
  assert(thirdsSvg.includes('stroke="#38bdf8"'), 'Rule of Thirds uses configured stroke color');
  assert(thirdsSvg.includes('x1="640"'), 'Rule of Thirds divides 1920 width at 640px (1/3)');
  assert(thirdsSvg.includes('x1="1280"'), 'Rule of Thirds divides 1920 width at 1280px (2/3)');
  assert(thirdsSvg.includes('y1="360"'), 'Rule of Thirds divides 1080 height at 360px (1/3)');
  assert(thirdsSvg.includes('UTC: 2026-10-17 21:00:00'), 'Timestamp watermark embedded');
  assert(thirdsSvg.includes('[Relative Uncalibrated]'), 'Relative uncalibrated disclaimer present');
  assert(thirdsSvg.includes('DUT Sample Alignment'), 'Custom label embedded in SVG');

  // Test 3: Overlay generation - Fine Grid 10x10
  const fineSvg = generateSvgOverlay(1000, 1000, {
    type: 'grid_fine',
    color: '#10b981',
    opacity: 0.5,
    showTimestamp: false,
    showCoordinates: true
  });
  assert(fineSvg.includes('stroke-dasharray="3,3"'), 'Fine Grid generates precision dashed measurement lines');
  assert(fineSvg.includes('x1="100"'), 'Fine grid steps every 10% (100px on 1000px frame)');

  // Test 4: Overlay generation - Precision Crosshairs
  const crosshairSvg = generateSvgOverlay(800, 600, {
    type: 'crosshair',
    color: '#f43f5e',
    opacity: 0.9,
    showTimestamp: false,
    showCoordinates: false
  });
  assert(crosshairSvg.includes('x1="400"'), 'Crosshair vertical axis centered at 400px (800/2)');
  assert(crosshairSvg.includes('y1="300"'), 'Crosshair horizontal axis centered at 300px (600/2)');
  assert(crosshairSvg.includes('r="25"'), 'Crosshair inner reticle circle present');

  // Test 5: Overlay generation - Inspection Reticle
  const reticleSvg = generateSvgOverlay(1280, 720, {
    type: 'reticle',
    color: '#eab308',
    opacity: 0.85,
    showTimestamp: false,
    showCoordinates: false
  });
  assert(reticleSvg.includes('r="40"') && reticleSvg.includes('r="90"') && reticleSvg.includes('r="160"'), 'Reticle includes concentric calibration circles');
  assert(reticleSvg.includes('r="2.5"'), 'Reticle center focal point rendered');

  // Test 6: Snapshot Metadata Creator
  const meta = createSnapshotMetadata({
    deviceId: 'test_phone_serial_123',
    sensorId: '0',
    lensFacing: 'back',
    zoomLevel: 2.5,
    overlayType: 'crosshair',
    imageWidth: 4000,
    imageHeight: 3000
  });
  assertEqual(meta.deviceId, 'test_phone_serial_123', 'SnapshotMetadata records device serial');
  assertEqual(meta.sensorId, '0', 'SnapshotMetadata records camera sensor ID');
  assertEqual(meta.zoomLevel, 2.5, 'SnapshotMetadata records optical/digital zoom factor');
  assertEqual(meta.isCalibrated, false, 'SnapshotMetadata strictly marks calibration as false');
  assert(meta.calibrationNote.includes('uncalibrated sensor pixels'), 'SnapshotMetadata contains explicit uncalibrated disclaimer');

  // Test 7: Timelapse Scheduler - Validation
  const scheduler = new TimelapseScheduler();
  const testDir = path.resolve(process.cwd(), 'Captures/test-timelapse');

  const invalidIntervalRes = await scheduler.start({
    intervalSeconds: 0,
    maxFrames: 10,
    outputDir: testDir
  }, async () => '');
  assert(!invalidIntervalRes.success, 'Scheduler rejects interval < 1s');

  const invalidFramesRes = await scheduler.start({
    intervalSeconds: 2,
    maxFrames: 5000,
    outputDir: testDir
  }, async () => '');
  assert(!invalidFramesRes.success, 'Scheduler rejects maxFrames > 3600');

  // Test 8: Timelapse Scheduler - Execution & Manifest Generation
  let framesCaptured = 0;
  const mockCaptureFrame = async (frameNum: number): Promise<string> => {
    framesCaptured++;
    const frameFile = path.join(testDir, `frame_${String(frameNum).padStart(4, '0')}.jpg`);
    fs.writeFileSync(frameFile, `mock-jpeg-frame-data-${frameNum}`, 'utf8');
    return frameFile;
  };

  const startRes = await scheduler.start({
    intervalSeconds: 1,
    maxFrames: 3,
    outputDir: testDir
  }, mockCaptureFrame);

  assert(startRes.success, 'Scheduler started successfully with valid config');
  assert(scheduler.getStatus().running, 'Scheduler status is running');
  assertEqual(scheduler.getStatus().totalFrames, 3, 'Total frames set to 3');
  assertEqual(framesCaptured, 1, 'Initial frame 1 captured immediately upon start');

  // Wait 2.2 seconds for frames 2 and 3 to execute and complete
  await new Promise(r => setTimeout(r, 2200));

  assert(!scheduler.getStatus().running, 'Scheduler auto-stopped upon reaching maxFrames limit (3)');
  assertEqual(framesCaptured, 3, 'Exactly 3 frames captured');

  // Verify manifest file generated on disk
  const manifestPath = path.join(testDir, 'timelapse_manifest.json');
  assert(fs.existsSync(manifestPath), 'timelapse_manifest.json generated in destination directory');

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assertEqual(manifest.totalFrames, 3, 'Manifest records totalFrames 3');
    assertEqual(manifest.frames.length, 3, 'Manifest lists all 3 captured frame records');
    assertEqual(manifest.frames[0].frameNumber, 1, 'First frame numbered 1');
  }

  // Cleanup test files
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  // Test 9: Manual Stop
  const manualScheduler = new TimelapseScheduler();
  await manualScheduler.start({
    intervalSeconds: 5,
    maxFrames: 100,
    outputDir: testDir
  }, async (num) => path.join(testDir, `f_${num}.jpg`));

  assert(manualScheduler.getStatus().running, 'Manual scheduler running');
  manualScheduler.stop();
  assert(!manualScheduler.getStatus().running, 'Scheduler stopped cleanly on manual stop() call');

  // Cleanup test directory if created
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  return { passed, failed };
}
