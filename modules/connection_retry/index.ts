import { EventEmitter } from 'events';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AndroidDevice, DeviceManager } from '../device_manager';

export type RetryStatusType =
  | 'idle'
  | 'discovering'
  | 'authorized'
  | 'unauthorized'
  | 'offline'
  | 'multiple'
  | 'timeout'
  | 'cancelled'
  | 'error';

export interface ConnectionRetryState {
  active: boolean;
  sessionId: number;
  attempt: number;
  elapsedSeconds: number;
  timeoutSeconds: number;
  status: RetryStatusType;
  message: string;
  devices: AndroidDevice[];
  cmdPid?: number;
  error?: string;
}

export interface ConnectionRetryOptions {
  adbPath: string;
  scriptPath?: string;
  timeoutSeconds?: number;
  intervalSeconds?: number;
  openConsole?: boolean;
  /** Wait for this device only; other devices are ignored (used when recovering a specific session). */
  targetSerial?: string;
}

/**
 * Builds the cmd.exe command line and the PowerShell -EncodedCommand payload used to open the visible
 * diagnostics console. Returns null when any path contains characters cmd.exe would interpret.
 */
export function buildConsoleLaunch(
  script: string,
  adbExe: string,
  timeoutSec: number,
  intervalSec: number,
  sessionDir: string
): { cmdLine: string; psCommand: string; encoded: string } | null {
  const unsafe = /["%&|<>^\r\n]/;
  if ([script, adbExe, sessionDir].some((v) => unsafe.test(v))) {
    return null;
  }
  const secs = (n: number) => String(Math.max(1, Math.ceil(n)));
  // cmd /k strips the outermost quote pair, hence the extra wrapping quotes.
  const cmdLine = `/k ""${script}" "${adbExe}" ${secs(timeoutSec)} ${secs(intervalSec)} "${sessionDir}""`;
  const psCommand =
    `$p = Start-Process -FilePath cmd.exe -ArgumentList '${cmdLine.replace(/'/g, "''")}' -PassThru; ` +
    `if ($p) { Write-Output $p.Id }`;
  return { cmdLine, psCommand, encoded: Buffer.from(psCommand, 'utf16le').toString('base64') };
}

export class ConnectionRetryManager extends EventEmitter {
  private deviceManager: DeviceManager;
  private adbPath: string;
  private scriptPath: string;
  private currentSessionId = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private currentCmdPid: number | null = null;
  private currentSessionDir: string | null = null;
  private state: ConnectionRetryState;
  private pollInFlight = false;
  private targetSerial: string | null = null;

  constructor(deviceManager: DeviceManager, adbPath: string, scriptPath?: string) {
    super();
    this.deviceManager = deviceManager;
    this.adbPath = adbPath;
    this.scriptPath = scriptPath || path.resolve(process.cwd(), 'scripts', 'adb-diagnostics.cmd');
    this.state = {
      active: false,
      sessionId: 0,
      attempt: 0,
      elapsedSeconds: 0,
      timeoutSeconds: 60,
      status: 'idle',
      message: 'No retry in progress.',
      devices: []
    };
  }

  public getStatus(): ConnectionRetryState {
    return { ...this.state, devices: [...this.state.devices] };
  }

  /**
   * Resolves the real diagnostic batch script location across dev and packaged paths
   */
  public resolveScriptPath(): string {
    const candidates = [
      this.scriptPath,
      path.resolve(process.cwd(), 'scripts', 'adb-diagnostics.cmd'),
      path.resolve(__dirname, '../../scripts/adb-diagnostics.cmd'),
      path.resolve(__dirname, '../../../scripts/adb-diagnostics.cmd'),
      path.resolve(__dirname, '../../../../scripts/adb-diagnostics.cmd')
    ];

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        return cand;
      }
    }
    return this.scriptPath;
  }

  /**
   * Spawns a real, visible Windows CMD console window displaying live ADB diagnostics.
   * Safe argument-based invocation: does not pass unescaped shell strings or user input.
   */
  public launchDiagnosticConsole(
    adbExe: string,
    timeoutSec: number,
    intervalSec: number,
    sessionDir: string
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const script = this.resolveScriptPath();
      if (!fs.existsSync(script)) {
        // If script is not present on disk, cannot launch external CMD window
        return resolve(null);
      }

      // Launch cmd.exe via PowerShell Start-Process to capture the Win32 PID of a visible console.
      // The command is passed as -EncodedCommand (base64 UTF-16LE) so no nested quoting layers can corrupt
      // paths containing spaces. cmd /k strips the outermost quote pair, hence the extra wrapping quotes.
      // Values are only our own bundled paths and numerics; characters cmd would interpret are rejected.
      const built = buildConsoleLaunch(script, adbExe, timeoutSec, intervalSec, sessionDir);
      if (!built) {
        return resolve(null);
      }
      const { cmdLine, encoded } = built;
      const secs = (n: number) => String(Math.max(1, Math.ceil(n)));
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (!err && stdout && stdout.trim()) {
            const pid = parseInt(stdout.trim(), 10);
            if (!isNaN(pid) && pid > 0) {
              this.currentCmdPid = pid;
              return resolve(pid);
            }
          }

          // Fallback: spawn cmd.exe /c start directly
          try {
            const fallback = spawn(
              'cmd.exe',
              ['/c', 'start', '"AndroScrn Live ADB Diagnostics"', 'cmd.exe', '/k', `""${script}" "${adbExe}" ${secs(timeoutSec)} ${secs(intervalSec)} "${sessionDir}""`],
              {
                windowsVerbatimArguments: true,
                windowsHide: false,
                detached: true,
                stdio: 'ignore'
              }
            );
            fallback.unref();
            resolve(fallback.pid || null);
          } catch {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Starts a device connection retry session.
   * Debounces multiple clicks to prevent overlapping retry loops and duplicate ADB processes.
   */
  public async startRetry(options?: Partial<ConnectionRetryOptions>): Promise<{
    success: boolean;
    message: string;
    sessionId?: number;
  }> {
    if (this.state.active) {
      return {
        success: false,
        message: 'A connection retry session is already active.'
      };
    }

    const timeoutSec = Math.max(1, options?.timeoutSeconds ?? 60);
    const intervalSec = Math.max(0.05, options?.intervalSeconds ?? 2);
    const openConsole = options?.openConsole ?? true;
    this.targetSerial = typeof options?.targetSerial === 'string' && options.targetSerial ? options.targetSerial : null;
    const adbExe = options?.adbPath ?? this.adbPath;

    this.currentSessionId++;
    const sessionId = this.currentSessionId;

    // Create session temp directory for signal flags
    const sessionDir = path.join(os.tmpdir(), `androscrn-retry-${sessionId}-${Date.now()}`);
    try {
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    } catch {
      // Ignore directory creation error; script handles missing dir gracefully
    }
    this.currentSessionDir = sessionDir;

    // Update state to active and discovering immediately
    this.state = {
      active: true,
      sessionId,
      attempt: 0,
      elapsedSeconds: 0,
      timeoutSeconds: timeoutSec,
      status: 'discovering',
      message: 'Starting device discovery...',
      devices: []
    };
    this.emit('statusChanged', this.getStatus());

    // Launch visible CMD window if requested (non-blocking)
    if (openConsole && process.platform === 'win32') {
      this.launchDiagnosticConsole(adbExe, timeoutSec, intervalSec, sessionDir).then((pid) => {
        if (this.currentSessionId === sessionId && pid) {
          this.state.cmdPid = pid;
          this.emit('statusChanged', this.getStatus());
        }
      });
    }

    // Immediate first attempt execution
    await this.executePollStep(sessionId, timeoutSec, intervalSec);

    // If still active after first attempt, begin interval timer
    if (this.state.active && this.currentSessionId === sessionId) {
      this.pollingTimer = setInterval(async () => {
        await this.executePollStep(sessionId, timeoutSec, intervalSec);
      }, intervalSec * 1000);
    }

    return {
      success: true,
      message: 'Device discovery started.',
      sessionId
    };
  }

  /**
   * Single polling step: queries devices, evaluates states, and branches accordingly.
   */
  private async executePollStep(sessionId: number, timeoutSec: number, intervalSec: number): Promise<void> {
    if (this.currentSessionId !== sessionId || !this.state.active || this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    try {
      await this.pollOnce(sessionId, timeoutSec, intervalSec);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async pollOnce(sessionId: number, timeoutSec: number, intervalSec: number): Promise<void> {
    this.state.attempt++;
    const currentAttempt = this.state.attempt;

    try {
      const allDevices = await this.deviceManager.getDevicesDetailed();
      const devices = this.targetSerial ? allDevices.filter((d) => d.serial === this.targetSerial) : allDevices;

      // Guard against stale async resolution
      if (this.currentSessionId !== sessionId || !this.state.active) {
        return;
      }

      this.state.devices = devices;

      const authorizedDevices = devices.filter((d) => d.state === 'device');
      const unauthorizedDevices = devices.filter((d) => d.state === 'unauthorized');
      const offlineDevices = devices.filter((d) => d.state === 'offline');

      // State 1: Authorized device(s) found -> SUCCESS
      if (authorizedDevices.length > 0) {
        this.cleanupTimer();
        this.state.active = false;
        this.state.status = 'authorized';
        this.state.message =
          authorizedDevices.length > 1
            ? `Discovered ${authorizedDevices.length} authorized devices. Select target device to connect.`
            : `Device ${authorizedDevices[0].model || authorizedDevices[0].serial} connected and authorized.`;

        this.signalFlag('success.flag');
        this.emit('statusChanged', this.getStatus());
        this.emit('deviceReady', authorizedDevices);
        return;
      }

      // State 2: Unauthorized device found
      if (unauthorizedDevices.length > 0) {
        this.state.status = 'unauthorized';
        this.state.message =
          'Device detected but unauthorized: Unlock your phone and tap "Allow USB debugging" (check "Always allow").';
        this.emit('statusChanged', this.getStatus());
      }
      // State 3: Offline device found
      else if (offlineDevices.length > 0) {
        this.state.status = 'offline';
        this.state.message = 'Device detected as offline: Reconnect the USB cable or toggle USB debugging.';
        this.emit('statusChanged', this.getStatus());
      }
      // State 4: Multiple non-ready devices
      else if (devices.length > 1) {
        this.state.status = 'multiple';
        this.state.message = `Multiple devices detected (${devices.length}), but none are currently authorized.`;
        this.emit('statusChanged', this.getStatus());
      }
      // State 5: No devices found
      else {
        this.state.status = 'discovering';
        this.state.message = `Searching for Android devices via ADB (Attempt #${currentAttempt})...`;
        this.emit('statusChanged', this.getStatus());
      }
    } catch (err: any) {
      if (this.currentSessionId !== sessionId || !this.state.active) return;
      this.state.status = 'error';
      this.state.error = err?.message || String(err);
      this.state.message = `ADB discovery error: ${this.state.error}`;
      this.emit('statusChanged', this.getStatus());
    }

    // Increment elapsed time (intervalSec seconds passed)
    if (currentAttempt > 1) {
      this.state.elapsedSeconds += intervalSec;
    }

    // Check timeout condition
    if (this.state.elapsedSeconds >= timeoutSec) {
      this.cleanupTimer();
      this.state.active = false;
      this.state.status = 'timeout';
      this.state.message = `Device discovery timed out after ${timeoutSec} seconds. No authorized device was detected.`;
      this.signalFlag('timeout.flag');
      this.emit('statusChanged', this.getStatus());
    }
  }

  /**
   * Signals a flag to the visible CMD script via session directory
   */
  private signalFlag(flagName: string): void {
    if (this.currentSessionDir && fs.existsSync(this.currentSessionDir)) {
      try {
        fs.writeFileSync(path.join(this.currentSessionDir, flagName), '1');
      } catch {
        // Ignore file write errors
      }
    }
  }

  /**
   * Cancels the active retry session and cleans up resources
   */
  public cancelRetry(): { success: boolean; message: string } {
    if (!this.state.active) {
      return { success: false, message: 'No active connection retry to cancel.' };
    }

    this.cleanupTimer();
    this.signalFlag('cancel.flag');

    // Attempt clean termination of the diagnostic CMD window process if PID is recorded
    if (this.currentCmdPid && process.platform === 'win32') {
      try {
        execFile('taskkill', ['/PID', String(this.currentCmdPid), '/F', '/T'], () => {});
      } catch {
        // Ignore taskkill errors
      }
      this.currentCmdPid = null;
    }

    this.currentSessionId++;
    this.state = {
      ...this.state,
      active: false,
      status: 'cancelled',
      message: 'Connection retry was cancelled by the user.'
    };
    this.emit('statusChanged', this.getStatus());

    return { success: true, message: 'Connection retry cancelled.' };
  }

  private cleanupTimer(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Disposes the retry manager (used when component unmounts or application quits)
   */
  public dispose(): void {
    this.cancelRetry();
    this.cleanupTimer();
    if (this.currentSessionDir && fs.existsSync(this.currentSessionDir)) {
      try {
        fs.rmSync(this.currentSessionDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
      this.currentSessionDir = null;
    }
    this.removeAllListeners();
  }
}
