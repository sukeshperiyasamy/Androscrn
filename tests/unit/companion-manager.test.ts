import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { CompanionClient } from '../../modules/companion_client';
import {
  CompanionManager,
  COMPANION_PACKAGE,
  describeInstallFailure,
  parseForwardPort,
  parseInstallState,
  readApkInfo,
  resolveCompanionApk
} from '../../modules/companion_client/manager';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

interface FakeAdbScript {
  state?: string;
  installedVersion?: number | null;
  installOutput?: string;
  installBumpsTo?: number;
  launchOutput?: string;
  forwardPort?: number | null;
  delayMs?: Record<string, number>;
}

/** Test double for DeviceManager.executeAdb; records every command. */
function fakeAdb(script: FakeAdbScript) {
  const calls: string[][] = [];
  let installed = script.installedVersion ?? null;
  const adb = {
    calls,
    executeAdb: async (args: string[]) => {
      calls.push(args);
      const cmd = args.slice(2).join(' ');
      const delay = Object.entries(script.delayMs || {}).find(([k]) => cmd.startsWith(k));
      if (delay) await new Promise((r) => setTimeout(r, delay[1]));
      if (args[2] === 'get-state') return { stdout: `${script.state ?? 'device'}\n`, stderr: '', code: script.state && script.state !== 'device' ? 1 : 0 };
      if (cmd.startsWith('shell dumpsys package')) {
        const out = installed === null ? 'Unable to find package' : `Packages:\n  Package [${COMPANION_PACKAGE}] (abc):\n    versionCode=${installed} minSdk=26 targetSdk=34\n    versionName=1.0.0-alpha.${installed}\n`;
        return { stdout: out, stderr: '', code: 0 };
      }
      if (args[2] === 'install') {
        const out = script.installOutput ?? 'Performing Streamed Install\nSuccess\n';
        if (/Success/.test(out)) installed = script.installBumpsTo ?? 2;
        return { stdout: out, stderr: '', code: /Success/.test(out) ? 0 : 1 };
      }
      if (cmd.startsWith('shell am start')) return { stdout: script.launchOutput ?? 'Status: ok\nLaunchState: COLD\nComplete\n', stderr: '', code: 0 };
      if (args[2] === 'forward' && args[3] === 'tcp:0') {
        return script.forwardPort === null ? { stdout: '', stderr: 'error: cannot bind', code: 1 } : { stdout: `${script.forwardPort ?? 45678}\n`, stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    }
  };
  return adb;
}

function stageApk(dir: string, meta: Record<string, any> = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  const apk = path.join(dir, 'androscrn-companion.apk');
  fs.writeFileSync(apk, 'PK fake apk bytes');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
  fs.writeFileSync(path.join(dir, 'androscrn-companion.json'), JSON.stringify({
    packageName: COMPANION_PACKAGE, versionCode: 2, versionName: '1.0.0-alpha.2', protocolVersion: 2, variant: 'debug', sha256, ...meta
  }));
  return apk;
}

/** Local stand-in for the phone app's status endpoint (test double, not a device). */
function fakeCompanionServer(statusBody: () => any): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v1/status') res.end(JSON.stringify(statusBody()));
      else { res.statusCode = 404; res.end('{}'); }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

export async function runCompanionManagerUnitTests(assert: AssertFn, assertEqual: AssertEqualFn): Promise<void> {
  console.log('\nTest Group: Companion manager (APK resolution, install, launch, handshake)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-companion-'));
  try {
    // --- APK resolution & metadata validation ---
    const goodDir = path.join(tmp, 'good');
    const goodApk = stageApk(goodDir);
    assertEqual(readApkInfo(goodApk)?.versionCode, 2, 'Valid staged APK resolves with its versionCode');
    assertEqual(resolveCompanionApk([path.join(tmp, 'missing.apk'), goodApk])?.apkPath, goodApk, 'Resolver skips missing candidates');

    const tampered = path.join(tmp, 'tampered');
    const tamperedApk = stageApk(tampered);
    fs.appendFileSync(tamperedApk, 'modified');
    assertEqual(readApkInfo(tamperedApk), null, 'APK whose bytes do not match the recorded SHA-256 is rejected');
    assertEqual(readApkInfo(stageApk(path.join(tmp, 'wrongpkg'), { packageName: 'com.evil.app' })), null, 'Metadata for another package is rejected');
    assertEqual(readApkInfo(stageApk(path.join(tmp, 'badver'), { versionCode: 'two' })), null, 'Non-integer versionCode is rejected');
    const noMeta = path.join(tmp, 'nometa');
    fs.mkdirSync(noMeta);
    fs.writeFileSync(path.join(noMeta, 'androscrn-companion.apk'), 'x');
    assertEqual(readApkInfo(path.join(noMeta, 'androscrn-companion.apk')), null, 'APK without metadata is not used');

    // --- Parsers ---
    assertEqual(parseInstallState('Unable to find package').installed, false, 'dumpsys without the package => not installed');
    const st = parseInstallState(`  Package [${COMPANION_PACKAGE}] (1):\n    versionCode=7 minSdk=26\n    versionName=1.2.3\n`);
    assert(st.installed && st.versionCode === 7 && st.versionName === '1.2.3', 'dumpsys versionCode/versionName parsed');
    assertEqual(parseForwardPort('45678\n'), 45678, 'adb forward tcp:0 port parsed');
    assertEqual(parseForwardPort('error'), null, 'Garbage forward output rejected');
    assertEqual(parseForwardPort('80'), null, 'Privileged forward port rejected');
    assertEqual(describeInstallFailure('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]').code, 'INSTALL_FAILED_USER_RESTRICTED', 'Xiaomi USB-install restriction recognised');
    assert(/Install via USB/.test(describeInstallFailure('INSTALL_FAILED_USER_RESTRICTED').message), 'USB-install restriction message names the phone setting');
    const sig = describeInstallFailure('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package signatures do not match]');
    assert(sig.code === 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' && /will not remove it automatically/.test(sig.message), 'Signature mismatch never triggers automatic uninstall');
    assertEqual(describeInstallFailure('adb: device \'x\' not found').code, 'device_lost', 'Disconnect during install recognised');

    // --- prepare(): validation and device states ---
    const client = () => new CompanionClient();
    let mgr = new CompanionManager(fakeAdb({}) as any, client(), () => [goodApk]);
    assertEqual((await mgr.prepare('bad;serial', false)).code, 'invalid_serial', 'Invalid serial rejected before any adb call');
    for (const [state, needle] of [['unauthorized', /authorized/], ['offline', /offline/]] as const) {
      const res = await new CompanionManager(fakeAdb({ state }) as any, client(), () => [goodApk]).prepare('ABC123', false);
      assert(res.code === 'device_unavailable' && needle.test(res.message), `Device state "${state}" reported with guidance`);
    }

    // --- Not installed: no install without explicit consent ---
    let adb = fakeAdb({ installedVersion: null });
    mgr = new CompanionManager(adb as any, client(), () => [goodApk]);
    let res = await mgr.prepare('ABC123', false);
    assertEqual(res.stage, 'install_required', 'Missing companion => install_required');
    assert(!adb.calls.some((c) => c[2] === 'install'), 'No adb install without allowInstall');
    assert(!adb.calls.some((c) => c.join(' ').includes('am start')), 'App not launched when not installed');

    // --- Missing bundled APK ---
    res = await new CompanionManager(fakeAdb({ installedVersion: null }) as any, client(), () => [path.join(tmp, 'nope.apk')]).prepare('ABC123', true);
    assertEqual(res.code, 'apk_missing', 'Missing bundled APK reported, nothing installed');

    // --- Install failure mapping ---
    adb = fakeAdb({ installedVersion: null, installOutput: 'Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]' });
    res = await new CompanionManager(adb as any, client(), () => [goodApk]).prepare('ABC123', true);
    assertEqual(res.code, 'INSTALL_FAILED_USER_RESTRICTED', 'Install failure surfaced with its code');
    assert(!adb.calls.some((c) => c.includes('uninstall') || c.join(' ').includes('pm clear')), 'Never uninstalls or clears data');

    // --- Install reports success but version unchanged ---
    adb = fakeAdb({ installedVersion: null, installBumpsTo: 0 });
    res = await new CompanionManager(adb as any, client(), () => [goodApk]).prepare('ABC123', true);
    assertEqual(res.code, 'install_unverified', 'adb "Success" without the new version on the phone is not trusted');

    // --- Older version installed => update offer ---
    res = await new CompanionManager(fakeAdb({ installedVersion: 1 }) as any, client(), () => [goodApk]).prepare('ABC123', false);
    assertEqual(res.stage, 'update_available', 'Older installed companion => update_available');

    // --- Launch failure ---
    res = await new CompanionManager(fakeAdb({ installedVersion: 2, launchOutput: 'Error: Activity class does not exist.' }) as any, client(), () => [goodApk]).prepare('ABC123', false);
    assertEqual(res.code, 'launch_failed', 'Launch failure reported');

    // --- Forward failure ---
    res = await new CompanionManager(fakeAdb({ installedVersion: 2, forwardPort: null }) as any, client(), () => [goodApk]).prepare('ABC123', false);
    assertEqual(res.code, 'forward_failed', 'adb forward failure reported');

    // --- Full happy path against a local status server (test double for the phone) ---
    const srv = await fakeCompanionServer(() => ({ status: 'ready', protocolVersion: 2, versionCode: 2, state: 'waiting_for_desktop', permissionGranted: true }));
    try {
      adb = fakeAdb({ installedVersion: null, forwardPort: srv.port });
      const c = client();
      mgr = new CompanionManager(adb as any, c, () => [goodApk], { readyTimeoutMs: 2000, pollIntervalMs: 50 });
      const stages: string[] = [];
      mgr.on('progress', (e) => stages.push(e.stage));
      res = await mgr.prepare('ABC123', true);
      assert(res.success && res.stage === 'ready', 'Install -> launch -> forward -> handshake succeeds');
      assertEqual(stages.join(','), 'checking,installing,launching,connecting,ready', 'Progress stages emitted in order');
      assert(adb.calls.some((c2) => c2.join(' ') === `-s ABC123 install -r ${goodApk}`), 'Installs with -r (keeps app data), no -d downgrade');
      assert(adb.calls.some((c2) => c2.join(' ') === '-s ABC123 forward tcp:0 localabstract:androscrn_companion'), 'Forwards to the abstract socket on a free host port');
      assertEqual(c.getBaseUrl(), `http://127.0.0.1:${srv.port}`, 'Client points at the forwarded port');

      await mgr.stop();
      assert(adb.calls.some((c2) => c2.join(' ') === `-s ABC123 forward --remove tcp:${srv.port}`), 'stop() removes the forward');
      assertEqual(c.getBaseUrl(), '', 'stop() clears the client base URL');
      let threw = false;
      try { await c.getStatus(); } catch { threw = true; }
      assert(threw, 'Requests after stop fail fast instead of reaching another local service');
    } finally {
      await srv.close();
    }

    // --- Protocol mismatch (legacy v1 companion) ---
    const legacy = await fakeCompanionServer(() => ({ status: 'ready', companionVersion: '1.0.0-alpha.1' }));
    try {
      res = await new CompanionManager(fakeAdb({ installedVersion: 2, forwardPort: legacy.port }) as any, client(), () => [goodApk], { readyTimeoutMs: 1000, pollIntervalMs: 50 }).prepare('ABC123', false);
      assertEqual(res.code, 'protocol_mismatch', 'Legacy companion without protocolVersion is rejected');
    } finally {
      await legacy.close();
    }

    // --- Readiness timeout (nothing listening) ---
    const t0 = Date.now();
    res = await new CompanionManager(fakeAdb({ installedVersion: 2, forwardPort: 1 + 40000 + Math.floor(Math.random() * 1000) }) as any, client(), () => [goodApk], { readyTimeoutMs: 600, pollIntervalMs: 100 }).prepare('ABC123', false);
    assert(res.code === 'not_ready' && Date.now() - t0 < 5000, 'Readiness handshake times out (bounded)');

    // --- Stale session: a newer prepare/stop supersedes an in-flight one ---
    adb = fakeAdb({ installedVersion: 2, delayMs: { 'shell am start': 300 } });
    mgr = new CompanionManager(adb as any, client(), () => [goodApk], { readyTimeoutMs: 500, pollIntervalMs: 50 });
    const slow = mgr.prepare('ABC123', false);
    await new Promise((r) => setTimeout(r, 50));
    await mgr.stop();
    const slowRes = await slow;
    assertEqual(slowRes.code, 'superseded', 'Prepare superseded by stop() returns "superseded"');
    assert(!adb.calls.some((c) => c.join(' ').includes('forward tcp:0')), 'Superseded prepare does not create a forward afterwards');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function runCompanionClientDefaultsTests(assert: AssertFn): Promise<void> {
  // Regression: the client used to default to http://127.0.0.1:8080 and would query any unrelated local service.
  const c = new CompanionClient();
  let threw = false;
  try { await c.getStatus(); } catch (e: any) { threw = /not connected/.test(e.message); }
  assert(threw, 'Fresh CompanionClient refuses to contact a default port before an adb forward exists');
  c.setSessionToken('t');
  assert(c.getStreamUrl() === '', 'No stream URL without a forwarded base URL');
  let rejected = false;
  try { c.setBaseUrl('http://evil.example:80'); } catch { rejected = true; }
  assert(rejected, 'setBaseUrl rejects non-loopback URLs');
}
