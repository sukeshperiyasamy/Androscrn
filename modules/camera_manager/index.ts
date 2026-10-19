import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { SecurityValidator } from '../security';
import { DeviceManager } from '../device_manager';

export interface CameraDeviceInfo {
  id: string;
  facing: 'back' | 'front' | 'external' | 'unknown';
  maxResolution?: string;
  fpsList: number[];
  zoomRange?: [number, number];
  supportedSizes: string[];
  highSpeedSizes?: Array<{ size: string; fps: number[] }>;
}

export interface CameraCapabilities {
  transportSupported: boolean;
  deviceSupported: boolean;
  androidVersion?: string;
  sdkVersion?: number;
  cameras: CameraDeviceInfo[];
  liveZoomSupported: boolean;
  liveTorchSupported: boolean;
  recordingSupported: boolean;
  snapshotsSupported: boolean;
  notes: string[];
}

export interface CameraSessionOptions {
  serial: string;
  cameraId?: string;
  facing?: 'back' | 'front' | 'external';
  size?: string;
  fps?: number;
  highSpeed?: boolean;
  torch?: boolean;
  zoom?: number;
  aspectRatio?: string;
  recordPath?: string;
  noAudio?: boolean;
  windowTitle?: string;
}

export interface CameraProcessStatus {
  running: boolean;
  pid?: number;
  targetSerial?: string;
  activeCameraId?: string;
  activeResolution?: string;
  activeFps?: number;
  isRecording: boolean;
  recordingPath?: string;
  currentZoom?: number;
  torchActive?: boolean;
  exitCode?: number | null;
  lastError?: string;
}

export class CameraManager extends EventEmitter {
  private scrcpyExePath: string;
  private deviceManager: DeviceManager;
  private currentProcess: ChildProcess | null = null;
  private currentSerial: string | null = null;
  private currentOptions: CameraSessionOptions | null = null;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private currentZoom = 1.0;
  private torchActive = false;
  private isStarting = false;

  constructor(scrcpyExePath: string, deviceManager: DeviceManager) {
    super();
    this.scrcpyExePath = scrcpyExePath;
    this.deviceManager = deviceManager;
  }

