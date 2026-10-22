import { app, BrowserWindow, ipcMain, dialog, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import { DeviceManager } from '../../../dist/modules/device_manager';
import { SecurityValidator } from '../../../dist/modules/security';
import { ConnectionManager } from '../../../dist/modules/connection_manager';
import { ScrcpyManager } from '../../../dist/modules/scrcpy_manager';
import { DiagnosticsManager } from '../../../dist/modules/diagnostics';
import { WorkflowEngine } from '../../../dist/modules/workflow_engine';
import { McpControlServer } from '../../../dist/modules/mcp/control-bridge';
import { CameraManager } from '../../../dist/modules/camera_manager';
import { CompanionClient, CompanionManager } from '../../../dist/modules/companion_client';
import { WirelessDiscovery, parseConnectRequest, parsePairRequest, parseDeviceHelpRequest } from '../../../dist/modules/wireless_discovery';
import { buildDeviceHelp } from '../../../dist/modules/oem_guidance';
import { DocumentWorkflow, TesseractOcrEngine, DocumentSession, DocumentError } from '../../../dist/modules/document_intelligence';
import { parseSessionRequest, parseProcessRequest, parseTextRequest, parseCaptureName, toErrorPayload } from '../../../dist/modules/document_intelligence/ipc';
import { generateSvgOverlay, TimelapseScheduler, createSnapshotMetadata } from '../../../dist/modules/lab_inspection';
import { ConnectionRetryManager } from '../../../dist/modules/connection_retry';
import { SettingsStore } from '../../../dist/modules/settings_store';
import { SessionRecoveryCoordinator } from '../../../dist/modules/session_recovery';

let mainWindow: BrowserWindow | null = null;
const timelapseScheduler = new TimelapseScheduler();

// Initialize file logger for portable runtime
function getLogFilePath(): string {
  try {
    const portableLog = path.join(path.dirname(process.execPath), 'androscrn.log');
    if (app.isPackaged) {
      fs.appendFileSync(portableLog, '');
      return portableLog;
    }
  } catch {
    // Fall back to userData if exe directory is write-protected
  }
  const userLogDir = app.getPath('userData');
  if (!fs.existsSync(userLogDir)) {
    fs.mkdirSync(userLogDir, { recursive: true });
  }
  return path.join(userLogDir, 'androscrn.log');
}

const logFile = getLogFilePath();
function appLog(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // Ignore log write failures
  }
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

appLog('INFO', 'AndroScrn starting up (Provisional Electron Distribution)', {
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath
});

// Binary Resolver: Locates ADB and scrcpy binaries relative to portable package or dev root
function resolveBinary(binaryName: string): string {
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    // 1. Packaged next to AndroScrn.exe (standard portable layout)
    path.join(exeDir, 'bin', 'scrcpy-win64', binaryName),
    // 2. Packaged inside Electron resources folder
    path.join(process.resourcesPath || '', 'bin', 'scrcpy-win64', binaryName),
    // 3. Inside resources/app/bin/scrcpy-win64
    path.join(app.getAppPath(), 'bin', 'scrcpy-win64', binaryName),
    // 4. Development mode from dist-electron
    path.resolve(__dirname, '../../bin/scrcpy-win64', binaryName),
    // 5. Development mode from repo root
    path.resolve(__dirname, '../../../bin/scrcpy-win64', binaryName),
    // 6. Current working directory fallback
    path.resolve(process.cwd(), 'bin', 'scrcpy-win64', binaryName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      appLog('INFO', `Resolved ${binaryName} at: ${candidate}`);
      return candidate;
    }
  }

  appLog('WARN', `Could not find bundled ${binaryName}. Falling back to default: ${candidates[0]}`);
  return candidates[0];
}

const adbPath = resolveBinary('adb.exe');
const scrcpyPath = resolveBinary('scrcpy.exe');

function resolveScript(scriptName: string): string {
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(exeDir, 'scripts', scriptName),
    path.join(process.resourcesPath || '', 'scripts', scriptName),
    path.join(app.getAppPath(), 'scripts', scriptName),
    path.resolve(__dirname, '../../scripts', scriptName),
    path.resolve(__dirname, '../../../scripts', scriptName),
    path.resolve(process.cwd(), 'scripts', scriptName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

const retryScriptPath = resolveScript('adb-diagnostics.cmd');

const deviceManager = new DeviceManager(adbPath);
const connectionManager = new ConnectionManager(deviceManager);
const scrcpyManager = new ScrcpyManager(scrcpyPath);
const diagnosticsManager = new DiagnosticsManager(deviceManager);
const workflowEngine = new WorkflowEngine(deviceManager, diagnosticsManager);
const cameraManager = new CameraManager(scrcpyPath, deviceManager);
const companionClient = new CompanionClient(deviceManager);

// Bundled companion APK (staged by `npm run build:companion` into bin/companion with version metadata).
function companionApkCandidates(): string[] {
  const rel = path.join('bin', 'companion', 'androscrn-companion.apk');
  return [
    path.join(path.dirname(process.execPath), rel),
    path.join(process.resourcesPath || '', rel),
    path.join(app.getAppPath(), rel),
    path.resolve(__dirname, '../..', rel),
    path.resolve(__dirname, '../../..', rel),
    path.resolve(process.cwd(), rel)
  ];
}
const companionManager = new CompanionManager(deviceManager, companionClient, companionApkCandidates);
companionManager.on('progress', (evt) => {
  mainWindow?.webContents.send('companion-progress', evt);
});
let companionCameraActive = false;
const connectionRetryManager = new ConnectionRetryManager(deviceManager, adbPath, retryScriptPath);

// Durable user preferences (aliases, quality preset, input mode). Runtime session state is never stored.
const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
{
  const loaded = settingsStore.load();
  if (loaded.status === 'corrupt') {
    appLog('WARN', 'Settings file was unreadable; defaults restored', { backup: loaded.backupPath });
  } else if (loaded.status === 'repaired') {
    appLog('WARN', 'Invalid settings values were reset to defaults', { fields: loaded.droppedFields });
  }
  for (const [serial, alias] of Object.entries(settingsStore.get().aliases)) {
    deviceManager.setDeviceAlias(serial, alias);
  }
}

cameraManager.on('statusChanged', (status) => {
  mainWindow?.webContents.send('camera-status-changed', status);
});

connectionRetryManager.on('statusChanged', (status) => {
  mainWindow?.webContents.send('connection-retry-status-changed', status);
});

// Mirroring session recovery after a disconnect. Restores go through the same camera coordination as a user start,
// except that a running Camera Studio session is never stopped by an automatic restore.
const sessionRecovery = new SessionRecoveryCoordinator(
  {
    startMirroring: (options) => {
      const cam = cameraManager.getStatus();
      if (cam.running && (!options.serial || cam.targetSerial === options.serial)) {
        return { success: false, message: 'Camera Studio is using the phone' };
      }
      const res = scrcpyManager.startMirroring(options);
      if (res.success) appLog('INFO', 'Mirroring session restored', { serial: SecurityValidator.redactSerial(options.serial || '') });
      return res;
    },
    getStatus: () => scrcpyManager.getStatus()
  },
  connectionRetryManager
);
sessionRecovery.on('statusChanged', (status) => {
  appLog('INFO', `Session recovery: ${status.state}`, { serial: SecurityValidator.redactSerial(status.serial || '') });
  mainWindow?.webContents.send('session-recovery-changed', status);
});
let mirrorStopRequested = false;

connectionRetryManager.on('deviceReady', (devices) => {
  mainWindow?.webContents.send('connection-retry-device-ready', devices);
});

function getCapturesFolder(): string {
  const exeDir = path.dirname(process.execPath);
  const portableCaptures = path.join(exeDir, 'Captures');
  
  if (!app.isPackaged && fs.existsSync(path.resolve(__dirname, '../../../package.json'))) {
    const devCaptures = path.resolve(__dirname, '../../../Captures');
    if (!fs.existsSync(devCaptures)) {
      fs.mkdirSync(devCaptures, { recursive: true });
    }
    return devCaptures;
  }

  try {
    if (!fs.existsSync(portableCaptures)) {
      fs.mkdirSync(portableCaptures, { recursive: true });
    }
    return portableCaptures;
  } catch {
    const userDataCaptures = path.join(app.getPath('userData'), 'Captures');
    if (!fs.existsSync(userDataCaptures)) {
      fs.mkdirSync(userDataCaptures, { recursive: true });
    }
    return userDataCaptures;
  }
}

function createWindow() {
  const preloadCandidates = [
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'dist-electron', 'preload.js'),
    path.join(app.getAppPath(), 'preload.js')
  ];
  const preloadPath = preloadCandidates.find(p => fs.existsSync(p)) || path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#FFFFFF',
    title: 'AndroScrn (Provisional Electron Distribution)',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      const { shell } = require('electron');
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const devUrl = 'http://localhost:5173';
  const prodIndexCandidates = [
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(__dirname, '../dist/index.html'),
    path.join(__dirname, 'dist', 'index.html')
  ];
  const prodIndex = prodIndexCandidates.find(p => fs.existsSync(p)) || path.join(app.getAppPath(), 'dist', 'index.html');

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(prodIndex);
    });
  } else {
    mainWindow.loadFile(prodIndex).catch((err) => {
      appLog('ERROR', 'Failed to load prodIndex: ' + prodIndex, err);
    });
  }

  mainWindow.on('closed', () => {
    try {
      scrcpyManager.stopMirroring();
      cameraManager.stopCamera();
      sessionRecovery.dispose();
      connectionRetryManager.dispose();
    } catch {
      // ignore on close
    }
    mainWindow = null;
  });
}

