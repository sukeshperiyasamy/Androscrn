import { ChildProcess, spawn } from 'child_process';
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
}

export interface ScrcpyProcessStatus {
  running: boolean;
  pid?: number;
  targetSerial?: string;
  exitCode?: number | null;
  error?: string;
  lastError?: string;
}

export class ScrcpyManager extends EventEmitter {
  private scrcpyExePath: string;
  private currentProcess: ChildProcess | null = null;
  private currentSerial: string | null = null;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private isStarting = false;

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

    if (this.currentProcess && !this.currentProcess.killed) {
      return { success: false, message: 'A screen mirroring session is already active.' };
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

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        this.emit('log', { type: 'stdout', text });
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        this.lastError = text.trim();
        this.emit('log', { type: 'stderr', text });
      });

      child.on('close', (code) => {
        const exitedSerial = this.currentSerial;
        this.lastExitCode = code;
        this.currentProcess = null;
        this.currentSerial = null;

        // Scrcpy Exit Codes:
        // 0: Normal termination
        // 1: Start failure (e.g. video encoder initialization error)
        // 2: Device disconnected while running
        this.emit('stopped', { code, serial: exitedSerial });

        if (code === 2) {
          this.emit('disconnected', { serial: exitedSerial });
        }
      });

      child.on('error', (err) => {
        this.lastError = err.message;
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        } else {
          this.emit('log', { type: 'stderr', text: `Process error: ${err.message}` });
        }
        this.currentProcess = null;
        this.currentSerial = null;
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
   * Stops active screen mirroring session cleanly
   */
  public stopMirroring(): boolean {
    if (!this.currentProcess) return false;

    try {
      this.currentProcess.kill();
      this.currentProcess = null;
      this.currentSerial = null;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns current process status and last exit information
   */
  public getStatus(): ScrcpyProcessStatus {
    return {
      running: this.currentProcess !== null && !this.currentProcess.killed,
      pid: this.currentProcess?.pid,
      targetSerial: this.currentSerial || undefined,
      exitCode: this.lastExitCode,
      lastError: this.lastError || undefined
    };
  }
}
