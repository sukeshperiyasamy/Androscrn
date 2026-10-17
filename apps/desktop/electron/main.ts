import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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
import { CompanionClient } from '../../../dist/modules/companion_client';
import { WirelessDiscovery, parseConnectRequest, parsePairRequest, parseDeviceHelpRequest } from '../../../dist/modules/wireless_discovery';
import { buildDeviceHelp } from '../../../dist/modules/oem_guidance';
import { DocumentWorkflow, TesseractOcrEngine, DocumentSession, DocumentError } from '../../../dist/modules/document_intelligence';
import { parseSessionRequest, parseProcessRequest, parseTextRequest, parseCaptureName, toErrorPayload } from '../../../dist/modules/document_intelligence/ipc';
import { generateSvgOverlay, TimelapseScheduler, createSnapshotMetadata } from '../../../dist/modules/lab_inspection';

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

const deviceManager = new DeviceManager(adbPath);
const connectionManager = new ConnectionManager(deviceManager);
const scrcpyManager = new ScrcpyManager(scrcpyPath);
const diagnosticsManager = new DiagnosticsManager(deviceManager);
const workflowEngine = new WorkflowEngine(deviceManager, diagnosticsManager);
const cameraManager = new CameraManager(scrcpyPath, deviceManager);
const companionClient = new CompanionClient(deviceManager);