// IPC Handlers with defensive error handling and logging
ipcMain.handle('get-devices', async () => {
  try {
    return await deviceManager.getDevicesDetailed();
  } catch (err: any) {
    appLog('ERROR', 'Error fetching devices', err?.message || err);
    return [];
  }
});

ipcMain.handle('start-connection-retry', async (_, options) => {
  try {
    appLog('INFO', 'Initiating connection retry session', options);
    return await connectionRetryManager.startRetry(options || {});
  } catch (err: any) {
    appLog('ERROR', 'Error starting connection retry', err?.message || err);
    return { success: false, message: err?.message || 'Failed to start connection retry' };
  }
});

ipcMain.handle('cancel-connection-retry', () => {
  try {
    appLog('INFO', 'Cancelling connection retry session');
    return connectionRetryManager.cancelRetry();
  } catch (err: any) {
    appLog('ERROR', 'Error cancelling connection retry', err?.message || err);
    return { success: false, message: err?.message || 'Failed to cancel connection retry' };
  }
});

ipcMain.handle('get-connection-retry-status', () => {
  try {
    return connectionRetryManager.getStatus();
  } catch (err: any) {
    return { active: false, status: 'error', error: err?.message };
  }
});

ipcMain.handle('set-alias', (_, payload) => {
  try {
    const { serial, alias } = payload || {};
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) return false;
    const res = settingsStore.setAlias(serial, typeof alias === 'string' ? alias : '');
    if (!res.success) {
      appLog('WARN', 'Alias not saved', res.message);
      return false;
    }
    deviceManager.setDeviceAlias(serial, res.settings.aliases[serial] || '');
    return true;
  } catch (err: any) {
    appLog('ERROR', 'Error setting alias', err?.message || err);
    return false;
  }
});

ipcMain.handle('get-settings', () => {
  const { qualityPreset, inputMode, clipboardSync } = settingsStore.get();
  return { qualityPreset, inputMode, clipboardSync };
});

ipcMain.handle('update-settings', (_, patch) => {
  try {
    const update: Record<string, unknown> = {};
    for (const key of ['qualityPreset', 'inputMode', 'clipboardSync']) {
      if (patch && key in patch) update[key] = patch[key];
    }
    const res = settingsStore.update(update);
    if (!res.success) appLog('WARN', 'Settings update rejected', res.message);
    const { qualityPreset, inputMode, clipboardSync } = res.settings;
    return { success: res.success, message: res.message, settings: { qualityPreset, inputMode, clipboardSync } };
  } catch (err: any) {
    appLog('ERROR', 'Error updating settings', err?.message || err);
    return { success: false, message: err?.message || 'Failed to update settings' };
  }
});

ipcMain.handle('start-mirroring', (_, options) => {
  try {
    if (!fs.existsSync(scrcpyPath)) {
      return { success: false, message: `scrcpy executable not found at: ${scrcpyPath}` };
    }
    const targetSerial = options?.serial;
    // Concurrency coordination: Stop conflicting Camera Studio session on device before starting mirroring
    const camStatus = cameraManager.getStatus();
    if (camStatus.running && (!targetSerial || camStatus.targetSerial === targetSerial)) {
      appLog('INFO', `Stopping conflicting Camera Studio session on ${targetSerial || 'default'} before starting mirroring`);
      cameraManager.stopCamera();
    }
    const res = scrcpyManager.startMirroring(options || {});
    if (res.success) {
      mirrorStopRequested = false;
      sessionRecovery.sessionStarted(options || {});
    }
    return res;
  } catch (err: any) {
    appLog('ERROR', 'Error starting mirroring', err?.message || err);
    return { success: false, message: err?.message || 'Failed to start mirroring process' };
  }
});

ipcMain.handle('stop-mirroring', () => {
  try {
    // A user stop is final: it cancels any recovery and is never restored.
    mirrorStopRequested = true;
    sessionRecovery.userStopped();
    return scrcpyManager.stopMirroring();
  } catch (err: any) {
    appLog('ERROR', 'Error stopping mirroring', err?.message || err);
    return { success: false, message: err?.message || 'Failed to stop mirroring' };
  }
});

