import * as path from 'path';
import * as fs from 'fs';
import { DeviceManager } from '../device_manager';

export interface CompanionStatusResponse {
  status: string;
  /** Absent on protocol v1 (legacy TCP 8080 companion). */
  protocolVersion?: number;
  versionCode?: number;
  state?: string;
  error?: string;
  permissionGranted?: boolean;
  pairingPending?: boolean;
  cameraActive?: boolean;
  streamClients?: number;
  cameraId?: string;
  frameWidth?: number;
  frameHeight?: number;
  companionVersion: string;
  deviceModel: string;
  deviceProduct: string;
  androidVersion: string;
  sdkVersion: number;
  isPaired: boolean;
  isStreaming: boolean;
  cameraFacing: 'front' | 'back';
  currentZoom: number;
  minZoom: number;
  maxZoom: number;
  torchOn: boolean;
}

export interface CompanionCapabilities {
  transport: string;
  deviceModel: string;
  torchSupported: boolean;
  zoomSupported: boolean;
  minZoom: number;
  maxZoom: number;
  snapshotsSupported: boolean;
  inAppPreviewSupported: boolean;
  streamFormat?: string;
  cameras?: Array<{ id: string; facing: string; sensorOrientation?: number; hasFlash: boolean; outputSizes: string[] }>;
}

const REQUEST_TIMEOUT_MS = 5000;
const PHOTO_TIMEOUT_MS = 15000;

