import { gracefulStop } from './graceful-stop';
import { ChildProcess, spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { SecurityValidator } from '../security';

export interface ScrcpyOptions {
  serial?: string;
  preset?: 'high_performance' | 'balanced' | 'battery_saver' | 'ultra' | 'custom';
  maxSize?: number;
  bitRateMbps?: number;
  maxFps?: number;
  videoCodec?: 'h264' | 'h265' | 'av1';
  turnScreenOff?: boolean;
  stayAwake?: boolean;
  fullscreen?: boolean;
  showTouches?: boolean;
  noAudio?: boolean;
  windowBorderless?: boolean;
  recordPath?: string;
  windowTitle?: string;
  keyboardMode?: 'sdk' | 'uhid' | 'aoa' | 'disabled';
  mouseMode?: 'sdk' | 'uhid' | 'aoa' | 'disabled';
  alwaysOnTop?: boolean;
  captureOrientation?: '0' | '90' | '180' | '270' | 'flip0' | 'flip90' | 'flip180' | 'flip270';
  newDisplay?: string;
  audioSource?: 'output' | 'playback' | 'mic';
  audioDup?: boolean;
  noPowerOn?: boolean;
  noClipboardAutosync?: boolean;
}

export interface ScrcpyProcessStatus {
  running: boolean;
  pid?: number;
  targetSerial?: string;
  exitCode?: number | null;
  error?: string;
  lastError?: string;
  inputControlBlocked?: boolean;
  inputControlMessage?: string;
  windowTitle?: string;
}

export class ScrcpyManager extends EventEmitter {
  private scrcpyExePath: string;
  private currentProcess: ChildProcess | null = null;
  private currentSerial: string | null = null;
  private currentOptions: ScrcpyOptions | null = null;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private inputControlBlocked = false;
  private inputControlMessage: string | null = null;
  private isStarting = false;
  private currentSessionId = 0;

  constructor(scrcpyExePath: string) {
    super();
    this.scrcpyExePath = scrcpyExePath;
  }

  /**
   * Queries scrcpy version and compiled dependencies
   */
  public getScrcpyVersion(): Promise<string> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.scrcpyExePath)) {
        return resolve('scrcpy binary not found');
      }

      const child = spawn(this.scrcpyExePath, ['--version'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      child.stdout?.on('data', d => { stdout += d.toString(); });
      child.on('close', () => {
        const match = stdout.match(/scrcpy\s+([\d.]+)/i);
        resolve(match ? `scrcpy ${match[1]}` : (stdout.split('\n')[0] || 'Unknown scrcpy'));
      });
      child.on('error', err => {
        resolve(`Error: ${err.message}`);
      });
    });
  }

  /**
   * Builds an immutable argument vector according to validated options
   */
  public buildArguments(options: ScrcpyOptions): string[] {
    const args: string[] = [];

    // Target device serial
    if (options.serial && SecurityValidator.isValidSerial(options.serial)) {
      args.push('-s', options.serial);
    }

    // Apply quality presets or custom overrides
    let maxSize = options.maxSize;
    let bitRate = options.bitRateMbps;
    let maxFps = options.maxFps;

    if (options.preset === 'high_performance') {
      maxSize = maxSize ?? 1920;
      bitRate = bitRate ?? 12;
      maxFps = maxFps ?? 60;
    } else if (options.preset === 'battery_saver') {
      maxSize = maxSize ?? 1280;
      bitRate = bitRate ?? 4;
      maxFps = maxFps ?? 30;
    } else if (options.preset === 'ultra') {
      maxSize = maxSize ?? 2560;
      bitRate = bitRate ?? 16;
      maxFps = maxFps ?? 60;
    } else if (options.preset === 'balanced' || !options.preset) {
      maxSize = maxSize ?? 1920;
      bitRate = bitRate ?? 8;
    }

    if (maxSize && maxSize > 0) {
      args.push('--max-size', maxSize.toString());
    }

    if (bitRate && bitRate > 0) {
      args.push(`-b${bitRate}M`);
    }

    if (maxFps && maxFps > 0) {
      args.push('--max-fps', maxFps.toString());
    }

    if (options.videoCodec) {
      args.push(`--video-codec=${options.videoCodec}`);
    }

    if (options.turnScreenOff) {
      args.push('-S');
    }

    if (options.stayAwake) {
      args.push('-w');
    }

    if (options.fullscreen) {
      args.push('-f');
    }

    if (options.showTouches) {
      args.push('-t');
    }

    if (options.noAudio) {
      args.push('--no-audio');
    }

    if (options.windowBorderless) {
      args.push('--window-borderless');
    }

    if (options.recordPath) {
      args.push(`--record=${options.recordPath}`);
    }

    if (options.keyboardMode && ['sdk', 'uhid', 'aoa', 'disabled'].includes(options.keyboardMode)) {
      args.push(`--keyboard=${options.keyboardMode}`);
    }

    if (options.mouseMode && ['sdk', 'uhid', 'aoa', 'disabled'].includes(options.mouseMode)) {
      args.push(`--mouse=${options.mouseMode}`);
    }

    if (options.alwaysOnTop) {
      args.push('--always-on-top');
    }

    if (options.captureOrientation && ['0', '90', '180', '270', 'flip0', 'flip90', 'flip180', 'flip270'].includes(options.captureOrientation)) {
      args.push(`--capture-orientation=${options.captureOrientation}`);
    }

    if (options.newDisplay && /^\d{3,4}x\d{3,4}(\/\d{2,3})?$/.test(options.newDisplay)) {
      args.push(`--new-display=${options.newDisplay}`, '-x');
    }

    if (options.audioSource && ['output', 'playback', 'mic'].includes(options.audioSource)) {
      args.push(`--audio-source=${options.audioSource}`);
    }

    if (options.audioDup) {
      args.push('--audio-dup');
    }

    if (options.noPowerOn || (options.keyboardMode === 'uhid' && options.mouseMode === 'uhid' && options.noPowerOn !== false)) {
      args.push('--no-power-on');
    }

    if (options.noClipboardAutosync) {
      args.push('--no-clipboard-autosync');
    }

    args.push(`--window-title=${options.windowTitle || 'AndroScrn Display'}`);

    return args;
  }

  /**
   * Starts screen mirroring process
   */
  public startMirroring(options: ScrcpyOptions): { success: boolean; pid?: number; message?: string } {
    if (this.isStarting) {
      return { success: false, message: 'Screen mirroring launch already in progress.' };
    }

    // Terminate existing active mirroring session to prevent duplicate windows or orphaned processes
    if (this.currentProcess && !this.currentProcess.killed && this.currentProcess.exitCode === null) {
      try {
        gracefulStop(this.currentProcess);
      } catch {}
      this.currentProcess = null;
    }

    if (!fs.existsSync(this.scrcpyExePath)) {
      return { success: false, message: `scrcpy executable not found at: ${this.scrcpyExePath}` };
    }

    this.isStarting = true;

    if (options.recordPath) {
      const recordDir = path.dirname(options.recordPath);
      if (!fs.existsSync(recordDir)) {
        try {
          fs.mkdirSync(recordDir, { recursive: true });
        } catch (err: any) {
          this.isStarting = false;
          return { success: false, message: `Cannot create recording directory: ${err.message}` };
        }
      }
    }

    this.lastError = null;
    this.lastExitCode = null;
    this.currentOptions = { ...options };
    this.inputControlBlocked = false;
    this.inputControlMessage = null;
    this.currentSessionId++;
    const sessionId = this.currentSessionId;

    const args = this.buildArguments(options);
    const binDir = path.dirname(this.scrcpyExePath);

    try {
      const child = spawn(this.scrcpyExePath, args, {
        cwd: binDir,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = child;
      this.currentSerial = options.serial || 'default';

      this.emit('started', { pid: child.pid, serial: this.currentSerial });
      this.emit('statusChanged', this.getStatus());

      child.stdout?.on('data', (chunk) => {
        if (this.currentSessionId !== sessionId) return;
        const text = chunk.toString();
        this.emit('log', { type: 'stdout', text });
      });

      child.stderr?.on('data', (chunk) => {
        if (this.currentSessionId !== sessionId) return;
        const text = chunk.toString();
        this.lastError = text.trim();

        // Detect OEM input injection restriction (e.g. Xiaomi HyperOS "USB debugging (Security Settings)")
        // When running in full UHID mode, remote keyboard/mouse operates via /dev/uhid and is not blocked by INJECT_EVENTS
        const isUhid = this.currentOptions?.keyboardMode === 'uhid' && this.currentOptions?.mouseMode === 'uhid';
        if (!isUhid && /INJECT_EVENTS|SecurityException|USB debugging \(Security Settings\)/i.test(text)) {
          this.inputControlBlocked = true;
          this.inputControlMessage = 'Input injection restricted by device security: Enable "USB debugging (Security settings)" in Developer options on your phone.';
          this.emit('inputBlocked', {
            serial: this.currentSerial,
            message: this.inputControlMessage
          });
          this.emit('statusChanged', this.getStatus());
        }

        this.emit('log', { type: 'stderr', text });
      });

      child.on('exit', (code) => {
        if (this.currentSessionId !== sessionId) return;
        this.lastExitCode = code;
      });

      child.on('close', (code) => {
        if (this.currentSessionId !== sessionId) return;
        const exitedSerial = this.currentSerial;
        this.lastExitCode = code;
        this.currentProcess = null;
        this.currentSerial = null;

        // Scrcpy Exit Codes:
        // 0: Normal termination
        // 1: Start failure (e.g. video encoder initialization error)
        // 2: Device disconnected while running
        this.emit('stopped', { code, serial: exitedSerial });
        this.emit('statusChanged', this.getStatus());

        if (code === 2) {
          this.emit('disconnected', { serial: exitedSerial });
        }
      });

      child.on('error', (err) => {
        if (this.currentSessionId !== sessionId) return;
        this.lastError = err.message;
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        } else {
          this.emit('log', { type: 'stderr', text: `Process error: ${err.message}` });
        }
        this.currentProcess = null;
        this.currentSerial = null;
        this.emit('statusChanged', this.getStatus());
      });

      return { success: true, pid: child.pid };
    } catch (err: any) {
      this.lastError = err.message;
      return { success: false, message: err.message };
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Focuses the native scrcpy interactive mirroring window on Windows
   */
  public focusMirrorWindow(): Promise<{ success: boolean; message: string }> {
    if (!this.currentProcess || this.currentProcess.killed || this.currentProcess.exitCode !== null) {
      return Promise.resolve({ success: false, message: 'Screen mirroring is not active.' });
    }
    const windowTitle = this.currentOptions?.windowTitle || 'AndroScrn Display';
    const safeTitle = windowTitle.replace(/'/g, "''");
    const pid = this.currentProcess.pid;

    return new Promise((resolve) => {
      try {
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          $wshell = New-Object -ComObject Wscript.Shell
          $activated = $false
          if (${pid || 0}) {
            $activated = $wshell.AppActivate(${pid || 0})
          }
          if (-not $activated) {
            $activated = $wshell.AppActivate('${safeTitle}')
          }
          if ($activated) { exit 0 } else { exit 1 }
        `;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
          windowsHide: true,
          timeout: 4000
        }, (error) => {
          if (!error) {
            resolve({ success: true, message: `Brought "${windowTitle}" to foreground.` });
          } else {
            resolve({ success: false, message: `Could not activate mirror window "${windowTitle}". It may be minimized or not yet created.` });
          }
        });
      } catch (err: any) {
        resolve({ success: false, message: `Failed to focus mirror window: ${err?.message || err}` });
      }
    });
  }

  /**
   * Stops active screen mirroring session cleanly
   */
  public stopMirroring(): boolean {
    if (!this.currentProcess) return false;

    try {
      gracefulStop(this.currentProcess);
      this.currentProcess = null;
      this.currentSerial = null;
      this.currentOptions = null;
      this.inputControlBlocked = false;
      this.inputControlMessage = null;
      this.emit('statusChanged', this.getStatus());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns current process status and last exit information
   */
  public getStatus(): ScrcpyProcessStatus {
    const isRunning = this.currentProcess !== null && !this.currentProcess.killed && this.currentProcess.exitCode === null;
    return {
      running: isRunning,
      pid: isRunning ? this.currentProcess?.pid : undefined,
      targetSerial: this.currentSerial || undefined,
      exitCode: this.lastExitCode,
      lastError: this.lastError || undefined,
      inputControlBlocked: this.inputControlBlocked,
      inputControlMessage: this.inputControlMessage || undefined,
      windowTitle: this.currentOptions?.windowTitle || 'AndroScrn Display'
    };
  }
}