ipcMain.handle('get-session-recovery-status', () => sessionRecovery.getStatus());

// Device profiles: validated and stored by SettingsStore; the renderer only ever receives sanitized profiles.
ipcMain.handle('profiles-list', () => settingsStore.listProfiles());

ipcMain.handle('profile-save', (_, payload) => {
  const res = settingsStore.saveProfile({
    id: payload?.id,
    name: payload?.name,
    deviceSerial: payload?.deviceSerial,
    deviceLabel: payload?.deviceLabel,
    settings: payload?.settings
  });
  appLog(res.success ? 'INFO' : 'WARN', res.success ? 'Device profile saved' : 'Device profile rejected', res.success ? undefined : res.message);
  return res;
});

ipcMain.handle('profile-delete', (_, payload) => {
  const res = settingsStore.deleteProfile(payload?.id);
  if (res.success) appLog('INFO', 'Device profile deleted');
  return res;
});

// Clipboard: paste the PC clipboard on the phone through scrcpy (MOD+v). The text itself is never logged.
const MAX_CLIPBOARD_CHARS = 100_000;
ipcMain.handle('mirror-paste-clipboard', async (_, payload) => {
  try {
    const serial = payload?.serial;
    const status = scrcpyManager.getStatus();
    if (!status.running) return { success: false, message: 'Start mirroring first.' };
    if (typeof serial !== 'string' || (status as any).targetSerial !== serial) {
      return { success: false, message: 'Mirroring is running for a different phone. Select that phone first.' };
    }
    let text = '';
    try {
      text = clipboard.readText();
    } catch {
      return { success: false, message: 'Could not read the PC clipboard.' };
    }
    if (!text) return { success: false, message: 'Your PC clipboard has no text to send.' };
    if (text.length > MAX_CLIPBOARD_CHARS) {
      return { success: false, message: `The clipboard text is too long (${text.length.toLocaleString()} characters; up to ${MAX_CLIPBOARD_CHARS.toLocaleString()}).` };
    }
    const res = await scrcpyManager.sendClipboardToDevice();
    appLog(res.success ? 'INFO' : 'WARN', 'Clipboard sent to phone', { chars: text.length, pasted: res.pasted, success: res.success });
    return res;
  } catch (err: any) {
    return { success: false, message: err?.message || 'Clipboard paste failed' };
  }
});

ipcMain.handle('cancel-session-recovery', () => {
  sessionRecovery.cancel();
  return sessionRecovery.getStatus();
});

ipcMain.handle('resume-session', (_, payload) => {
  const serial = payload?.serial;
  if (typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
    return { success: false, message: 'Select a device first.' };
  }
  mirrorStopRequested = false;
  return sessionRecovery.resume(serial);
});

ipcMain.handle('get-mirror-status', () => {
  try {
    return scrcpyManager.getStatus();
  } catch (err: any) {
    return { running: false, error: err?.message || 'Unknown status' };
  }
});

ipcMain.handle('focus-mirror-window', async () => {
  try {
    return await scrcpyManager.focusMirrorWindow();
  } catch (err: any) {
    appLog('ERROR', 'Error focusing mirror window', err?.message || err);
    return { success: false, message: err?.message || 'Failed to focus mirror window' };
  }
});

