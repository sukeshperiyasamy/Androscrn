import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('androscrnApi', {
  getDevices: () => ipcRenderer.invoke('get-devices'),
  setAlias: (serial: string, alias: string) => ipcRenderer.invoke('set-alias', { serial, alias }),
  startMirroring: (options: any) => ipcRenderer.invoke('start-mirroring', options),
  stopMirroring: () => ipcRenderer.invoke('stop-mirroring'),
  getMirrorStatus: () => ipcRenderer.invoke('get-mirror-status'),
  handoffWifi: (serial: string) => ipcRenderer.invoke('handoff-wifi', { serial }),
  connectWireless: (ip: string, port: number) => ipcRenderer.invoke('connect-wireless', { ip, port }),
  disconnectDevice: (serial: string) => ipcRenderer.invoke('disconnect-device', { serial }),
  pairWireless: (data: any) => ipcRenderer.invoke('pair-wireless', data),
  detectHotspot: () => ipcRenderer.invoke('detect-hotspot'),
  captureScreenshot: (serial: string) => ipcRenderer.invoke('capture-screenshot', { serial }),
  getRecentLogs: (serial: string) => ipcRenderer.invoke('get-recent-logs', { serial }),
  exportDiagnostics: (serial: string) => ipcRenderer.invoke('export-diagnostics', { serial }),
  executeWorkflow: (data: any) => ipcRenderer.invoke('execute-workflow', data),
  executeAdb: (args: string[]) => ipcRenderer.invoke('execute-adb', args)
});
