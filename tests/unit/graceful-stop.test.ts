import { spawn } from 'child_process';
import { gracefulStop } from '../../modules/scrcpy_manager/graceful-stop';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

export async function runGracefulStopUnitTests(assert: AssertFn, assertEqual: AssertEqualFn): Promise<void> {
  console.log('\nTest Group: Graceful scrcpy stop (recording finalization)');

  // A process that ignores polite close requests must still be force-killed within the grace period.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  await new Promise((r) => setTimeout(r, 300));
  const started = Date.now();
  gracefulStop(child, 800);
  const winner = await Promise.race([exited.then(() => 'exited'), new Promise((r) => setTimeout(() => r('hung'), 6000))]);
  assertEqual(winner, 'exited', 'Stubborn child exits after gracefulStop (force-kill fallback)');
  assert(Date.now() - started < 6000, 'gracefulStop completes within bounded time');

  // Already-exited process is a no-op and must not throw.
  let threw = false;
  try {
    gracefulStop(child, 100);
  } catch {
    threw = true;
  }
  assert(!threw, 'gracefulStop on an exited process is a safe no-op');
}
