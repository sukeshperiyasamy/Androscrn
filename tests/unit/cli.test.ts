import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { AndroScrnCli } from '../../modules/cli';

export async function runCliTests(
  assert: (condition: boolean, testName: string) => void,
  assertEqual: <T>(actual: T, expected: T, testName: string) => void
) {
  console.log('\nTest Group: CLI Launcher & Portable Packaging');

  const appDir = path.resolve(__dirname, '../../..');
  const cli = new AndroScrnCli({ appDir });

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

  // 8. PATH Setup and Validation on Paths with Spaces
  const nonExistentDir = path.join(appDir, 'this_dir_does_not_exist_12345');
  const badPathRes = cli.handleSetupPath([nonExistentDir]);
  assertEqual(badPathRes.exitCode, 1, 'setup-path rejects non-existent directory');
  assert(badPathRes.stderr.includes('Target directory does not exist'), 'setup-path reports invalid directory error');

  // Test setup-path on valid directory (with spaces if temp folder)
  const testDirWithSpaces = path.join(os.tmpdir(), 'AndroScrn Test Dir With Spaces');
  if (!fs.existsSync(testDirWithSpaces)) {
    fs.mkdirSync(testDirWithSpaces, { recursive: true });
  }

  try {
    const setupRes = cli.handleSetupPath([testDirWithSpaces]);
    assertEqual(setupRes.exitCode, 0, 'setup-path succeeds on valid folder with spaces');
    assert(
      setupRes.stdout.includes('Successfully added to User PATH') || setupRes.stdout.includes('already present'),
      'setup-path reports success or existing presence'
    );

    // Test duplicate detection
    const dupRes = cli.handleSetupPath([testDirWithSpaces]);
    assertEqual(dupRes.exitCode, 0, 'setup-path handles duplicate path gracefully');
    assert(dupRes.stdout.includes('already present in User PATH'), 'setup-path detects duplicate entry');

    // Test remove-path
    const removeRes = cli.handleRemovePath([testDirWithSpaces]);
    assertEqual(removeRes.exitCode, 0, 'remove-path succeeds');
    assert(removeRes.stdout.includes('Successfully removed from User PATH'), 'remove-path reports clean removal');

    // Test remove-path when not present
    const removeAgainRes = cli.handleRemovePath([testDirWithSpaces]);
    assertEqual(removeAgainRes.exitCode, 0, 'remove-path on non-existent PATH entry succeeds with no-op');
    assert(removeAgainRes.stdout.includes('not found in User PATH'), 'remove-path informs no changes needed');
  } finally {
    try {
      if (fs.existsSync(testDirWithSpaces)) {
        fs.rmdirSync(testDirWithSpaces);
      }
    } catch {
      // ignore cleanup
    }
  }

  // 8b. Portable packager script syntax and path resolution
  const packagerScript = fs.readFileSync(path.join(appDir, 'packaging', 'portable', 'package-portable.ps1'), 'utf8');
  assert(packagerScript.includes('[System.IO.Path]::GetFullPath($OutputDir)'), 'package-portable.ps1 resolves OutputDir to absolute path');
  assert(packagerScript.includes('csc.exe'), 'package-portable.ps1 references native C# compiler');

  // 9. Portable Distribution Archive & File Layout Inspection
  const portableDir = path.join(appDir, 'dist-release', 'AndroScrn-portable-win-x64');
  const zipPath = path.join(appDir, 'dist-release', 'AndroScrn-portable-win-x64.zip');
  const checksumsPath = path.join(appDir, 'dist-release', 'SHA256SUMS.txt');

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

    // 10. Native Compiled Executable Verification
    const nativeExe = path.join(portableDir, 'androscrn.exe');
    const procHelp = spawnSync(nativeExe, ['--help'], { encoding: 'utf8' });
    assertEqual(procHelp.status, 0, 'Native androscrn.exe --help exits with 0');
    assert(procHelp.stdout.includes('AndroScrn — Next-Generation Android Control'), 'Native androscrn.exe --help outputs help');

    const procVer = spawnSync(nativeExe, ['--version'], { encoding: 'utf8' });
    assertEqual(procVer.status, 0, 'Native androscrn.exe --version exits with 0');
    assert(procVer.stdout.includes('v1.0.0-alpha.1'), 'Native androscrn.exe --version outputs version');

    const procInvalid = spawnSync(nativeExe, ['--nonexistent-flag'], { encoding: 'utf8' });
    assertEqual(procInvalid.status, 1, 'Native androscrn.exe invalid flag exits with 1');
    assert(procInvalid.stderr.includes('Error: Unknown command or option'), 'Native androscrn.exe invalid flag writes to stderr');
  }

  if (fs.existsSync(zipPath)) {
    const zipSizeMb = fs.statSync(zipPath).size / (1024 * 1024);
    assert(zipSizeMb > 50 && zipSizeMb < 250, `Portable ZIP archive exists with plausible size (${zipSizeMb.toFixed(1)} MB)`);
  }

  if (fs.existsSync(checksumsPath)) {
    const checksums = fs.readFileSync(checksumsPath, 'utf8');
    assert(checksums.includes('AndroScrn-portable-win-x64.zip'), 'SHA256SUMS.txt contains ZIP hash entry');
    assert(checksums.includes('androscrn.exe'), 'SHA256SUMS.txt contains CLI exe hash entry');
    assert(checksums.includes('AndroScrn-gui.exe'), 'SHA256SUMS.txt contains GUI exe hash entry');
  }
}
