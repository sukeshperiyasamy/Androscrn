import { ChildProcess, spawn } from 'child_process';
import path from 'path';
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
}

export class ScrcpyManager extends EventEmitter {
  private scrcpyExePath: string;
  private currentProcess: ChildProcess | null = null;
  private currentSerial: string | null = null;

  constructor(scrcpyExePath: string) {
    super();
    this.scrcpyExePath = scrcpyExePath;
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
    if (this.currentProcess) {
      return { success: false, message: 'A screen mirroring session is already active.' };
    }

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
        this.emit('log', { type: 'stderr', text });
      });

      child.on('close', (code) => {
        const exitedSerial = this.currentSerial;
        this.currentProcess = null;
        this.currentSerial = null;

        // Scrcpy Exit Codes:
        // 0: Normal termination
        // 1: Start failure
        // 2: Device disconnected while running
        this.emit('stopped', { code, serial: exitedSerial });

        if (code === 2) {
          this.emit('disconnected', { serial: exitedSerial });
        }
      });

      child.on('error', (err) => {
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
      return { success: false, message: err.message };
    }
  }

  /**
   * Stops active screen mirroring session cleanly
   */
  public stopMirroring(): boolean {
    if (!this.currentProcess) return false;

    try {
      this.currentProcess.kill('SIGINT');
      this.currentProcess = null;
      this.currentSerial = null;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns current process status
   */
  public getStatus(): ScrcpyProcessStatus {
    return {
      running: this.currentProcess !== null && !this.currentProcess.killed,
      pid: this.currentProcess?.pid,
      targetSerial: this.currentSerial || undefined
    };
  }
}
