import { EventEmitter } from 'events';
import { SessionRecoveryCoordinator, MirrorControl, DeviceWaiter, RecoveryStatus } from '../../modules/session_recovery';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

/** Test double for ConnectionRetryManager: tests drive its events directly. */
class FakeWaiter extends EventEmitter implements DeviceWaiter {
  active = false;
  starts: Array<{ targetSerial?: string; openConsole?: boolean }> = [];
  cancels = 0;
  async startRetry(options: any = {}) {
    if (this.active) return { success: false, message: 'A connection retry session is already active.' };
    this.active = true;
    this.starts.push(options);
    return { success: true, message: 'started' };
  }
  cancelRetry() {
    if (!this.active) return { success: false, message: 'none' };
    this.active = false;
    this.cancels++;
    this.emit('statusChanged', { ...this.getStatus(), status: 'cancelled' });
    return { success: true, message: 'cancelled' };
  }
  getStatus(): any {
    return { active: this.active, sessionId: 1, attempt: 1, elapsedSeconds: 0, timeoutSeconds: 60, status: 'discovering', message: '', devices: [] };
  }
  /** Simulates the poll finding authorized devices (the real manager stops polling at that point). */
  found(serials: string[]) {
    this.active = false;
    this.emit('deviceReady', serials.map(serial => ({ serial, state: 'device' })));
  }
  state(status: string) {
    if (status === 'timeout') this.active = false;
    this.emit('statusChanged', { ...this.getStatus(), status });
  }
}

class FakeMirror implements MirrorControl {
  running = false;
  starts: any[] = [];
  next: { success: boolean; message?: string } = { success: true };
  startMirroring(options: any) {
    this.starts.push(options);
    if (this.next.success) this.running = true;
    return this.next;
  }
  getStatus() {
    return { running: this.running };
  }
}

const tick = () => new Promise(r => setImmediate(r));

function setup(opts: any = {}) {
  const mirror = new FakeMirror();
  const waiter = new FakeWaiter();
  let now = 1_000_000;
  const rec = new SessionRecoveryCoordinator(mirror, waiter, { now: () => now, ...opts });
  const states: string[] = [];
  rec.on('statusChanged', (s: RecoveryStatus) => states.push(s.state));
  const startUserSession = (serial = 'PHONE1') => {
    mirror.running = true;
    rec.sessionStarted({ serial, preset: 'balanced', keyboardMode: 'uhid', mouseMode: 'uhid' } as any);
  };
  const exit = (code: number | null, serial = 'PHONE1') => {
    mirror.running = false;
    rec.sessionExited(code, serial);
  };
  return { mirror, waiter, rec, states, startUserSession, exit, advance: (ms: number) => (now += ms) };
}

