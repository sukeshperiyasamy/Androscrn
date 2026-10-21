import { DeviceManager } from '../../modules/device_manager';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

/** DeviceManager test double: scripted `adb` output, counts every invocation. */
function scripted(devicesOut: () => string) {
  const dm = new DeviceManager('mock/adb.exe');
  const calls: string[] = [];
  (dm as any).executeAdb = async (args: string[]) => {
    const cmd = (args[0] === '-s' ? args.slice(2) : args).join(' ');
    calls.push(cmd);
    if (cmd === 'devices -l') return { stdout: devicesOut(), stderr: '', code: 0 };
    if (cmd.startsWith('shell getprop')) return { stdout: '[ro.product.manufacturer]: [Xiaomi]\n[ro.build.version.release]: [13]\n[ro.build.version.sdk]: [33]\n', stderr: '', code: 0 };
    if (cmd.startsWith('shell dumpsys battery')) return { stdout: '  level: 87\n', stderr: '', code: 0 };
    return { stdout: '', stderr: '', code: 0 };
  };
  return { dm, calls };
}

export async function runDeviceCacheUnitTests(assert: AssertFn, assertEqual: AssertEqualFn): Promise<void> {
  console.log('\nTest Group: Device polling cache (getprop / battery)');
  let list = 'List of devices attached\nABC123 device product:p model:M device:d transport_id:1\n';
  const { dm, calls } = scripted(() => list);

  const first = await dm.getDevicesDetailed();
  assertEqual(first[0].manufacturer, 'Xiaomi', 'First poll reads device properties');
  const firstCalls = calls.length;
  assert(calls.some(c => c.startsWith('shell getprop')), 'First poll runs getprop');

  calls.length = 0;
  const second = await dm.getDevicesDetailed();
  assertEqual(calls.join('|'), 'devices -l', 'Steady-state poll runs only `adb devices -l`');
  assertEqual(second[0].manufacturer, 'Xiaomi', 'Cached properties are still reported');
  assertEqual(second[0].androidVersion, '13', 'Cached Android version is still reported');
  assert(firstCalls >= 3, 'First poll did the full read (devices + battery + getprop)');

  // Device leaves -> cache dropped; when it returns the properties are read again
  list = 'List of devices attached\n';
  await dm.getDevicesDetailed();
  list = 'List of devices attached\nABC123 device product:p model:M device:d transport_id:2\n';
  calls.length = 0;
  await dm.getDevicesDetailed();
  assert(calls.some(c => c.startsWith('shell getprop')), 'Reconnected device gets fresh properties');

  // Unauthorized device is never probed and does not keep a cache entry
  list = 'List of devices attached\nABC123 unauthorized transport_id:3\n';
  calls.length = 0;
  const unauth = await dm.getDevicesDetailed();
  assertEqual(calls.join('|'), 'devices -l', 'Unauthorized device is not probed');
  assertEqual(unauth[0].manufacturer, undefined, 'Unauthorized device reports no stale cached properties');
}
