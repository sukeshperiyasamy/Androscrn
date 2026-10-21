import { gracefulStop } from '../scrcpy_manager/graceful-stop';
import { ChildProcess, spawn, execFile } from 'child_process';
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
  autoReconnect?: boolean;
}

export type CameraSessionStatus = 'idle' | 'starting' | 'running' | 'interrupted' | 'reconnecting' | 'stopped' | 'error';

export type CameraExitReason =
  | 'user_stopped'
  | 'camera_preempted'
  | 'device_disconnected'
  | 'startup_error'
  | 'process_crashed';

export interface CameraProcessStatus {
  running: boolean;
  status: CameraSessionStatus;
  exitReason?: CameraExitReason;
  canReconnect: boolean;
  reconnectCount: number;
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
  autoReconnect?: boolean;
  recentStderr?: string[];
}

/**
 * Turns scrcpy's start-up output into a short, actionable reason. scrcpy's last line is usually a generic
 * "Demuxer error" / "Server connection failed"; the useful line ("Camera configuration error", an unsupported
 * size, ...) comes earlier. The raw lines stay available in the status' recentStderr for diagnostics.
 */
export function describeCameraStartupFailure(stderrLines: string[], options: { highSpeed?: boolean; size?: string; fps?: number } = {}): string {
  const text = stderrLines.join('\n');
  if (/Camera configuration error/i.test(text)) {
    if (options.highSpeed) {
      return 'This camera does not support high-speed capture on this phone, even though it lists it. Choose another camera (on some phones only certain lenses allow it) or turn off High-Speed Capture.';
    }
    return `The phone rejected this camera setting${options.size ? ` (${options.size}${options.fps ? ` at ${options.fps} FPS` : ''})` : ''}. Try a lower resolution or frame rate.`;
  }
  if (/Capture\/encoding error|IllegalArgumentException/i.test(text)) {
    return 'The phone could not encode this resolution. Choose a smaller capture resolution.';
  }
  if (/camera.*(in use|disabled|busy)|CAMERA_IN_USE|MAX_CAMERAS_IN_USE/i.test(text)) {
    return 'The camera is in use by another app or session. Close it and try again.';
  }
  if (/Could not find.*camera|No camera|camera.*not found/i.test(text)) {
    return 'The selected camera was not found on the phone. Detect cameras again and choose another one.';
  }
  return 'The camera could not start. Open Diagnostics for the technical details.';
}

export class CameraManager extends EventEmitter {
  private scrcpyExePath: string;
  private deviceManager: DeviceManager;
  private currentProcess: ChildProcess | null = null;
  private currentSerial: string | null = null;
  private currentOptions: CameraSessionOptions | null = null;
  private lastSessionOptions: CameraSessionOptions | null = null;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;
  private currentZoom = 1.0;
  private torchActive = false;
  private isStarting = false;

