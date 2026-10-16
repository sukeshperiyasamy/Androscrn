import os from 'os';
import { DeviceManager } from '../device_manager';
import { SecurityValidator } from '../security';

export interface HandoffResult {
  success: boolean;
  ipAddress?: string;
  port: number;
  message: string;
}

export interface PairResult {
  success: boolean;
  message: string;
}

export class ConnectionManager {
  private deviceManager: DeviceManager;

  constructor(deviceManager: DeviceManager) {
    this.deviceManager = deviceManager;
  }

  /**
   * Discovers the Wi-Fi IP address of a device currently attached via USB
   */
  public async getDeviceWifiIp(serial: string): Promise<string | null> {
    if (!SecurityValidator.isValidSerial(serial)) return null;

    // Method 1: ip -f inet addr show wlan0
    const ipRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
    const match = ipRes.stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match && SecurityValidator.isValidIPv4(match[1])) {
      return match[1];
    }

    // Method 2: ip -f inet addr show ap0 (Hotspot interface)
    const apRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'ap0']);
    const apMatch = apRes.stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (apMatch && SecurityValidator.isValidIPv4(apMatch[1])) {
      return apMatch[1];
    }

    // Method 3: getprop dhcp.wlan0.ipaddress
    const propRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'getprop', 'dhcp.wlan0.ipaddress']);
    const propIp = propRes.stdout.trim();
    if (SecurityValidator.isValidIPv4(propIp)) {
      return propIp;
    }

    return null;
  }

  /**
   * Executes 1-Click USB-to-TCP/IP Handoff
   */
  public async handoffUsbToWifi(serial: string, port = 5555): Promise<HandoffResult> {
    if (!SecurityValidator.isValidSerial(serial)) {
      return { success: false, port, message: 'Invalid device serial identifier.' };
    }

    const ip = await this.getDeviceWifiIp(serial);
    if (!ip) {
      return {
        success: false,
        port,
        message: 'Could not determine phone Wi-Fi IP. Ensure the phone is connected to Wi-Fi or Hotspot is active.'
      };
    }

    // Step 1: Tell ADB daemon on device to listen on TCP port
    const tcpipRes = await this.deviceManager.executeAdb(['-s', serial, 'tcpip', port.toString()]);
    if (tcpipRes.code !== 0 && !tcpipRes.stdout.includes('restarting in TCP mode')) {
      return {
        success: false,
        port,
        message: `Failed to set TCP/IP mode: ${tcpipRes.stderr || tcpipRes.stdout}`
      };
    }

    // Step 2: Connect to device IP
    const connectRes = await this.deviceManager.executeAdb(['connect', `${ip}:${port}`], 8000);
    if (connectRes.stdout.includes('connected to') || connectRes.stdout.includes('already connected')) {
      return {
        success: true,
        ipAddress: ip,
        port,
        message: `Successfully connected to ${ip}:${port}. You can now safely disconnect the USB cable!`
      };
    }

    return {
      success: false,
      ipAddress: ip,
      port,
      message: `Failed to connect over Wi-Fi: ${connectRes.stdout || connectRes.stderr}`
    };
  }

  /**
   * Connects to a device via known IP and port
   */
  public async connectWireless(ip: string, port = 5555): Promise<{ success: boolean; message: string }> {
    if (!SecurityValidator.isValidIPv4(ip) || !SecurityValidator.isValidPort(port)) {
      return { success: false, message: 'Invalid IP address or port number.' };
    }

    const res = await this.deviceManager.executeAdb(['connect', `${ip}:${port}`], 8000);
    if (res.stdout.includes('connected to') || res.stdout.includes('already connected')) {
      return { success: true, message: `Connected to ${ip}:${port}` };
    }

    return { success: false, message: res.stdout || res.stderr || 'Connection failed' };
  }

  /**
   * Disconnects an active wireless connection
   */
  public async disconnect(target: string): Promise<{ success: boolean; message: string }> {
    if (!SecurityValidator.isValidSerial(target)) {
      return { success: false, message: 'Invalid serial target.' };
    }

    const res = await this.deviceManager.executeAdb(['disconnect', target], 5000);
    return {
      success: res.code === 0,
      message: res.stdout.trim() || res.stderr.trim()
    };
  }

  /**
   * Android 11+ Pair Device using 6-digit PIN and pairing port
   */
  public async pairWireless(ip: string, pairPort: number, pin: string, connectPort?: number): Promise<PairResult> {
    if (!SecurityValidator.isValidIPv4(ip) || !SecurityValidator.isValidPort(pairPort) || !SecurityValidator.isValidPairingCode(pin)) {
      return { success: false, message: 'Invalid IP, pairing port, or 6-digit PIN.' };
    }

    const pairRes = await this.deviceManager.executeAdb(['pair', `${ip}:${pairPort}`, pin], 10000);
    if (!pairRes.stdout.includes('Successfully paired')) {
      return {
        success: false,
        message: `Pairing failed: ${pairRes.stdout || pairRes.stderr}`
      };
    }

    // If connect port was also provided, establish connection immediately
    if (connectPort && SecurityValidator.isValidPort(connectPort)) {
      const connRes = await this.connectWireless(ip, connectPort);
      return {
        success: connRes.success,
        message: `Paired successfully! ${connRes.message}`
      };
    }

    return {
      success: true,
      message: 'Paired successfully! Now connect using the connect port displayed on your phone.'
    };
  }

  /**
   * Auto-detect default gateway IP when laptop is connected to Android hotspot
   */
  public detectHotspotGateway(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        // Look for common Android mobile hotspot subnet: 192.168.43.x, 192.168.50.x, etc.
        if (net.family === 'IPv4' && !net.internal) {
          if (net.address.startsWith('192.168.43.')) {
            return '192.168.43.1';
          }
          if (net.address.startsWith('192.168.50.')) {
            return '192.168.50.1';
          }
        }
      }
    }
    return null;
  }
}
