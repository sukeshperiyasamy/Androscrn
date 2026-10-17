import { spawn } from 'child_process';
import fs from 'fs';
import { SecurityValidator } from '../security';

export interface AndroidDevice {
  serial: string;
  state:
    | 'device'
    | 'unauthorized'
    | 'offline'
    | 'connecting'
    | 'authorizing'
    | 'no permissions'
    | 'recovery'
    | 'sideload'
    | 'bootloader'
    | 'unknown';
  model: string;
  product: string;
  device: string;
  transportType: 'usb' | 'wifi';
  alias?: string;
  batteryLevel?: number;
  ipAddress?: string;
  guidance?: string;
}

export function getDeviceStateGuidance(state: AndroidDevice['state']): string {
  switch (state) {
    case 'unauthorized':
      return 'Device unauthorized: Unlock your phone and tap "Allow USB debugging" (check "Always allow from this computer").';
    case 'offline':
      return 'Device offline: Reconnect the USB cable or toggle Developer Options -> USB debugging.';
    case 'connecting':
      return 'Establishing ADB connection: Please wait a moment...';
    case 'authorizing':
      return 'Authorizing device: Please confirm the host key prompt on your phone screen.';
    case 'no permissions':
      return 'Permission denied: Install Windows OEM USB drivers or configure appropriate USB device permissions.';
    case 'recovery':
      return 'Device in Recovery mode: Reboot device into normal Android system for mirroring.';
    case 'sideload':
      return 'Device in Recovery Sideload mode: Reboot device into Android system.';
    case 'bootloader':
      return 'Device in Bootloader/Fastboot mode: Reboot device normally to connect.';
    case 'device':
      return 'Connected and authorized: Ready for screen mirroring and control.';
    default:
      return 'No device detected. Connect via USB with Developer Options & USB debugging enabled.';
  }
}

export class DeviceManager {
  private adbPath: string;
  private aliases: Map<string, string> = new Map();

  constructor(adbPath: string) {
    this.adbPath = adbPath;
  }

  /**
   * Returns the ADB binary version string
   */
  public async getAdbVersion(): Promise<string> {
    if (!fs.existsSync(this.adbPath)) {
      return `ADB binary not found at "${this.adbPath}"`;
    }
    const res = await this.executeAdb(['version']);
    const match = res.stdout.match(/Android Debug Bridge version ([\d.]+)/i);
    if (match) return `ADB ${match[1]}`;
    if (res.code !== 0) {
      return `ADB error: ${res.stderr.trim() || 'Command failed'}`;
    }
    return res.stdout.split('\n')[0] || 'Unknown ADB Version';
  }

