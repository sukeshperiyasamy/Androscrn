import fs from 'fs';
import path from 'path';
import { DeviceManager } from '../../modules/device_manager';
import { ConnectionManager } from '../../modules/connection_manager';
import { DiagnosticsManager } from '../../modules/diagnostics';
import { SecurityValidator } from '../../modules/security';
import { WirelessDiscovery, parseMdnsServices, DISCOVERY_TTL_MS } from '../../modules/wireless_discovery';

type AssertFn = (condition: boolean, name: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, name: string) => void;

function ok(stdout = '', stderr = '', code = 0) {
  return { stdout, stderr, code };
}

function mock(dm: DeviceManager, handler: (args: string[], signal?: AbortSignal) => any) {
  (dm as any).executeAdb = async (args: string[], _t?: number, signal?: AbortSignal) => handler(args, signal);
}

const SERVICES = [
  'List of discovered mdns services',
  'adb-ABCD1234EFGH-xYz9Qa\t_adb-tls-connect._tcp\t192.168.1.77:41555',
  'adb-ABCD1234EFGH-xYz9Qa\t_adb-tls-pairing._tcp\t192.168.1.77:37123',
  ''
].join('\n');

/**
 * Phase 10.1 validation of wireless discovery edge cases and diagnostic redaction. All network and ADB
 * behavior is mocked: none of this proves behavior on a physical phone (see docs/compatibility.md).
 */