cameraManager.on('statusChanged', (status) => {
  mainWindow?.webContents.send('camera-status-changed', status);
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
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#07090e',
    title: 'AndroScrn (Provisional Electron Distribution)',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true
    }
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

ipcMain.handle('set-alias', (_, { serial, alias }) => {
  try {
    deviceManager.setDeviceAlias(serial, alias);
    return true;
  } catch (err: any) {
    appLog('ERROR', 'Error setting alias', err?.message || err);
    return false;
  }
});

ipcMain.handle('start-mirroring', (_, options) => {
  try {
    if (!fs.existsSync(scrcpyPath)) {
      return { success: false, message: `scrcpy executable not found at: ${scrcpyPath}` };
    }
    return scrcpyManager.startMirroring(options);
  } catch (err: any) {
    appLog('ERROR', 'Error starting mirroring', err?.message || err);
    return { success: false, message: err?.message || 'Failed to start mirroring process' };
  }
});

ipcMain.handle('stop-mirroring', () => {
  try {
    return scrcpyManager.stopMirroring();
  } catch (err: any) {
    appLog('ERROR', 'Error stopping mirroring', err?.message || err);
    return { success: false, message: err?.message || 'Failed to stop mirroring' };
  }
});

ipcMain.handle('get-mirror-status', () => {
  try {
    return scrcpyManager.getStatus();
  } catch (err: any) {
    return { running: false, error: err?.message || 'Unknown status' };
  }
});

// Scrcpy Screen Mirroring Event Listeners
scrcpyManager.on('started', (data) => {
  appLog('INFO', `Screen mirroring started [PID: ${data.pid}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('mirror-status-changed', { running: true, pid: data.pid, serial: data.serial });
});

scrcpyManager.on('stopped', (data) => {
  appLog('INFO', `Screen mirroring stopped [Code: ${data.code}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('mirror-status-changed', {
    running: false,
    code: data.code,
    serial: data.serial,
    lastError: scrcpyManager.getStatus().lastError
  });
});

scrcpyManager.on('disconnected', (data) => {
  appLog('WARN', `Screen mirroring device disconnected: ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('mirror-status-changed', {
    running: false,
    code: 2,
    serial: data.serial,
    disconnected: true
  });
});

// Camera Studio Event Listeners & IPC Handlers
cameraManager.on('started', (data) => {
  appLog('INFO', `Camera streaming started [PID: ${data.pid}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', data);
});

cameraManager.on('stopped', (data) => {
  appLog('INFO', `Camera streaming stopped [Code: ${data.code}] for ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', data);
});

cameraManager.on('disconnected', (data) => {
  appLog('WARN', `Camera device disconnected: ${SecurityValidator.redactSerial(data.serial)}`);
  mainWindow?.webContents.send('camera-status-changed', data);
});

ipcMain.handle('query-camera-capabilities', async (_, { serial }) => {
  try {
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
    // Auto-resolve recording folder if requested
    if (options.record && !options.recordPath) {
      const capturesFolder = getCapturesFolder();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      options.recordPath = path.join(capturesFolder, `camera_${options.serial || 'rec'}_${timestamp}.mp4`);
    }
    return cameraManager.startCamera(options);
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

ipcMain.handle('get-camera-status', () => {
  try {
    return cameraManager.getStatus();
  } catch (err: any) {
    return { running: false, error: err?.message || 'Unknown camera status' };
  }
});

ipcMain.handle('send-camera-zoom', async (_, { direction }) => {
  try {
    return await cameraManager.sendLiveZoom(direction);
  } catch (err: any) {
    appLog('ERROR', 'Error dispatching camera zoom', err?.message || err);
    return { success: false, message: err?.message || 'Zoom command failed' };
  }
});

ipcMain.handle('send-camera-torch', async (_, { state }) => {
  try {
    return await cameraManager.sendLiveTorch(state);
  } catch (err: any) {
    appLog('ERROR', 'Error dispatching camera torch', err?.message || err);
    return { success: false, message: err?.message || 'Torch command failed' };
  }
});

ipcMain.handle('handoff-wifi', async (_, { serial }) => {
  try {
    return await connectionManager.handoffUsbToWifi(serial);
  } catch (err: any) {
    appLog('ERROR', 'Error in wifi handoff', err?.message || err);
    return { success: false, error: err?.message || 'Wireless handoff failed' };
  }
});

ipcMain.handle('connect-wireless', async (_, { ip, port }) => {
  try {
    return await connectionManager.connectWireless(ip, port);
  } catch (err: any) {
    appLog('ERROR', 'Error connecting wireless', err?.message || err);
    return { success: false, error: err?.message || 'Wireless connection failed' };
  }
});

ipcMain.handle('disconnect-device', async (_, { serial }) => {
  try {
    return await connectionManager.disconnect(serial);
  } catch (err: any) {
    appLog('ERROR', 'Error disconnecting device', err?.message || err);
    return { success: false, error: err?.message || 'Disconnect failed' };
  }
});

ipcMain.handle('pair-wireless', async (_, { ip, pairPort, pin, connectPort }) => {
  try {
    return await connectionManager.pairWireless(ip, pairPort, pin, connectPort);
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

ipcMain.handle('capture-screenshot', async (_, { serial }) => {
  try {
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
    const pdfPath = documentWorkflow.exportSearchablePdf(entry.session, documentsFolder());
    return { ok: true, path: pdfPath, directory: path.dirname(pdfPath) };
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

ipcMain.handle('get-recent-logs', async (_, { serial }) => {
  try {
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

ipcMain.handle('get-diagnostic-report', async (_, { serial } = {}) => {
  try {
    const status = scrcpyManager.getStatus();
    return await diagnosticsManager.generateDiagnosticBundle(serial, status);
  } catch (err: any) {
    appLog('ERROR', 'Error generating diagnostic report', err?.message || err);
    return `Failed to generate diagnostic report: ${err?.message || err}`;
  }
});

ipcMain.handle('export-diagnostics', async (_, { serial }) => {
  try {
    const capturesFolder = getCapturesFolder();
    const status = scrcpyManager.getStatus();
    return await diagnosticsManager.exportDiagnosticReport(serial, capturesFolder, status);
  } catch (err: any) {
    appLog('ERROR', 'Error exporting diagnostics', err?.message || err);
    return { success: false, error: err?.message || 'Diagnostics export failed' };
  }
});

ipcMain.handle('execute-workflow', async (_, { serial, workflow }) => {
  try {
    const capturesFolder = getCapturesFolder();
    return await workflowEngine.executeWorkflow(serial, workflow, capturesFolder);
  } catch (err: any) {
    appLog('ERROR', 'Error executing workflow', err?.message || err);
    return { success: false, error: err?.message || 'Workflow execution failed' };
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

ipcMain.handle('approve-mcp-pairing', (_, { requestId }) => {
  try {
    appLog('INFO', `User clicked Approve for MCP Request: ${requestId}`);
    return mcpControlServer.approveRequest(requestId);
  } catch (err: any) {
    appLog('ERROR', 'Error approving MCP request', err?.message || err);
    return false;
  }
});

ipcMain.handle('deny-mcp-pairing', (_, { requestId }) => {
  try {
    appLog('INFO', `User clicked Deny for MCP Request: ${requestId}`);
    return mcpControlServer.denyRequest(requestId);
  } catch (err: any) {
    appLog('ERROR', 'Error denying MCP request', err?.message || err);
    return false;
  }
});

ipcMain.handle('revoke-mcp-session', (_, { sessionId }) => {
  try {
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
ipcMain.handle('companion-get-status', async (_, { serial }) => {
  try {
    if (serial) {
      await companionClient.setupPortForward(serial, 8080, 8080);
    }
    return await companionClient.getStatus();
  } catch (err: any) {
    return { status: 'offline', error: err?.message || 'Companion offline' };
  }
});

ipcMain.handle('companion-request-pairing', async (_, { serial }) => {
  try {
    if (serial) {
      await companionClient.setupPortForward(serial, 8080, 8080);
    }
    return await companionClient.requestPairingChallenge();
  } catch (err: any) {
    return { success: false, message: err?.message || 'Pairing request failed' };
  }
});

ipcMain.handle('companion-submit-pin', async (_, { pin, serial }) => {
  try {
    if (serial) {
      await companionClient.setupPortForward(serial, 8080, 8080);
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

ipcMain.handle('companion-set-camera', async (_, { facing }) => {
  return await companionClient.setCamera(facing);
});

ipcMain.handle('companion-set-zoom', async (_, { ratio }) => {
  return await companionClient.setZoom(ratio);
});

ipcMain.handle('companion-set-torch', async (_, { enabled }) => {
  return await companionClient.setTorch(enabled);
});

ipcMain.handle('companion-take-photo', async (_, { destinationDir }) => {
  const saveDir = destinationDir || getCapturesFolder();
  return await companionClient.takeAndSavePhoto(saveDir);
});

ipcMain.handle('companion-disconnect', async () => {
  return await companionClient.disconnect();
});

ipcMain.handle('companion-get-stream-url', () => {
  return companionClient.getStreamUrl();
});

// Lab & Inspection IPC Handlers (Phase 7.1)
ipcMain.handle('lab-generate-overlay-svg', (_, { width, height, config, metadata }) => {
  return generateSvgOverlay(width, height, config, metadata);
});

ipcMain.handle('lab-start-timelapse', async (_, config) => {
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

ipcMain.handle('lab-export-annotated-snapshot', async (_, { sourcePath, svgOverlay, metadata }) => {
  try {
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

app.on('window-all-closed', () => {
  try {
    scrcpyManager.stopMirroring();
    cameraManager.stopCamera();
    companionClient.disconnect().catch(() => {});
    timelapseScheduler.stop();
    mcpControlServer.stop().catch(() => {});
  } catch {
    // ignore
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

