import { spawn } from 'child_process';
import { SecurityValidator } from '../security';

export interface AndroidDevice {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | 'connecting' | 'unknown';
  model: string;
  product: string;
  device: string;
  transportType: 'usb' | 'wifi';
  alias?: string;
  batteryLevel?: number;
  ipAddress?: string;
}

export class DeviceManager {
  private adbPath: string;
  private aliases: Map<string, string> = new Map();

  constructor(adbPath: string) {
    this.adbPath = adbPath;
  }

  /**
   * Executes an ADB command with discrete positional arguments (no shell injection)
   */
  public executeAdb(args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
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
      if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('* daemon')) {
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
        ipAddress: isWifi ? serial.split(':')[0] : undefined
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

    // Optionally probe battery for authorized devices
    for (const d of devices) {
      if (d.state === 'device') {
        try {
          const battery = await this.getBatteryLevel(d.serial);
          if (battery !== undefined) {
            d.batteryLevel = battery;
          }
        } catch {
          // Ignore battery query failures
        }
      }
    }

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
}