// Scrcpy Screen Mirroring Event Listeners
scrcpyManager.on('started', (data) => {
  appLog('INFO', `Screen mirroring started [PID: ${data.pid}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('mirror-status-changed', { running: true, pid: data.pid, serial: data.serial });
});

scrcpyManager.on('statusChanged', (status) => {
  mainWindow?.webContents.send('mirror-status-changed', status);
});

scrcpyManager.on('inputBlocked', (data) => {
  appLog('WARN', `Input injection restricted by device security: ${data.message} for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('mirror-status-changed', scrcpyManager.getStatus());
});

scrcpyManager.on('stopped', (data) => {
  // scrcpy exit codes: 0 = window closed / normal stop, 1 = failure, 2 = device disconnected.
  const reason = mirrorStopRequested ? 'user_stopped' : data.code === 0 ? 'window_closed' : data.code === 2 ? 'disconnected' : 'failed';
  mirrorStopRequested = false;
  appLog('INFO', `Screen mirroring stopped [Code: ${data.code}, Reason: ${reason}] for ${SecurityValidator.redactSerial(data.serial)}`);
  if (reason !== 'user_stopped') sessionRecovery.sessionExited(data.code, data.serial);
  mainWindow?.webContents.send('mirror-status-changed', {
    running: false,
    code: data.code,
    serial: data.serial,
    reason,
    // Only a real failure carries an error line; a normal stop's last stderr line is not an error.
    lastError: reason === 'failed' ? scrcpyManager.getStatus().lastError : undefined
  });
});

scrcpyManager.on('disconnected', (data) => {
  // The 'stopped' event (code 2) already reports this to the UI and starts recovery; log only.
  appLog('WARN', `Screen mirroring device disconnected: ${SecurityValidator.redactSerial(data.serial)}`);
});

// Camera Studio Event Listeners & IPC Handlers
cameraManager.on('started', (data) => {
  appLog('INFO', `Camera streaming started [PID: ${data.pid}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', cameraManager.getStatus());
});

cameraManager.on('stopped', (data) => {
  appLog('INFO', `Camera streaming stopped [Code: ${data.code}, Reason: ${data.exitReason || 'user_stopped'}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', cameraManager.getStatus());
});

cameraManager.on('disconnected', (data) => {
  appLog('WARN', `Camera device disconnected: ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', cameraManager.getStatus());
});

cameraManager.on('interrupted', (data) => {
  appLog('WARN', `Camera streaming interrupted: ${data.message} for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', cameraManager.getStatus());
});

ipcMain.handle('query-camera-capabilities', async (_, payload) => {
  try {
    const serial = payload?.serial;
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return {
        transportSupported: false,
        deviceSupported: false,
        cameras: [],
        liveZoomSupported: false,
        liveTorchSupported: false,
        recordingSupported: false,
        snapshotsSupported: false,
        notes: ['Invalid device serial provided.']
      };
    }
    return await cameraManager.queryCapabilities(serial);
  } catch (err: any) {
    appLog('ERROR', 'Error querying camera capabilities', err?.message || err);
    return {
      transportSupported: false,
      deviceSupported: false,
      cameras: [],
      liveZoomSupported: false,
      liveTorchSupported: false,
      recordingSupported: false,
      snapshotsSupported: false,
      notes: [`Capability query failed: ${err?.message || err}`]
    };
  }
});

ipcMain.handle('start-camera', (_, options) => {
  try {
    if (!fs.existsSync(scrcpyPath)) {
      return { success: false, message: `scrcpy executable not found at: ${scrcpyPath}` };
    }
    const opts = options || {};
    const targetSerial = opts.serial;
    if (companionCameraActive) {
      appLog('INFO', 'Stopping companion camera before starting scrcpy Camera Studio');
      companionCameraActive = false;
      companionClient.stopCamera().catch(() => undefined);
    }
    // Concurrency coordination: Stop conflicting Screen Mirroring session on device before starting camera
    const mirrorStatus = scrcpyManager.getStatus();
    if (mirrorStatus.running && (!targetSerial || mirrorStatus.targetSerial === targetSerial)) {
      appLog('INFO', `Stopping conflicting Screen Mirroring session on ${targetSerial || 'default'} before starting camera`);
      scrcpyManager.stopMirroring();
    }
    // Auto-resolve recording folder if requested
    if (opts.record && !opts.recordPath) {
      const capturesFolder = getCapturesFolder();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      opts.recordPath = path.join(capturesFolder, `camera_${opts.serial || 'rec'}_${timestamp}.mp4`);
    }
    return cameraManager.startCamera(opts);
  } catch (err: any) {
    appLog('ERROR', 'Error starting camera session', err?.message || err);
    return { success: false, message: err?.message || 'Failed to start camera session' };
  }
});

ipcMain.handle('stop-camera', () => {
  try {
    return cameraManager.stopCamera();
  } catch (err: any) {
    appLog('ERROR', 'Error stopping camera session', err?.message || err);
    return { success: false, message: err?.message || 'Failed to stop camera session' };
  }
});

ipcMain.handle('reconnect-camera', async () => {
  try {
    const mirrorStatus = scrcpyManager.getStatus();
    if (mirrorStatus.running) {
      appLog('INFO', 'Stopping conflicting Screen Mirroring session before reconnecting camera');
      scrcpyManager.stopMirroring();
    }
    return await cameraManager.reconnectCamera();
  } catch (err: any) {
    appLog('ERROR', 'Error reconnecting camera session', err?.message || err);
    return { success: false, message: err?.message || 'Failed to reconnect camera session' };
  }
});

ipcMain.handle('get-camera-status', () => {
  try {
    return cameraManager.getStatus();
  } catch (err: any) {
    return { running: false, error: err?.message || 'Unknown camera status' };
  }
});

ipcMain.handle('send-camera-zoom', async (_, payload) => {
  try {
    const direction = payload?.direction;
    if (direction !== 'in' && direction !== 'out') {
      return { success: false, message: 'Invalid zoom direction (must be "in" or "out")' };
    }
    return await cameraManager.sendLiveZoom(direction);
  } catch (err: any) {
    appLog('ERROR', 'Error dispatching camera zoom', err?.message || err);
    return { success: false, message: err?.message || 'Zoom command failed' };
  }
});

ipcMain.handle('send-camera-torch', async (_, payload) => {
  try {
    const state = payload?.state;
    if (state !== 'on' && state !== 'off') {
      return { success: false, message: 'Invalid torch state (must be "on" or "off")' };
    }
    return await cameraManager.sendLiveTorch(state);
  } catch (err: any) {
    appLog('ERROR', 'Error dispatching camera torch', err?.message || err);
    return { success: false, message: err?.message || 'Torch command failed' };
  }
});

ipcMain.handle('focus-camera-window', async () => {
  try {
    return await cameraManager.focusCameraWindow();
  } catch (err: any) {
    appLog('ERROR', 'Error focusing camera window', err?.message || err);
    return { success: false, message: err?.message || 'Failed to focus camera window' };
  }
});

ipcMain.handle('handoff-wifi', async (_, payload) => {
  try {
    const serial = payload?.serial;
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid device serial provided' };
    }
    return await connectionManager.handoffUsbToWifi(serial);
  } catch (err: any) {
    appLog('ERROR', 'Error in wifi handoff', err?.message || err);
    return { success: false, error: err?.message || 'Wireless handoff failed' };
  }
});

ipcMain.handle('connect-wireless', async (_, payload) => {
  try {
    const { ip, port } = payload || {};
    if (!ip || typeof ip !== 'string' || !SecurityValidator.isValidIPv4(ip)) {
      return { success: false, error: 'Invalid IPv4 address provided' };
    }
    const numPort = typeof port === 'number' ? port : parseInt(String(port), 10);
    if (!SecurityValidator.isValidPort(numPort)) {
      return { success: false, error: 'Invalid port number (must be 1-65535)' };
    }
    return await connectionManager.connectWireless(ip, numPort);
  } catch (err: any) {
    appLog('ERROR', 'Error connecting wireless', err?.message || err);
    return { success: false, error: err?.message || 'Wireless connection failed' };
  }
});

ipcMain.handle('disconnect-device', async (_, payload) => {
  try {
    const serial = payload?.serial;
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid device serial provided' };
    }
    return await connectionManager.disconnect(serial);
  } catch (err: any) {
    appLog('ERROR', 'Error disconnecting device', err?.message || err);
    return { success: false, error: err?.message || 'Disconnect failed' };
  }
});

ipcMain.handle('pair-wireless', async (_, payload) => {
  try {
    const { ip, pairPort, pin, connectPort } = payload || {};
    if (!ip || !SecurityValidator.isValidIPv4(ip)) {
      return { success: false, error: 'Invalid IP address provided' };
    }
    const numPairPort = typeof pairPort === 'number' ? pairPort : parseInt(String(pairPort), 10);
    if (!SecurityValidator.isValidPort(numPairPort)) {
      return { success: false, error: 'Invalid pairing port (must be 1-65535)' };
    }
    if (!pin || typeof pin !== 'string' || !SecurityValidator.isValidPairingCode(pin)) {
      return { success: false, error: 'Invalid 6-digit PIN' };
    }
    const numConnectPort = connectPort ? (typeof connectPort === 'number' ? connectPort : parseInt(String(connectPort), 10)) : undefined;
    return await connectionManager.pairWireless(ip, numPairPort, pin, numConnectPort);
  } catch (err: any) {
    appLog('ERROR', 'Error pairing wireless', err?.message || err);
    return { success: false, error: err?.message || 'Pairing failed' };
  }
});

// Smart discovery & connection help ---------------------------------------------------------------
// Discovery is read-only. Connect/pair require an endpoint handle from a recent discovery plus a native
// confirmation dialog owned by the main process, so a compromised renderer cannot connect on its own.
// None of these channels touch MCP sessions or permissions.
let wirelessDiscovery: WirelessDiscovery | null = null;
function getWirelessDiscovery(): WirelessDiscovery {
  if (!wirelessDiscovery) wirelessDiscovery = new WirelessDiscovery(deviceManager, connectionManager);
  return wirelessDiscovery;
}

async function confirmWirelessAction(details: { action: 'connect' | 'pair'; label: string; ip: string; port: number }): Promise<boolean> {
  const verb = details.action === 'pair' ? 'Pair with' : 'Connect to';
  const options = {
    type: 'question' as const,
    buttons: ['Cancel', verb],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirm wireless debugging action',
    message: `${verb} ${details.ip}:${details.port}?`,
    detail: `Device: ${details.label}\nOnly continue if this is your own phone on your local network.`
  };
  const res = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
  return res.response === 1;
}

ipcMain.handle('discover-wireless-devices', async () => {
  try {
    const result = await getWirelessDiscovery().discover();
    appLog('INFO', 'Wireless discovery finished', { supported: result.supported, endpoints: result.endpoints.length, timedOut: result.timedOut, cancelled: result.cancelled });
    return result;
  } catch (err: any) {
    appLog('ERROR', 'Wireless discovery failed', err?.message || err);
    return { success: false, supported: false, cancelled: false, timedOut: false, endpoints: [], ignoredCount: 0, message: 'Wireless discovery failed unexpectedly.', fallback: [] };
  }
});

ipcMain.handle('cancel-wireless-discovery', () => {
  getWirelessDiscovery().cancel();
  return true;
});

ipcMain.handle('connect-discovered-device', async (_, payload) => {
  const parsed = parseConnectRequest(payload);
  if (!parsed.ok) return { success: false, message: parsed.message };
  try {
    const res = await getWirelessDiscovery().connect(parsed.endpointId, confirmWirelessAction);
    appLog('INFO', 'Discovered-device connect attempt', { success: res.success, cancelled: !!res.cancelled });
    return res;
  } catch (err: any) {
    appLog('ERROR', 'Discovered-device connect failed', err?.message || err);
    return { success: false, message: 'Connection failed unexpectedly.' };
  }
});

ipcMain.handle('pair-discovered-device', async (_, payload) => {
  const parsed = parsePairRequest(payload);
  if (!parsed.ok) return { success: false, message: parsed.message };
  try {
    // The pairing code is deliberately excluded from every log line.
    const res = await getWirelessDiscovery().pair(parsed.endpointId, parsed.pin, confirmWirelessAction);
    appLog('INFO', 'Discovered-device pairing attempt', { success: res.success, cancelled: !!res.cancelled });
    return res;
  } catch (err: any) {
    appLog('ERROR', 'Discovered-device pairing failed', err?.message || err);
    return { success: false, message: 'Pairing failed unexpectedly.' };
  }
});

ipcMain.handle('get-device-help', async (_, payload) => {
  const parsed = parseDeviceHelpRequest(payload);
  if (!parsed.ok) return { key: 'invalid', connection: null, vendor: [], error: parsed.message };
  try {
    const devices = await deviceManager.getDevicesDetailed();
    const device = devices.find(d => d.serial === parsed.serial);
    return buildDeviceHelp(device);
  } catch (err: any) {
    appLog('ERROR', 'Error building device help', err?.message || err);
    return { key: 'error', connection: null, vendor: [] };
  }
});

ipcMain.handle('detect-hotspot', () => {
  try {
    return connectionManager.detectHotspotGateway();
  } catch (err: any) {
    appLog('ERROR', 'Error detecting hotspot', err?.message || err);
    return null;
  }
});

ipcMain.handle('capture-screenshot', async (_, payload) => {
  try {
    const serial = payload?.serial;
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid or missing device serial' };
    }
    const capturesFolder = getCapturesFolder();
    return await diagnosticsManager.captureDeviceScreenshot(serial, capturesFolder);
  } catch (err: any) {
    appLog('ERROR', 'Error capturing screenshot', err?.message || err);
    return { success: false, error: err?.message || 'Screenshot capture failed' };
  }
});

