import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { DeviceManager } from '../device_manager';
import { SecurityValidator } from '../security';

export interface LogEntry {
  raw: string;
  timestamp?: string;
  pid?: string;
  tid?: string;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'UNKNOWN';
  tag?: string;
  message: string;
}

export interface CaptureItem {
  id: string;
  type: 'screenshot' | 'video';
  name: string;
  timestamp: string;
  path: string;
  sizeBytes: number;
}

export class DiagnosticsManager extends EventEmitter {
  private deviceManager: DeviceManager;

  constructor(deviceManager: DeviceManager) {
    super();
    this.deviceManager = deviceManager;
  }

  /**
   * Parses standard ADB logcat line (threadtime format)
   */
  public parseLogLine(raw: string): LogEntry {
    // Example format: 10-16 12:30:15.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
    const match = raw.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s*(.*)$/);
    if (match) {
      return {
        raw,
        timestamp: match[1],
        pid: match[2],
        tid: match[3],
        level: match[4] as LogEntry['level'],
        tag: match[5].trim(),
        message: match[6]
      };
    }

    return {
      raw,
      level: raw.includes(' E ') || raw.includes('FATAL') ? 'E' : 'I',
      message: raw
    };
  }

  /**
   * Fetches recent logcat entries
   */
  public async getRecentLogs(serial: string, count = 200): Promise<LogEntry[]> {
    if (!SecurityValidator.isValidSerial(serial)) return [];

    const res = await this.deviceManager.executeAdb(['-s', serial, 'logcat', '-d', '-v', 'threadtime', '-t', count.toString()], 8000);
    const lines = res.stdout.split(/\r?\n/);
    return lines.filter(l => l.trim().length > 0).map(l => this.parseLogLine(l));
  }

  /**
   * Captures raw binary PNG screenshot directly from device frame buffer via screencap
   */
  public async captureDeviceScreenshot(serial: string, destFolder: string): Promise<{ success: boolean; filePath?: string; size?: number; error?: string }> {
    if (!SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid device serial identifier.' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot_${serial.replace(/[:.]/g, '_')}_${timestamp}.png`;
    const safePath = SecurityValidator.resolveSafePath(destFolder, filename);

    try {
      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true });
      }

      // ADB exec-out screencap -p pipes raw binary PNG data
      const res = await this.deviceManager.executeAdbBinary(['-s', serial, 'exec-out', 'screencap', '-p'], 10000);
      
      if (res.code !== 0 || res.buffer.length === 0) {
        return { success: false, error: res.error || 'ADB screencap command returned no data.' };
      }

      // Verify PNG magic header: 89 50 4E 47 0D 0A 1A 0A
      const isPng = res.buffer.length >= 8 &&
        res.buffer[0] === 0x89 &&
        res.buffer[1] === 0x50 &&
        res.buffer[2] === 0x4e &&
        res.buffer[3] === 0x47;

      if (!isPng) {
        return { success: false, error: `Invalid image stream returned by device (received ${res.buffer.length} bytes without PNG signature).` };
      }

      // Write raw binary buffer directly
      fs.writeFileSync(safePath, res.buffer);

      // Verify file presence and non-zero size
      if (!fs.existsSync(safePath)) {
        return { success: false, error: 'Failed to write screenshot file to destination.' };
      }

      const stats = fs.statSync(safePath);
      if (stats.size === 0) {
        try { fs.unlinkSync(safePath); } catch {}
        return { success: false, error: 'Screenshot file was written with zero bytes (cleaned up).' };
      }

      return { success: true, filePath: safePath, size: stats.size };
    } catch (err: any) {
      if (fs.existsSync(safePath)) {
        try { fs.unlinkSync(safePath); } catch {}
      }
      return { success: false, error: err?.message || 'Screenshot write failed.' };
    }
  }

  /**
   * Scans a captures folder and returns real existing files
   */
  public getExistingCaptures(capturesFolder: string): CaptureItem[] {
    if (!fs.existsSync(capturesFolder)) {
      return [];
    }

    try {
      const files = fs.readdirSync(capturesFolder);
      const results: CaptureItem[] = [];

      for (const f of files) {
        const fullPath = path.join(capturesFolder, f);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            const ext = path.extname(f).toLowerCase();
            if (ext === '.png' || ext === '.mp4' || ext === '.mkv') {
              results.push({
                id: f,
                name: f,
                type: ext === '.png' ? 'screenshot' : 'video',
                timestamp: stats.mtime.toLocaleString(),
                path: fullPath,
                sizeBytes: stats.size
              });
            }
          }
        } catch {
          // ignore stat errors
        }
      }

      // Sort newest first
      return results.reverse();
    } catch {
      return [];
    }
  }

  /**
   * Generates a copyable, sanitized diagnostic report string
   */
  public async generateDiagnosticBundle(
    serial?: string,
    scrcpyStatus?: any,
    options: { includeSerials?: boolean } = {}
  ): Promise<string> {
    const includeSerials = options.includeSerials === true;
    const adbVer = await this.deviceManager.getAdbVersion();
    const devices = await this.deviceManager.getDevicesDetailed();
    const knownSerials = [
      ...devices.map(d => d.serial),
      ...(serial ? [serial] : []),
      ...(scrcpyStatus?.targetSerial ? [scrcpyStatus.targetSerial] : [])
    ];
    // Serial numbers are redacted from the whole report by default (see finalize() below).
    const showSerial = (s: string) => (includeSerials ? s : SecurityValidator.redactSerial(s));

    let targetDeviceSection = 'No active device selected.';
    let propsSection = 'N/A';
    let batterySection = 'N/A';
    let recentLogsText = 'No logs available.';

    if (serial && SecurityValidator.isValidSerial(serial)) {
      const d = devices.find(x => x.serial === serial);
      if (d) {
        targetDeviceSection = [
          `Serial: ${showSerial(d.serial)}`,
          `Model: ${d.model}`,
          `Manufacturer: ${d.manufacturer || 'Unknown'}`,
          `Android: ${d.androidVersion || 'Unknown'}${d.apiLevel !== undefined ? ` (API ${d.apiLevel})` : ''}`,
          `Product: ${d.product}`,
          `Device State: ${d.state}`,
          `Transport: ${d.transportType.toUpperCase()}${d.connectionType ? ` (${d.connectionType})` : ''}`,
          `Battery: ${d.batteryLevel !== undefined ? `${d.batteryLevel}%` : 'Unknown'}`,
          `Guidance: ${d.guidance || 'None'}`
        ].join('\n');

        if (d.state === 'device') {
          const props = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'getprop']);
          const battery = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'dumpsys', 'battery']);
          const logs = await this.getRecentLogs(serial, 100);

          propsSection = SecurityValidator.redactSensitiveText(props.stdout.slice(0, 1500));
          batterySection = battery.stdout.trim() || 'N/A';
          if (logs.length > 0) {
            recentLogsText = logs.slice(0, 50).map(l => 
              `[${l.timestamp || ''}] [${l.level}] ${l.tag ? l.tag + ': ' : ''}${SecurityValidator.redactSensitiveText(l.message)}`
            ).join('\n');
          }
        }
      }
    }

    const lines = [
      '================================================================',
      '               ANDROSCRN SYSTEM DIAGNOSTIC REPORT               ',
      '================================================================',
      `Generated: ${new Date().toISOString()}`,
      `Host Platform: Windows ${os.release()} (${os.arch()})`,
      `Node.js: ${process.version}`,
      `ADB Version: ${adbVer}`,
      '',
      '--- SCREEN MIRRORING SESSION ---',
      `Running: ${scrcpyStatus?.running ? 'YES' : 'NO'}`,
      `Target Serial: ${scrcpyStatus?.targetSerial ? showSerial(scrcpyStatus.targetSerial) : 'None'}`,
      `Process PID: ${scrcpyStatus?.pid || 'None'}`,
      `Last Exit Code: ${scrcpyStatus?.exitCode ?? 'None'}`,
      `Last Error: ${scrcpyStatus?.lastError || 'None'}`,
      '',
      `--- CONNECTED DEVICES (${devices.length}) ---`,
      devices.length === 0
        ? 'No Android devices detected via ADB.'
        : devices.map(d => `• ${d.model} (${showSerial(d.serial)}) - State: ${d.state} [${d.transportType.toUpperCase()}]`).join('\n'),
      '',
      '--- TARGET DEVICE DETAILS ---',
      targetDeviceSection,
      '',
      '--- BATTERY STATUS ---',
      batterySection,
      '',
      '--- SYSTEM PROPERTIES (SAMPLE) ---',
      propsSection,
      '',
      '--- RECENT DEVICE LOGCAT (50 LINES) ---',
      recentLogsText,
      '================================================================'
    ];

    const report = lines.join('\n');
    return includeSerials
      ? report
      : SecurityValidator.redactNetworkIdentifiers(SecurityValidator.redactSerialsInText(report, knownSerials));
  }

  /**
   * Exports a sanitized diagnostic bundle file to disk
   */
  public async exportDiagnosticReport(serial: string, outputDir: string, scrcpyStatus?: any): Promise<{ success: boolean; reportPath?: string; error?: string }> {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      // The file name never contains the device serial; a short hash keeps reports from different devices apart.
      const deviceTag = serial ? crypto.createHash('sha256').update(serial).digest('hex').slice(0, 8) : 'system';
      const filename = `androscrn_report_${deviceTag}_${timestamp}.txt`;
      const reportPath = path.join(outputDir, filename);

      const reportContent = await this.generateDiagnosticBundle(serial, scrcpyStatus);
      fs.writeFileSync(reportPath, reportContent, 'utf8');

      return { success: true, reportPath };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Report export failed.' };
    }
  }
}
