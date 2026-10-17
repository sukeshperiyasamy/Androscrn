import cp from 'child_process';

/**
 * Regression guard for "the browser keeps opening on every test run".
 *
 * Root cause (reproduced with a spawn tracer): the CLI `docs` unit test really executed
 * `cmd.exe /c start "" https://...`, so every unit-suite run opened the default browser.
 *
 * While installed, any attempt by the test process to launch a browser, URL or HTML file is recorded and
 * BLOCKED (the real launch never happens). The suite then fails if anything was attempted.
 * Tests that need to verify launch behavior must inject a fake spawn (see `openInDefaultBrowser`).
 */
const attempts: string[] = [];
const originals: Record<string, any> = {};

function looksLikeBrowserLaunch(cmd: unknown, args: unknown): boolean {
  const command = String(cmd ?? '').toLowerCase();
  const argList = Array.isArray(args) ? args.map(a => String(a).toLowerCase()) : [];
  const whole = [command, ...argList].join(' ');
  const base = command.split(/[\\/]/).pop() || '';
  if (base === 'xdg-open' || base === 'open' || base === 'sensible-browser') return true;
  if (/^(chrome|msedge|firefox|brave|iexplore)(\.exe)?$/.test(base)) return true;
  // cmd.exe /c start "" <target>  and  explorer.exe <url|html>
  if (/^cmd(\.exe)?$/.test(base) && /(^|\s)start(\s|$)/.test(whole) && /(https?:\/\/|\.html?\b)/.test(whole)) return true;
  if (/^explorer(\.exe)?$/.test(base) && /(https?:\/\/|\.html?\b)/.test(whole)) return true;
  return false;
}

function fakeChild(): any {
  const { EventEmitter } = require('events');
  const child: any = new EventEmitter();
  child.unref = () => child;
  child.kill = () => true;
  child.pid = -1;
  child.stdout = null;
  child.stderr = null;
  setImmediate(() => child.emit('close', 0));
  return child;
}

export function installLaunchGuard(): void {
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'] as const) {
    if (originals[name]) continue;
    originals[name] = (cp as any)[name];
    (cp as any)[name] = function (cmd: any, maybeArgs?: any, ...rest: any[]) {
      const args = Array.isArray(maybeArgs) ? maybeArgs : [];
      // exec/execSync take a single command line string
      const target = name === 'exec' || name === 'execSync' ? cmd : cmd;
      const asArgs = name === 'exec' || name === 'execSync' ? String(cmd).split(/\s+/).slice(1) : args;
      const asCmd = name === 'exec' || name === 'execSync' ? String(cmd).split(/\s+/)[0] : target;
      if (looksLikeBrowserLaunch(asCmd, asArgs)) {
        attempts.push(`${name}: ${asCmd} ${asArgs.join(' ')}`.slice(0, 200));
        if (name === 'spawn') return fakeChild();
        if (name === 'spawnSync' || name === 'execFileSync' || name === 'execSync') return Buffer.alloc(0);
        return fakeChild();
      }
      return originals[name].call(this, cmd, maybeArgs, ...rest);
    };
  }
}

export function removeLaunchGuard(): void {
  for (const name of Object.keys(originals)) {
    (cp as any)[name] = originals[name];
    delete originals[name];
  }
}

export function getBlockedBrowserLaunches(): string[] {
  return [...attempts];
}

export function assertNoBrowserLaunches(assert: (condition: boolean, name: string) => void): void {
  console.log('\nTest Group: Browser Launch Guard');
  if (attempts.length > 0) {
    console.error(`    blocked launch attempts:\n      ${attempts.join('\n      ')}`);
  }
  assert(attempts.length === 0, 'Unit tests never launch a browser, URL or HTML page');
}