/** fetch with an abort timeout; the companion runs on a phone that can disappear mid-request. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Companion request timed out after ${timeoutMs} ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface CompanionPairingResult {
  success: boolean;
  token?: string;
  error?: string;
  message?: string;
}

export interface CompanionPhotoResult {
  success: boolean;
  photoId?: string;
  sizeBytes?: number;
  downloadUrl?: string;
  filePath?: string;
  error?: string;
}

export class CompanionClient {
  private deviceManager?: DeviceManager;
  private activeToken: string | null = null;
  // No default target: until CompanionManager (or the legacy setupPortForward) establishes an adb forward,
  // requests must fail instead of reaching whatever else listens on a well-known local port such as 8080.
  private defaultBaseUrl: string = '';
  private forwardConfigured: boolean = false;
  private configuredHostPort: number = 8080;

  constructor(deviceManager?: DeviceManager, token?: string) {
    this.deviceManager = deviceManager;
    if (token) {
      this.activeToken = token;
    }
  }

  /**
   * Points the client at the host port of the current `adb forward` (set by CompanionManager).
   * null clears it; requests then fail fast instead of reaching an unrelated local service.
   */
  setBaseUrl(url: string | null): void {
    if (url !== null && !/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(url)) {
      throw new Error('Companion base URL must be http://127.0.0.1:<port>');
    }
    this.defaultBaseUrl = url ?? '';
    if (url === null) this.activeToken = null;
  }

  getBaseUrl(): string {
    return this.defaultBaseUrl;
  }

  setSessionToken(token: string | null): void {
    this.activeToken = token;
  }

  getSessionToken(): string | null {
    return this.activeToken;
  }

  /**
   * Sets up localhost ADB port forwarding so PC loopback connects to the companion app.
   */
  async setupPortForward(serial: string, hostPort: number = 8080, devicePort: number = 8080): Promise<boolean> {
    if (!serial || typeof serial !== 'string' || serial.trim().length === 0) {
      throw new Error('Device serial is required for port forwarding');
    }
    if (hostPort <= 1024 || hostPort > 65535 || devicePort <= 1024 || devicePort > 65535) {
      throw new Error('Port must be a valid non-privileged TCP port (1025-65535)');
    }

    if (this.deviceManager) {
      const res = await this.deviceManager.executeAdb(['-s', serial.trim(), 'forward', `tcp:${hostPort}`, `tcp:${devicePort}`]);
      if (res.code === 0) {
        this.forwardConfigured = true;
        this.configuredHostPort = hostPort;
        this.defaultBaseUrl = `http://127.0.0.1:${hostPort}`;
        return true;
      }
      return false;
    }

    // Default configuration for standalone/direct testing
    this.forwardConfigured = true;
    this.configuredHostPort = hostPort;
    this.defaultBaseUrl = `http://127.0.0.1:${hostPort}`;
    return true;
  }

  /**
   * Removes ADB port forwarding on teardown.
   */
  async removePortForward(serial: string, hostPort: number = 8080): Promise<boolean> {
    if (!serial || typeof serial !== 'string' || serial.trim().length === 0) {
      return false;
    }
    try {
      if (this.deviceManager) {
        const res = await this.deviceManager.executeAdb(['-s', serial.trim(), 'forward', '--remove', `tcp:${hostPort}`]);
        this.forwardConfigured = false;
        return res.code === 0;
      }
      this.forwardConfigured = false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Probes whether the companion server is running and accessible on 127.0.0.1:8080.
   */
  async getStatus(baseUrl: string = this.defaultBaseUrl): Promise<CompanionStatusResponse> {
    if (!baseUrl) throw new Error('AndroScrn Companion is not connected (no adb forward is active)');
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/status`;

    try {
      const res = await fetchWithTimeout(url, {}, 3000);
      if (!res.ok) {
        throw new Error(`Companion status check returned HTTP ${res.status}`);
      }
      return await res.json() as CompanionStatusResponse;
    } catch (err: any) {
      throw new Error(`AndroScrn Companion app unreachable at ${url}: ${err.message}`);
    }
  }

  /**
   * Requests a pairing challenge, prompting the phone to show a 6-digit PIN.
   */
  async requestPairingChallenge(baseUrl: string = this.defaultBaseUrl): Promise<{ success: boolean; message: string; expiresInSeconds?: number }> {
    if (!baseUrl) throw new Error('AndroScrn Companion is not connected');
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/pair`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      throw new Error(body?.error || `Pairing challenge request failed with status ${res.status}`);
    }
    return await res.json() as { success: boolean; message: string; expiresInSeconds?: number };
  }

  /**
   * Submits the 6-digit verification PIN to receive an authenticated session token.
   */
  async submitPairingPin(pin: string, baseUrl: string = this.defaultBaseUrl): Promise<CompanionPairingResult> {
    if (typeof pin !== 'string') {
      return { success: false, error: 'Verification PIN must be a string' };
    }
    const cleanPin = pin.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanPin)) {
      return { success: false, error: 'Verification PIN must be exactly 6 numeric digits' };
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/pair`;
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin })
      });

      const data = await res.json() as any;
      if (res.ok && data.success && data.token) {
        this.activeToken = data.token;
        return { success: true, token: data.token, message: data.message };
      } else {
        return { success: false, error: data.error || 'Pairing rejected' };
      }
    } catch (err: any) {
      return { success: false, error: `Pairing network error: ${err.message}` };
    }
  }

  /**
   * Retrieves verified camera hardware capabilities from companion.
   */
  async getCapabilities(baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<CompanionCapabilities> {
    if (!token) {
      throw new Error('Authenticated session token is required to query capabilities');
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/capabilities`;
    const res = await fetchWithTimeout(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error(`Capabilities query failed (HTTP ${res.status})`);
    }
    return await res.json() as CompanionCapabilities;
  }

  /** Opens the phone camera (protocol v2). The MJPEG stream is available once this succeeds. */
  async startCamera(facing?: 'front' | 'back', cameraId?: string, baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<{ success: boolean; state?: string; code?: string; error?: string }> {
    if (!token) return { success: false, error: 'Authentication required' };
    if (facing !== undefined && facing !== 'front' && facing !== 'back') return { success: false, error: "Facing must be 'front' or 'back'" };
    if (cameraId !== undefined && !/^[A-Za-z0-9_.:-]{1,32}$/.test(cameraId)) return { success: false, error: 'Invalid camera id' };
    const payload: Record<string, any> = { action: 'start_camera' };
    if (facing) payload.facing = facing;
    if (cameraId) payload.cameraId = cameraId;
    return this.sendControlSafe(payload, baseUrl, token, 12000);
  }

  /** Releases the phone camera. */
  async stopCamera(baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<{ success: boolean; error?: string }> {
    if (!token) return { success: false, error: 'Authentication required' };
    return this.sendControlSafe({ action: 'stop_camera' }, baseUrl, token, 12000);
  }

  /**
   * Live lens switching (front/back) without restarting the stream.
   */
  async setCamera(facing: 'front' | 'back', baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<{ success: boolean; error?: string }> {
    if (!token) return { success: false, error: 'Authentication required' };
    if (facing !== 'front' && facing !== 'back') {
      return { success: false, error: "Facing must be 'front' or 'back'" };
    }

    return this.sendControl({ action: 'set_camera', facing }, baseUrl, token);
  }

  /**
   * Live digital zoom adjustment.
   */
  async setZoom(ratio: number, baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<{ success: boolean; currentZoom?: number; error?: string }> {
    if (!token) return { success: false, error: 'Authentication required' };
    if (typeof ratio !== 'number' || isNaN(ratio) || ratio <= 0) {
      return { success: false, error: 'Zoom ratio must be a positive number' };
    }

    return this.sendControl({ action: 'set_zoom', ratio }, baseUrl, token);
  }

  /**
   * Live LED torch toggle.
   */
  async setTorch(enabled: boolean, baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<{ success: boolean; torchOn?: boolean; error?: string }> {
    if (!token) return { success: false, error: 'Authentication required' };

    return this.sendControl({ action: 'set_torch', enabled: !!enabled }, baseUrl, token);
  }

  /**
   * Takes a full-resolution still photo and downloads it directly to destinationDir on PC.
   */
  async takeAndSavePhoto(destinationDir: string, baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<CompanionPhotoResult> {
    if (!token) return { success: false, error: 'Authentication required' };

    if (!destinationDir || typeof destinationDir !== 'string') {
      return { success: false, error: 'Destination directory path is required' };
    }

    const resolvedDir = path.resolve(destinationDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    // 1. Trigger photo capture on companion
    // The phone waits up to 5 s for the capture itself, so allow more than that end to end.
    const ctrlRes = await this.sendControl({ action: 'take_photo' }, baseUrl, token, 10000);
    if (!ctrlRes.success || !ctrlRes.photoId) {
      return { success: false, error: ctrlRes.error || 'Failed to capture photo' };
    }

    // 2. Download JPEG binary to PC
    const downloadUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1/photo/${ctrlRes.photoId}?token=${encodeURIComponent(token)}`;
    const imgRes = await fetchWithTimeout(downloadUrl, {}, PHOTO_TIMEOUT_MS);
    if (!imgRes.ok) {
      return { success: false, error: `Failed to download captured photo: HTTP ${imgRes.status}` };
    }

    const arrayBuf = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const filename = `companion_photo_${Date.now()}.jpg`;
    const targetFile = path.join(resolvedDir, filename);
    fs.writeFileSync(targetFile, buffer);

    return {
      success: true,
      photoId: ctrlRes.photoId,
      sizeBytes: buffer.length,
      downloadUrl,
      filePath: targetFile
    };
  }

  /**
   * Terminates active companion session.
   */
  async disconnect(baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): Promise<boolean> {
    if (!token) return true;
    try {
      await this.sendControl({ action: 'disconnect' }, baseUrl, token);
    } catch {
      // ignore
    } finally {
      this.activeToken = null;
    }
    return true;
  }

  /**
   * Constructs the authenticated live MJPEG stream URL for native HTML <img> embedding.
   */
  getStreamUrl(baseUrl: string = this.defaultBaseUrl, token: string | null = this.activeToken): string {
    if (!token || !baseUrl) return '';
    return `${baseUrl.replace(/\/+$/, '')}/api/v1/stream?token=${encodeURIComponent(token)}`;
  }

  /** Like sendControl, but returns the companion's error body instead of throwing on HTTP errors. */
  private async sendControlSafe(payload: Record<string, any>, baseUrl: string, token: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    if (!baseUrl) return { success: false, error: 'AndroScrn Companion is not connected' };
    try {
      const res = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/api/v1/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      }, timeoutMs);
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, code: body?.code, error: body?.error || `HTTP ${res.status}` };
      return body;
    } catch (err: any) {
      return { success: false, code: 'unreachable', error: err?.message || String(err) };
    }
  }

  private async sendControl(payload: Record<string, any>, baseUrl: string, token: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
    if (!baseUrl) throw new Error('AndroScrn Companion is not connected');
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/control`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    }, timeoutMs);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Control command '${payload.action}' failed (HTTP ${res.status}): ${errBody}`);
    }

    return await res.json();
  }
}
export * from './manager';