export async function runWirelessValidationTests(assert: AssertFn, assertEqual: AssertEqualFn) {
  console.log('\nTest Group: Wireless Discovery Validation (Phase 10.1, mocked ADB)');

  // ---- ip range handling ----
  const accepted = ['10.0.0.2', '172.16.0.9', '172.31.255.1', '192.168.0.1', '169.254.10.5'];
  const rejected = ['172.32.0.1', '172.15.255.255', '100.64.0.1', '127.0.0.1', '0.0.0.0', '224.0.0.251', '255.255.255.255', '192.169.1.1', '8.8.8.8'];
  for (const ip of accepted) {
    const r = parseMdnsServices(`adb-AAAA1111BBBB-cccc\t_adb-tls-connect._tcp\t${ip}:5555`);
    assertEqual(r.endpoints.length, 1, `Private or link-local endpoint ${ip} is accepted`);
  }
  for (const ip of rejected) {
    const r = parseMdnsServices(`adb-AAAA1111BBBB-cccc\t_adb-tls-connect._tcp\t${ip}:5555`);
    assertEqual(r.endpoints.length, 0, `Non-local endpoint ${ip} is rejected`);
  }
  assertEqual(parseMdnsServices('adb-AAAA1111BBBB-cccc\t_adb-tls-connect._tcp\t192.168.1.5:0').endpoints.length, 0, 'Port 0 is rejected');
  assertEqual(parseMdnsServices('adb-AAAA1111BBBB-cccc\t_adb-tls-connect._tcp\t192.168.1.5:65536').endpoints.length, 0, 'Port 65536 is rejected');
  assertEqual(parseMdnsServices('x'.repeat(500)).endpoints.length, 0, 'Oversized garbage line is ignored');

  // ---- zero endpoints / check timeout / cancel during device read ----
  const zeroDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mock(zeroDm, args => (args[1] === 'check' ? ok('mdns daemon version [adb discovery 0.0.0]') : args[1] === 'services' ? ok('List of discovered mdns services\n') : ok('List of devices attached\n')));
  const zero = await new WirelessDiscovery(zeroDm, new ConnectionManager(zeroDm)).discover();
  assert(zero.success && zero.supported && zero.endpoints.length === 0, 'Zero discovered endpoints is a successful, empty result');
  assert(/Wireless debugging/.test(zero.message) && zero.fallback.length >= 3, 'Empty result tells the user to enable Wireless debugging and offers fallbacks');

  const checkTimeoutDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mock(checkTimeoutDm, args => (args[1] === 'check' ? { stdout: '', stderr: '\nCommand timed out.', code: -1 } : ok()));
  const checkTimeout = await new WirelessDiscovery(checkTimeoutDm, new ConnectionManager(checkTimeoutDm)).discover();
  assert(checkTimeout.timedOut && !checkTimeout.success, 'A timed-out mDNS support check is reported as a timeout');
  assert(!/does not provide mDNS/.test(checkTimeout.message), 'A timeout is not misreported as "mDNS unsupported"');

  const lateCancelDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  let lateDisc: WirelessDiscovery;
  mock(lateCancelDm, (args, signal) => {
    if (args[1] === 'check') return ok('mdns daemon version [x]');
    if (args[1] === 'services') return ok(SERVICES);
    // cancel while the device list is being read
    lateDisc.cancel();
    return new Promise(resolve => {
      if (signal?.aborted) return resolve({ stdout: '', stderr: 'Command cancelled.', code: -1, aborted: true });
      signal?.addEventListener('abort', () => resolve({ stdout: '', stderr: 'Command cancelled.', code: -1, aborted: true }));
    });
  });
  lateDisc = new WirelessDiscovery(lateCancelDm, new ConnectionManager(lateCancelDm));
  const late = await lateDisc.discover();
  assert(late.cancelled && !late.success && late.endpoints.length === 0, 'Cancelling during the device-list read returns cancelled, never a success');
  assertEqual(lateDisc.isRunning, false, 'Running flag cleared after a late cancel');
  const afterLate = await lateDisc.connect('0123456789abcdef', async () => true);
  assert(!afterLate.success, 'A cancelled run leaves no usable endpoint handles');

  // ---- device list failure must not break discovery ----
  const noDevListDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mock(noDevListDm, args => {
    if (args[1] === 'check') return ok('mdns daemon version [x]');
    if (args[1] === 'services') return ok(SERVICES);
    return { stdout: '', stderr: 'error: device disconnected', code: 1 };
  });
  const noDev = await new WirelessDiscovery(noDevListDm, new ConnectionManager(noDevListDm)).discover();
  assert(noDev.success && noDev.endpoints.length === 2, 'A failing `adb devices` still lists discovered endpoints');
  assertEqual(noDev.endpoints.find(e => e.kind === 'connect')?.status, 'connectable', 'Without device info the endpoint is conservatively "connectable"');

  // ---- handles across runs, expiry, confirmation ordering with the REAL ConnectionManager ----
  const adbCalls: string[][] = [];
  let present = true;
  let connectReply = 'connected to 192.168.1.77:41555';
  let pairReply = 'Successfully paired to 192.168.1.77:37123 [guid=adb-ABCD1234EFGH-xYz9Qa]';
  const realDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  mock(realDm, args => {
    adbCalls.push(args);
    if (args[0] === 'mdns' && args[1] === 'check') return ok('mdns daemon version [x]');
    if (args[0] === 'mdns' && args[1] === 'services') return ok(present ? SERVICES : 'List of discovered mdns services\n');
    if (args[0] === 'devices') return ok('List of devices attached\n');
    if (args[0] === 'connect') return ok(connectReply);
    if (args[0] === 'pair') return ok(pairReply);
    return ok();
  });
  let clock = 5_000_000;
  const disc = new WirelessDiscovery(realDm, new ConnectionManager(realDm), () => clock);
  const run1 = await disc.discover();
  const connectEp = run1.endpoints.find(e => e.kind === 'connect')!;
  const pairEp = run1.endpoints.find(e => e.kind === 'pairing')!;
  const mutating = () => adbCalls.filter(c => c[0] === 'connect' || c[0] === 'pair' || c[0] === 'tcpip');
  assertEqual(mutating().length, 0, 'Discovery issued no connect, pair or tcpip command');
  assert(!adbCalls.some(c => c.includes('shell')), 'Discovery issued no shell command');

  // Confirmation: nothing happens until the user approves, and the dialog gets safe, accurate details
  let release: (v: boolean) => void = () => {};
  const gate = new Promise<boolean>(res => (release = res));
  let seenDetails: any = null;
  const pending = disc.connect(connectEp.id, async d => {
    seenDetails = d;
    return gate;
  });
  await new Promise(r => setTimeout(r, 30));
  assertEqual(mutating().length, 0, 'No ADB connect is issued while the confirmation dialog is still open');
  release(true);
  const connected = await pending;
  assert(connected.success, 'Approved connect succeeds');
  assertEqual(JSON.stringify(mutating()), JSON.stringify([['connect', '192.168.1.77:41555']]), 'Connect passes exactly the discovered ip:port as one discrete argument');
  assert(seenDetails.action === 'connect' && seenDetails.ip === '192.168.1.77' && seenDetails.port === 41555, 'Confirmation dialog receives the real action, ip and port');
  assert(!String(seenDetails.label).includes('ABCD1234EFGH'), 'Confirmation dialog label never shows the raw serial');

  // A dialog that throws fails closed
  adbCalls.length = 0;
  let threw = false;
  try {
    await disc.connect(connectEp.id, async () => {
      throw new Error('dialog crashed');
    });
  } catch {
    threw = true;
  }
  assertEqual(mutating().length, 0, 'A crashing confirmation dialog never results in a connection');
  assertEqual(threw, true, 'Dialog failure surfaces as an error to the caller instead of being swallowed');

  // ADB failure / device disconnected between discovery and connect
  connectReply = 'failed to connect to 192.168.1.77:41555';
  const failedConnect = await disc.connect(connectEp.id, async () => true);
  assert(!failedConnect.success && /failed to connect/i.test(failedConnect.message), 'ADB connect failure is reported as failure with the reason');

  // Pairing: argument handling and code redaction
  adbCalls.length = 0;
  pairReply = 'error: protocol fault (couldn\'t read status message): code 123456 rejected';
  const badPair = await disc.pair(pairEp.id, '123456', async () => true);
  assert(!badPair.success && !badPair.message.includes('123456'), 'A pairing failure never echoes the code even if ADB repeats it');
  assertEqual(JSON.stringify(adbCalls.filter(c => c[0] === 'pair')), JSON.stringify([['pair', '192.168.1.77:37123', '123456']]), 'Pair passes ip:port and code as discrete arguments to ADB');
  pairReply = 'Successfully paired to 192.168.1.77:37123 [guid=adb-ABCD1234EFGH-xYz9Qa]';
  const goodPair = await disc.pair(pairEp.id, '123456', async () => true);
  assert(goodPair.success && !goodPair.message.includes('123456') && !goodPair.message.includes('ABCD1234EFGH'), 'A successful pairing message exposes neither the code nor the raw serial');

  // Handle lifetime: new run without the endpoint invalidates it
  present = false;
  const run2 = await disc.discover();
  assertEqual(run2.endpoints.length, 0, 'Second run no longer sees the endpoint');
  const stale = await disc.connect(connectEp.id, async () => true);
  assert(!stale.success && /no longer available/i.test(stale.message), 'A handle from an earlier run is rejected when the endpoint is gone');
  present = true;
  const run3 = await disc.discover();
  const connect3 = run3.endpoints.find(e => e.kind === 'connect')!;
  const crossKind = await disc.pair(connect3.id, '123456', async () => true);
  assert(!crossKind.success, 'A connect handle cannot be replayed as a pairing request');
  clock += DISCOVERY_TTL_MS + 1;
  const expired = await disc.pair(run3.endpoints.find(e => e.kind === 'pairing')!.id, '123456', async () => true);
  assert(!expired.success && /expired/i.test(expired.message), 'Expired handles are rejected for pairing too');
  disc.clear();
  const cleared = await disc.connect(connect3.id, async () => true);
  assert(!cleared.success, 'clear() forgets every issued handle');

  // Discovery results grant no control and carry no credentials
  const keys = JSON.stringify(run1).toLowerCase();
  assert(!/token|session|password|secret|pin"/.test(keys), 'Discovery results contain no tokens, sessions or secrets');

  const mainLog = fs.readFileSync(path.resolve(__dirname, '../../../apps/desktop/electron/main.ts'), 'utf8');
  const rawSerialLogs = mainLog.split(/\r?\n/).filter(l => l.includes('appLog(') && /\$\{(?:data|audit)\.serial\}/.test(l));
  assertEqual(rawSerialLogs.length, 0, 'Application log lines never interpolate a raw device serial (they use redactSerial)');
  const secretLogs = mainLog.split(/\r?\n/).filter(l => l.includes('appLog(') && /sessionToken|\.token\b|\bpin\b/i.test(l));
  assertEqual(secretLogs.length, 0, 'Application log lines never include session tokens or pairing codes');

  const moduleSrc = fs.readFileSync(path.resolve(__dirname, '../../../modules/wireless_discovery/index.ts'), 'utf8');
  assert(!/console\./.test(moduleSrc), 'Wireless discovery module never writes to the console (no log path for pairing codes)');
  assert(!/'shell'|"shell"|exec\(|execSync|spawn\(/.test(moduleSrc), 'Wireless discovery module never builds shell commands');

  // ---- diagnostic exports: IPs, MACs and serials redacted by default ----
  console.log('\nTest Group: Diagnostic Export Redaction (Phase 10.1)');
  const diagDm = new DeviceManager('C:\\nonexistent\\adb.exe');
  const props = [
    '[ro.serialno]: [R58M123XYZ]',
    '[ro.boot.serialno]: [R58M123XYZ]',
    '[dhcp.wlan0.ipaddress]: [10.20.30.40]',
    '[dhcp.wlan0.gateway]: [10.20.30.1]',
    '[net.dns1]: [8.8.8.8]',
    '[ro.boot.wifimacaddr]: [aa:bb:cc:dd:ee:ff]',
    '[ro.product.manufacturer]: [Xiaomi]',
    '[ro.build.version.release]: [13]',
    '[ro.build.version.sdk]: [33]'
  ].join('\n');
  mock(diagDm, args => {
    if (args[0] === 'version') return ok('Android Debug Bridge version 1.0.41');
    if (args.includes('dumpsys')) return ok('  level: 50');
    if (args.includes('logcat')) return ok('10-18 12:00:00.000  1  1 I Net: connected to 172.16.5.9 from AA-BB-CC-DD-EE-FF serial R58M123XYZ TransportInfo: <SSID: "My Home WiFi", BSSID: 11:22:33:44:55:66, Security type: 3> SSID: <unknown ssid> ssid=Cafe_Guest');
    if (args.includes('getprop')) return ok(props);
    return ok('List of devices attached\nR58M123XYZ device model:Foo\n');
  });
  const diag = new DiagnosticsManager(diagDm);
  const report = await diag.generateDiagnosticBundle('R58M123XYZ');
  for (const secret of ['R58M123XYZ', '10.20.30.40', '10.20.30.1', '172.16.5.9', '8.8.8.8', 'aa:bb:cc:dd:ee:ff', 'AA-BB-CC-DD-EE-FF']) {
    assert(!report.includes(secret), `Default diagnostic report does not contain identifier "${secret.slice(0, 3)}…"`);
  }
  for (const ssid of ['My Home WiFi', 'Cafe_Guest', '11:22:33:44:55:66']) {
    assert(!report.includes(ssid), `Default diagnostic report does not contain Wi-Fi identifier "${ssid.slice(0, 3)}…"`);
  }
  assert(report.includes('[REDACTED_SSID]'), 'Wi-Fi network names are replaced with a visible redaction marker');
  assert(report.includes('Manufacturer: Xiaomi') && report.includes('Android: 13 (API 33)') && report.includes('Model: Foo'), 'Report uses the detailed device properties (manufacturer, Android version, API level)');
  assertEqual(SecurityValidator.redactNetworkIdentifiers('adb 1.0.41 node 20.20.1 build 10.0.26200'), 'adb 1.0.41 node 20.20.1 build 10.0.26200', 'Version strings are not mistaken for IP addresses');
  assertEqual(SecurityValidator.redactNetworkIdentifiers('999.1.1.1 and 1.2.3.4'), '999.1.1.1 and 1.2.*.*', 'Out-of-range dotted numbers are left alone, real addresses masked');
}
