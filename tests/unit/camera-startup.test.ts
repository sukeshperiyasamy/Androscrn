import { describeCameraStartupFailure } from '../../modules/camera_manager';

type AssertFn = (condition: boolean, message: string) => void;

export async function runCameraStartupUnitTests(assert: AssertFn): Promise<void> {
  console.log('\nTest Group: Camera start-up failure explanations');
  // Real scrcpy 5.0.1 output from a Xiaomi 21091116I asked for high-speed on camera 0
  const hsFailure = ["[server] INFO: Using camera '0'", '[server] ERROR: Camera configuration error', 'ERROR: Demuxer error'];
  const hs = describeCameraStartupFailure(hsFailure, { highSpeed: true, size: '1280x720', fps: 120 });
  assert(/high-speed/i.test(hs) && /another camera/i.test(hs), 'High-speed configuration error explains the camera does not support it and suggests another camera');
  assert(!/Demuxer/i.test(hs), 'Generic last line (Demuxer error) is not shown as the reason');

  const normal = describeCameraStartupFailure(hsFailure, { size: '4000x3000', fps: 30 });
  assert(/rejected/.test(normal) && /4000x3000/.test(normal) && /lower resolution/.test(normal), 'Non-high-speed configuration error names the setting and suggests lowering it');

  const enc = describeCameraStartupFailure(['[server] ERROR: Capture/encoding error: java.lang.IllegalArgumentException: null', 'ERROR: Demuxer error']);
  assert(/smaller capture resolution/.test(enc), 'Encoder rejection suggests a smaller resolution');

  const busy = describeCameraStartupFailure(['ERROR: Camera is in use by another client']);
  assert(/in use/.test(busy), 'Camera in use is reported');

  const unknown = describeCameraStartupFailure(['ERROR: something unexpected']);
  assert(/Diagnostics/.test(unknown), 'Unknown failures point to Diagnostics for details');
}