ipcMain.handle('get-captures', () => {
  try {
    const capturesFolder = getCapturesFolder();
    return diagnosticsManager.getExistingCaptures(capturesFolder);
  } catch (err: any) {
    appLog('ERROR', 'Error retrieving captures list', err?.message || err);
    return [];
  }
});

// Local document intelligence (Phase 11) -------------------------------------------------------------
// Images are chosen through a native dialog or from the captures folder; the renderer only ever holds an opaque
// session id. OCR runs in a worker thread inside tesseract.js, entirely offline. Originals are never modified.
const documentWorkflow = new DocumentWorkflow(new TesseractOcrEngine());
const documentSessions = new Map<string, { session: DocumentSession; abort: AbortController | null }>();
const MAX_DOCUMENT_SESSIONS = 4;

function registerDocumentSession(session: DocumentSession) {
  documentSessions.set(session.id, { session, abort: null });
  while (documentSessions.size > MAX_DOCUMENT_SESSIONS) {
    const oldest = documentSessions.keys().next().value as string;
    documentSessions.get(oldest)?.abort?.abort();
    documentSessions.delete(oldest);
  }
}

function summarizeDocument(session: DocumentSession) {
  return {
    id: session.id,
    sourceName: session.sourceName,
    format: session.format,
    width: session.original.width,
    height: session.original.height,
    hasProcessed: !!session.processed,
    hasOcr: !!session.ocr
  };
}

function documentsFolder(): string {
  return path.join(getCapturesFolder(), 'documents');
}

function describeOcr(session: DocumentSession) {
  const o = session.ocr;
  return o
    ? {
        text: documentWorkflow.getText(session),
        rawText: o.text,
        meanConfidence: o.meanConfidence,
        wordCount: o.words.length,
        lowConfidenceWords: o.lowConfidenceWords,
        lowConfidenceSample: o.words.filter(w => w.confidence < 60).slice(0, 40).map(w => ({ text: w.text, confidence: Math.round(w.confidence) })),
        engine: o.engine,
        language: o.language,
        durationMs: o.durationMs
      }
    : null;
}

async function importIntoWorkflow(load: () => DocumentSession) {
  const session = load();
  registerDocumentSession(session);
  const analysis = documentWorkflow.analyze(session);
  return {
    ok: true as const,
    document: summarizeDocument(session),
    preview: analysis.preview,
    corners: analysis.detection.corners,
    detectionReason: analysis.detection.reason ?? null,
    detectionConfidence: analysis.detection.confidence,
    skewDegrees: analysis.skewDegrees
  };
}

ipcMain.handle('document-ocr-status', async () => {
  const a = await new TesseractOcrEngine().isAvailable();
  return { available: a.available, reason: a.reason ?? null };
});

ipcMain.handle('document-import-dialog', async () => {
  try {
    const options = {
      title: 'Choose a document image',
      properties: ['openFile' as const],
      filters: [{ name: 'Images (PNG, JPEG)', extensions: ['png', 'jpg', 'jpeg'] }]
    };
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (res.canceled || res.filePaths.length === 0) return { ok: false, code: 'CANCELLED', message: 'No file was selected.' };
    return await importIntoWorkflow(() => documentWorkflow.importFile(res.filePaths[0]));
  } catch (err: any) {
    appLog('ERROR', 'Document import failed', err?.message || err);
    return toErrorPayload(err);
  }
});

