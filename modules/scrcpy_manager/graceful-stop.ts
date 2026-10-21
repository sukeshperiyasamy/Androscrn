import { ChildProcess, execFile } from 'child_process';

/**
 * Asks a scrcpy process to close cleanly so recordings (MP4/MKV) are finalized, then force-kills it
 * if it has not exited within graceMs. On Windows a plain child.kill() is TerminateProcess, which leaves
 * an MP4 without its moov atom (unplayable); taskkill without /F posts WM_CLOSE to the scrcpy window instead.
 */
export function gracefulStop(child: ChildProcess, graceMs = 4000): void {
  if (child.exitCode !== null || child.killed) return;

  const force = setTimeout(() => {
    if (child.exitCode === null) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  }, graceMs);
  force.unref();
  if (typeof child.once === 'function') {
    child.once('exit', () => clearTimeout(force));
  }

  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid)], { windowsHide: true }, () => {});
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      // handled by force timer
    }
  }
}
