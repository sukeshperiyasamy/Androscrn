import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { DeviceManager } from '../../../dist/modules/device_manager';
import { ConnectionManager } from '../../../dist/modules/connection_manager';
import { ScrcpyManager } from '../../../dist/modules/scrcpy_manager';
import { DiagnosticsManager } from '../../../dist/modules/diagnostics';
import { WorkflowEngine } from '../../../dist/modules/workflow_engine';

let mainWindow: BrowserWindow | null = null;

const adbPath = path.resolve(__dirname, '../../bin/scrcpy-win64/adb.exe');
const scrcpyPath = path.resolve(__dirname, '../../bin/scrcpy-win64/scrcpy.exe');

const deviceManager = new DeviceManager(adbPath);
const connectionManager = new ConnectionManager(deviceManager);
const scrcpyManager = new ScrcpyManager(scrcpyPath);
const diagnosticsManager = new DiagnosticsManager(deviceManager);
const workflowEngine = new WorkflowEngine(deviceManager, diagnosticsManager);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#07090e',
    title: 'AndroScrn',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const devUrl = 'http://localhost:5173';
  const prodIndex = path.join(__dirname, '../dist/index.html');

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // If running in development with Vite port 5173
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadFile(prodIndex);
    });
  }

  mainWindow.on('closed', () => {
    scrcpyManager.stopMirroring();
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-devices', async () => {
  return await deviceManager.getDevices();
});

ipcMain.handle('set-alias', (_, { serial, alias }) => {
  deviceManager.setDeviceAlias(serial, alias);
  return true;
});

ipcMain.handle('start-mirroring', (_, options) => {
  return scrcpyManager.startMirroring(options);
});

ipcMain.handle('stop-mirroring', () => {
  return scrcpyManager.stopMirroring();
});

ipcMain.handle('get-mirror-status', () => {
  return scrcpyManager.getStatus();
});

ipcMain.handle('handoff-wifi', async (_, { serial }) => {
  return await connectionManager.handoffUsbToWifi(serial);
});

ipcMain.handle('connect-wireless', async (_, { ip, port }) => {
  return await connectionManager.connectWireless(ip, port);
});

ipcMain.handle('disconnect-device', async (_, { serial }) => {
  return await connectionManager.disconnect(serial);
});

ipcMain.handle('pair-wireless', async (_, { ip, pairPort, pin, connectPort }) => {
  return await connectionManager.pairWireless(ip, pairPort, pin, connectPort);
});

ipcMain.handle('detect-hotspot', () => {
  return connectionManager.detectHotspotGateway();
});

ipcMain.handle('capture-screenshot', async (_, { serial }) => {
  const capturesFolder = path.resolve(__dirname, '../../Captures');
  return await diagnosticsManager.captureDeviceScreenshot(serial, capturesFolder);
});

ipcMain.handle('get-recent-logs', async (_, { serial }) => {
  return await diagnosticsManager.getRecentLogs(serial, 250);
});

ipcMain.handle('export-diagnostics', async (_, { serial }) => {
  const capturesFolder = path.resolve(__dirname, '../../Captures');
  return await diagnosticsManager.exportDiagnosticReport(serial, capturesFolder);
});

ipcMain.handle('execute-workflow', async (_, { serial, workflow }) => {
  const capturesFolder = path.resolve(__dirname, '../../Captures');
  return await workflowEngine.executeWorkflow(serial, workflow, capturesFolder);
});

ipcMain.handle('execute-adb', async (_, args) => {
  return await deviceManager.executeAdb(args);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  scrcpyManager.stopMirroring();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
