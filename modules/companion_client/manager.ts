import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DeviceManager } from '../device_manager';
import { SecurityValidator } from '../security';
import type { CompanionClient, CompanionStatusResponse } from './index';

export const COMPANION_PACKAGE = 'com.androscrn.companion';
export const COMPANION_ACTIVITY = `${COMPANION_PACKAGE}/.MainActivity`;
export const COMPANION_SOCKET = 'androscrn_companion';
export const COMPANION_PROTOCOL_VERSION = 2;

export interface CompanionApkInfo {
  apkPath: string;
  packageName: string;
  versionCode: number;
  versionName: string;
  protocolVersion: number;
  sha256?: string;
  variant?: string;
}

export interface CompanionInstallState {
  installed: boolean;
  versionCode?: number;
  versionName?: string;
}

export type CompanionStage =
  | 'checking'
  | 'install_required'
  | 'update_available'
  | 'installing'
  | 'launching'
  | 'connecting'
  | 'ready'
  | 'failed'
  | 'stopped';

export interface CompanionPrepareResult {
  success: boolean;
  stage: CompanionStage;
  code?: string;
  message: string;
  sessionId: number;
  install?: CompanionInstallState;
  bundled?: { versionCode: number; versionName: string } | null;
  status?: CompanionStatusResponse;
  hostPort?: number;
}

export interface CompanionProgressEvent {
  sessionId: number;
  stage: CompanionStage;
  message: string;
}

type AdbLike = Pick<DeviceManager, 'executeAdb'>;

