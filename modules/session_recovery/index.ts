import { EventEmitter } from 'events';
import type { ScrcpyOptions } from '../scrcpy_manager';
import type { AndroidDevice } from '../device_manager';
import type { ConnectionRetryState } from '../connection_retry';

/**
 * Recovery of a screen-mirroring session after the phone disconnects.
 *
 * Policy (deliberately conservative):
 * - Only a session the user started and did not stop is recovered.
 * - Only a disconnect (scrcpy exit code 2) triggers automatic recovery. Exit code 0 (the user closed the window)
 *   is treated as a stop; exit code 1 (start/runtime failure) is reported, not retried.
 * - Waiting for the phone reuses ConnectionRetryManager (bounded, cancellable polling of `adb devices`; ADB is
 *   never restarted). Only the same serial is restored automatically; a different identity needs the user.
 * - At most MAX_RESTORES automatic restores within RESTORE_WINDOW_MS, so a phone that keeps dropping cannot loop.
 * - Every recovery has an id; callbacks belonging to an older recovery are ignored.
 * - Camera Studio is never touched.
 */

export type RecoveryState =
  | 'idle'
  | 'disconnected'
  | 'reconnecting'
  | 'unauthorized'
  | 'restoring'
  | 'restored'
  | 'failed'
  | 'cancelled';

export interface RecoveryStatus {
  state: RecoveryState;
  recoveryId: number;
  serial: string | null;
  message: string;
  /** True when the user can press "Resume session" (the last session settings are known and a device is selected). */
  canResume: boolean;
}

/** The parts of ScrcpyManager the coordinator needs (injected so tests can fake them). */
export interface MirrorControl {
  startMirroring(options: ScrcpyOptions): { success: boolean; pid?: number; message?: string };
  getStatus(): { running: boolean };
}

/** The parts of ConnectionRetryManager the coordinator needs. */
export interface DeviceWaiter extends EventEmitter {
  startRetry(options?: { timeoutSeconds?: number; intervalSeconds?: number; openConsole?: boolean; targetSerial?: string }): Promise<{ success: boolean; message: string }>;
  cancelRetry(): { success: boolean; message: string };
  getStatus(): ConnectionRetryState;
}

export interface RecoveryOptions {
  waitTimeoutSeconds?: number;
  pollIntervalSeconds?: number;
  maxRestores?: number;
  restoreWindowMs?: number;
  now?: () => number;
}

export const DEFAULT_RECOVERY_WAIT_SECONDS = 60;
export const MAX_RESTORES = 3;
export const RESTORE_WINDOW_MS = 120_000;

export class SessionRecoveryCoordinator extends EventEmitter {
  private lastOptions: ScrcpyOptions | null = null;
  /** True between a user-initiated start and a user-initiated stop. */
  private wantsRunning = false;
  private recoveryId = 0;
  private status: RecoveryStatus = { state: 'idle', recoveryId: 0, serial: null, message: '', canResume: false };
  private restoreTimes: number[] = [];
  private readonly onRetryStatus: (s: ConnectionRetryState) => void;
  private readonly onDeviceReady: (devices: AndroidDevice[]) => void;
  private readonly opts: Required<RecoveryOptions>;

  constructor(private mirror: MirrorControl, private waiter: DeviceWaiter, options: RecoveryOptions = {}) {
    super();
    this.opts = {
      waitTimeoutSeconds: options.waitTimeoutSeconds ?? DEFAULT_RECOVERY_WAIT_SECONDS,
      pollIntervalSeconds: options.pollIntervalSeconds ?? 2,
      maxRestores: options.maxRestores ?? MAX_RESTORES,
      restoreWindowMs: options.restoreWindowMs ?? RESTORE_WINDOW_MS,
      now: options.now ?? Date.now
    };
    this.onRetryStatus = (s) => this.handleRetryStatus(s);
    this.onDeviceReady = (devices) => this.handleDeviceReady(devices);
    this.waiter.on('statusChanged', this.onRetryStatus);
    this.waiter.on('deviceReady', this.onDeviceReady);
  }

  getStatus(): RecoveryStatus {
    return { ...this.status };
  }

  /** A mirroring session was started by the user (or by a restore). Remembers its settings. */
  sessionStarted(options: ScrcpyOptions): void {
    this.lastOptions = { ...options };
    this.wantsRunning = true;
  }

  /** The user stopped mirroring: never restore it, and abandon any recovery in progress. */
  userStopped(): void {
    this.wantsRunning = false;
    if (this.isRecovering()) this.cancel('Mirroring was stopped.');
    else this.set('idle', null, '');
  }

  /** Called with every scrcpy exit. */
  sessionExited(code: number | null, serial: string | null): void {
    if (!this.wantsRunning) return; // stopped by the user, or never started by the user
    if (code === 0) {
      // The user closed the mirroring window: same as stopping.
      this.wantsRunning = false;
      this.set('idle', serial, '');
      return;
    }
    if (code !== 2) {
      this.wantsRunning = false;
      this.set('failed', serial, 'Mirroring stopped because of an error. Check the phone and start mirroring again.');
      return;
    }
    this.beginRecovery(serial);
  }