ipcMain.handle('document-import-capture', async (_, payload) => {
  const parsed = parseCaptureName(payload);
  if (!parsed.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: parsed.message };
  try {
    const file = path.join(getCapturesFolder(), parsed.fileName);
    return await importIntoWorkflow(() => documentWorkflow.importFile(file));
  } catch (err: any) {
    appLog('ERROR', 'Document import from captures failed', err?.message || err);
    return toErrorPayload(err);
  }
});

ipcMain.handle('document-process', async (_, payload) => {
  const parsed = parseProcessRequest(payload);
  if (!parsed.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: parsed.message };
  const entry = documentSessions.get(parsed.value.id);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That document is no longer open. Import it again.' };
  try {
    const { corners, rotationQuarterTurns, rotationDegrees, enhance } = parsed.value;
    const out = documentWorkflow.process(entry.session, { corners, rotationQuarterTurns, rotationDegrees, enhance });
    return { ok: true, document: summarizeDocument(entry.session), preview: out.preview };
  } catch (err: any) {
    return toErrorPayload(err);
  }
});

ipcMain.handle('document-ocr', async (event, payload) => {
  const parsed = parseSessionRequest(payload);
  if (!parsed.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: parsed.message };
  const entry = documentSessions.get(parsed.id);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That document is no longer open. Import it again.' };
  if (entry.abort) return { ok: false, code: 'INVALID_ARGUMENT', message: 'OCR is already running for this document.' };
  const controller = new AbortController();
  entry.abort = controller;
  try {
    await documentWorkflow.recognize(entry.session, {
      signal: controller.signal,
      onProgress: p => {
        if (!event.sender.isDestroyed()) event.sender.send('document-ocr-progress', { id: parsed.id, stage: p.stage, progress: p.progress });
      }
    });
    appLog('INFO', 'Document OCR finished', { words: entry.session.ocr?.words.length ?? 0 });
    return { ok: true, result: describeOcr(entry.session) };
  } catch (err: any) {
    if (!(err instanceof DocumentError && err.code === 'CANCELLED')) appLog('ERROR', 'Document OCR failed', err?.message || err);
    return toErrorPayload(err);
  } finally {
    entry.abort = null;
  }
});

ipcMain.handle('document-ocr-cancel', (_, payload) => {
  const parsed = parseSessionRequest(payload);
  if (!parsed.ok) return false;
  documentSessions.get(parsed.id)?.abort?.abort();
  return true;
});

ipcMain.handle('document-set-text', (_, payload) => {
  const parsed = parseTextRequest(payload);
  if (!parsed.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: parsed.message };
  const entry = documentSessions.get(parsed.id);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That document is no longer open.' };
  documentWorkflow.setText(entry.session, parsed.text);
  return { ok: true };
});

ipcMain.handle('document-save', (_, payload) => {
  const parsed = parseSessionRequest(payload);
  if (!parsed.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: parsed.message };
  const entry = documentSessions.get(parsed.id);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That document is no longer open.' };
  try {
    const saved = documentWorkflow.save(entry.session, documentsFolder());
    return { ok: true, directory: saved.directory };
  } catch (err: any) {
    appLog('ERROR', 'Document save failed', err?.message || err);
    return toErrorPayload(err);
  }
});

ipcMain.handle('document-export-pdf', (_, payload) => {
  const parsed = parseSessionRequest(payload);
  if (!parsed.ok) return { ok: false, code: 'INVALID_ARGUMENT', message: parsed.message };
  const entry = documentSessions.get(parsed.id);
  if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That document is no longer open.' };
  try {
    const exported = documentWorkflow.exportSearchablePdf(entry.session, documentsFolder());
    return { ok: true, path: exported.path, directory: path.dirname(exported.path), textSource: exported.textSource, insertedWords: exported.insertedWords, removedWords: exported.removedWords, replacedWords: exported.replacedWords };
  } catch (err: any) {
    return toErrorPayload(err);
  }
});

ipcMain.handle('document-release', (_, payload) => {
  const parsed = parseSessionRequest(payload);
  if (!parsed.ok) return false;
  documentSessions.get(parsed.id)?.abort?.abort();
  documentSessions.delete(parsed.id);
  return true;
});

ipcMain.handle('open-path', async (_, targetPath: string) => {
  try {
    const capturesFolder = getCapturesFolder();
    if (typeof targetPath === 'string' && (targetPath.startsWith(capturesFolder) || targetPath === logFile)) {
      const { shell } = require('electron');
      await shell.openPath(targetPath);
      return true;
    }
    return false;
  } catch (err: any) {
    appLog('ERROR', 'Error opening path: ' + targetPath, err?.message || err);
    return false;
  }
});

ipcMain.handle('open-external', async (_, url: string) => {
  try {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      const { shell } = require('electron');
      await shell.openExternal(url);
      return true;
    }
    return false;
  } catch (err: any) {
    appLog('ERROR', 'Error opening external URL: ' + url, err?.message || err);
    return false;
  }
});

ipcMain.handle('get-recent-logs', async (_, payload) => {
  try {
    const serial = payload?.serial;
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return [];
    }
    return await diagnosticsManager.getRecentLogs(serial, 250);
  } catch (err: any) {
    appLog('ERROR', 'Error fetching recent logs', err?.message || err);
    return [];
  }
});

ipcMain.handle('get-system-info', async () => {
  try {
    const adbVersion = await deviceManager.getAdbVersion();
    const scrcpyVersion = await scrcpyManager.getScrcpyVersion();
    const mirrorStatus = scrcpyManager.getStatus();
    const devices = await deviceManager.getDevices();

    let recentAppLogs: string[] = [];
    try {
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        recentAppLogs = content.trim().split('\n').slice(-25);
      }
    } catch {
      // ignore
    }

    return {
      adbPath,
      adbVersion,
      scrcpyPath,
      scrcpyVersion,
      deviceCount: devices.length,
      mirrorStatus,
      platform: `${process.platform} (${process.arch})`,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      logFile,
      recentAppLogs
    };
  } catch (err: any) {
    appLog('ERROR', 'Error retrieving system info', err?.message || err);
    return { error: err?.message || 'Failed to retrieve system information' };
  }
});

ipcMain.handle('get-diagnostic-report', async (_, payload) => {
  try {
    const serial = payload?.serial;
    const status = scrcpyManager.getStatus();
    return await diagnosticsManager.generateDiagnosticBundle(serial, status);
  } catch (err: any) {
    appLog('ERROR', 'Error generating diagnostic report', err?.message || err);
    return `Failed to generate diagnostic report: ${err?.message || err}`;
  }
});

ipcMain.handle('export-diagnostics', async (_, payload) => {
  try {
    const serial = payload?.serial;
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid or missing device serial' };
    }
    const capturesFolder = getCapturesFolder();
    const status = scrcpyManager.getStatus();
    return await diagnosticsManager.exportDiagnosticReport(serial, capturesFolder, status);
  } catch (err: any) {
    appLog('ERROR', 'Error exporting diagnostics', err?.message || err);
    return { success: false, error: err?.message || 'Diagnostics export failed' };
  }
});

