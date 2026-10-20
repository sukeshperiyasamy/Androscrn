import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('androscrnApi', {
  getDevices: () => ipcRenderer.invoke('get-devices'),
  setAlias: (serial: string, alias: string) => ipcRenderer.invoke('set-alias', { serial, alias }),
  startMirroring: (options: any) => ipcRenderer.invoke('start-mirroring', options),
  stopMirroring: () => ipcRenderer.invoke('stop-mirroring'),
  getMirrorStatus: () => ipcRenderer.invoke('get-mirror-status'),
  focusMirrorWindow: () => ipcRenderer.invoke('focus-mirror-window'),
  onMirrorStatusChanged: (cb: (data: any) => void) => {
    const handler = (_: any, d: any) => cb(d);
    ipcRenderer.on('mirror-status-changed', handler);
    return () => { ipcRenderer.removeListener('mirror-status-changed', handler); };
  },
  handoffWifi: (serial: string) => ipcRenderer.invoke('handoff-wifi', { serial }),
  connectWireless: (ip: string, port: number) => ipcRenderer.invoke('connect-wireless', { ip, port }),
  disconnectDevice: (serial: string) => ipcRenderer.invoke('disconnect-device', { serial }),
  pairWireless: (data: any) => ipcRenderer.invoke('pair-wireless', data),
  detectHotspot: () => ipcRenderer.invoke('detect-hotspot'),
  discoverWirelessDevices: () => ipcRenderer.invoke('discover-wireless-devices'),
  cancelWirelessDiscovery: () => ipcRenderer.invoke('cancel-wireless-discovery'),
  connectDiscoveredDevice: (endpointId: string) => ipcRenderer.invoke('connect-discovered-device', { endpointId }),
  pairDiscoveredDevice: (endpointId: string, pin: string) => ipcRenderer.invoke('pair-discovered-device', { endpointId, pin }),
  getDeviceHelp: (serial: string) => ipcRenderer.invoke('get-device-help', { serial }),
  captureScreenshot: (serial: string) => ipcRenderer.invoke('capture-screenshot', { serial }),
  getCaptures: () => ipcRenderer.invoke('get-captures'),
  openPath: (targetPath: string) => ipcRenderer.invoke('open-path', targetPath),
  getRecentLogs: (serial: string) => ipcRenderer.invoke('get-recent-logs', { serial }),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getDiagnosticReport: (serial?: string) => ipcRenderer.invoke('get-diagnostic-report', { serial }),
  exportDiagnostics: (serial: string) => ipcRenderer.invoke('export-diagnostics', { serial }),
  executeWorkflow: (data: any) => ipcRenderer.invoke('execute-workflow', data),
  cancelWorkflow: () => ipcRenderer.invoke('cancel-workflow'),
  executeAdb: (args: string[]) => ipcRenderer.invoke('execute-adb', args),
  getMcpStatus: () => ipcRenderer.invoke('get-mcp-status'),
  approveMcpPairing: (requestId: string) => ipcRenderer.invoke('approve-mcp-pairing', { requestId }),
  denyMcpPairing: (requestId: string) => ipcRenderer.invoke('deny-mcp-pairing', { requestId }),
  revokeMcpSession: (sessionId: string) => ipcRenderer.invoke('revoke-mcp-session', { sessionId }),
  revokeAllMcpSessions: () => ipcRenderer.invoke('revoke-all-mcp-sessions'),
  onMcpPairingRequest: (cb: (req: any) => void) => {
    const handler = (_: any, req: any) => cb(req);
    ipcRenderer.on('mcp-pairing-requested', handler);
    return () => { ipcRenderer.removeListener('mcp-pairing-requested', handler); };
  },
  onMcpStatusChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('mcp-status-changed', handler);
    return () => { ipcRenderer.removeListener('mcp-status-changed', handler); };
  },
  onMcpSessionsRevoked: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('mcp-sessions-revoked', handler);
    return () => { ipcRenderer.removeListener('mcp-sessions-revoked', handler); };
  },
  onMcpActionAudit: (cb: (audit: any) => void) => {
    const handler = (_: any, audit: any) => cb(audit);
    ipcRenderer.on('mcp-action-audit', handler);
    return () => { ipcRenderer.removeListener('mcp-action-audit', handler); };
  },
  queryCameraCapabilities: (serial: string) => ipcRenderer.invoke('query-camera-capabilities', { serial }),
  startCamera: (options: any) => ipcRenderer.invoke('start-camera', options),
  stopCamera: () => ipcRenderer.invoke('stop-camera'),
  reconnectCamera: () => ipcRenderer.invoke('reconnect-camera'),
  getCameraStatus: () => ipcRenderer.invoke('get-camera-status'),
  sendCameraZoom: (direction: 'in' | 'out') => ipcRenderer.invoke('send-camera-zoom', { direction }),
  sendCameraTorch: (state: 'on' | 'off') => ipcRenderer.invoke('send-camera-torch', { state }),
  focusCameraWindow: () => ipcRenderer.invoke('focus-camera-window'),
  onCameraStatusChanged: (cb: (data: any) => void) => {
    const handler = (_: any, d: any) => cb(d);
    ipcRenderer.on('camera-status-changed', handler);
    return () => { ipcRenderer.removeListener('camera-status-changed', handler); };
  },
  companionGetStatus: (serial?: string) => ipcRenderer.invoke('companion-get-status', { serial }),
  companionRequestPairing: (serial?: string) => ipcRenderer.invoke('companion-request-pairing', { serial }),
  companionSubmitPin: (pin: string, serial?: string) => ipcRenderer.invoke('companion-submit-pin', { pin, serial }),
  companionGetCapabilities: () => ipcRenderer.invoke('companion-get-capabilities'),
  companionSetCamera: (facing: 'front' | 'back') => ipcRenderer.invoke('companion-set-camera', { facing }),
  companionSetZoom: (ratio: number) => ipcRenderer.invoke('companion-set-zoom', { ratio }),
  companionSetTorch: (enabled: boolean) => ipcRenderer.invoke('companion-set-torch', { enabled }),
  companionTakePhoto: (destinationDir?: string) => ipcRenderer.invoke('companion-take-photo', { destinationDir }),
  companionDisconnect: () => ipcRenderer.invoke('companion-disconnect'),
  companionGetStreamUrl: () => ipcRenderer.invoke('companion-get-stream-url'),
  documentOcrStatus: () => ipcRenderer.invoke('document-ocr-status'),
  documentImportDialog: () => ipcRenderer.invoke('document-import-dialog'),
  documentImportCapture: (fileName: string) => ipcRenderer.invoke('document-import-capture', { fileName }),
  documentProcess: (options: any) => ipcRenderer.invoke('document-process', options),
  documentOcr: (id: string) => ipcRenderer.invoke('document-ocr', { id }),
  documentOcrCancel: (id: string) => ipcRenderer.invoke('document-ocr-cancel', { id }),
  documentSetText: (id: string, text: string) => ipcRenderer.invoke('document-set-text', { id, text }),
  documentSave: (id: string) => ipcRenderer.invoke('document-save', { id }),
  documentExportPdf: (id: string) => ipcRenderer.invoke('document-export-pdf', { id }),
  documentRelease: (id: string) => ipcRenderer.invoke('document-release', { id }),
  onDocumentOcrProgress: (cb: (p: { id: string; stage: string; progress: number }) => void) => {
    const handler = (_: any, p: any) => cb(p);
    ipcRenderer.on('document-ocr-progress', handler);
    return () => { ipcRenderer.removeListener('document-ocr-progress', handler); };
  },
  labGenerateOverlaySvg: (width: number, height: number, config: any, metadata?: any) => ipcRenderer.invoke('lab-generate-overlay-svg', { width, height, config, metadata }),
  labStartTimelapse: (config: any) => ipcRenderer.invoke('lab-start-timelapse', config),
  labStopTimelapse: () => ipcRenderer.invoke('lab-stop-timelapse'),
  labGetTimelapseStatus: () => ipcRenderer.invoke('lab-get-timelapse-status'),
  labExportAnnotatedSnapshot: (options: any) => ipcRenderer.invoke('lab-export-annotated-snapshot', options)
});

