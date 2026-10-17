import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

type AssertFn = (condition: boolean, name: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, name: string) => void;
type SkipFn = (name: string, reason: string) => void;

const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];

function describeRun(r: ReturnType<typeof spawnSync>): string {
  return [
    `status=${r.status}`,
    `signal=${r.signal}`,
    `error=${r.error ? r.error.message : 'none'}`,
    `stdout=${JSON.stringify(String(r.stdout ?? '').slice(0, 300))}`,
    `stderr=${JSON.stringify(String(r.stderr ?? '').slice(0, 300))}`
  ].join(' ');
}

/** PATH with every entry that contains an installed AndroScrn launcher removed, so lookup can never hit it. */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const entries = (process.env.PATH || '').split(path.delimiter).filter(entry => {
    if (!entry) return false;
    return !fs.existsSync(path.join(entry, 'androscrn.exe')) && !fs.existsSync(path.join(entry, 'androscrn.cmd'));
  });
  return { ...process.env, PATH: entries.join(path.delimiter) };
}

/**
 * Exercises the native `androscrn.exe` launcher.
 *
 * Prerequisites are established explicitly instead of assumed:
 *  - Fixture: the launcher is compiled from `packaging/portable/androscrn-cli.cs` into a temp folder created
 *    by this test (needs the .NET Framework C# compiler; skipped with a reason when it is missing).
 *  - Artifact: if `npm run build:portable` output exists it is checked too; otherwise that part is skipped.
 * Executables are always launched by absolute path with a PATH that excludes installed AndroScrn copies, and
 * assertions use ASCII text only, because the launcher's output encoding follows the host console code page.
 */
export async function runNativeCliTests(assert: AssertFn, assertEqual: AssertEqualFn, skip: SkipFn) {
  console.log('\nTest Group: Native androscrn.exe Launcher');

  if (os.platform() !== 'win32') {
    skip('Native androscrn.exe launcher', 'requires Windows');
    return;
  }

  const appDir = path.resolve(__dirname, '../../..');
  const source = path.join(appDir, 'packaging', 'portable', 'androscrn-cli.cs');
  const version: string = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  const env = sanitizedEnv();

  const check = (condition: boolean, name: string, detail: string) => {
    if (!condition) console.error(`    diagnostic: ${detail}`);
    assert(condition, name);
  };

  const exerciseExe = (exe: string, label: string, cwd: string) => {
    const run = (args: string[]) => spawnSync(exe, args, { encoding: 'utf8', cwd, env, timeout: 20000, windowsHide: true });

    const help = run(['--help']);
    check(!help.error && help.status === 0, `${label}: --help exits with 0`, describeRun(help));
    check(
      String(help.stdout).includes('USAGE:') && String(help.stdout).includes('Next-Generation Android Control & Automation Platform for Windows'),
      `${label}: --help prints the usage banner`,
      describeRun(help)
    );

    const shortHelp = run(['-h']);
    check(shortHelp.status === 0 && String(shortHelp.stdout).includes('USAGE:'), `${label}: -h behaves like --help`, describeRun(shortHelp));

    const ver = run(['--version']);
    check(ver.status === 0 && String(ver.stdout).includes(`v${version}`), `${label}: --version reports package version v${version}`, describeRun(ver));

    const bad = run(['--nonexistent-flag']);
    check(bad.status === 1, `${label}: unknown flag exits with 1`, describeRun(bad));
    check(String(bad.stderr).includes('Error: Unknown command or option'), `${label}: unknown flag explains the error on stderr`, describeRun(bad));
  };

  // ---------------------------------------------------------------- fixture build
  const csc = CSC_CANDIDATES.find(c => fs.existsSync(c));
  if (!csc) {
    skip('Native launcher fixture build', 'C# compiler (csc.exe) not found');
  } else if (!fs.existsSync(source)) {
    check(false, 'Native launcher source file exists', `missing ${source}`);
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-native-'));
    try {
      const exe = path.join(tmp, 'androscrn.exe');
      const build = spawnSync(csc, ['/nologo', '/target:exe', '/optimize+', `/out:${exe}`, source], {
        encoding: 'utf8',
        timeout: 120000,
        windowsHide: true
      });
      check(build.status === 0 && fs.existsSync(exe), 'Native launcher compiles from source into an isolated temp folder', describeRun(build));
      if (fs.existsSync(exe)) {
        assert(path.dirname(exe) === tmp, 'Launcher under test is the freshly built fixture, not an installed copy');
        exerciseExe(exe, 'Fixture exe', tmp);
      }
    } finally {
      // Remove only the folder this test created.
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  // ---------------------------------------------------------------- generated portable artifact
  const artifactExe = path.join(appDir, 'dist-release', 'AndroScrn-portable-win-x64', 'androscrn.exe');
  if (fs.existsSync(artifactExe)) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-native-artifact-'));
    try {
      exerciseExe(artifactExe, 'Portable artifact exe', cwd);
    } finally {
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  } else {
    skip('Portable artifact androscrn.exe', 'portable build output not found; run `npm run build:portable` to enable this check');
  }
}