  /**
   * Executes an ADB command with raw binary buffer output (prevents PNG/media corruption)
   */
  public executeAdbBinary(args: string[], timeoutMs = 10000): Promise<{ buffer: Buffer; code: number; error?: string }> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.adbPath)) {
        return resolve({
          buffer: Buffer.alloc(0),
          code: -1,
          error: `ADB binary not found at: ${this.adbPath}`
        });
      }

      const child = spawn(this.adbPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const chunks: Buffer[] = [];
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const buffer = Buffer.concat(chunks);
        if (timedOut) {
          resolve({ buffer, code: -1, error: 'ADB command timed out.' });
        } else {
          resolve({ buffer, code: code ?? 0, error: stderr.trim() || undefined });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ buffer: Buffer.alloc(0), code: -1, error: err.message });
      });
    });
  }

  /**
   * Executes an ADB command with discrete positional arguments (no shell injection)
   */
  public executeAdb(args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.adbPath)) {
        return resolve({
          stdout: '',
          stderr: `ADB binary not found at "${this.adbPath}". Ensure Android platform-tools or bundled binaries are installed.`,
          code: -1
        });
      }

      const child = spawn(this.adbPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ stdout, stderr: stderr + '\nCommand timed out.', code: -1 });
        } else {
          resolve({ stdout, stderr, code: code ?? 0 });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, code: -1 });
      });
    });
  }

  /**
   * Sets a user-defined friendly alias for a device serial
   */
  public setDeviceAlias(serial: string, alias: string): void {
    if (SecurityValidator.isValidSerial(serial)) {
      this.aliases.set(serial, alias.trim());
    }
  }

  /**
   * Parses the raw stdout of `adb devices -l`
   */
  public parseDevicesOutput(output: string): AndroidDevice[] {
    const devices: AndroidDevice[] = [];
    const lines = output.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith('List of devices') ||
        trimmed.startsWith('* daemon') ||
        trimmed.startsWith('adb server version') ||
        trimmed.startsWith('cannot connect to daemon')
      ) {
        continue;
      }

      // Expected format: <serial> <state> [usb:...] [product:...] [model:...] [device:...] [transport_id:...]
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;

      const serial = parts[0];
      const rawState = parts[1];

      let state: AndroidDevice['state'] = 'unknown';
      if (rawState === 'device') state = 'device';
      else if (rawState === 'unauthorized') state = 'unauthorized';
      else if (rawState === 'offline') state = 'offline';
      else if (rawState === 'connecting') state = 'connecting';
      else if (rawState === 'authorizing') state = 'authorizing';
      else if (rawState === 'recovery') state = 'recovery';
      else if (rawState === 'sideload') state = 'sideload';
      else if (rawState === 'bootloader') state = 'bootloader';
      else if (trimmed.includes('no permissions')) state = 'no permissions';

      // Determine transport type: if serial has IP:port format, it is Wi-Fi, otherwise USB
      const isWifi = serial.includes(':') || /^\d+\.\d+\.\d+\.\d+/.test(serial);
      const transportType: 'usb' | 'wifi' = isWifi ? 'wifi' : 'usb';

      let model = 'Android Device';
      let product = 'Unknown';
      let device = 'Unknown';

      for (let i = 2; i < parts.length; i++) {
        const token = parts[i];
        if (token.startsWith('model:')) model = token.replace('model:', '').replace(/_/g, ' ');
        if (token.startsWith('product:')) product = token.replace('product:', '');
        if (token.startsWith('device:')) device = token.replace('device:', '');
      }

      const alias = this.aliases.get(serial);

      devices.push({
        serial,
        state,
        model,
        product,
        device,
        transportType,
        alias,
        ipAddress: isWifi ? serial.split(':')[0] : undefined,
        guidance: getDeviceStateGuidance(state)
      });
    }

    return devices;
  }

  /**
   * Enumerates all currently attached and authorized Android devices
   */
  public async getDevices(): Promise<AndroidDevice[]> {
    const result = await this.executeAdb(['devices', '-l']);
    const devices = this.parseDevicesOutput(result.stdout);

    // Concurrently probe battery for authorized devices with bounded timeout
    await Promise.allSettled(
      devices
        .filter(d => d.state === 'device')
        .map(async d => {
          try {
            const battery = await this.getBatteryLevel(d.serial);
            if (battery !== undefined) {
              d.batteryLevel = battery;
            }
          } catch {
            // Ignore battery query failures
          }
        })
    );

    return devices;
  }

  /**
   * Retrieves battery percentage for a device
   */
  public async getBatteryLevel(serial: string): Promise<number | undefined> {
    if (!SecurityValidator.isValidSerial(serial)) return undefined;
    const res = await this.executeAdb(['-s', serial, 'shell', 'dumpsys', 'battery'], 4000);
    const match = res.stdout.match(/level:\s*(\d+)/i);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return undefined;
  }

  /**
   * Queries device screen dimensions via `wm size`
   */
  public async getScreenSize(serial: string): Promise<{ width: number; height: number } | null> {
    if (!SecurityValidator.isValidSerial(serial)) return null;
    const res = await this.executeAdb(['-s', serial, 'shell', 'wm', 'size'], 4000);
    if (res.code !== 0) return null;

    // Check for Override size first (e.g. "Override size: 1080x2400")
    const overrideMatch = res.stdout.match(/Override size:\s*(\d+)x(\d+)/i);
    if (overrideMatch) {
      return {
        width: parseInt(overrideMatch[1], 10),
        height: parseInt(overrideMatch[2], 10)
      };
    }

    // Physical size fallback (e.g. "Physical size: 1080x2400")
    const physicalMatch = res.stdout.match(/Physical size:\s*(\d+)x(\d+)/i);
    if (physicalMatch) {
      return {
        width: parseInt(physicalMatch[1], 10),
        height: parseInt(physicalMatch[2], 10)
      };
    }

    return null;
  }
}