  /**
   * Pure parser: parses stdout from `scrcpy --video-source=camera --list-camera-sizes`
   * or `scrcpy --list-cameras`.
   */
  public parseCameraListOutput(output: string): CameraDeviceInfo[] {
    const cameras: CameraDeviceInfo[] = [];
    if (!output || typeof output !== 'string') return cameras;

    const lines = output.split(/\r?\n/);
    let currentCamera: CameraDeviceInfo | null = null;
    let inHighSpeedSection = false;

    // Pattern: --camera-id=0    (back, 4000x3000, fps={10, 15, 20, 30}, zoom-range=[1, 10])
    const camHeaderRegex = /--camera-id=(\S+)\s+\((back|front|external|unknown)?(?:,\s*(\d+x\d+))?(?:,\s*fps=\{([^}]+)\})?(?:,\s*zoom-range=\[([\d.]+),\s*([\d.]+)\])?\)/i;
    const sizeRegex = /^\s+-\s+(\d+x\d+)(?:\s+\(fps=\{([^}]+)\}\))?/i;
    const highSpeedHeaderRegex = /High\s+speed\s+capture/i;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      const camMatch = line.match(camHeaderRegex);
      if (camMatch) {
        if (currentCamera) {
          cameras.push(currentCamera);
        }

        const id = camMatch[1];
        const facing = (camMatch[2]?.toLowerCase() as any) || 'unknown';
        const maxResolution = camMatch[3] || undefined;
        const fpsString = camMatch[4] || '';
        const fpsList = fpsString
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n > 0);

        let zoomRange: [number, number] | undefined = undefined;
        if (camMatch[5] && camMatch[6]) {
          const minZoom = parseFloat(camMatch[5]);
          const maxZoom = parseFloat(camMatch[6]);
          if (!isNaN(minZoom) && !isNaN(maxZoom)) {
            zoomRange = [minZoom, maxZoom];
          }
        }

        currentCamera = {
          id,
          facing,
          maxResolution,
          fpsList: fpsList.length > 0 ? fpsList : [30],
          zoomRange,
          supportedSizes: [],
          highSpeedSizes: []
        };
        inHighSpeedSection = false;
        continue;
      }

      if (currentCamera) {
        if (highSpeedHeaderRegex.test(line)) {
          inHighSpeedSection = true;
          continue;
        }

        const sizeMatch = line.match(sizeRegex);
        if (sizeMatch) {
          const res = sizeMatch[1];
          if (inHighSpeedSection) {
            const hsFps = (sizeMatch[2] || '')
              .split(',')
              .map(s => parseInt(s.trim(), 10))
              .filter(n => !isNaN(n) && n > 0);
            currentCamera.highSpeedSizes = currentCamera.highSpeedSizes || [];
            currentCamera.highSpeedSizes.push({ size: res, fps: hsFps });
          } else {
            if (!currentCamera.supportedSizes.includes(res)) {
              currentCamera.supportedSizes.push(res);
            }
          }
        }
      }
    }

    if (currentCamera) {
      cameras.push(currentCamera);
    }

    return cameras;
  }

  /**
   * Queries Android version and camera hardware capabilities for a specified device.
   */
  public async queryCapabilities(serial: string): Promise<CameraCapabilities> {
    if (!serial || !SecurityValidator.isValidSerial(serial)) {
      return {
        transportSupported: false,
        deviceSupported: false,
        cameras: [],
        liveZoomSupported: false,
        liveTorchSupported: false,
        recordingSupported: false,
        snapshotsSupported: false,
        notes: ['Invalid device serial number.']
      };
    }

    const notes: string[] = [];

    // 1. Check Android OS Version
    const releaseRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], 5000);
    const sdkRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'], 5000);

    const androidVersion = releaseRes.stdout.trim() || 'Unknown';
    const sdkVersion = parseInt(sdkRes.stdout.trim(), 10) || 0;

    // scrcpy camera mode requires Android 12+ (API level 31+)
    const isAndroid12Plus = sdkVersion >= 31 || parseInt(androidVersion, 10) >= 12;

    if (!isAndroid12Plus) {
      notes.push(
        `scrcpy camera mirroring requires Android 12 (API 31) or higher. Device is running Android ${androidVersion} (API ${sdkVersion || 'unknown'}). Native Camera Studio preview is unavailable on this OS version.`
      );
      return {
        transportSupported: false,
        deviceSupported: false,
        androidVersion,
        sdkVersion,
        cameras: [],
        liveZoomSupported: false,
        liveTorchSupported: false,
        recordingSupported: false,
        snapshotsSupported: false,
        notes
      };
    }

    // 2. Query available cameras and resolutions via scrcpy
    if (!fs.existsSync(this.scrcpyExePath)) {
      notes.push(`scrcpy executable not found at: ${this.scrcpyExePath}`);
      return {
        transportSupported: false,
        deviceSupported: false,
        androidVersion,
        sdkVersion,
        cameras: [],
        liveZoomSupported: false,
        liveTorchSupported: false,
        recordingSupported: false,
        snapshotsSupported: false,
        notes
      };
    }

    const binDir = path.dirname(this.scrcpyExePath);
    let rawOutput = '';

    try {
      rawOutput = await new Promise<string>((resolve) => {
        const child = spawn(
          this.scrcpyExePath,
          ['-s', serial, '--video-source=camera', '--list-camera-sizes'],
          { cwd: binDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        );

        let output = '';
        const timer = setTimeout(() => {
          child.kill();
          resolve(output);
        }, 8000);

        child.stdout?.on('data', d => { output += d.toString(); });
        child.stderr?.on('data', d => { output += d.toString(); });
        child.on('close', () => {
          clearTimeout(timer);
          resolve(output);
        });
        child.on('error', () => {
          clearTimeout(timer);
          resolve(output);
        });
      });
    } catch (err: any) {
      notes.push(`Error interrogating camera capabilities: ${err.message}`);
    }

    let cameras = this.parseCameraListOutput(rawOutput);

    // Fallback if list-camera-sizes returned empty
    if (cameras.length === 0) {
      try {
        const fallbackOutput = await new Promise<string>((resolve) => {
          const child = spawn(
            this.scrcpyExePath,
            ['-s', serial, '--list-cameras'],
            { cwd: binDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
          );

          let output = '';
          const timer = setTimeout(() => {
            child.kill();
            resolve(output);
          }, 6000);

          child.stdout?.on('data', d => { output += d.toString(); });
          child.stderr?.on('data', d => { output += d.toString(); });
          child.on('close', () => {
            clearTimeout(timer);
            resolve(output);
          });
        });
        cameras = this.parseCameraListOutput(fallbackOutput);
      } catch {
        // ignore fallback errors
      }
    }

    const deviceSupported = cameras.length > 0;
    if (!deviceSupported) {
      notes.push('No camera devices were detected on this Android device or camera access was restricted.');
    } else {
      notes.push(
        `Discovered ${cameras.length} camera sensor(s). Live Direct3D11 streaming and PC-side MP4 recording are supported.`
      );
      notes.push(
        'Note: Direct single-frame PNG snapshot during live video stream is unsupported by the native scrcpy transport; reliable full-fidelity snapshots will be provided via the dedicated CameraX companion APK.'
      );
    }

    return {
      transportSupported: true,
      deviceSupported,
      androidVersion,
      sdkVersion,
      cameras,
      liveZoomSupported: true,
      liveTorchSupported: true,
      recordingSupported: true,
      snapshotsSupported: false, // Explicitly false for scrcpy transport
      notes
    };
  }

  /**
   * Validates and constructs an immutable argument array for launching scrcpy in camera mode.
   * Enforces zero shell string interpolation.
   */
  public buildArguments(options: CameraSessionOptions): string[] {
    const args: string[] = [];

    // Target serial
    if (!options.serial || !SecurityValidator.isValidSerial(options.serial)) {
      throw new Error('Invalid or missing device serial number.');
    }
    args.push('-s', options.serial);

    // Core camera mode
    args.push('--video-source=camera');

    // Camera ID / Facing
    if (options.cameraId !== undefined && options.cameraId !== '') {
      if (!/^[a-zA-Z0-9_-]+$/.test(options.cameraId)) {
        throw new Error('Invalid camera ID format.');
      }
      args.push(`--camera-id=${options.cameraId}`);
    } else if (options.facing) {
      if (!['front', 'back', 'external'].includes(options.facing)) {
        throw new Error('Invalid camera facing direction.');
      }
      args.push(`--camera-facing=${options.facing}`);
    }

    // Size / Resolution
    if (options.size) {
      if (!/^\d{3,4}x\d{3,4}$/.test(options.size)) {
        throw new Error('Invalid camera size format. Expected <width>x<height> (e.g. 1920x1080).');
      }
      args.push(`--camera-size=${options.size}`);
    }

    // FPS
    if (options.fps) {
      if (typeof options.fps !== 'number' || options.fps < 5 || options.fps > 240) {
        throw new Error('Invalid camera FPS. Value must be between 5 and 240.');
      }
      args.push(`--camera-fps=${options.fps}`);
    }

    // High Speed
    if (options.highSpeed) {
      args.push('--camera-high-speed');
    }

    // Initial Zoom
    if (options.zoom !== undefined) {
      if (typeof options.zoom !== 'number' || options.zoom < 1.0 || options.zoom > 50.0) {
        throw new Error('Invalid zoom level. Value must be between 1.0 and 50.0.');
      }
      args.push(`--camera-zoom=${options.zoom}`);
    }

    // Torch
    if (options.torch) {
      args.push('--camera-torch');
    }

    // Aspect Ratio
    if (options.aspectRatio) {
      if (!/^(sensor|\d+:\d+|\d+(?:\.\d+)?)$/i.test(options.aspectRatio)) {
        throw new Error('Invalid aspect ratio. Expected "sensor", "<num>:<den>" or float.');
      }
      args.push(`--camera-ar=${options.aspectRatio}`);
    }

    // PC-side Recording
    if (options.recordPath) {
      const validation = this.validateRecordingPath(options.recordPath);
      if (!validation.valid || !validation.normalizedPath) {
        throw new Error(validation.error || 'Invalid recording output path.');
      }
      args.push(`--record=${validation.normalizedPath}`);
    }

    // Audio policy: by default mute microphone to avoid howling feedback unless explicit
    if (options.noAudio !== false) {
      args.push('--no-audio');
    }

    // Window Title
    const title = options.windowTitle || `AndroScrn Camera Studio - ${options.serial}`;
    args.push(`--window-title=${title}`);

    return args;
  }

  /**
   * Validates recording output path and ensures parent directory exists.
   */
  public validateRecordingPath(targetPath: string): { valid: boolean; normalizedPath?: string; error?: string } {
    if (!targetPath || typeof targetPath !== 'string') {
      return { valid: false, error: 'Recording path cannot be empty.' };
    }

    const normalized = path.resolve(targetPath);
    const ext = path.extname(normalized).toLowerCase();

    if (ext !== '.mp4' && ext !== '.mkv') {
      return { valid: false, error: 'Recording path must end with .mp4 or .mkv extension.' };
    }

    const parentDir = path.dirname(normalized);
    try {
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    } catch (err: any) {
      return { valid: false, error: `Failed to create recording directory: ${err.message}` };
    }

    return { valid: true, normalizedPath: normalized };
  }

  /**
   * Starts a camera streaming session using native scrcpy.
   */
  public startCamera(options: CameraSessionOptions): { success: boolean; pid?: number; message?: string } {
    if (this.isStarting) {
      return { success: false, message: 'Camera preview launch already in progress.' };
    }

    if (this.currentProcess && !this.currentProcess.killed && this.currentProcess.exitCode === null) {
      return { success: false, message: 'A camera streaming session is already active.' };
    }

    if (!fs.existsSync(this.scrcpyExePath)) {
      return { success: false, message: `scrcpy executable not found at: ${this.scrcpyExePath}` };
    }

    this.isStarting = true;
    try {
      let args: string[];
      try {
        args = this.buildArguments(options);
      } catch (err: any) {
        return { success: false, message: err.message };
      }

      this.lastError = null;
      this.lastExitCode = null;
      this.currentZoom = options.zoom || 1.0;
      this.torchActive = !!options.torch;
      this.currentOptions = options;

      const binDir = path.dirname(this.scrcpyExePath);

      const child = spawn(this.scrcpyExePath, args, {
        cwd: binDir,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = child;
      this.currentSerial = options.serial;

      this.emit('started', {
        pid: child.pid,
        serial: this.currentSerial,
        cameraId: options.cameraId,
        recording: !!options.recordPath
      });

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        this.emit('log', { type: 'stdout', text });
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        this.lastError = text.trim();
        this.emit('log', { type: 'stderr', text });
      });

      child.on('exit', (code) => {
        this.lastExitCode = code;
        this.currentProcess = null;
        this.currentSerial = null;
        this.currentOptions = null;
      });

      child.on('close', (code) => {
        const exitedSerial = this.currentSerial;
        this.lastExitCode = code;
        this.currentProcess = null;
        this.currentSerial = null;
        this.currentOptions = null;

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
          this.emit('log', { type: 'stderr', text: `Camera process error: ${err.message}` });
        }
        this.currentProcess = null;
        this.currentSerial = null;
        this.currentOptions = null;
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
   * Stops active camera session cleanly.
   */
  public stopCamera(): boolean {
    if (!this.currentProcess) return false;

    try {
      this.currentProcess.kill();
      this.currentProcess = null;
      this.currentSerial = null;
      this.currentOptions = null;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sends live zoom keyboard shortcuts to the native scrcpy camera window.
   * scrcpy supports live zoom via MOD+Up (zoom in) and MOD+Down (zoom out).
   */
  public async sendLiveZoom(direction: 'in' | 'out'): Promise<{ success: boolean; currentZoom: number; message: string }> {
    if (!this.currentProcess || this.currentProcess.killed) {
      return { success: false, currentZoom: this.currentZoom, message: 'Camera session is not running.' };
    }

    const key = direction === 'in' ? '%{UP}' : '%{DOWN}'; // Alt+Up or Alt+Down
    const delta = direction === 'in' ? 0.5 : -0.5;
    this.currentZoom = Math.max(1.0, Math.min(10.0, Math.round((this.currentZoom + delta) * 10) / 10));

    try {
      // Dispatches key event to active AndroScrn Camera Studio window via PowerShell
      const windowTitle = this.currentOptions?.windowTitle || `AndroScrn Camera Studio - ${this.currentSerial}`;
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $wshell = New-Object -ComObject Wscript.Shell
        if ($wshell.AppActivate('${windowTitle}')) {
          Start-Sleep -Milliseconds 50
          [System.Windows.Forms.SendKeys]::SendWait('${key}')
        }
      `;

      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        windowsHide: true,
        stdio: 'ignore'
      });

      return {
        success: true,
        currentZoom: this.currentZoom,
        message: `Zoom ${direction} command sent (Target: ~${this.currentZoom}x). You can also press Alt+Up / Alt+Down directly inside the camera preview window.`
      };
    } catch (err: any) {
      return {
        success: false,
        currentZoom: this.currentZoom,
        message: `Failed to dispatch live zoom shortcut: ${err.message}`
      };
    }
  }

  /**
   * Sends live torch toggle shortcut to the native scrcpy camera window.
   * scrcpy supports live torch via MOD+t (on) and MOD+Shift+t (off).
   */
  public async sendLiveTorch(state: 'on' | 'off'): Promise<{ success: boolean; torchActive: boolean; message: string }> {
    if (!this.currentProcess || this.currentProcess.killed) {
      return { success: false, torchActive: this.torchActive, message: 'Camera session is not running.' };
    }

    const key = state === 'on' ? '%t' : '%+t'; // Alt+t or Alt+Shift+t
    this.torchActive = state === 'on';

    try {
      const windowTitle = this.currentOptions?.windowTitle || `AndroScrn Camera Studio - ${this.currentSerial}`;
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $wshell = New-Object -ComObject Wscript.Shell
        if ($wshell.AppActivate('${windowTitle}')) {
          Start-Sleep -Milliseconds 50
          [System.Windows.Forms.SendKeys]::SendWait('${key}')
        }
      `;

      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        windowsHide: true,
        stdio: 'ignore'
      });

      return {
        success: true,
        torchActive: this.torchActive,
        message: `Torch ${state} command sent. You can also press Alt+T / Alt+Shift+T directly inside the camera preview window.`
      };
    } catch (err: any) {
      return {
        success: false,
        torchActive: this.torchActive,
        message: `Failed to dispatch live torch shortcut: ${err.message}`
      };
    }
  }

  /**
   * Returns current process status and active session metadata.
   */
  public getStatus(): CameraProcessStatus {
    const isRunning = this.currentProcess !== null && !this.currentProcess.killed && this.currentProcess.exitCode === null;
    return {
      running: isRunning,
      pid: isRunning ? this.currentProcess?.pid : undefined,
      targetSerial: this.currentSerial || undefined,
      activeCameraId: this.currentOptions?.cameraId,
      activeResolution: this.currentOptions?.size,
      activeFps: this.currentOptions?.fps,
      isRecording: !!this.currentOptions?.recordPath,
      recordingPath: this.currentOptions?.recordPath,
      currentZoom: this.currentZoom,
      torchActive: this.torchActive,
      exitCode: this.lastExitCode,
      lastError: this.lastError || undefined
    };
  }
}