ipcMain.handle('execute-workflow', async (_, payload) => {
  try {
    const { serial, workflow } = payload || {};
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      return { success: false, error: 'Invalid or missing device serial' };
    }
    if (!workflow || typeof workflow !== 'object') {
      return { success: false, error: 'Invalid or missing workflow definition' };
    }
    const capturesFolder = getCapturesFolder();
    return await workflowEngine.executeWorkflow(serial, workflow, capturesFolder);
  } catch (err: any) {
    appLog('ERROR', 'Error executing workflow', err?.message || err);
    return { success: false, error: err?.message || 'Workflow execution failed' };
  }
});

ipcMain.handle('cancel-workflow', () => {
  try {
    workflowEngine.cancel();
    return { success: true };
  } catch (err: any) {
    appLog('ERROR', 'Error cancelling workflow', err?.message || err);
    return { success: false, error: err?.message || 'Failed to cancel workflow' };
  }
});

ipcMain.handle('execute-adb', async (_, args) => {
  try {
    return await deviceManager.executeAdb(args);
  } catch (err: any) {
    appLog('ERROR', 'Error executing ADB command', err?.message || err);
    return { exitCode: -1, stdout: '', stderr: err?.message || 'ADB execution failed' };
  }
});

// MCP Named Pipe Control Bridge Handlers
const mcpControlServer = new McpControlServer();

mcpControlServer.on('pairingRequested', (req) => {
  appLog('INFO', `Incoming MCP Pairing Request for client '${req.clientName}' (Tier ${req.requestedTier})`);
  mainWindow?.webContents.send('mcp-pairing-requested', req);
});

mcpControlServer.on('sessionCreated', (session) => {
  appLog('INFO', `MCP Session created for '${session.clientName}' [SessionId: ${session.sessionId}]`);
  mainWindow?.webContents.send('mcp-status-changed');
});

mcpControlServer.on('sessionRevoked', (sessionId) => {
  appLog('INFO', `MCP Session revoked: ${sessionId}`);
  mainWindow?.webContents.send('mcp-status-changed');
});

mcpControlServer.on('allSessionsRevoked', () => {
  appLog('WARN', 'Emergency Kill Switch: All MCP AI Sessions Revoked');
  mainWindow?.webContents.send('mcp-sessions-revoked');
  mainWindow?.webContents.send('mcp-status-changed');
});

mcpControlServer.on('clientConnected', (count) => {
  appLog('INFO', `MCP Client connected via Named Pipe. Active clients: ${count}`);
  mainWindow?.webContents.send('mcp-status-changed');
});

mcpControlServer.on('clientDisconnected', (count) => {
  appLog('INFO', `MCP Client disconnected. Active clients: ${count}`);
  mainWindow?.webContents.send('mcp-status-changed');
});

mcpControlServer.on('actionAudit', (audit) => {
  appLog('INFO', `MCP Action [${audit.action}] by '${audit.clientName}' on ${SecurityValidator.redactSerial(audit.serial)}: ${audit.status}`);
  mainWindow?.webContents.send('mcp-action-audit', audit);
  mainWindow?.webContents.send('mcp-status-changed');
});

ipcMain.handle('get-mcp-status', () => {
  try {
    return mcpControlServer.getStatus();
  } catch (err: any) {
    appLog('ERROR', 'Error querying MCP status', err?.message || err);
    return { connectedMcpProcesses: 0, pendingRequests: [], activeSessions: [] };
  }
});

ipcMain.handle('approve-mcp-pairing', (_, payload) => {
  try {
    const requestId = payload?.requestId;
    if (!requestId || typeof requestId !== 'string') return false;
    appLog('INFO', `User clicked Approve for MCP Request: ${requestId}`);
    return mcpControlServer.approveRequest(requestId);
  } catch (err: any) {
    appLog('ERROR', 'Error approving MCP request', err?.message || err);
    return false;
  }
});

ipcMain.handle('deny-mcp-pairing', (_, payload) => {
  try {
    const requestId = payload?.requestId;
    if (!requestId || typeof requestId !== 'string') return false;
    appLog('INFO', `User clicked Deny for MCP Request: ${requestId}`);
    return mcpControlServer.denyRequest(requestId);
  } catch (err: any) {
    appLog('ERROR', 'Error denying MCP request', err?.message || err);
    return false;
  }
});

ipcMain.handle('revoke-mcp-session', (_, payload) => {
  try {
    const sessionId = payload?.sessionId;
    if (!sessionId || typeof sessionId !== 'string') return false;
    appLog('INFO', `User revoked MCP session: ${sessionId}`);
    return mcpControlServer.revokeSession(sessionId);
  } catch (err: any) {
    appLog('ERROR', 'Error revoking MCP session', err?.message || err);
    return false;
  }
});

ipcMain.handle('revoke-all-mcp-sessions', () => {
  try {
    appLog('WARN', 'User triggered Revoke All AI Sessions');
    mcpControlServer.revokeAllSessions();
    return true;
  } catch (err: any) {
    appLog('ERROR', 'Error during emergency revocation', err?.message || err);
    return false;
  }
});

// Camera Studio Companion App IPC Handlers
// The companion is reached only through `adb forward tcp:0 localabstract:androscrn_companion`, set up by
// CompanionManager.prepare(). Every handler validates its payload; none accepts a URL or command from the renderer.
const COMPANION_NOT_CONNECTED = { success: false, error: 'Companion is not connected. Use "Connect companion" first.' };

ipcMain.handle('companion-prepare', async (_, payload) => {
  try {
    const serial = payload?.serial;
    const allowInstall = payload?.allowInstall === true;
    appLog('INFO', 'Preparing companion app', { install: allowInstall });
    const res = await companionManager.prepare(serial, allowInstall);
    appLog(res.success ? 'INFO' : 'WARN', `Companion prepare: ${res.stage}`, { code: res.code, message: res.message });
    return res;
  } catch (err: any) {
    appLog('ERROR', 'Companion prepare failed', err?.message || err);
    return { success: false, stage: 'failed', code: 'internal', message: err?.message || 'Companion preparation failed' };
  }
});

ipcMain.handle('companion-get-bundle-info', () => {
  const apk = companionManager.getBundledApk();
  return apk ? { available: true, versionName: apk.versionName, versionCode: apk.versionCode, protocolVersion: apk.protocolVersion } : { available: false };
});

ipcMain.handle('companion-get-status', async () => {
  try {
    return await companionClient.getStatus();
  } catch (err: any) {
    return { status: 'offline', error: err?.message || 'Companion offline' };
  }
});

ipcMain.handle('companion-request-pairing', async () => {
  try {
    return await companionClient.requestPairingChallenge();
  } catch (err: any) {
    return { success: false, message: err?.message || 'Pairing request failed' };
  }
});