export async function runSessionRecoveryUnitTests(assert: AssertFn, assertEqual: AssertEqualFn): Promise<void> {
  console.log('\nTest Group: Mirroring session recovery');

  // Disconnect and reconnect of the same device restores the same settings
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    assertEqual(t.rec.getStatus().state, 'reconnecting', 'Disconnect (exit 2) starts reconnecting');
    assertEqual(t.waiter.starts.length, 1, 'One device search is started');
    assertEqual(t.waiter.starts[0].targetSerial, 'PHONE1', 'The search waits for this phone only');
    assertEqual(t.waiter.starts[0].openConsole, false, 'Recovery does not open the diagnostics console');
    t.waiter.found(['PHONE1']);
    assertEqual(t.rec.getStatus().state, 'restored', 'Same phone back -> session restored');
    assertEqual(t.mirror.starts.length, 1, 'Exactly one mirroring process started');
    assertEqual(t.mirror.starts[0].keyboardMode, 'uhid', 'Restored session keeps the user settings (UHID)');
    assertEqual(t.mirror.starts[0].serial, 'PHONE1', 'Restored session targets the same phone');
    assert(t.states.includes('disconnected') && t.states.includes('restoring'), 'UI sees disconnected -> restoring -> restored');
  }

  // User-initiated stop never triggers recovery
  {
    const t = setup();
    t.startUserSession();
    t.rec.userStopped();
    t.exit(0);
    t.exit(2);
    await tick();
    assertEqual(t.waiter.starts.length, 0, 'No device search after the user stopped mirroring');
    assertEqual(t.mirror.starts.length, 0, 'No restore after the user stopped mirroring');
  }

  // Closing the mirroring window counts as a stop
  {
    const t = setup();
    t.startUserSession();
    t.exit(0);
    t.exit(2);
    await tick();
    assertEqual(t.waiter.starts.length, 0, 'Closed window (exit 0) is not recovered, even if a later exit follows');
  }

  // scrcpy failure (exit 1) is reported, not retried
  {
    const t = setup();
    t.startUserSession();
    t.exit(1);
    await tick();
    assertEqual(t.rec.getStatus().state, 'failed', 'Exit 1 is reported as a failure');
    assertEqual(t.waiter.starts.length, 0, 'Exit 1 does not start a device search');
    assert(t.rec.getStatus().canResume, 'A failed session can be resumed manually');
  }

  // Repeated disconnect events do not create duplicate searches
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    t.exit(2);
    t.rec.sessionExited(2, 'PHONE1');
    await tick();
    assertEqual(t.waiter.starts.length, 1, 'Repeated disconnect events start only one search');
  }

  // Device stays away -> timeout -> failed with Resume
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.waiter.state('timeout');
    assertEqual(t.rec.getStatus().state, 'failed', "Search timeout ends in Couldn't reconnect");
    assert(t.rec.getStatus().canResume, 'Resume session is offered after a timeout');
    t.waiter.found(['PHONE1']);
    assertEqual(t.mirror.starts.length, 0, 'A late device appearance after failure does not auto-start mirroring');
  }

  // Unauthorized device: wait and explain, never restore
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.waiter.state('unauthorized');
    assertEqual(t.rec.getStatus().state, 'unauthorized', 'Unauthorized phone is reported');
    assert(/allow USB debugging/i.test(t.rec.getStatus().message), 'Unauthorized message says what to do');
    assertEqual(t.mirror.starts.length, 0, 'Unauthorized phone is not mirrored');
    t.waiter.found(['PHONE1']);
    assertEqual(t.rec.getStatus().state, 'restored', 'Once authorized, the session is restored');
  }

  // Manual cancel stops the search and any later appearance is ignored
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.rec.cancel();
    assertEqual(t.waiter.cancels, 1, 'Cancel stops the device search');
    assertEqual(t.rec.getStatus().state, 'cancelled', 'State becomes cancelled');
    t.waiter.found(['PHONE1']);
    assertEqual(t.mirror.starts.length, 0, 'No restore after cancel');
  }

  // Cancel from the shared retry UI (Try Again's Cancel) is honoured
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.waiter.cancelRetry();
    assertEqual(t.rec.getStatus().state, 'cancelled', 'Cancelling the device search cancels recovery');
  }

  // Multiple devices: another phone answering never replaces ours
  {
    const t = setup();
    t.startUserSession('PHONE1');
    t.exit(2, 'PHONE1');
    await tick();
    t.waiter.found(['OTHER']);
    await tick();
    assertEqual(t.mirror.starts.length, 0, 'Another phone is never mirrored automatically');
    assertEqual(t.rec.getStatus().state, 'reconnecting', 'Recovery keeps waiting for the original phone');
    assertEqual(t.waiter.starts.length, 2, 'A targeted search is restarted');
    assertEqual(t.waiter.starts[1].targetSerial, 'PHONE1', 'The restarted search targets the original phone');
  }

  // Restore failure (e.g. Camera Studio holds the phone)
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.mirror.next = { success: false, message: 'Camera Studio is using the phone' };
    t.waiter.found(['PHONE1']);
    assertEqual(t.rec.getStatus().state, 'failed', 'Failed restore is reported');
    assert(/Camera Studio/.test(t.rec.getStatus().message), 'Failure reason (camera busy) is shown, camera untouched');
  }

  // Bounded: a phone that keeps dropping stops being restored automatically
  {
    const t = setup({ maxRestores: 3, restoreWindowMs: 120_000 });
    t.startUserSession();
    for (let i = 0; i < 3; i++) {
      t.exit(2);
      await tick();
      t.waiter.found(['PHONE1']);
      t.advance(5_000);
    }
    t.exit(2);
    await tick();
    assertEqual(t.rec.getStatus().state, 'failed', 'Fourth drop within 2 minutes is not restored automatically');
    assertEqual(t.mirror.starts.length, 3, 'Exactly three automatic restores happened');
    t.advance(200_000);
    const resumed = t.rec.resume('PHONE1');
    assert(resumed.success, 'Manual Resume still works after the automatic limit');
  }

  // Stale callbacks: a device appearing for an old recovery after a new user session is ignored
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.rec.cancel();
    t.startUserSession('PHONE2');
    t.waiter.found(['PHONE1']);
    assertEqual(t.mirror.starts.length, 0, 'Device event from an old recovery does not start mirroring');
  }

  // Resume rules
  {
    const t = setup();
    assert(!t.rec.resume('PHONE1').success, 'Resume without a previous session is refused');
    t.startUserSession();
    assert(!t.rec.resume('PHONE1').success, 'Resume while mirroring is running is refused');
  }

  // Shutdown during recovery
  {
    const t = setup();
    t.startUserSession();
    t.exit(2);
    await tick();
    t.rec.dispose();
    assertEqual(t.waiter.cancels, 1, 'Shutdown cancels the active search');
    assertEqual(t.waiter.listenerCount('deviceReady'), 0, 'Shutdown removes its listeners');
    t.waiter.found(['PHONE1']);
    assertEqual(t.mirror.starts.length, 0, 'No restore after shutdown');
  }
}