  private currentSessionId = 0;
  private sessionStatus: CameraSessionStatus = 'idle';
  private exitReason?: CameraExitReason;
  private canReconnect = false;
  private reconnectCount = 0;
  private maxReconnectRetries = 5;
  private lastStartedAt = 0;
  private userRequestedStop = false;
  private stderrRingBuffer: string[] = [];
  private readonly maxStderrLines = 50;
  private reconnectCooldownMs = 1500;
  private lastReconnectAttempt = 0;
  private autoReconnect = true;
  private autoReconnectTimer: NodeJS.Timeout | null = null;

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
    return this.startCameraInternal(options, false);
  }

  /**
   * Reconnects the most recent camera session options with retry bounding and preemption recovery.
   */
  public async reconnectCamera(): Promise<{ success: boolean; pid?: number; message?: string }> {
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }

    if (!this.lastSessionOptions) {
      return { success: false, message: 'No previous camera session configuration found to reconnect.' };
    }

    const isRunning = this.currentProcess !== null && !this.currentProcess.killed && this.currentProcess.exitCode === null;
    if (isRunning) {
      return { success: false, message: 'Camera streaming session is already active.' };
    }

    if (this.reconnectCount >= this.maxReconnectRetries) {
      return {
        success: false,
        message: `Maximum reconnect attempts (${this.maxReconnectRetries}) reached. Please restart Camera Studio manually.`
      };
    }

    const now = Date.now();
    if (now - this.lastReconnectAttempt < this.reconnectCooldownMs) {
      return {
        success: false,
        message: `Reconnect rate-limited. Please wait ${Math.ceil((this.reconnectCooldownMs - (now - this.lastReconnectAttempt)) / 1000)}s before trying again.`
      };
    }
    this.lastReconnectAttempt = now;
    this.reconnectCount++;

    const isConnected = await this.deviceManager.isDeviceConnected(this.lastSessionOptions.serial);
    if (!isConnected) {
      this.sessionStatus = 'stopped';
      this.exitReason = 'device_disconnected';
      this.canReconnect = false;
      this.emit('statusChanged', this.getStatus());
      return { success: false, message: 'Device is no longer connected to ADB.' };
    }

    this.sessionStatus = 'reconnecting';
    this.emit('reconnecting', {
      attempt: this.reconnectCount,
      maxRetries: this.maxReconnectRetries,
      serial: this.lastSessionOptions.serial
    });
    this.emit('statusChanged', this.getStatus());

    return this.startCameraInternal(this.lastSessionOptions, true);
  }

  private startCameraInternal(options: CameraSessionOptions, isReconnect: boolean): { success: boolean; pid?: number; message?: string } {
    if (this.isStarting) {
      return { success: false, message: 'Camera preview launch already in progress.' };
    }

    // Terminate existing active camera process to prevent duplicate windows or orphaned locks
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
    try {
      let args: string[];
      try {
        args = this.buildArguments(options);
      } catch (err: any) {
        return { success: false, message: err.message };
      }

      this.currentSessionId++;
      const sessionId = this.currentSessionId;

      this.lastError = null;
      this.lastExitCode = null;
      this.currentZoom = options.zoom || 1.0;
      this.torchActive = !!options.torch;
      this.autoReconnect = options.autoReconnect !== undefined ? options.autoReconnect : true;
      this.currentOptions = { ...options, autoReconnect: this.autoReconnect };
      this.lastSessionOptions = { ...options, autoReconnect: this.autoReconnect };
      this.userRequestedStop = false;
      this.stderrRingBuffer = [];
      this.lastStartedAt = Date.now();
      if (!isReconnect) {
        this.reconnectCount = 0;
      }
      this.canReconnect = false;
      this.exitReason = undefined;
      this.sessionStatus = isReconnect ? 'reconnecting' : 'starting';

      const binDir = path.dirname(this.scrcpyExePath);

      const child = spawn(this.scrcpyExePath, args, {
        cwd: binDir,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = child;
      this.currentSerial = options.serial;
      this.sessionStatus = 'running';

      this.emit('started', {
        running: true,
        status: 'running',
        pid: child.pid,
        serial: this.currentSerial,
        cameraId: options.cameraId,
        recording: !!options.recordPath
      });
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
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.stderrRingBuffer.push(line);
          if (this.stderrRingBuffer.length > this.maxStderrLines) {
            this.stderrRingBuffer.shift();
          }
        }
        this.emit('log', { type: 'stderr', text });
      });

      let isClosed = false;

      child.on('exit', (code) => {
        if (this.currentSessionId !== sessionId) return;
        this.lastExitCode = code;
      });

      child.on('close', async (code) => {
        if (isClosed) return;
        isClosed = true;
        if (this.currentSessionId !== sessionId) return;

        this.lastExitCode = code;
        this.currentProcess = null;
        const targetSerial = this.currentSerial || this.lastSessionOptions?.serial || '';
        this.currentSerial = null;
        this.currentOptions = null;

        if (this.userRequestedStop) {
          this.sessionStatus = 'stopped';
          this.exitReason = 'user_stopped';
          this.canReconnect = false;
          this.emit('stopped', { running: false, status: 'stopped', exitReason: 'user_stopped', code, serial: targetSerial });
          this.emit('statusChanged', this.getStatus());
          return;
        }

        const stderrJoined = this.stderrRingBuffer.join('\n');
        const hasCameraPreemptedKeywords =
          /Camera disconnected|Camera capture failed|evicting conflicting client|adjCameraPriority|RESET_REASON_TERMINATED|Device disconnected|Camera \d+: start to disconnect|ERROR_CAMERA_DEVICE|ERROR_CAMERA_DISABLED|com\.miui\.face/i.test(stderrJoined);

        let deviceStillConnected = false;
        try {
          if (targetSerial) {
            deviceStillConnected = await this.deviceManager.isDeviceConnected(targetSerial);
          }
        } catch {
          deviceStillConnected = false;
        }

        // Stale event guard after async call
        if (this.currentSessionId !== sessionId) return;

        const sessionDurationMs = Date.now() - this.lastStartedAt;

        if (deviceStillConnected) {
          if (hasCameraPreemptedKeywords || sessionDurationMs > 1500) {
            this.sessionStatus = 'interrupted';
            this.exitReason = 'camera_preempted';
            this.canReconnect = true;
            const message = 'Camera stream was preempted by Android (e.g. phone screen wake, lockscreen or Face Unlock). Device is still connected.';
            this.emit('interrupted', { running: false, status: 'interrupted', exitReason: 'camera_preempted', canReconnect: true, code, serial: targetSerial, message });
            this.emit('stopped', { running: false, status: 'interrupted', exitReason: 'camera_preempted', canReconnect: true, code, serial: targetSerial, message });
            this.emit('statusChanged', this.getStatus());

            if (this.autoReconnect && this.reconnectCount < this.maxReconnectRetries) {
              if (this.autoReconnectTimer) clearTimeout(this.autoReconnectTimer);
              this.autoReconnectTimer = setTimeout(() => {
                if (this.sessionStatus === 'interrupted' && !this.userRequestedStop) {
                  this.reconnectCamera().catch(() => {});
                }
              }, this.reconnectCooldownMs + 500);
            }
          } else {
            this.sessionStatus = 'error';
            this.exitReason = 'startup_error';
            this.canReconnect = false;
            const message = describeCameraStartupFailure([...this.stderrRingBuffer], this.lastSessionOptions || {});
            this.lastError = message;
            this.emit('stopped', { running: false, status: 'error', exitReason: 'startup_error', canReconnect: false, code, serial: targetSerial, message });
            this.emit('statusChanged', this.getStatus());
          }
        } else {
          this.sessionStatus = 'stopped';
          this.exitReason = 'device_disconnected';
          this.canReconnect = false;
          this.emit('disconnected', { running: false, status: 'stopped', exitReason: 'device_disconnected', canReconnect: false, code, serial: targetSerial });
          this.emit('stopped', { running: false, status: 'stopped', exitReason: 'device_disconnected', canReconnect: false, code, serial: targetSerial });
          this.emit('statusChanged', this.getStatus());
        }
      });

      child.on('error', (err) => {
        if (this.currentSessionId !== sessionId) return;
        this.lastError = err.message;
        this.sessionStatus = 'error';
        this.exitReason = 'process_crashed';
        this.canReconnect = false;
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        } else {
          this.emit('log', { type: 'stderr', text: `Camera process error: ${err.message}` });
        }
        this.currentProcess = null;
        this.currentSerial = null;
        this.currentOptions = null;
        this.emit('statusChanged', this.getStatus());
      });

      return { success: true, pid: child.pid };
    } catch (err: any) {
      this.lastError = err.message;
      this.sessionStatus = 'error';
      this.exitReason = 'startup_error';
      this.emit('statusChanged', this.getStatus());
      return { success: false, message: err.message };
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stops active camera session cleanly.
   */
  public stopCamera(): boolean {
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }

    if (!this.currentProcess && this.sessionStatus === 'idle') {
      return false;
    }

    this.userRequestedStop = true;
    this.reconnectCount = 0;
    this.canReconnect = false;
    this.sessionStatus = 'stopped';
    this.exitReason = 'user_stopped';

    if (!this.currentProcess) {
      this.emit('statusChanged', this.getStatus());
      return false;
    }

    try {
      const exitedSerial = this.currentSerial;
      gracefulStop(this.currentProcess);
      this.currentProcess = null;
      this.currentSerial = null;
      this.currentOptions = null;
      this.emit('stopped', { running: false, status: 'stopped', exitReason: 'user_stopped', code: 0, serial: exitedSerial });
      this.emit('statusChanged', this.getStatus());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Focuses the native scrcpy Camera Studio window on Windows.
   */
  public focusCameraWindow(): Promise<{ success: boolean; message: string }> {
    if (!this.currentProcess || this.currentProcess.killed || this.currentProcess.exitCode !== null) {
      return Promise.resolve({ success: false, message: 'Camera preview is not active.' });
    }
    const windowTitle = this.currentOptions?.windowTitle || `AndroScrn Camera Studio - ${this.currentSerial}`;
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
            resolve({ success: false, message: `Could not activate camera window "${windowTitle}". It may be minimized or not yet created.` });
          }
        });
      } catch (err: any) {
        resolve({ success: false, message: `Failed to focus camera window: ${err?.message || err}` });
      }
    });
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
      status: isRunning ? 'running' : this.sessionStatus,
      exitReason: this.exitReason,
      canReconnect: this.canReconnect,
      reconnectCount: this.reconnectCount,
      pid: isRunning ? this.currentProcess?.pid : undefined,
      targetSerial: this.currentSerial || undefined,
      activeCameraId: this.currentOptions?.cameraId || this.lastSessionOptions?.cameraId,
      activeResolution: this.currentOptions?.size || this.lastSessionOptions?.size,
      activeFps: this.currentOptions?.fps || this.lastSessionOptions?.fps,
      isRecording: !!(this.currentOptions?.recordPath || this.lastSessionOptions?.recordPath),
      recordingPath: this.currentOptions?.recordPath || this.lastSessionOptions?.recordPath,
      currentZoom: this.currentZoom,
      torchActive: this.torchActive,
      exitCode: this.lastExitCode,
      lastError: this.lastError || undefined,
      autoReconnect: this.autoReconnect,
      recentStderr: [...this.stderrRingBuffer]
    };
  }
}