ipcMain.handle('companion-submit-pin', async (_, payload) => {
  try {
    const pin = payload?.pin;
    if (!pin || typeof pin !== 'string') {
      return { success: false, error: 'Invalid PIN' };
    }
    return await companionClient.submitPairingPin(pin);
  } catch (err: any) {
    return { success: false, error: err?.message || 'PIN validation failed' };
  }
});

ipcMain.handle('companion-get-capabilities', async () => {
  try {
    return await companionClient.getCapabilities();
  } catch (err: any) {
    return { snapshotsSupported: false, inAppPreviewSupported: false, error: err?.message };
  }
});

ipcMain.handle('companion-start-camera', async (_, payload) => {
  try {
    if (!companionClient.getBaseUrl() || !companionClient.getSessionToken()) return COMPANION_NOT_CONNECTED;
    const facing = payload?.facing;
    const cameraId = payload?.cameraId;
    if (facing !== undefined && facing !== 'front' && facing !== 'back') return { success: false, error: 'Invalid camera facing' };
    if (cameraId !== undefined && (typeof cameraId !== 'string' || !/^[A-Za-z0-9_.:-]{1,32}$/.test(cameraId))) {
      return { success: false, error: 'Invalid camera id' };
    }
    // One camera owner per phone: a scrcpy Camera Studio session would hold the camera and block the companion.
    const active = companionManager.getActive();
    const camStatus = cameraManager.getStatus();
    if (camStatus.running && (!camStatus.targetSerial || camStatus.targetSerial === active.serial)) {
      appLog('INFO', 'Stopping scrcpy Camera Studio session before starting the companion camera');
      cameraManager.stopCamera();
      await new Promise((r) => setTimeout(r, 1500));
    }
    const res = await companionClient.startCamera(facing, cameraId);
    companionCameraActive = !!res.success;
    return { ...res, streamUrl: res.success ? companionClient.getStreamUrl() : '' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not start the companion camera' };
  }
});

ipcMain.handle('companion-stop-camera', async () => {
  companionCameraActive = false;
  if (!companionClient.getBaseUrl() || !companionClient.getSessionToken()) return { success: true };
  return await companionClient.stopCamera();
});

ipcMain.handle('companion-set-camera', async (_, payload) => {
  const facing = payload?.facing;
  if (facing !== 'front' && facing !== 'back') {
    return { success: false, error: 'Invalid camera facing (must be "front" or "back")' };
  }
  try {
    return await companionClient.setCamera(facing);
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not switch camera' };
  }
});

ipcMain.handle('companion-set-zoom', async (_, payload) => {
  const ratio = payload?.ratio;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return { success: false, error: 'Invalid zoom ratio' };
  try {
    return await companionClient.setZoom(ratio);
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not set zoom' };
  }
});

ipcMain.handle('companion-set-torch', async (_, payload) => {
  const enabled = payload?.enabled;
  if (typeof enabled !== 'boolean') return { success: false, error: 'Invalid torch state' };
  try {
    return await companionClient.setTorch(enabled);
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not toggle torch' };
  }
});

ipcMain.handle('companion-take-photo', async () => {
  // Photos always go to the Captures folder; the renderer cannot choose an arbitrary destination.
  try {
    return await companionClient.takeAndSavePhoto(getCapturesFolder());
  } catch (err: any) {
    return { success: false, error: err?.message || 'Photo capture failed' };
  }
});

ipcMain.handle('companion-disconnect', async () => {
  companionCameraActive = false;
  return await companionManager.stop();
});

ipcMain.handle('companion-get-stream-url', () => {
  return companionClient.getStreamUrl();
});

// Lab & Inspection IPC Handlers (Phase 7.1)
ipcMain.handle('lab-generate-overlay-svg', (_, payload) => {
  const { width, height, config, metadata } = payload || {};
  if (typeof width !== 'number' || typeof height !== 'number' || !config) {
    return '<svg></svg>';
  }
  return generateSvgOverlay(width, height, config, metadata);
});

ipcMain.handle('lab-start-timelapse', async (_, payload) => {
  const config = payload || {};
  if (!config.intervalSeconds || !config.totalFrames) {
    return { success: false, error: 'Invalid timelapse configuration (missing intervalSeconds or totalFrames)' };
  }
  const saveDir = config.outputDir || path.join(getCapturesFolder(), `Timelapse_${Date.now()}`);
  return await timelapseScheduler.start({ ...config, outputDir: saveDir }, async (frameNum) => {
    const photoRes = await companionClient.takeAndSavePhoto(saveDir);
    if (photoRes.success && photoRes.filePath) {
      return photoRes.filePath;
    }
    throw new Error(photoRes.error || `Frame ${frameNum} capture failed`);
  });
});

ipcMain.handle('lab-stop-timelapse', () => {
  return timelapseScheduler.stop();
});

ipcMain.handle('lab-get-timelapse-status', () => {
  return timelapseScheduler.getStatus();
});

ipcMain.handle('lab-export-annotated-snapshot', async (_, payload) => {
  try {
    const { sourcePath, svgOverlay, metadata } = payload || {};
    if (!sourcePath || typeof sourcePath !== 'string' || !svgOverlay) {
      return { success: false, error: 'Invalid snapshot or overlay data' };
    }
    const ext = path.extname(sourcePath);
    const base = path.basename(sourcePath, ext);
    const dir = path.dirname(sourcePath);
    const annotatedSvgPath = path.join(dir, `${base}_annotated.svg`);
    const metaPath = path.join(dir, `${base}_metadata.json`);

    fs.writeFileSync(annotatedSvgPath, svgOverlay, 'utf8');
    fs.writeFileSync(metaPath, JSON.stringify(metadata || {}, null, 2), 'utf8');
    return { success: true, annotatedSvgPath, metaPath };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Export failed' };
  }
});


const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  appLog('INFO', 'Another instance of AndroScrn is already running. Focusing existing window and exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    mcpControlServer.start().then(() => {
      appLog('INFO', 'MCP Named Pipe Control Server listening on \\\\.\\pipe\\androscrn-mcp-control');
    }).catch((err: any) => {
      appLog('WARN', 'Failed to start MCP Named Pipe control server (standalone fallback active)', err?.message || err);
    });
  });
}

// app.quit() (and test harnesses) skip 'window-all-closed', so the companion is also released here, once.
let companionQuitCleanupDone = false;
app.on('before-quit', (event) => {
  if (companionQuitCleanupDone) return;
  companionQuitCleanupDone = true;
  event.preventDefault();
  Promise.race([companionManager.stop().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  let companionStopped: Promise<unknown> = Promise.resolve();
  try {
    scrcpyManager.stopMirroring();
    cameraManager.stopCamera();
    // Release the phone camera and remove the adb forward; bounded so a vanished phone cannot block quitting.
    companionStopped = Promise.race([companionManager.stop().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    timelapseScheduler.stop();
    mcpControlServer.stop().catch(() => {});
  } catch {
    // ignore
  }
  if (process.platform !== 'darwin') {
    companionStopped.finally(() => app.quit());
  }
});

