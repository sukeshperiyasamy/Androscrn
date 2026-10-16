import fs from 'fs';
import path from 'path';
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

export class DiagnosticsManager extends EventEmitter {
  private deviceManager: DeviceManager;
  private logcatProcess: any = null;

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
   * Captures high-res screenshot directly from device frame buffer via screencap
   */
  public async captureDeviceScreenshot(serial: string, destFolder: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
    if (!SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid device serial.' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot_${serial.replace(/[:.]/g, '_')}_${timestamp}.png`;
    const safePath = SecurityValidator.resolveSafePath(destFolder, filename);

    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    // ADB exec-out screencap -p pipes binary PNG directly without writing to Android sdcard
    const res = await this.deviceManager.executeAdb(['-s', serial, 'exec-out', 'screencap', '-p'], 8000);
    if (res.code === 0 && res.stdout.length > 0) {
      // Write buffer
      fs.writeFileSync(safePath, res.stdout, 'binary');
      return { success: true, filePath: safePath };
    }

    return { success: false, error: res.stderr || 'Screenshot capture failed' };
  }

  /**
   * Exports a sanitized diagnostic bundle containing device props, battery, and recent logcat
   */
  public async exportDiagnosticReport(serial: string, outputDir: string): Promise<{ success: boolean; reportPath?: string; error?: string }> {
    if (!SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid device serial.' };
    }

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `androscrn_report_${serial.replace(/[:.]/g, '_')}_${timestamp}.txt`;
      const reportPath = path.join(outputDir, filename);

      const props = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'getprop']);
      const battery = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'dumpsys', 'battery']);
      const recentLogs = await this.getRecentLogs(serial, 300);

      const reportContent = [
        '==================================================',
        '              ANDROSCRN DIAGNOSTIC REPORT         ',
        '==================================================',
        `Generated: ${new Date().toISOString()}`,
        `Device Target: ${serial}`,
        '',
        '--- BATTERY STATUS ---',
        battery.stdout.trim(),
        '',
        '--- SYSTEM PROPERTIES ---',
        SecurityValidator.redactSensitiveText(props.stdout.trim()),
        '',
        '--- RECENT LOGCAT ENTRIES ---',
        ...recentLogs.map(l => `[${l.timestamp || ''}] [${l.level}] ${l.tag ? l.tag + ': ' : ''}${SecurityValidator.redactSensitiveText(l.message)}`),
        '=================================================='
      ].join('\n');

      fs.writeFileSync(reportPath, reportContent, 'utf8');
      return { success: true, reportPath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
