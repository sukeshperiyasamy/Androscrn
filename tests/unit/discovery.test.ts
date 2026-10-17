import fs from 'fs';
import path from 'path';
import { DeviceManager, AndroidDevice } from '../../modules/device_manager';
import { ConnectionManager } from '../../modules/connection_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';
import { SecurityValidator } from '../../modules/security';
import {
  WirelessDiscovery,
  parseMdnsServices,
  parseConnectRequest,
  parsePairRequest,
  parseDeviceHelpRequest,
  DISCOVERY_TTL_MS
} from '../../modules/wireless_discovery';
import {
  getOemGuidance,
  getConnectionGuidance,
  buildDeviceHelp,
  isInputInjectionBlocked,
  detectXiaomiFamily
} from '../../modules/oem_guidance';

type AssertFn = (condition: boolean, name: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, name: string) => void;

const DEVICES_LIST = [
  'List of devices attached',
  'R58M123XYZ            device usb:1-2 product:lisa model:21091116I device:lisa transport_id:1',
  '192.168.1.60:5555     device product:x model:Pixel_7 device:panther transport_id:2',
  'adb-ABCD1234EFGH-xYz9Qa._adb-tls-connect._tcp unauthorized transport_id:3',
  'emulator-5554         offline transport_id:4',
  'ZX1G22BBBB            no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html]',
  'WEIRD0001             somethingnew',
  ''
].join('\n');

const MDNS_OUTPUT = [
  'List of discovered mdns services',
  'adb-ABCD1234EFGH-xYz9Qa\t_adb-tls-connect._tcp\t192.168.1.77:41555',
  'adb-ABCD1234EFGH-xYz9Qa\t_adb-tls-pairing._tcp\t192.168.1.77:37123',
  'garbage line',
  'adb-PUBLIC00-aaaa\t_adb-tls-connect._tcp\t8.8.8.8:5555',
  'adb-IPV6000-bbbb\t_adb-tls-connect._tcp\t[fe80::1]:5555',
  'adb-OTHER000-cccc\t_airplay._tcp\t192.168.1.90:7000',
  'adb-BADPORT0-dddd\t_adb-tls-connect._tcp\t192.168.1.91:99999',
  'adb-ABCD1234EFGH-xYz9Qa\t_adb-tls-connect._tcp\t192.168.1.77:41555',
  'bad name!\t_adb-tls-connect._tcp\t192.168.1.92:5555',
  ''
].join('\n');

function mockAdb(dm: DeviceManager, handler: (args: string[], signal?: AbortSignal) => any) {
  (dm as any).executeAdb = async (args: string[], _timeout?: number, signal?: AbortSignal) => handler(args, signal);
}

function okResult(stdout = '', stderr = '', code = 0) {
  return { stdout, stderr, code };
}