/** Reads the staged APK metadata next to an APK candidate; returns null if missing or inconsistent. */
export function readApkInfo(apkPath: string, verifyChecksum = true): CompanionApkInfo | null {
  try {
    if (!fs.existsSync(apkPath)) return null;
    const metaPath = path.join(path.dirname(apkPath), 'androscrn-companion.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.packageName !== COMPANION_PACKAGE) return null;
    if (!Number.isInteger(meta.versionCode) || meta.versionCode < 1) return null;
    if (typeof meta.versionName !== 'string' || !Number.isInteger(meta.protocolVersion)) return null;
    if (verifyChecksum && typeof meta.sha256 === 'string') {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
      if (actual !== meta.sha256) return null;
    }
    return {
      apkPath,
      packageName: meta.packageName,
      versionCode: meta.versionCode,
      versionName: meta.versionName,
      protocolVersion: meta.protocolVersion,
      sha256: meta.sha256,
      variant: meta.variant
    };
  } catch {
    return null;
  }
}

/** First candidate with a valid APK + metadata pair (dev tree, packaged resources, next to the exe). */
export function resolveCompanionApk(candidates: string[]): CompanionApkInfo | null {
  for (const c of candidates) {
    const info = readApkInfo(c);
    if (info) return info;
  }
  return null;
}

/** Parses `adb shell dumpsys package <pkg>` output. */
export function parseInstallState(dumpsys: string): CompanionInstallState {
  if (!dumpsys.includes(`Package [${COMPANION_PACKAGE}]`)) return { installed: false };
  const code = dumpsys.match(/versionCode=(\d+)/);
  const name = dumpsys.match(/versionName=([^\s]+)/);
  return {
    installed: true,
    versionCode: code ? parseInt(code[1], 10) : undefined,
    versionName: name ? name[1] : undefined
  };
}

/** Maps `adb install` failures to actionable messages. Never suggests automatic uninstall. */
export function describeInstallFailure(output: string): { code: string; message: string } {
  const m = output.match(/(INSTALL_[A-Z_]+)/);
  const reason = m ? m[1] : '';
  switch (reason) {
    case 'INSTALL_FAILED_USER_RESTRICTED':
      return {
        code: reason,
        message:
          'The phone blocked the install. On Xiaomi/Redmi/POCO enable Developer options > "Install via USB" (needs a Mi account sign-in), keep the phone unlocked, and tap "Install" if a prompt appears on the phone. Then try again.'
      };
    case 'INSTALL_FAILED_UPDATE_INCOMPATIBLE':
      return {
        code: reason,
        message:
          'A copy of AndroScrn Companion signed with a different key is already installed. AndroScrn will not remove it automatically: uninstall "AndroScrn Camera" on the phone yourself (its data will be lost), then try again.'
      };
    case 'INSTALL_FAILED_VERSION_DOWNGRADE':
      return { code: reason, message: 'A newer companion version is already installed on the phone; it was left unchanged.' };
    case 'INSTALL_FAILED_INSUFFICIENT_STORAGE':
      return { code: reason, message: 'Not enough free storage on the phone to install the companion app.' };
    case 'INSTALL_FAILED_OLDER_SDK':
    case 'INSTALL_FAILED_NO_MATCHING_ABIS':
      return { code: reason, message: 'This phone is not compatible with the companion app (Android 8.0 or newer is required).' };
    case 'INSTALL_PARSE_FAILED_NOT_APK':
    case 'INSTALL_PARSE_FAILED_NO_CERTIFICATES':
      return { code: reason, message: 'The bundled companion APK is damaged. Rebuild it with "npm run build:companion".' };
    default:
      if (/timed out/i.test(output)) return { code: 'timeout', message: 'Installation timed out. Check the phone for a confirmation prompt and try again.' };
      if (/device .*not found|no devices/i.test(output)) return { code: 'device_lost', message: 'The phone disconnected during installation. Reconnect it and try again.' };
      return { code: reason || 'install_failed', message: `Installation failed: ${output.trim().slice(0, 300) || 'unknown error'}` };
  }
}

/** Parses the host port printed by `adb forward tcp:0 ...`. */
export function parseForwardPort(stdout: string): number | null {
  const port = parseInt(stdout.trim().split(/\s+/).pop() || '', 10);
  return Number.isInteger(port) && port > 1024 && port <= 65535 ? port : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Orchestrates the companion app over the bundled ADB: install check, explicit install/update, launch,
 * port forward to the app's abstract socket, and a protocol-checked readiness handshake.
 * Every operation runs under a session id; a newer prepare/stop invalidates older ones, so a slow
 * step from an abandoned attempt cannot overwrite the current state.
 */
export class CompanionManager extends EventEmitter {
  private sessionId = 0;
  private serial: string | null = null;
  private hostPort: number | null = null;

  constructor(
    private adb: AdbLike,
    private client: CompanionClient,
    private apkCandidates: () => string[],
    private options: { readyTimeoutMs?: number; pollIntervalMs?: number; installTimeoutMs?: number } = {}
  ) {
    super();
  }

  getBundledApk(): CompanionApkInfo | null {
    return resolveCompanionApk(this.apkCandidates());
  }

  getActive(): { serial: string | null; hostPort: number | null; sessionId: number } {
    return { serial: this.serial, hostPort: this.hostPort, sessionId: this.sessionId };
  }

  async getInstallState(serial: string): Promise<CompanionInstallState> {
    const res = await this.adb.executeAdb(['-s', serial, 'shell', 'dumpsys', 'package', COMPANION_PACKAGE], 15000);
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Could not query installed packages');
    return parseInstallState(res.stdout);
  }

  /**
   * Prepares the companion for a camera session. Installs or updates only when [allowInstall] is true,
   * so installation is always an explicit user action.
   */
  async prepare(serial: unknown, allowInstall: boolean): Promise<CompanionPrepareResult> {
    const id = ++this.sessionId;
    const fail = (code: string, message: string, extra: Partial<CompanionPrepareResult> = {}): CompanionPrepareResult => {
      this.progress(id, 'failed', message);
      return { success: false, stage: 'failed', code, message, sessionId: id, ...extra };
    };
    if (typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return fail('invalid_serial', 'Select a valid device first.');
    }

    this.progress(id, 'checking', 'Checking the phone and the companion app…');
    const devices = await this.adb.executeAdb(['-s', serial, 'get-state'], 8000);
    const state = devices.stdout.trim();
    if (this.stale(id)) return this.staleResult(id);
    if (state !== 'device') {
      const msg = /unauthorized/i.test(devices.stderr + state)
        ? 'The phone has not authorized this PC. Unlock it and accept the "Allow USB debugging" prompt.'
        : /offline/i.test(devices.stderr + state)
          ? 'The phone is offline. Reconnect the USB cable.'
          : 'The phone is not connected.';
      return fail('device_unavailable', msg);
    }

    const bundled = this.getBundledApk();
    let install: CompanionInstallState;
    try {
      install = await this.getInstallState(serial);
    } catch (err: any) {
      return fail('adb_error', `Could not check the companion app: ${err?.message || err}`);
    }
    if (this.stale(id)) return this.staleResult(id);
    const bundledSummary = bundled ? { versionCode: bundled.versionCode, versionName: bundled.versionName } : null;

    const needsInstall = !install.installed;
    const needsUpdate = install.installed && !!bundled && (install.versionCode ?? 0) < bundled.versionCode;
    if (needsInstall || needsUpdate) {
      if (!bundled) {
        return fail('apk_missing', needsInstall
          ? 'The companion app is not installed and no companion APK is bundled. Build it with "npm run build:companion".'
          : 'An older companion is installed and no newer APK is bundled.', { install, bundled: null });
      }
      if (!allowInstall) {
        const stage: CompanionStage = needsInstall ? 'install_required' : 'update_available';
        const message = needsInstall
          ? `The AndroScrn Camera companion (${bundled.versionName}) is not installed on the phone.`
          : `The companion on the phone (${install.versionName ?? install.versionCode}) is older than the bundled ${bundled.versionName}; it must be updated.`;
        this.progress(id, stage, message);
        return { success: false, stage, code: stage, message, sessionId: id, install, bundled: bundledSummary };
      }
      this.progress(id, 'installing', `Installing companion ${bundled.versionName} on the phone…`);
      const res = await this.adb.executeAdb(['-s', serial, 'install', '-r', bundled.apkPath], this.options.installTimeoutMs ?? 120000);
      if (this.stale(id)) return this.staleResult(id);
      const out = `${res.stdout}\n${res.stderr}`;
      if (res.code !== 0 || !/\bSuccess\b/.test(out)) {
        const f = describeInstallFailure(out);
        return fail(f.code, f.message, { install, bundled: bundledSummary });
      }
      install = await this.getInstallState(serial).catch(() => ({ installed: false }) as CompanionInstallState);
      if (!install.installed || (install.versionCode ?? 0) < bundled.versionCode) {
        return fail('install_unverified', 'adb reported success but the companion version on the phone did not change.', { install, bundled: bundledSummary });
      }
    }

    this.progress(id, 'launching', 'Opening the companion app on the phone…');
    const launch = await this.adb.executeAdb(['-s', serial, 'shell', 'am', 'start', '-W', '-n', COMPANION_ACTIVITY], 20000);
    if (this.stale(id)) return this.staleResult(id);
    if (launch.code !== 0 || /Error:|Exception/.test(launch.stdout + launch.stderr)) {
      return fail('launch_failed', `The companion app could not be opened: ${(launch.stdout + launch.stderr).trim().slice(0, 300)}`, { install, bundled: bundledSummary });
    }

    this.progress(id, 'connecting', 'Connecting to the companion…');
    await this.removeForward();
    const fwd = await this.adb.executeAdb(['-s', serial, 'forward', 'tcp:0', `localabstract:${COMPANION_SOCKET}`], 8000);
    const port = fwd.code === 0 ? parseForwardPort(fwd.stdout) : null;
    if (!port) return fail('forward_failed', `adb port forwarding failed: ${fwd.stderr.trim() || fwd.stdout.trim()}`, { install, bundled: bundledSummary });
    if (this.stale(id)) {
      await this.adb.executeAdb(['-s', serial, 'forward', '--remove', `tcp:${port}`], 5000);
      return this.staleResult(id);
    }
    this.serial = serial;
    this.hostPort = port;
    this.client.setBaseUrl(`http://127.0.0.1:${port}`);

    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 10000);
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        const status = await this.client.getStatus();
        if (this.stale(id)) return this.staleResult(id);
        if (status.protocolVersion !== COMPANION_PROTOCOL_VERSION) {
          return fail('protocol_mismatch', `The companion on the phone speaks protocol ${status.protocolVersion ?? 1}, this desktop needs ${COMPANION_PROTOCOL_VERSION}. Update the companion app.`, { install, bundled: bundledSummary, status });
        }
        this.progress(id, 'ready', 'Companion app is ready.');
        return { success: true, stage: 'ready', message: 'Companion app is ready.', sessionId: id, install, bundled: bundledSummary, status, hostPort: port };
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
      await sleep(this.options.pollIntervalMs ?? 500);
      if (this.stale(id)) return this.staleResult(id);
    }
    return fail('not_ready', `The companion app did not respond. Make sure it is open and in front on the phone, and the phone is unlocked. (${lastError})`, { install, bundled: bundledSummary });
  }

  /** Ends the session: stops the camera via the app, revokes the token and removes the port forward. */
  async stop(): Promise<{ success: boolean }> {
    const id = ++this.sessionId;
    try {
      await this.client.disconnect();
    } catch {
      // app may already be gone
    }
    await this.removeForward();
    this.progress(id, 'stopped', 'Companion session ended.');
    return { success: true };
  }

  private async removeForward(): Promise<void> {
    if (this.serial && this.hostPort) {
      await this.adb.executeAdb(['-s', this.serial, 'forward', '--remove', `tcp:${this.hostPort}`], 5000).catch(() => undefined);
    }
    this.hostPort = null;
    this.client.setBaseUrl(null);
  }

  private stale(id: number): boolean {
    return id !== this.sessionId;
  }

  private staleResult(id: number): CompanionPrepareResult {
    return { success: false, stage: 'failed', code: 'superseded', message: 'A newer companion request replaced this one.', sessionId: id };
  }

  private progress(sessionId: number, stage: CompanionStage, message: string): void {
    if (sessionId !== this.sessionId) return;
    const evt: CompanionProgressEvent = { sessionId, stage, message };
    this.emit('progress', evt);
  }
}
