import fs from 'fs';
import path from 'path';
import os from 'os';
import { AndroScrnCli, MemoryUserPathStore, openInDefaultBrowser } from '../../modules/cli';

export async function runCliTests(
  assert: (condition: boolean, testName: string) => void,
  assertEqual: <T>(actual: T, expected: T, testName: string) => void,
  skip: (testName: string, reason: string) => void = () => {}
) {
  console.log('\nTest Group: CLI Launcher & Portable Packaging');

  const appDir = path.resolve(__dirname, '../../..');
  // PATH persistence is injected: these tests never read or write the real Windows User PATH.
  const openedUrls: string[] = [];
  const cli = new AndroScrnCli({ appDir, pathStore: new MemoryUserPathStore(''), openUrl: url => { openedUrls.push(url); } });

  // 1. Help Commands
  const helpRes1 = await cli.run(['--help']);
  assertEqual(helpRes1.exitCode, 0, 'CLI --help returns exitCode 0');
  assert(helpRes1.stdout.includes('USAGE:'), 'CLI --help contains USAGE header');
  assert(helpRes1.stdout.includes('devices'), 'CLI --help lists devices command');
  assert(helpRes1.stdout.includes('doctor'), 'CLI --help lists doctor command');
  assert(helpRes1.stdout.includes('setup-path'), 'CLI --help lists setup-path command');

  const helpRes2 = await cli.run(['-h']);
  assertEqual(helpRes2.exitCode, 0, 'CLI -h returns exitCode 0');
  assert(helpRes2.stdout.includes('AndroScrn'), 'CLI -h contains brand banner');

  const helpRes3 = await cli.run(['help']);
  assertEqual(helpRes3.exitCode, 0, 'CLI help subcommand returns exitCode 0');

  // 2. Version Commands
  const verRes1 = await cli.run(['--version']);
  assertEqual(verRes1.exitCode, 0, 'CLI --version returns exitCode 0');
  assert(verRes1.stdout.includes('AndroScrn v1.0.0-alpha.1'), 'CLI --version contains correct version');
  assert(verRes1.stdout.includes('scrcpy 5.0.1'), 'CLI --version reports scrcpy version');
  assert(verRes1.stdout.includes('adb 1.0.41'), 'CLI --version reports adb version');

  const verRes2 = await cli.run(['-v']);
  assertEqual(verRes2.exitCode, 0, 'CLI -v returns exitCode 0');

  // 3. Unknown Command Error Handling
  const unknownRes = await cli.run(['--invalid-flag']);
  assertEqual(unknownRes.exitCode, 1, 'Unknown option returns exitCode 1');
  assert(unknownRes.stderr.includes("Unknown command or option '--invalid-flag'"), 'Unknown option writes to stderr');
  assert(unknownRes.stderr.includes('androscrn --help'), 'Unknown option advises running --help');

  const unknownSubcmd = await cli.run(['nonexistent-subcommand']);
  assertEqual(unknownSubcmd.exitCode, 1, 'Unknown subcommand returns exitCode 1');
  assert(unknownSubcmd.stderr.includes('nonexistent-subcommand'), 'Unknown subcommand identified in stderr');

  // 4. Docs Command
  const docsRes = await cli.run(['docs']);
  assertEqual(docsRes.exitCode, 0, 'CLI docs command returns exitCode 0');
  assert(docsRes.stdout.includes('https://sukeshperiyasamy.github.io/Androscrn/'), 'CLI docs mentions documentation URL');
  assertEqual(openedUrls.length, 1, 'An explicit `docs` request opens the browser exactly once');
  assertEqual(openedUrls[0], 'https://sukeshperiyasamy.github.io/Androscrn/', 'The browser is asked to open the documentation site');
  await cli.run(['--help']);
  await cli.run(['--version']);
  await cli.run(['devices']);
  assertEqual(openedUrls.length, 1, 'No other CLI command opens a browser');

  // The real launcher: verified with a fake spawn so no browser actually opens
  const launches: Array<{ cmd: string; args: string[]; opts: any; unrefs: number }> = [];
  const fakeSpawn = (cmd: string, args: string[], opts: any) => {
    const rec = { cmd, args, opts, unrefs: 0 };
    launches.push(rec);
    return { unref() { rec.unrefs++; } };
  };
  openInDefaultBrowser('https://example.test/docs/', 'win32', fakeSpawn);
  assertEqual(JSON.stringify([launches[0].cmd, launches[0].args]), JSON.stringify(['cmd.exe', ['/c', 'start', '', 'https://example.test/docs/']]), 'Windows launcher uses `cmd /c start` with the URL as a discrete argument');
  assert(launches[0].opts.detached === true && launches[0].unrefs === 1, 'Launched browser is detached and unref\'d (one launch, no wait loop)');
  openInDefaultBrowser('https://example.test/', 'linux', fakeSpawn);
  assertEqual(launches[1].cmd, 'xdg-open', 'Non-Windows launcher uses xdg-open');
  assertEqual(launches.length, 2, 'Each explicit call launches exactly once');
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'https://x.test/a&calc.exe', 'https://x.test/a b', 'C:\\temp\\page.html', '']) {
    let rejected = false;
    try {
      openInDefaultBrowser(bad, 'win32', fakeSpawn);
    } catch {
      rejected = true;
    }
    assert(rejected, `Unsafe or non-http(s) URL is refused: ${JSON.stringify(bad)}`);
  }
  assertEqual(launches.length, 2, 'Refused URLs never reach spawn');

  // 5. Missing ADB Binary Handling
  const brokenCli = new AndroScrnCli({
    appDir,
    adbPath: path.join(appDir, 'nonexistent_bin', 'adb.exe')
  });
  const brokenDevRes = await brokenCli.run(['devices']);
  assertEqual(brokenDevRes.exitCode, 2, 'Missing ADB binary returns exitCode 2');
  assert(brokenDevRes.stderr.includes('Bundled ADB binary not found'), 'Missing ADB informs user in stderr');

  // 6. Devices Command (with valid bundled ADB)
  const devRes = await cli.run(['devices']);
  assertEqual(devRes.exitCode, 0, 'CLI devices command executes cleanly');
  assert(
    devRes.stdout.includes('Attached Android Devices') || devRes.stdout.includes('No Android devices detected'),
    'CLI devices outputs structured status or guidance'
  );

  // 7. Doctor Command
  const docRes = await cli.run(['doctor']);
  assertEqual(docRes.exitCode, 0, 'CLI doctor command executes with exitCode 0');
  assert(docRes.stdout.includes('[1/6] Operating System Check'), 'Doctor runs check 1 (OS)');
  assert(docRes.stdout.includes('[2/6] Bundled Android Debug Bridge (ADB)'), 'Doctor runs check 2 (ADB)');
  assert(docRes.stdout.includes('[3/6] Bundled scrcpy Engine'), 'Doctor runs check 3 (scrcpy)');
  assert(docRes.stdout.includes('[4/6] Connected Android Hardware'), 'Doctor runs check 4 (Hardware)');
  assert(docRes.stdout.includes('[5/6] Supervised MCP Named Pipe Boundary'), 'Doctor runs check 5 (IPC Boundary)');
  assert(docRes.stdout.includes('[6/6] User PATH Integration'), 'Doctor runs check 6 (PATH)');
  assert(docRes.stdout.includes('VERDICT:'), 'Doctor provides overall verdict');

  // 8. PATH validation that needs no persistence (detailed PATH behavior is covered in path-env.test.ts)
  const nonExistentDir = path.join(appDir, 'this_dir_does_not_exist_12345');
  const badPathRes = cli.handleSetupPath([nonExistentDir]);
  assertEqual(badPathRes.exitCode, 1, 'setup-path rejects non-existent directory');
  assert(badPathRes.stderr.includes('Target directory does not exist'), 'setup-path reports invalid directory error');

  // 8b. Portable packager script syntax and path resolution
  const packagerScript = fs.readFileSync(path.join(appDir, 'packaging', 'portable', 'package-portable.ps1'), 'utf8');
  assert(packagerScript.includes('[System.IO.Path]::GetFullPath($OutputDir)'), 'package-portable.ps1 resolves OutputDir to absolute path');
  assert(packagerScript.includes('csc.exe'), 'package-portable.ps1 references native C# compiler');

  // 9. Portable Distribution Archive & File Layout Inspection (generated by `npm run build:portable`)
  const portableDir = path.join(appDir, 'dist-release', 'AndroScrn-portable-win-x64');
  const zipPath = path.join(appDir, 'dist-release', 'AndroScrn-portable-win-x64.zip');
  const checksumsPath = path.join(appDir, 'dist-release', 'SHA256SUMS.txt');
  const buildHint = 'portable build output not found; run `npm run build:portable` to enable this check';

  if (fs.existsSync(portableDir)) {
    assert(fs.existsSync(path.join(portableDir, 'androscrn.exe')), 'Portable folder contains native CLI launcher androscrn.exe');
    assert(fs.existsSync(path.join(portableDir, 'AndroScrn-gui.exe')), 'Portable folder contains GUI executable AndroScrn-gui.exe');
    assert(fs.existsSync(path.join(portableDir, 'androscrn.cmd')), 'Portable folder contains androscrn.cmd');
    assert(fs.existsSync(path.join(portableDir, 'setup-path.ps1')), 'Portable folder contains setup-path.ps1 helper');
    assert(fs.existsSync(path.join(portableDir, 'remove-path.ps1')), 'Portable folder contains remove-path.ps1 helper');
    assert(fs.existsSync(path.join(portableDir, 'LICENSE')), 'Portable folder contains LICENSE');
    assert(fs.existsSync(path.join(portableDir, 'THIRD-PARTY-NOTICES.txt')), 'Portable folder contains THIRD-PARTY-NOTICES.txt');
    assert(fs.existsSync(path.join(portableDir, 'bin', 'scrcpy-win64', 'adb.exe')), 'Portable folder contains bundled adb.exe');
    assert(fs.existsSync(path.join(portableDir, 'bin', 'scrcpy-win64', 'scrcpy.exe')), 'Portable folder contains bundled scrcpy.exe');
    assert(fs.existsSync(path.join(portableDir, 'resources', 'app', 'package.json')), 'Portable folder contains resources/app/package.json');
    assert(fs.existsSync(path.join(portableDir, 'resources', 'app', 'dist-electron', 'main.js')), 'Portable folder contains main.js bundle');
  } else {
    skip('Portable folder layout', buildHint);
  }

  if (fs.existsSync(zipPath)) {
    const zipSizeMb = fs.statSync(zipPath).size / (1024 * 1024);
    assert(zipSizeMb > 50 && zipSizeMb < 250, `Portable ZIP archive exists with plausible size (${zipSizeMb.toFixed(1)} MB)`);
  } else {
    skip('Portable ZIP archive size', buildHint);
  }

  if (fs.existsSync(checksumsPath)) {
    const checksums = fs.readFileSync(checksumsPath, 'utf8');
    assert(checksums.includes('AndroScrn-portable-win-x64.zip'), 'SHA256SUMS.txt contains ZIP hash entry');
    assert(checksums.includes('androscrn.exe'), 'SHA256SUMS.txt contains CLI exe hash entry');
    assert(checksums.includes('AndroScrn-gui.exe'), 'SHA256SUMS.txt contains GUI exe hash entry');
  } else {
    skip('SHA256SUMS.txt entries', buildHint);
  }
}