  /** Manual "Resume session": restart the last session on the given (currently selected) device. */
  resume(selectedSerial: string): { success: boolean; message: string } {
    if (!this.lastOptions) return { success: false, message: 'There is no previous session to resume.' };
    if (this.mirror.getStatus().running) return { success: false, message: 'Mirroring is already running.' };
    if (this.isRecovering()) this.cancel('');
    const id = ++this.recoveryId;
    this.restoreTimes = [];
    return this.restore(id, selectedSerial, true);
  }

  cancel(message = 'Reconnecting was cancelled.'): void {
    if (!this.isRecovering() && this.status.state !== 'failed') return;
    this.recoveryId++;
    this.wantsRunning = false;
    if (this.waiter.getStatus().active) this.waiter.cancelRetry();
    this.set('cancelled', this.status.serial, message);
  }

  dispose(): void {
    this.recoveryId++;
    this.wantsRunning = false;
    if (this.isRecovering() && this.waiter.getStatus().active) this.waiter.cancelRetry();
    this.waiter.off('statusChanged', this.onRetryStatus);
    this.waiter.off('deviceReady', this.onDeviceReady);
    this.removeAllListeners();
  }

  private isRecovering(): boolean {
    return ['disconnected', 'reconnecting', 'unauthorized', 'restoring'].includes(this.status.state);
  }

  private beginRecovery(serial: string | null): void {
    const now = this.opts.now();
    this.restoreTimes = this.restoreTimes.filter(t => now - t < this.opts.restoreWindowMs);
    if (this.restoreTimes.length >= this.opts.maxRestores) {
      this.wantsRunning = false;
      this.set('failed', serial, "Couldn't keep the connection: the phone disconnected repeatedly. Check the cable, then use Resume session.");
      return;
    }
    if (this.isRecovering()) return; // repeated disconnect events for the same loss
    const id = ++this.recoveryId;
    this.set('disconnected', serial, 'Device disconnected.');
    this.set('reconnecting', serial, 'Reconnecting… Reconnect the cable or keep the phone nearby.');
    this.waitFor(id, serial);
  }

  /** Waits (bounded) for this specific phone; other phones are ignored. */
  private waitFor(id: number, serial: string | null): void {
    if (!this.waiter.getStatus().active) {
      this.waiter
        .startRetry({
          timeoutSeconds: this.opts.waitTimeoutSeconds,
          intervalSeconds: this.opts.pollIntervalSeconds,
          openConsole: false,
          targetSerial: serial || undefined
        })
        .then((res) => {
          // "already active" (e.g. the user pressed Try Again) is fine: we listen to its events too.
          if (!res.success && id === this.recoveryId && !this.waiter.getStatus().active) {
            this.set('failed', serial, "Couldn't reconnect: the device search could not start.");
          }
        })
        .catch(() => {
          if (id === this.recoveryId) this.set('failed', serial, "Couldn't reconnect: the device search could not start.");
        });
    }
  }

  private handleRetryStatus(s: ConnectionRetryState): void {
    if (!this.isRecovering() || this.status.state === 'restoring') return;
    const serial = this.status.serial;
    if (s.status === 'unauthorized') {
      this.set('unauthorized', serial, 'Device found but not authorized. Unlock the phone and allow USB debugging.');
    } else if (s.status === 'timeout') {
      this.wantsRunning = false;
      this.set('failed', serial, "Couldn't reconnect: the phone did not come back. Reconnect it and use Resume session.");
    } else if (s.status === 'cancelled') {
      this.recoveryId++;
      this.wantsRunning = false;
      this.set('cancelled', serial, 'Reconnecting was cancelled.');
    }
  }

  private handleDeviceReady(devices: AndroidDevice[]): void {
    if (!this.isRecovering() || this.status.state === 'restoring') return;
    const id = this.recoveryId;
    const serial = this.status.serial;
    if (serial && devices.some(d => d.serial === serial && d.state === 'device')) {
      this.set('restoring', serial, 'Device found. Restoring session…');
      this.restore(id, serial, false);
    } else {
      // Another phone answered a search that was not limited to ours (e.g. the user's Try Again). Never switch
      // devices on our own: keep waiting for this phone.
      this.waitFor(id, serial);
    }
  }

  private restore(id: number, serial: string, manual: boolean): { success: boolean; message: string } {
    if (id !== this.recoveryId) return { success: false, message: 'Superseded.' };
    if (!this.lastOptions) return { success: false, message: 'There is no previous session to resume.' };
    const options: ScrcpyOptions = { ...this.lastOptions, serial };
    this.set('restoring', serial, 'Restoring session…');
    const res = this.mirror.startMirroring(options);
    if (id !== this.recoveryId) return { success: false, message: 'Superseded.' };
    if (res.success) {
      this.restoreTimes.push(this.opts.now());
      this.lastOptions = options;
      this.wantsRunning = true;
      this.set('restored', serial, manual ? 'Session resumed.' : 'Connection restored.');
      return { success: true, message: this.status.message };
    }
    this.wantsRunning = false;
    this.set('failed', serial, `Couldn't restore the session: ${res.message || 'mirroring did not start'}.`);
    return { success: false, message: this.status.message };
  }

  private set(state: RecoveryState, serial: string | null, message: string): void {
    this.status = {
      state,
      recoveryId: this.recoveryId,
      serial,
      message,
      canResume: !!this.lastOptions && (state === 'failed' || state === 'cancelled')
    };
    this.emit('statusChanged', this.getStatus());
  }
}