export async function runDiscoveryTests(assert: AssertFn, assertEqual: AssertEqualFn) {
  console.log('\nTest Group 10: Smart Device Discovery & Compatibility Expansion');

  // ---------------------------------------------------------------------------------------------
  // 1 & 3. ADB device parsing, states, link types, missing properties
  // ---------------------------------------------------------------------------------------------
  const dm = new DeviceManager('C:\\nonexistent\\adb.exe');
  const parsed = dm.parseDevicesOutput(DEVICES_LIST);
  assertEqual(parsed.length, 6, 'Parser returns every attached entry across mixed states');
  const bySerial = (s: string) => parsed.find(d => d.serial === s) as AndroidDevice;

  assertEqual(bySerial('R58M123XYZ').state, 'device', 'USB device state is "device"');
  assertEqual(bySerial('R58M123XYZ').connectionType, 'usb', 'USB serial classified as usb');
  assertEqual(bySerial('R58M123XYZ').model, '21091116I', 'Model parsed from device line');
  assertEqual(bySerial('192.168.1.60:5555').connectionType, 'tcpip', 'IP:port serial classified as classic TCP/IP');
  assertEqual(bySerial('192.168.1.60:5555').ipAddress, '192.168.1.60', 'TCP/IP device exposes IP address');
  const mdnsDev = parsed.find(d => d.serial.includes('_adb-tls-connect'))!;
  assertEqual(mdnsDev.connectionType, 'wireless-debugging', 'mDNS-style serial classified as wireless debugging, not USB');
  assertEqual(mdnsDev.transportType, 'wifi', 'mDNS-style serial reports Wi-Fi transport');
  assertEqual(mdnsDev.state, 'unauthorized', 'Unauthorized state recognized');
  assertEqual(bySerial('emulator-5554').state, 'offline', 'Offline state recognized');
  assertEqual(bySerial('emulator-5554').connectionType, 'emulator', 'Emulator serial classified as emulator');
  assertEqual(bySerial('ZX1G22BBBB').state, 'no permissions', '"no permissions" state recognized');
  assertEqual(bySerial('WEIRD0001').state, 'unknown', 'Unrecognized state maps to unknown without crashing');
  assertEqual(bySerial('WEIRD0001').rawState, 'somethingnew', 'Raw state preserved for unknown states');
  assertEqual(bySerial('WEIRD0001').model, 'Android Device', 'Missing model falls back to default label');

  for (const state of ['recovery', 'sideload', 'bootloader', 'connecting', 'authorizing']) {
    const d = dm.parseDevicesOutput(`SER123456 ${state}`)[0];
    assertEqual(d.state, state as any, `State "${state}" recognized`);
  }

  const empty = dm.parseDevicesOutput('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n');
  assertEqual(empty.length, 0, 'ADB daemon banner lines are not parsed as devices');

  assertEqual(JSON.stringify(DeviceManager.parseDeviceProperties('')), '{}', 'Empty getprop output yields no properties');
  const props = DeviceManager.parseDeviceProperties(
    [
      '[ro.product.manufacturer]: [Xiaomi]',
      '[ro.product.brand]: [Redmi]',
      '[ro.build.version.release]: [13]',
      '[ro.build.version.sdk]: [33]',
      '[ro.mi.os.version.name]: [V816]',
      '[ro.serialno]: [R58M123XYZ]',
      '[persist.sys.email]: [me@example.com]',
      'not a property line'
    ].join('\r\n')
  );
  assertEqual(props.manufacturer, 'Xiaomi', 'Manufacturer parsed from getprop');
  assertEqual(props.androidVersion, '13', 'Android version parsed');
  assertEqual(props.apiLevel, 33, 'API level parsed as number');
  assert(!JSON.stringify(props).includes('R58M123XYZ') && !JSON.stringify(props).includes('example.com'), 'Only allow-listed properties are retained (no serial or personal data)');
  const partial = DeviceManager.parseDeviceProperties('[ro.build.version.sdk]: [notanumber]\n[ro.product.model]: []');
  assertEqual(JSON.stringify(partial), '{}', 'Malformed or empty property values are dropped');

  // Detailed enumeration: property failure must not remove or crash a device
  const dmDetail = new DeviceManager('C:\\nonexistent\\adb.exe');
  mockAdb(dmDetail, args => {
    if (args[0] === 'devices') return okResult('List of devices attached\nAAAA1111 device model:Foo\nBBBB2222 device\n');
    if (args.includes('dumpsys')) return okResult('  level: 80');
    if (args.includes('getprop') && args[1] === 'AAAA1111') {
      return okResult('[ro.product.manufacturer]: [samsung]\n[ro.build.version.release]: [14]\n[ro.build.version.sdk]: [34]\n');
    }
    if (args.includes('getprop')) return okResult('', 'error: closed', 1);
    return okResult();
  });
  const detailed = await dmDetail.getDevicesDetailed();
  assertEqual(detailed.length, 2, 'Detailed enumeration keeps all devices when one property query fails');
  assertEqual(detailed.find(d => d.serial === 'AAAA1111')?.manufacturer, 'samsung', 'Detailed enumeration adds manufacturer');
  assertEqual(detailed.find(d => d.serial === 'AAAA1111')?.apiLevel, 34, 'Detailed enumeration adds API level');
  assertEqual(detailed.find(d => d.serial === 'BBBB2222')?.manufacturer, undefined, 'Failed property query leaves manufacturer undefined');
  assertEqual(JSON.stringify(await dmDetail.getDeviceProperties('bad; serial')), '{}', 'Invalid serial yields no properties');

  // ---------------------------------------------------------------------------------------------
  // 2. Multiple devices: never guess the target
  // ---------------------------------------------------------------------------------------------
  const two = dm.parseDevicesOutput('AAAA1111 device model:A\nBBBB2222 device model:B');
  const ambiguous = DeviceManager.resolveTargetSerial(two) as any;
  assert(!ambiguous.ok && ambiguous.reason === 'ambiguous', 'Two ready devices with no explicit serial is ambiguous');
  const explicit = DeviceManager.resolveTargetSerial(two, 'BBBB2222') as any;
  assert(explicit.ok && explicit.serial === 'BBBB2222', 'Explicit serial selects exactly that device');
  const missing = DeviceManager.resolveTargetSerial(two, 'CCCC3333') as any;
  assert(!missing.ok && missing.reason === 'not-found', 'Unknown serial is rejected');
  const mixed = dm.parseDevicesOutput('AAAA1111 device\nBBBB2222 unauthorized');
  const onlyReady = DeviceManager.resolveTargetSerial(mixed) as any;
  assert(onlyReady.ok && onlyReady.serial === 'AAAA1111', 'Single authorized device is selected automatically');
  const notReady = DeviceManager.resolveTargetSerial(mixed, 'BBBB2222') as any;
  assert(!notReady.ok && notReady.reason === 'not-ready' && notReady.message.includes('unauthorized'), 'Unauthorized device explicitly requested reports actionable guidance');
  const none = DeviceManager.resolveTargetSerial([]) as any;
  assert(!none.ok && none.reason === 'none', 'No devices reports none');

  // ---------------------------------------------------------------------------------------------
  // 4. Missing ADB binary and timeouts
  // ---------------------------------------------------------------------------------------------
  const missingDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  const missingDisc = new WirelessDiscovery(missingDm, new ConnectionManager(missingDm));
  const missingRes = await missingDisc.discover();
  assert(!missingRes.success && !missingRes.supported, 'Discovery with missing ADB reports unsupported instead of throwing');
  assert(missingRes.fallback.length >= 3, 'Missing ADB result includes USB and manual wireless fallbacks');
  assert(missingRes.fallback.some(f => /USB/.test(f)) && missingRes.fallback.some(f => /pairing code/i.test(f)), 'Fallbacks mention USB and pairing-code flow');
  assertEqual(missingDisc.isRunning, false, 'Discovery flag cleared after failure');

  // Real subprocess timeout, using node.exe (path contains spaces on most Windows installs) as a stand-in ADB
  const nodeAdb = new DeviceManager(process.execPath);
  const started = Date.now();
  const slow = await nodeAdb.executeAdb(['-e', 'setTimeout(()=>{},30000)'], 300);
  assertEqual(slow.code, -1, 'Hung ADB command returns -1 after timeout');
  assert(slow.stderr.includes('timed out'), 'Timeout is reported in stderr');
  assert(Date.now() - started < 5000, 'Timed-out process is terminated promptly');

  // Discovery timeout surfaced distinctly
  const timeoutDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mockAdb(timeoutDm, args => {
    if (args[1] === 'check') return okResult('mdns daemon version [Openscreen]');
    if (args[1] === 'services') return { stdout: '', stderr: '\nCommand timed out.', code: -1 };
    return okResult('List of devices attached\n');
  });
  const timeoutRes = await new WirelessDiscovery(timeoutDm, new ConnectionManager(timeoutDm)).discover({ timeoutMs: 50 });
  assert(timeoutRes.timedOut && !timeoutRes.success, 'Discovery timeout is reported as timedOut');

  // mDNS unsupported by the bundled ADB
  const noMdnsDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mockAdb(noMdnsDm, args => (args[1] === 'check' ? okResult('', 'adb: unknown command mdns', 1) : okResult()));
  const noMdns = await new WirelessDiscovery(noMdnsDm, new ConnectionManager(noMdnsDm)).discover();
  assert(!noMdns.supported && !noMdns.success, 'Unsupported mDNS is reported as unsupported');
  assert(noMdns.fallback.length > 0, 'Unsupported mDNS provides a USB/manual fallback');

  // ---------------------------------------------------------------------------------------------
  // 5 & 7. Wireless discovery results, malformed records, pairing-required vs authorized
  // ---------------------------------------------------------------------------------------------
  const parsedMdns = parseMdnsServices(MDNS_OUTPUT);
  assertEqual(parsedMdns.endpoints.length, 2, 'Only valid, local, unique connect/pairing endpoints survive parsing');
  assertEqual(parsedMdns.ignored.length, 6, 'Malformed, public, IPv6, unknown-type, bad-port and bad-name records are counted as ignored');
  assert(parsedMdns.ignored.some(i => i.reason.includes('outside the local network')), 'Public IP endpoint is rejected');
  assert(parsedMdns.ignored.some(i => i.reason.includes('not an IPv4')), 'IPv6 endpoint is rejected');
  assert(parsedMdns.endpoints.every(e => !e.label.includes('ABCD1234EFGH')), 'Endpoint labels redact the device serial');
  assertEqual(parseMdnsServices('').endpoints.length, 0, 'Empty mDNS output yields no endpoints');
  assertEqual(parseMdnsServices('\u0000\u0001 binary \u0002').endpoints.length, 0, 'Binary garbage never throws and yields no endpoints');

  const discDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  let devicesOut = 'List of devices attached\n';
  mockAdb(discDm, args => {
    if (args[0] === 'mdns' && args[1] === 'check') return okResult('mdns daemon version [Openscreen]');
    if (args[0] === 'mdns' && args[1] === 'services') return okResult(MDNS_OUTPUT);
    if (args[0] === 'devices') return okResult(devicesOut);
    return okResult();
  });
  const connectCalls: Array<[string, number]> = [];
  const pairCalls: Array<[string, number, string]> = [];
  const fakeConn: any = {
    connectWireless: async (ip: string, port: number) => {
      connectCalls.push([ip, port]);
      return { success: true, message: `Connected to ${ip}:${port}` };
    },
    pairWireless: async (ip: string, port: number, pin: string) => {
      pairCalls.push([ip, port, pin]);
      return { success: pin === '123456', message: `Pairing ${pin === '123456' ? 'ok' : 'failed'} for code ${pin}` };
    }
  };
  let clock = 1_000_000;
  const disc = new WirelessDiscovery(discDm, fakeConn as ConnectionManager, () => clock);
  const first = await disc.discover();
  assert(first.success && first.supported, 'Discovery succeeds with mocked mDNS output');
  assertEqual(first.endpoints.length, 2, 'Discovery returns the two valid endpoints');
  assertEqual(first.ignoredCount, 6, 'Discovery reports how many records were ignored');
  assertEqual(first.mdnsVersion, 'Openscreen', 'mDNS daemon version surfaced');
  const pairingEp = first.endpoints.find(e => e.kind === 'pairing')!;
  const connectEp = first.endpoints.find(e => e.kind === 'connect')!;
  assertEqual(pairingEp.status, 'pairing-required', 'Pairing service reported as pairing-required');
  assertEqual(connectEp.status, 'connectable', 'Unpaired connect service is connectable with pairing caveat');
  assert(connectEp.note.toLowerCase().includes('pair first'), 'Connectable note tells the user to pair first');
  assertEqual(connectCalls.length + pairCalls.length, 0, 'Discovery alone never connects or pairs');
  assert(/^[a-f0-9]{16}$/.test(connectEp.id), 'Endpoints are exposed through opaque 16-hex handles');
  assert(!JSON.stringify(first).includes('ABCD1234EFGH'), 'Discovery result never contains the raw device serial');

  devicesOut = 'List of devices attached\n192.168.1.77:41555 device product:x model:Pixel_7\n';
  const authorized = await disc.discover();
  assertEqual(authorized.endpoints.find(e => e.kind === 'connect')?.status, 'connected', 'Already-authorized endpoint reported as connected');

  devicesOut = 'List of devices attached\n192.168.1.77:41555 unauthorized\n';
  const unauth = await disc.discover();
  assertEqual(unauth.endpoints.find(e => e.kind === 'connect')?.status, 'needs-authorization', 'Unauthorized endpoint reported as needing authorization');

  devicesOut = 'List of devices attached\n';
  const fresh = await disc.discover();
  const freshConnect = fresh.endpoints.find(e => e.kind === 'connect')!;
  const freshPair = fresh.endpoints.find(e => e.kind === 'pairing')!;

  // Confirmation & handle validation
  const decline = await disc.connect(freshConnect.id, async () => false);
  assert(!decline.success && decline.cancelled === true, 'Declining the confirmation cancels the connection');
  assertEqual(connectCalls.length, 0, 'No connection is attempted without confirmation');
  const wrongKind = await disc.connect(freshPair.id, async () => true);
  assert(!wrongKind.success && wrongKind.message.includes('pairing'), 'A pairing endpoint cannot be used to connect');
  const badId = await disc.connect('../../etc/passwd', async () => true);
  assert(!badId.success && badId.message.includes('Invalid'), 'Malformed endpoint handle is rejected');
  const unknownId = await disc.connect('0123456789abcdef', async () => true);
  assert(!unknownId.success && unknownId.message.includes('Discover again'), 'Unissued endpoint handle is rejected');
  const approved = await disc.connect(freshConnect.id, async d => {
    return d.action === 'connect' && d.ip === '192.168.1.77' && d.port === 41555;
  });
  assert(approved.success && connectCalls.length === 1, 'Confirmed connect reaches ConnectionManager with the discovered endpoint');
  assertEqual(`${connectCalls[0][0]}:${connectCalls[0][1]}`, '192.168.1.77:41555', 'Connect uses the validated discovered IP and port only');

  const shortPin = await disc.pair(freshPair.id, '12', async () => true);
  assert(!shortPin.success && pairCalls.length === 0, 'Invalid pairing code is rejected before any ADB call');
  const wrongPin = await disc.pair(freshPair.id, '000000', async () => true);
  assert(!wrongPin.success && !wrongPin.message.includes('000000'), 'Failed pairing never echoes the pairing code');
  const rightPin = await disc.pair(freshPair.id, '123456', async () => true);
  assert(rightPin.success && !rightPin.message.includes('123456'), 'Successful pairing never echoes the pairing code');
  const pairDeclined = await disc.pair(freshPair.id, '123456', async () => false);
  assert(pairDeclined.cancelled === true, 'Declined pairing is reported as cancelled');
  const pairWithConnectEp = await disc.pair(freshConnect.id, '123456', async () => true);
  assert(!pairWithConnectEp.success, 'A connect endpoint cannot be used to pair');

  clock += DISCOVERY_TTL_MS + 1;
  const expired = await disc.connect(freshConnect.id, async () => true);
  assert(!expired.success && expired.message.includes('expired'), 'Stale discovery results expire');

  // ---------------------------------------------------------------------------------------------
  // 6. Cancellation and cleanup
  // ---------------------------------------------------------------------------------------------
  const cancelDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  let fastServices = false;
  mockAdb(cancelDm, (args, signal) => {
    if (args[1] === 'check') return okResult('mdns daemon version [Openscreen]');
    if (args[1] === 'services') {
      if (fastServices) return okResult(MDNS_OUTPUT);
      return new Promise(resolve => {
        const t = setTimeout(() => resolve(okResult(MDNS_OUTPUT)), 5000);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve({ stdout: '', stderr: 'Command cancelled.', code: -1, aborted: true });
        });
      });
    }
    return okResult('List of devices attached\n');
  });
  const cancelDisc = new WirelessDiscovery(cancelDm, fakeConn as ConnectionManager);
  const pending = cancelDisc.discover({ timeoutMs: 10000 });
  await new Promise(r => setTimeout(r, 50));
  assertEqual(cancelDisc.isRunning, true, 'Discovery reports running while in flight');
  const concurrent = await cancelDisc.discover();
  assert(!concurrent.success && concurrent.message.includes('already running'), 'Overlapping discovery is refused');
  cancelDisc.cancel();
  const cancelled = await pending;
  assert(cancelled.cancelled && !cancelled.success, 'Cancelled discovery returns cancelled');
  assertEqual(cancelled.endpoints.length, 0, 'Cancelled discovery returns no endpoints');
  assertEqual(cancelDisc.isRunning, false, 'Running flag is cleared after cancellation');
  fastServices = true;
  const afterCancel = await cancelDisc.discover();
  assert(afterCancel.success && afterCancel.endpoints.length === 2, 'The same instance can run a fresh discovery after cancellation');

  // Real child process is killed on abort (no orphaned ADB processes)
  const ac = new AbortController();
  const t0 = Date.now();
  const killPromise = nodeAdb.executeAdb(['-e', 'setTimeout(()=>{},30000)'], 20000, ac.signal);
  setTimeout(() => ac.abort(), 150);
  const killed = await killPromise;
  assert(killed.aborted === true && killed.code === -1, 'Aborting executeAdb terminates the child and reports aborted');
  assert(Date.now() - t0 < 5000, 'Aborted process exits promptly instead of waiting for its timeout');
  const preAborted = new AbortController();
  preAborted.abort();
  const preRes = await nodeAdb.executeAdb(['-e', 'setTimeout(()=>{},30000)'], 20000, preAborted.signal);
  assert(preRes.aborted === true, 'Already-aborted signal short-circuits the command');

  // ---------------------------------------------------------------------------------------------
  // 8. OEM guidance
  // ---------------------------------------------------------------------------------------------
  assertEqual(detectXiaomiFamily({ manufacturer: 'Xiaomi', brand: 'Redmi' }), 'Redmi', 'Redmi brand recognized');
  assertEqual(detectXiaomiFamily({ manufacturer: 'Xiaomi', brand: 'POCO' }), 'POCO', 'POCO brand recognized');
  assertEqual(detectXiaomiFamily({ manufacturer: 'XIAOMI' }), 'Xiaomi', 'Manufacturer match is case-insensitive');
  assertEqual(detectXiaomiFamily({ manufacturer: 'samsung' }), null, 'Non-Xiaomi manufacturer not recognized');

  const xiaomi = getOemGuidance({ manufacturer: 'Xiaomi', brand: 'Redmi', model: '21091116I', osSkin: 'MIUI V130' });
  assertEqual(xiaomi.length, 1, 'Xiaomi device yields one guidance entry');
  assertEqual(xiaomi[0].feature, 'input-injection', 'Xiaomi guidance targets input injection');
  assertEqual(xiaomi[0].evidence, 'documented', 'Xiaomi guidance carries documented evidence level');
  assert(xiaomi[0].uncertainty.length > 0, 'Xiaomi guidance states its uncertainty');
  assert(xiaomi[0].restriction.includes('MIUI V130'), 'Detected system skin appears in the explanation');
  assert(!/\bSIM\b/i.test(JSON.stringify(xiaomi)), 'Guidance does not claim a SIM requirement');
  assert(!/universal|always required|must be enabled/i.test(xiaomi[0].restriction + xiaomi[0].uncertainty), 'Guidance avoids universal claims');
  assert(xiaomi[0].steps.every(s => !/\badb\b|shell|setprop|settings put/i.test(s)), 'Guidance steps are user actions, not privileged commands');
  assert(!!xiaomi[0].reference?.url.startsWith('https://'), 'Guidance includes a documentation reference');

  const samsung = getOemGuidance({ manufacturer: 'samsung' });
  assertEqual(samsung.length, 1, 'Unrecognized manufacturer still returns guidance');
  assertEqual(samsung[0].evidence, 'none', 'Unrecognized manufacturer guidance is labelled general advice');
  assert(samsung[0].title.includes('samsung'), 'Unrecognized manufacturer guidance names the manufacturer');
  assertEqual(getOemGuidance(undefined)[0].manufacturer, 'Unknown', 'Missing device info still produces useful guidance');
  assertEqual(getOemGuidance(null).length, 1, 'Null device info does not throw');

  const unauthGuide = getConnectionGuidance('unauthorized', 'usb');
  assert(!!unauthGuide && unauthGuide.steps.some(s => /Allow USB debugging/.test(s)), 'Unauthorized guidance explains the RSA prompt');
  const unauthWireless = getConnectionGuidance('unauthorized', 'wireless-debugging');
  assert(!!unauthWireless && unauthWireless.steps.some(s => /pairing code/i.test(s)), 'Unauthorized wireless guidance points to the pairing-code flow');
  assert(!!getConnectionGuidance('offline', 'usb')?.steps.some(s => /cable/i.test(s)), 'Offline USB guidance mentions the cable');
  assert(!!getConnectionGuidance('offline', 'tcpip')?.steps.some(s => /same network/i.test(s)), 'Offline wireless guidance mentions the network');
  assertEqual(getConnectionGuidance('device', 'usb'), null, 'Ready device has no connection guidance');

  const helpUnauth = buildDeviceHelp({ state: 'unauthorized', manufacturer: 'Xiaomi', connectionType: 'usb' });
  assert(!!helpUnauth.connection && helpUnauth.vendor.length === 0, 'Connection problems are not mixed with vendor input restrictions');
  const helpReady = buildDeviceHelp({ state: 'device', manufacturer: 'Xiaomi', brand: 'Redmi', connectionType: 'usb' });
  assert(helpReady.connection === null && helpReady.vendor.length === 1, 'Ready Xiaomi device shows vendor guidance only');
  assertEqual(buildDeviceHelp({ state: 'device', manufacturer: 'Xiaomi' }).key, buildDeviceHelp({ state: 'device', manufacturer: 'Xiaomi' }).key, 'Guidance key is stable so identical help is not re-announced');
  assert(helpUnauth.key !== helpReady.key, 'Guidance key changes when the situation changes');
  assertEqual(buildDeviceHelp(null).key, 'none', 'No selected device yields empty help');

  assert(isInputInjectionBlocked({ stderr: 'java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission' }), 'INJECT_EVENTS failure detected as blocked input');
  assert(!isInputInjectionBlocked({ stdout: '', stderr: '' }), 'Clean output is not treated as blocked');

  // Workflow engine must not report blocked input as success
  const { WorkflowEngine } = await import('../../modules/workflow_engine');
  const wfDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mockAdb(wfDm, args => (args.includes('input') ? { stdout: '', stderr: 'SecurityException: INJECT_EVENTS', code: 0 } : okResult()));
  const engine: any = new (WorkflowEngine as any)(wfDm, null);
  for (const action of ['tap', 'swipe', 'keyevent', 'input_text']) {
    let message = '';
    try {
      await engine.executeStep('AAAA1111', { action, params: { x: 10, y: 10, text: 'hello' } }, require('os').tmpdir(), {});
    } catch (err: any) {
      message = err.message;
    }
    assert(/blocked by device security settings/.test(message), `Blocked ${action} with exit code 0 is reported as failure, not success`);
  }

  // ---------------------------------------------------------------------------------------------
  // 10. MCP boundary unchanged
  // ---------------------------------------------------------------------------------------------
  const mcpServerSrc = fs.readFileSync(path.resolve(__dirname, '../../../modules/mcp/server.ts'), 'utf8');
  const toolNames = [...mcpServerSrc.matchAll(/this\.server\.tool\(\s*'([a-z_]+)'/g)].map(m => m[1]).sort();
  assertEqual(
    toolNames.join(','),
    ['capture_screenshot', 'get_device_info', 'get_diagnostics', 'get_logcat', 'get_pairing_status', 'input_text', 'keyevent', 'list_devices', 'pair_session', 'request_pairing', 'swipe', 'tap'].join(','),
    'MCP still exposes exactly the original 12 tools'
  );
  const mcpSources = ['server.ts', 'control-bridge.ts', 'pairing.ts', 'index.ts', 'cli.ts']
    .map(f => fs.readFileSync(path.resolve(__dirname, '../../../modules/mcp', f), 'utf8'))
    .join('\n');
  assert(!/wireless_discovery|oem_guidance|WirelessDiscovery|mdns/i.test(mcpSources), 'MCP layer has no access to wireless discovery or pairing');
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../../apps/desktop/electron/main.ts'), 'utf8');
  assert(/parseConnectRequest\(payload\)/.test(mainSrc) && /parsePairRequest\(payload\)/.test(mainSrc), 'Discovery IPC handlers validate payloads before use');
  assert(/confirmWirelessAction/.test(mainSrc) && /dialog\.showMessageBox/.test(mainSrc), 'Connect/pair require a main-process confirmation dialog');
  const discoveryHandlers = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('discover-wireless-devices'"), mainSrc.indexOf("ipcMain.handle('detect-hotspot'"));
  assert(!/mcpServer|mcpControl|approveMcp|revoke|createSession|pairingManager/i.test(discoveryHandlers), 'Discovery IPC handlers never touch MCP sessions or approvals');
  assert(!/\bpin\b[^\n]*appLog|appLog[^\n]*\bpin\b/.test(discoveryHandlers.replace(/The pairing code is deliberately[^\n]*/, '')), 'Pairing code is never passed to the logger');
  const preloadSrc = fs.readFileSync(path.resolve(__dirname, '../../../apps/desktop/electron/preload.ts'), 'utf8');
  assert(/discoverWirelessDevices|connectDiscoveredDevice|pairDiscoveredDevice|getDeviceHelp/.test(preloadSrc) && !/ipcRenderer\.on\('discover/.test(preloadSrc), 'Preload exposes only the narrow discovery methods');

  // ---------------------------------------------------------------------------------------------
  // IPC payload validation
  // ---------------------------------------------------------------------------------------------
  assert(!parseConnectRequest(null).ok && !parseConnectRequest({}).ok && !parseConnectRequest({ endpointId: 5 }).ok, 'Connect request rejects null, empty and non-string handles');
  assert(!parseConnectRequest({ endpointId: '192.168.1.77:41555' }).ok, 'Connect request rejects raw IP:port (only issued handles are accepted)');
  assert(parseConnectRequest({ endpointId: '0123456789abcdef' }).ok, 'Connect request accepts a well-formed handle');
  assert(!parsePairRequest({ endpointId: '0123456789abcdef', pin: '12345' }).ok, 'Pair request rejects short pin');
  assert(!parsePairRequest({ endpointId: '0123456789abcdef', pin: '12345a' }).ok, 'Pair request rejects non-numeric pin');
  assert(!parsePairRequest({ endpointId: '0123456789abcdef', pin: 123456 }).ok, 'Pair request rejects non-string pin');
  assert(parsePairRequest({ endpointId: '0123456789abcdef', pin: ' 123456 ' }).ok, 'Pair request accepts and trims a 6-digit pin');
  assert(!parseDeviceHelpRequest({ serial: 'x; calc.exe' }).ok && !parseDeviceHelpRequest({ serial: 42 }).ok, 'Help request rejects injection and non-string serials');
  assert(parseDeviceHelpRequest({ serial: 'R58M123XYZ' }).ok, 'Help request accepts a valid serial');
  assert(SecurityValidator.isLocalNetworkIPv4('192.168.0.5') && SecurityValidator.isLocalNetworkIPv4('10.1.2.3') && SecurityValidator.isLocalNetworkIPv4('172.20.0.1'), 'Private ranges accepted as local');
  assert(!SecurityValidator.isLocalNetworkIPv4('172.32.0.1') && !SecurityValidator.isLocalNetworkIPv4('8.8.8.8') && !SecurityValidator.isLocalNetworkIPv4('300.1.1.1'), 'Public and invalid addresses rejected as non-local');

  // ---------------------------------------------------------------------------------------------
  // 11. Redaction of serials and tokens
  // ---------------------------------------------------------------------------------------------
  assertEqual(SecurityValidator.redactSerial('192.168.1.60:5555'), '192.168.*.*:5555', 'IP serial keeps only the network prefix and port');
  const red = SecurityValidator.redactSerial('R58M123XYZ');
  assert(red.startsWith('R5') && red.endsWith('YZ') && !red.includes('123'), 'Hardware serial keeps only first and last two characters');
  assertEqual(SecurityValidator.redactSerial('abc'), '****', 'Short serials are fully masked');
  assertEqual(SecurityValidator.redactSerial(''), '', 'Empty serial stays empty');
  assert(!SecurityValidator.redactSerialsInText('device R58M123XYZ and R58M123XYZ-2', ['R58M123XYZ', 'R58M123XYZ-2']).includes('R58M123XYZ'), 'All occurrences of every serial are redacted from free text');
  assert(SecurityValidator.redactSensitiveText('Bearer abcdef123456 code 654321').includes('[REDACTED_PIN]'), 'Pairing codes are redacted from log text');

  const diagDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mockAdb(diagDm, args => {
    if (args[0] === 'version') return okResult('Android Debug Bridge version 1.0.41');
    if (args[0] === 'devices') return okResult('List of devices attached\nR58M123XYZ device model:Foo\n192.168.1.60:5555 device model:Bar\n');
    if (args.includes('dumpsys')) return okResult('  level: 50');
    if (args.includes('logcat')) return okResult('10-18 12:00:00.000  1  1 I Tag: serial R58M123XYZ connected');
    if (args.includes('getprop')) return okResult('[ro.serialno]: [R58M123XYZ]\n[ro.product.manufacturer]: [Xiaomi]');
    return okResult();
  });
  (diagDm as any).getDevices = async () => diagDm.parseDevicesOutput('R58M123XYZ device model:Foo\n192.168.1.60:5555 device model:Bar\n');
  const diag = new DiagnosticsManager(diagDm);
  const report = await diag.generateDiagnosticBundle('R58M123XYZ', { running: true, targetSerial: '192.168.1.60:5555' });
  assert(!report.includes('R58M123XYZ'), 'Default diagnostic report contains no full device serial');
  assert(!report.includes('192.168.1.60'), 'Default diagnostic report contains no full device IP');
  assert(report.includes('R5') && report.includes('Manufacturer'), 'Redacted report still identifies the device and its properties');
  const fullReport = await diag.generateDiagnosticBundle('R58M123XYZ', undefined, { includeSerials: true });
  assert(fullReport.includes('R58M123XYZ'), 'Serials appear only when explicitly requested');
  const tmpOut = path.join(require('os').tmpdir(), `androscrn-diag-${Date.now()}`);
  const exported = await diag.exportDiagnosticReport('R58M123XYZ', tmpOut);
  assert(exported.success && !!exported.reportPath && !path.basename(exported.reportPath).includes('R58M123XYZ'), 'Exported report filename does not contain the serial');
  try {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  } catch {
    // ignore cleanup failure
  }

  // ---------------------------------------------------------------------------------------------
  // 12. Windows path and command-argument handling
  // ---------------------------------------------------------------------------------------------
  const argProbe = await nodeAdb.executeAdb(
    ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'a b', 'c"d', '&calc.exe', '%PATH%', '192.168.1.5:5555'],
    10000
  );
  const echoed = JSON.parse(argProbe.stdout || '[]');
  assertEqual(echoed.length, 5, 'Arguments are passed as discrete values (no shell splitting)');
  assertEqual(echoed[0], 'a b', 'Arguments containing spaces are preserved');
  assertEqual(echoed[2], '&calc.exe', 'Shell metacharacters are passed literally, not executed');
  assertEqual(echoed[3], '%PATH%', 'Windows environment-variable syntax is not expanded');
  const spaced = new DeviceManager('C:\\Program Files\\Not Installed\\platform-tools\\adb.exe');
  const spacedVersion = await spaced.getAdbVersion();
  assert(spacedVersion.includes('not found') && spacedVersion.includes('Program Files'), 'Missing ADB under a path with spaces reports the exact path');
  assert(!SecurityValidator.isValidSerial('R58M123XYZ&calc') && !SecurityValidator.isValidSerial('a b'), 'Serials with shell metacharacters or spaces are rejected');
}
