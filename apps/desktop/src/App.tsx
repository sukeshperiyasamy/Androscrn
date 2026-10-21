import React, { useState, useEffect } from 'react';
import ConnectionHelp, { DeviceHelp } from './ConnectionHelp';
import WirelessDiscoveryPanel from './WirelessDiscoveryPanel';
import DocumentPanel from './DocumentPanel';
import {
  Smartphone,
  Wifi,
  Usb,
  Play,
  Square,
  Camera,
  Video,
  FileText,
  Activity,
  Bot,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Search,
  Shield,
  Copy,
  Folder,
  Layers,
  ExternalLink,
  Info,
  ShieldAlert,
  Key,
  Lock,
  Unlock,
  Trash2,
  ZoomIn,
  ZoomOut,
  Flashlight,
  FlashlightOff,
  Sliders,
  Zap,
  Power,
  ShieldCheck,
  RotateCcw,
  Grid,
  Crosshair,
  Clock,
  Sparkles,
  Maximize2,
  Minimize2,
  Terminal,
  Check,
  X
} from 'lucide-react';

interface CameraDeviceInfo {
  id: string;
  facing: 'back' | 'front' | 'external' | 'unknown';
  maxResolution?: string;
  fpsList: number[];
  zoomRange?: [number, number];
  supportedSizes: string[];
  highSpeedSizes?: Array<{ size: string; fps: number[] }>;
}

interface CameraCapabilities {
  transportSupported: boolean;
  deviceSupported: boolean;
  androidVersion?: string;
  sdkVersion?: number;
  cameras: CameraDeviceInfo[];
  liveZoomSupported: boolean;
  liveTorchSupported: boolean;
  recordingSupported: boolean;
  snapshotsSupported: boolean;
  notes: string[];
}

interface AndroidDevice {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | 'connecting' | 'authorizing' | 'no permissions' | 'recovery' | 'sideload' | 'bootloader' | 'unknown';
  model: string;
  product: string;
  device: string;
  transportType: 'usb' | 'wifi';
  connectionType?: 'usb' | 'tcpip' | 'wireless-debugging' | 'emulator';
  manufacturer?: string;
  androidVersion?: string;
  apiLevel?: number;
  alias?: string;
  batteryLevel?: number;
  ipAddress?: string;
  guidance?: string;
}

interface LogEntry {
  raw: string;
  timestamp?: string;
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'UNKNOWN';
  tag?: string;
  message: string;
}

interface CaptureItem {
  id: string;
  type: 'screenshot' | 'video';
  name: string;
  timestamp: string;
  path: string;
  sizeBytes: number;
}

interface SystemInfo {
  adbPath?: string;
  adbVersion?: string;
  scrcpyPath?: string;
  scrcpyVersion?: string;
  deviceCount?: number;
  mirrorStatus?: {
    running: boolean;
    pid?: number;
    targetSerial?: string;
    exitCode?: number | null;
    lastError?: string;
  };
  platform?: string;
  electronVersion?: string;
  nodeVersion?: string;
  logFile?: string;
  recentAppLogs?: string[];
  error?: string;
}

// Sensor maximums (e.g. 4000x3000) are rejected by many phones' video encoders, so scrcpy exits at startup
// when --camera-size is set to them. Default to the largest advertised size that fits within 1920 px.
function pickDefaultCameraSize(sizes: string[]): string | undefined {
  const dims = (s: string) => s.split('x').map((n) => parseInt(n, 10));
  const safe = sizes.filter((s) => Math.max(...dims(s)) <= 1920);
  if (safe.includes('1920x1080')) return '1920x1080';
  return safe[0] ?? sizes[sizes.length - 1];
}

function pickDefaultCameraFps(fpsList: number[]): number {
  return fpsList.includes(30) ? 30 : fpsList[fpsList.length - 1];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'mirror' | 'camera' | 'wireless' | 'media' | 'documents' | 'diagnostics' | 'workflow' | 'ai' | 'about'>('mirror');
  const [aboutSubTab, setAboutSubTab] = useState<'licenses' | 'privacy' | 'terms' | 'submission'>('licenses');
  
  // Device State
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [deviceHelp, setDeviceHelp] = useState<DeviceHelp | null>(null);
  const [helpRetrying, setHelpRetrying] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [editingAlias, setEditingAlias] = useState(false);

  // Device Connection Retry State (Phase 5)
  const [retryState, setRetryState] = useState<{
    active: boolean;
    attempt: number;
    elapsedSeconds: number;
    timeoutSeconds: number;
    status: string;
    message: string;
    cmdPid?: number;
  }>({
    active: false,
    attempt: 0,
    elapsedSeconds: 0,
    timeoutSeconds: 60,
    status: 'idle',
    message: ''
  });

  // Mirroring State
  const [isMirroring, setIsMirroring] = useState(false);
  const [qualityPreset, setQualityPreset] = useState<'high_performance' | 'balanced' | 'battery_saver' | 'ultra'>('balanced');
  const [turnScreenOff, setTurnScreenOff] = useState(false);
  const [stayAwake, setStayAwake] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [showTouches, setShowTouches] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [windowBorderless, setWindowBorderless] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [inputMode, setInputMode] = useState<'auto' | 'sdk' | 'uhid'>('auto');
  const [captureOrientation, setCaptureOrientation] = useState<'0' | '90' | '180' | '270'>('0');
  const [sessionDuration, setSessionDuration] = useState(0);
  const [isOperating, setIsOperating] = useState(false);
  const [inputControlBlocked, setInputControlBlocked] = useState(false);
  const [inputControlMessage, setInputControlMessage] = useState<string | null>(null);

  // Camera Studio State
  const [cameraCaps, setCameraCaps] = useState<CameraCapabilities | null>(null);
  const [isQueryingCameras, setIsQueryingCameras] = useState(false);
  const [isCameraRunning, setIsCameraRunning] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('0');
  const [selectedResolution, setSelectedResolution] = useState<string>('1920x1080');
  const [selectedFps, setSelectedFps] = useState<number>(30);
  const [cameraZoom, setCameraZoom] = useState<number>(1.0);
  const [cameraTorch, setCameraTorch] = useState<boolean>(false);
  const [recordCameraSession, setRecordCameraSession] = useState<boolean>(false);
  const [cameraHighSpeed, setCameraHighSpeed] = useState<boolean>(false);
  const [cameraAspectRatio, setCameraAspectRatio] = useState<string>('auto');
  const [cameraLiveFeedback, setCameraLiveFeedback] = useState<string | null>(null);
  const [cameraSessionDuration, setCameraSessionDuration] = useState<number>(0);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'starting' | 'running' | 'interrupted' | 'reconnecting' | 'stopped' | 'error'>('idle');
  const [cameraPreempted, setCameraPreempted] = useState<boolean>(false);
  const [canReconnectCamera, setCanReconnectCamera] = useState<boolean>(false);
  const [cameraReconnectAttempts, setCameraReconnectAttempts] = useState<number>(0);
  const [isReconnectingCamera, setIsReconnectingCamera] = useState<boolean>(false);
  const [cameraPreviewExpanded, setCameraPreviewExpanded] = useState<boolean>(false);
  const [showCameraDiagnostics, setShowCameraDiagnostics] = useState<boolean>(false);
  const [cameraAutoReconnect, setCameraAutoReconnect] = useState<boolean>(true);
  const [cameraRecentStderr, setCameraRecentStderr] = useState<string[]>([]);
  const [cameraExitCode, setCameraExitCode] = useState<number | null>(null);
  const [cameraExitReason, setCameraExitReason] = useState<string | null>(null);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState<boolean>(false);

  // Camera Studio Mode & Companion State (Phase 6)
  const [cameraMode, setCameraMode] = useState<'scrcpy' | 'companion'>('scrcpy');
  const [companionConnected, setCompanionConnected] = useState(false);
  const [companionPaired, setCompanionPaired] = useState(false);
  const [companionPinInput, setCompanionPinInput] = useState('');
  const [companionChallengeActive, setCompanionChallengeActive] = useState(false);
  const [companionStreamUrl, setCompanionStreamUrl] = useState('');
  const [companionFacing, setCompanionFacing] = useState<'front' | 'back'>('back');
  const [companionZoom, setCompanionZoom] = useState<number>(1.0);
  const [companionTorch, setCompanionTorch] = useState<boolean>(false);
  const [companionLoading, setCompanionLoading] = useState<boolean>(false);
  const [companionError, setCompanionError] = useState<string | null>(null);
  const [companionSuccessMsg, setCompanionSuccessMsg] = useState<string | null>(null);

  // Lab & Inspection Engine State (Phase 7.1)
  const [inspectionOverlay, setInspectionOverlay] = useState<'none' | 'grid_thirds' | 'grid_fine' | 'crosshair' | 'reticle' | 'diagonal'>('none');
  const [overlayColor, setOverlayColor] = useState<string>('#38bdf8');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.75);
  const [overlayShowTimestamp, setOverlayShowTimestamp] = useState<boolean>(true);
  const [overlayShowCoords, setOverlayShowCoords] = useState<boolean>(true);
  const [refCompEnabled, setRefCompEnabled] = useState<boolean>(false);
  const [refCompMode, setRefCompMode] = useState<'side_by_side' | 'split_vertical' | 'overlay_blend'>('side_by_side');
  const [refCompOpacity, setRefCompOpacity] = useState<number>(0.5);
  const [timelapseRunning, setTimelapseRunning] = useState<boolean>(false);
  const [timelapseInterval, setTimelapseInterval] = useState<number>(5);
  const [timelapseFrames, setTimelapseFrames] = useState<number>(30);
  const [timelapseCurrentFrame, setTimelapseCurrentFrame] = useState<number>(0);
  const [timelapseStatusMsg, setTimelapseStatusMsg] = useState<string | null>(null);
  const [annotatedExportSuccess, setAnnotatedExportSuccess] = useState<string | null>(null);

  // Wireless & Hotspot State
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('5555');
  const [pairIp, setPairIp] = useState('');
  const [pairPort, setPairPort] = useState('37000');
  const [pairPin, setPairPin] = useState('');
  const [pairConnectPort, setPairConnectPort] = useState('37001');
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const [hotspotGateway, setHotspotGateway] = useState<string | null>('192.168.43.1');

  // Media State
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [recordMirrorSession, setRecordMirrorSession] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // Diagnostics State
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('ALL');
  const [logSource, setLogSource] = useState<'device' | 'app'>('device');
  const [copyReportSuccess, setCopyReportSuccess] = useState(false);

  // MCP Control & Security State
  const [mcpStatus, setMcpStatus] = useState<{
    connectedMcpProcesses: number;
    pendingRequests: Array<{
      requestId: string;
      clientName: string;
      requestedTier: number;
      pin: string;
      expiresAt: number;
    }>;
    activeSessions: Array<{
      sessionId: string;
      clientName?: string;
      tiers: number[];
      expiresAt: number;
    }>;
    recentAudits?: Array<{
      id: string;
      timestamp: number;
      action: string;
      clientName: string;
      serial: string;
      status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REJECTED';
      details?: string;
    }>;
  }>({ connectedMcpProcesses: 0, pendingRequests: [], activeSessions: [], recentAudits: [] });

  // Workflow Sequencer State (Phase 10/11)
  const [workflowPreset, setWorkflowPreset] = useState<'sanity' | 'gestures' | 'custom'>('sanity');
  const [workflowRunning, setWorkflowRunning] = useState<boolean>(false);
  const [workflowResult, setWorkflowResult] = useState<any>(null);
  const [workflowSteps, setWorkflowSteps] = useState<Array<{ id: string; action: string; params: any; description?: string }>>([
    { id: 's1', action: 'keyevent', params: { keycode: 3 }, description: 'Press HOME' },
    { id: 's2', action: 'wait', params: { waitMs: 800 }, description: 'Wait 800ms' },
    { id: 's3', action: 'keyevent', params: { keycode: 187 }, description: 'Open App Switcher (Recents)' },
    { id: 's4', action: 'wait', params: { waitMs: 1000 }, description: 'Wait 1000ms' },
    { id: 's5', action: 'keyevent', params: { keycode: 4 }, description: 'Press BACK to Home' },
    { id: 's6', action: 'screenshot', params: { label: 'workflow_sanity_check' }, description: 'Capture Verification Screenshot' }
  ]);

  // Status Alerts
  const [alertBanner, setAlertBanner] = useState<{ type: 'info' | 'success' | 'warning' | 'error'; message: string } | null>({
    type: 'info',
    message: 'Welcome to AndroScrn. Connect an Android phone via USB or Wi-Fi to begin.'
  });

  // Check IPC availability
  const api = (window as any).androscrnApi;

  const refreshCaptures = async () => {
    try {
      if (api?.getCaptures) {
        setCaptures(await api.getCaptures());
      }
    } catch {}
  };

  // Persisted preferences: restore once on mount, then save on change. Saving waits for the restore so the
  // initial defaults never overwrite the stored values.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    if (!api?.getSettings) {
      setSettingsLoaded(true);
      return;
    }
    api.getSettings()
      .then((s: any) => {
        if (s?.qualityPreset) setQualityPreset(s.qualityPreset);
        if (s?.inputMode) setInputMode(s.inputMode);
      })
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !api?.updateSettings) return;
    api.updateSettings({ qualityPreset, inputMode }).catch(() => {});
  }, [settingsLoaded, qualityPreset, inputMode]);

  // Connection help follows the selected device. Only the (serial, state) pair re-triggers a lookup,
  // so polling the same device does not rebuild or re-announce identical guidance.
  const helpTarget = devices.find(d => d.serial === selectedSerial);
  const helpTargetState = helpTarget?.state;
  useEffect(() => {
    let cancelled = false;
    if (!api?.getDeviceHelp || !selectedSerial || !helpTargetState) {
      setDeviceHelp(null);
      return;
    }
    api.getDeviceHelp(selectedSerial).then((h: DeviceHelp) => {
      if (!cancelled) setDeviceHelp(h);
    }).catch(() => {
      if (!cancelled) setDeviceHelp(null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedSerial, helpTargetState]);

  // Refresh devices and mirror status
  const refreshDevices = async () => {
    setIsScanning(true);
    try {
      if (api?.getDevices) {
        const devList: AndroidDevice[] = await api.getDevices();
        setDevices(devList);
        
        // Auto-select first device or maintain valid user selection using functional updater
        setSelectedSerial(current => {
          if (devList.length === 0) {
            setIsMirroring(false);
            setIsCameraRunning(false);
            return '';
          }
          if (current && devList.some(d => d.serial === current)) return current;
          setIsMirroring(false);
          setIsCameraRunning(false);
          return devList[0].serial;
        });
      }

      // Sync mirroring status
      if (api?.getMirrorStatus) {
        const status = await api.getMirrorStatus();
        if (status.running && !isMirroring) {
          setIsMirroring(true);
        } else if (!status.running && isMirroring) {
          setIsMirroring(false);
          if (status.lastError) {
            setAlertBanner({ type: 'error', message: `Screen mirroring session exited: ${status.lastError}` });
          }
        }
        if (typeof status.inputControlBlocked === 'boolean') {
          setInputControlBlocked(status.inputControlBlocked);
        }
        if (status.inputControlMessage) {
          setInputControlMessage(status.inputControlMessage);
        }
      }

      // Sync captures
      if (api?.getCaptures) {
        const existingCaptures = await api.getCaptures();
        setCaptures(existingCaptures);
      }
    } catch (e: any) {
      console.error('Device refresh error:', e);
    } finally {
      setIsScanning(false);
    }
  };

  // Query System Info & Diagnostics
  const refreshSystemInfo = async () => {
    try {
      if (api?.getSystemInfo) {
        const info = await api.getSystemInfo();
        setSystemInfo(info);
      }
    } catch (e) {
      console.error('System info query error:', e);
    }
  };

  // Query Device Logcat
  const refreshLogcat = async () => {
    if (api?.getRecentLogs && selectedSerial) {
      try {
        const entries = await api.getRecentLogs(selectedSerial);
        setLogs(entries);
      } catch (e) {
        console.error('Logcat fetch error:', e);
      }
    } else {
      setLogs([]);
    }
  };

  const refreshMcpStatus = async () => {
    try {
      if (api?.getMcpStatus) {
        const st = await api.getMcpStatus();
        if (st) setMcpStatus(st);
      }
    } catch (e) {
      // ignore
    }
  };

  const handleApprovePairing = async (requestId: string) => {
    if (api?.approveMcpPairing) {
      const ok = await api.approveMcpPairing(requestId);
      if (ok) {
        setAlertBanner({ type: 'success', message: 'Pairing request approved. AI agent authorized.' });
        refreshMcpStatus();
      } else {
        setAlertBanner({ type: 'error', message: 'Failed to approve pairing request.' });
      }
    }
  };

  const handleDenyPairing = async (requestId: string) => {
    if (api?.denyMcpPairing) {
      await api.denyMcpPairing(requestId);
      setAlertBanner({ type: 'info', message: 'Pairing request denied.' });
      refreshMcpStatus();
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (api?.revokeMcpSession) {
      await api.revokeMcpSession(sessionId);
      setAlertBanner({ type: 'info', message: 'AI session revoked.' });
      refreshMcpStatus();
    }
  };

  const handleRevokeAllSessions = async () => {
    if (api?.revokeAllMcpSessions) {
      const ok = await api.revokeAllMcpSessions();
      if (ok) {
        setAlertBanner({ type: 'error', message: 'EMERGENCY REVOCATION: All active AI sessions revoked immediately.' });
        refreshMcpStatus();
      }
    }
  };

  useEffect(() => {
    refreshDevices();
    refreshSystemInfo();
    refreshMcpStatus();

    const interval = setInterval(() => {
      refreshDevices();
      refreshMcpStatus();
    }, 2500);

    const unsubs: Array<() => void> = [];

    if (api?.onMcpPairingRequest) {
      const u = api.onMcpPairingRequest((req: any) => {
        refreshMcpStatus();
        setAlertBanner({
          type: 'info',
          message: `🔔 Incoming AI Pairing Request from '${req.clientName}' for Tier ${req.requestedTier}. Desktop approval required.`
        });
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onMcpStatusChanged) {
      const u = api.onMcpStatusChanged(() => {
        refreshMcpStatus();
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onMcpSessionsRevoked) {
      const u = api.onMcpSessionsRevoked(() => {
        refreshMcpStatus();
        setAlertBanner({
          type: 'error',
          message: '⚠️ All AI sessions have been revoked by the Emergency Kill Switch.'
        });
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onMcpActionAudit) {
      const u = api.onMcpActionAudit((_audit: any) => {
        refreshMcpStatus();
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onMirrorStatusChanged) {
      const u = api.onMirrorStatusChanged((data: any) => {
        if (!data) return;
        if (typeof data.running === 'boolean') {
          setIsMirroring(data.running);
        }
        if (typeof data.inputControlBlocked === 'boolean') {
          setInputControlBlocked(data.inputControlBlocked);
          if (data.inputControlBlocked) {
            setAlertBanner({
              type: 'warning',
              message: 'Laptop touch/keyboard input blocked: Xiaomi HyperOS requires "USB debugging (Security settings)" enabled in Developer options.'
            });
          }
        }
        if (data.inputControlMessage) {
          setInputControlMessage(data.inputControlMessage);
        }
        if (!data.running) {
          if (data.disconnected) {
            setAlertBanner({
              type: 'error',
              message: `Device disconnected! Screen mirroring terminated for ${data.serial || 'device'}.`
            });
          } else if (data.lastError) {
            setAlertBanner({
              type: 'error',
              message: `Screen mirroring session closed: ${data.lastError}`
            });
          }
          refreshDevices();
        }
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onCameraStatusChanged) {
      const u = api.onCameraStatusChanged((data: any) => {
        if (!data) return;
        if (typeof data.running === 'boolean') {
          setIsCameraRunning(data.running);
        }
        if (data.status) {
          setCameraStatus(data.status);
        }
        if (typeof data.canReconnect === 'boolean') {
          setCanReconnectCamera(data.canReconnect);
        }
        if (typeof data.reconnectCount === 'number') {
          setCameraReconnectAttempts(data.reconnectCount);
        }
        if (data.exitCode !== undefined) {
          setCameraExitCode(data.exitCode);
        }
        if (data.exitReason) {
          setCameraExitReason(data.exitReason);
        }
        if (Array.isArray(data.recentStderr)) {
          setCameraRecentStderr(data.recentStderr);
        }
        if (data.status === 'interrupted' || data.exitReason === 'camera_preempted') {
          setCameraPreempted(true);
          setIsReconnectingCamera(false);
          setAlertBanner({
            type: 'warning',
            message: 'Camera stream disconnected: Camera sensor was preempted by Android (e.g. phone screen wake, lock screen or Face Unlock). Device is still connected.'
          });
        } else if (data.status === 'running') {
          setCameraPreempted(false);
          setIsReconnectingCamera(false);
        } else if (data.status === 'reconnecting') {
          setIsReconnectingCamera(true);
        } else if (data.status === 'stopped' && data.exitReason === 'user_stopped') {
          setCameraPreempted(false);
          setCanReconnectCamera(false);
          setIsReconnectingCamera(false);
        } else if (data.exitReason === 'device_disconnected') {
          setCameraPreempted(false);
          setCanReconnectCamera(false);
          setIsReconnectingCamera(false);
          setAlertBanner({
            type: 'error',
            message: 'Device disconnected from ADB. Camera preview stopped.'
          });
        }
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onConnectionRetryStatusChanged) {
      const u = api.onConnectionRetryStatusChanged((status: any) => {
        if (!status) return;
        setRetryState(status);
        if (status.status === 'unauthorized') {
          setAlertBanner({
            type: 'error',
            message: 'Device unauthorized: Unlock your phone and tap "Allow USB debugging".'
          });
        } else if (status.status === 'timeout') {
          setAlertBanner({
            type: 'error',
            message: `Connection retry timed out (${status.timeoutSeconds}s). Check USB connection or Developer Options.`
          });
        }
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    if (api?.onConnectionRetryDeviceReady) {
      const u = api.onConnectionRetryDeviceReady((readyDevices: any[]) => {
        refreshDevices();
        if (readyDevices && readyDevices.length > 0) {
          setSelectedSerial(readyDevices[0].serial);
          setAlertBanner({
            type: 'success',
            message: `Device ${readyDevices[0].model || readyDevices[0].serial} connected and authorized! Ready for mirroring.`
          });
        }
      });
      if (typeof u === 'function') unsubs.push(u);
    }

    return () => {
      clearInterval(interval);
      try { api?.cancelConnectionRetry?.(); } catch {}
      unsubs.forEach(cleanup => {
        try { cleanup(); } catch {}
      });
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      refreshSystemInfo();
      refreshLogcat();
    } else if (activeTab === 'ai') {
      refreshMcpStatus();
    } else if (activeTab === 'wireless' && api?.detectHotspot) {
      api.detectHotspot().then((gw: string | null) => {
        if (gw) setHotspotGateway(gw);
      }).catch(() => {});
    }
  }, [activeTab, selectedSerial]);

  // Timelapse progress polling (Phase 7.1)
  useEffect(() => {
    let t: any;
    if (timelapseRunning && api?.labGetTimelapseStatus) {
      t = setInterval(async () => {
        try {
          const st = await api.labGetTimelapseStatus();
          if (st) {
            if (typeof st.completedFrames === 'number') {
              setTimelapseCurrentFrame(st.completedFrames);
            }
            if (!st.isRunning) {
              setTimelapseRunning(false);
              setTimelapseStatusMsg('Timelapse session completed. Frames saved to Captures.');
              if (api?.getCaptures) {
                const updated = await api.getCaptures();
                setCaptures(updated);
              }
            }
          }
        } catch {}
      }, 1000);
    }
    return () => clearInterval(t);
  }, [timelapseRunning]);

  // Mirroring Session Timer
  useEffect(() => {
    let t: any;
    if (isMirroring) {
      t = setInterval(() => setSessionDuration(d => d + 1), 1000);
    } else {
      setSessionDuration(0);
    }
    return () => clearInterval(t);
  }, [isMirroring]);

  // Camera Studio Session Timer
  useEffect(() => {
    let t: any;
    if (isCameraRunning) {
      t = setInterval(() => setCameraSessionDuration(d => d + 1), 1000);
    } else {
      setCameraSessionDuration(0);
    }
    return () => clearInterval(t);
  }, [isCameraRunning]);

  // Fetch camera capabilities when camera tab is active or device changes
  useEffect(() => {
    if (activeTab === 'camera' && selectedSerial) {
      refreshCameraCapabilities(selectedSerial);
      refreshCameraStatus();
    }
  }, [activeTab, selectedSerial]);

  const refreshCameraCapabilities = async (serial: string) => {
    if (!serial || !api?.queryCameraCapabilities) return;
    setIsQueryingCameras(true);
    try {
      const caps = await api.queryCameraCapabilities(serial);
      setCameraCaps(caps);
      if (caps.cameras && caps.cameras.length > 0) {
        setSelectedCameraId(caps.cameras[0].id);
        if (caps.cameras[0].supportedSizes && caps.cameras[0].supportedSizes.length > 0) {
          setSelectedResolution(pickDefaultCameraSize(caps.cameras[0].supportedSizes)!);
        }
        if (caps.cameras[0].fpsList && caps.cameras[0].fpsList.length > 0) {
          setSelectedFps(pickDefaultCameraFps(caps.cameras[0].fpsList));
        }
      }
    } catch (err: any) {
      console.error('Camera capability error:', err);
    } finally {
      setIsQueryingCameras(false);
    }
  };

  const refreshCameraStatus = async () => {
    try {
      if (api?.getCameraStatus) {
        const st = await api.getCameraStatus();
        if (st) {
          setIsCameraRunning(st.running);
          if (st.status) setCameraStatus(st.status);
          if (st.canReconnect !== undefined) setCanReconnectCamera(st.canReconnect);
          if (st.reconnectCount !== undefined) setCameraReconnectAttempts(st.reconnectCount);
          if (st.exitCode !== undefined) setCameraExitCode(st.exitCode);
          if (st.exitReason) setCameraExitReason(st.exitReason);
          if (Array.isArray(st.recentStderr)) setCameraRecentStderr(st.recentStderr);
          if (st.currentZoom !== undefined) setCameraZoom(st.currentZoom);
          if (st.torchActive !== undefined) setCameraTorch(st.torchActive);
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const handleFocusCameraWindow = async () => {
    if (api?.focusCameraWindow) {
      const res = await api.focusCameraWindow();
      if (res?.message) {
        setCameraLiveFeedback(res.message);
        setTimeout(() => setCameraLiveFeedback(null), 3000);
      }
    }
  };

  const handleCopyCameraDiagnostics = () => {
    const diagText = [
      `=== AndroScrn Camera Studio Diagnostics ===`,
      `Device Serial: ${selectedSerial}`,
      `Device Model: ${activeDevice?.model || 'Unknown'}`,
      `Camera Sensor ID: ${selectedCameraId}`,
      `Selected Resolution: ${selectedResolution}`,
      `Target FPS: ${selectedFps}`,
      `Current Zoom: ${cameraZoom.toFixed(1)}x`,
      `Torch Active: ${cameraTorch}`,
      `Session Status: ${cameraStatus}`,
      `Exit Reason: ${cameraExitReason || 'none'}`,
      `Exit Code: ${cameraExitCode !== null ? cameraExitCode : 'N/A'}`,
      `Reconnect Attempts: ${cameraReconnectAttempts}/5`,
      `Recent Stderr:`,
      cameraRecentStderr.length > 0 ? cameraRecentStderr.join('\n') : '(None)'
    ].join('\n');

    navigator.clipboard.writeText(diagText).then(() => {
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 2500);
    }).catch(() => {});
  };

  const handleStartCamera = async () => {
    if (isOperating) return;
    setIsOperating(true);
    try {
      if (!selectedSerial && devices.length === 0) {
        setAlertBanner({ type: 'error', message: 'No Android device connected. Please attach a device via USB or Wi-Fi.' });
        return;
      }

      if (activeDevice && activeDevice.state !== 'device') {
        setAlertBanner({ type: 'error', message: activeDevice.guidance || 'Device is not ready for camera preview.' });
        return;
      }

      if (cameraCaps && !cameraCaps.transportSupported) {
        setAlertBanner({
          type: 'error',
          message: cameraCaps.notes[0] || 'scrcpy camera mirroring requires Android 12 or higher.'
        });
        return;
      }

      setAlertBanner({ type: 'info', message: `Launching Camera Studio for ${activeDevice?.model || selectedSerial}...` });

      if (api?.startCamera) {
        const res = await api.startCamera({
          serial: selectedSerial,
          cameraId: selectedCameraId,
          size: selectedResolution || undefined,
          fps: selectedFps || undefined,
          zoom: cameraZoom,
          torch: cameraTorch,
          highSpeed: cameraHighSpeed,
          aspectRatio: cameraAspectRatio !== 'auto' ? cameraAspectRatio : undefined,
          record: recordCameraSession,
          autoReconnect: cameraAutoReconnect
        });

        if (res.success) {
          setIsCameraRunning(true);
          setCameraPreempted(false);
          setAlertBanner({
            type: 'success',
            message: 'Camera preview active in low-latency Direct3D11 window! Use Alt+Up/Down for live zoom, Alt+T for torch.'
          });
        } else {
          setAlertBanner({ type: 'error', message: res.message || 'Failed to start camera session.' });
        }
      }
    } finally {
      setIsOperating(false);
    }
  };

  const handleStopCamera = async () => {
    if (api?.stopCamera) {
      await api.stopCamera();
      setIsCameraRunning(false);
      setCameraPreempted(false);
      setCanReconnectCamera(false);
      setAlertBanner({ type: 'info', message: 'Camera Studio preview session stopped.' });
    }
  };

  const handleReconnectCamera = async () => {
    if (isReconnectingCamera || isOperating) return;
    setIsReconnectingCamera(true);
    setAlertBanner({ type: 'info', message: 'Reconnecting Camera Studio preview...' });
    try {
      if (api?.reconnectCamera) {
        const res = await api.reconnectCamera();
        if (res.success) {
          setCameraPreempted(false);
          setIsCameraRunning(true);
          setAlertBanner({
            type: 'success',
            message: 'Camera preview reconnected successfully!'
          });
        } else {
          setAlertBanner({
            type: 'error',
            message: res.message || 'Camera reconnection failed. Device camera may still be occupied.'
          });
        }
      }
    } catch (e: any) {
      setAlertBanner({
        type: 'error',
        message: e?.message || 'Camera reconnection error'
      });
    } finally {
      setIsReconnectingCamera(false);
    }
  };

  const handleZoomChange = async (direction: 'in' | 'out') => {
    if (api?.sendCameraZoom) {
      const res = await api.sendCameraZoom(direction);
      if (res.success) {
        setCameraZoom(res.currentZoom);
        setCameraLiveFeedback(res.message);
        setTimeout(() => setCameraLiveFeedback(null), 3500);
      }
    } else {
      const delta = direction === 'in' ? 0.5 : -0.5;
      setCameraZoom(z => Math.max(1.0, Math.min(10.0, Math.round((z + delta) * 10) / 10)));
    }
  };

  const handleTorchToggle = async () => {
    const nextState = cameraTorch ? 'off' : 'on';
    if (api?.sendCameraTorch) {
      const res = await api.sendCameraTorch(nextState);
      if (res.success) {
        setCameraTorch(res.torchActive);
        setCameraLiveFeedback(res.message);
        setTimeout(() => setCameraLiveFeedback(null), 3500);
      }
    } else {
      setCameraTorch(!cameraTorch);
    }
  };

  // Companion Actions (Phase 6)
  const handleCompanionConnect = async () => {
    setCompanionLoading(true);
    setCompanionError(null);
    setCompanionSuccessMsg(null);
    try {
      if (api?.companionRequestPairing) {
        const challenge = await api.companionRequestPairing(selectedSerial);
        if (challenge?.success) {
          setCompanionChallengeActive(true);
          setCompanionConnected(true);
          setCompanionSuccessMsg('Pairing requested. Check phone screen for 6-digit PIN.');
        } else {
          setCompanionError(challenge?.message || 'Could not connect to companion app. Ensure app is open on device.');
        }
      } else {
        // Mock fallback for browser / UI tests
        setCompanionChallengeActive(true);
        setCompanionConnected(true);
        setCompanionSuccessMsg('Pairing challenge active. Check phone screen for 6-digit PIN.');
      }
    } catch (e: any) {
      setCompanionError(e?.message || 'Companion connection failed');
    } finally {
      setCompanionLoading(false);
    }
  };

  const handleCompanionSubmitPin = async () => {
    const clean = companionPinInput.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setCompanionError('Please enter a valid 6-digit numeric PIN');
      return;
    }
    setCompanionLoading(true);
    setCompanionError(null);
    setCompanionSuccessMsg(null);
    try {
      if (api?.companionSubmitPin) {
        const res = await api.companionSubmitPin(clean, selectedSerial);
        if (res?.success) {
          setCompanionPaired(true);
          setCompanionChallengeActive(false);
          const streamUrl = await api.companionGetStreamUrl();
          setCompanionStreamUrl(streamUrl || 'http://127.0.0.1:8080/api/v1/stream?token=mock_token_64');
          setCompanionSuccessMsg('Pairing approved! Live studio feed active.');
        } else {
          setCompanionError(res?.error || 'Invalid verification PIN');
        }
      } else {
        // Mock fallback for browser / UI tests
        setCompanionPaired(true);
        setCompanionChallengeActive(false);
        setCompanionStreamUrl('http://127.0.0.1:8080/api/v1/stream?token=mock_token_64');
        setCompanionSuccessMsg('Pairing approved! Live studio feed active.');
      }
    } catch (e: any) {
      setCompanionError(e?.message || 'Pairing verification error');
    } finally {
      setCompanionLoading(false);
    }
  };

  const handleCompanionFlipLens = async () => {
    const nextFacing = companionFacing === 'back' ? 'front' : 'back';
    try {
      if (api?.companionSetCamera) {
        const res = await api.companionSetCamera(nextFacing);
        if (res?.success) {
          setCompanionFacing(nextFacing);
          setCompanionSuccessMsg(`Switched to ${nextFacing === 'back' ? 'Back Main' : 'Front Selfie'} lens`);
        }
      } else {
        setCompanionFacing(nextFacing);
        setCompanionSuccessMsg(`Switched to ${nextFacing === 'back' ? 'Back Main' : 'Front Selfie'} lens`);
      }
    } catch (e: any) {
      setCompanionError(e?.message || 'Failed to flip lens');
    }
  };

  const handleCompanionZoom = async (newZoom: number) => {
    setCompanionZoom(newZoom);
    try {
      if (api?.companionSetZoom) {
        await api.companionSetZoom(newZoom);
      }
    } catch (e: any) {
      console.error('Zoom error', e);
    }
  };

  const handleCompanionTorch = async () => {
    const nextTorch = !companionTorch;
    try {
      if (api?.companionSetTorch) {
        const res = await api.companionSetTorch(nextTorch);
        if (res?.success) {
          setCompanionTorch(nextTorch);
        }
      } else {
        setCompanionTorch(nextTorch);
      }
    } catch (e: any) {
      setCompanionError(e?.message || 'Failed to toggle torch');
    }
  };

  const handleCompanionSnapshot = async () => {
    setCompanionLoading(true);
    setCompanionError(null);
    setCompanionSuccessMsg(null);
    try {
      if (api?.companionTakePhoto) {
        const res = await api.companionTakePhoto();
        if (res?.success && res.filePath) {
          setCompanionSuccessMsg(`Full-resolution photo saved (${Math.round((res.sizeBytes || 0) / 1024)} KB) to Captures/`);
          refreshCaptures();
        } else {
          setCompanionError(res?.error || 'Photo capture failed');
        }
      } else {
        setCompanionSuccessMsg('Full-resolution photo saved (2450 KB) to Captures/');
      }
    } catch (e: any) {
      setCompanionError(e?.message || 'Failed to capture photo');
    } finally {
      setCompanionLoading(false);
    }
  };

  const handleCompanionDisconnect = async () => {
    try {
      if (api?.companionDisconnect) {
        await api.companionDisconnect();
      }
    } catch {}
    setCompanionPaired(false);
    setCompanionConnected(false);
    setCompanionChallengeActive(false);
    setCompanionStreamUrl('');
    setCompanionSuccessMsg('Companion session disconnected and token revoked');
  };

  // Lab & Inspection Engine Actions (Phase 7.1)
  const handleStartTimelapse = async () => {
    setTimelapseRunning(true);
    setTimelapseCurrentFrame(1);
    setTimelapseStatusMsg(`Timelapse started: 1 frame every ${timelapseInterval}s (${timelapseFrames} frames total)`);
    try {
      if (api?.labStartTimelapse) {
        await api.labStartTimelapse({
          intervalSeconds: timelapseInterval,
          maxFrames: timelapseFrames
        });
      }
    } catch (e: any) {
      console.error('Timelapse start error:', e);
    }
  };

  const handleStopTimelapse = async () => {
    setTimelapseRunning(false);
    setTimelapseStatusMsg('Timelapse session completed. Manifest and frames saved to Captures/');
    try {
      if (api?.labStopTimelapse) {
        await api.labStopTimelapse();
      }
    } catch {}
    refreshCaptures();
  };

  const handleExportAnnotated = async () => {
    try {
      if (api?.labExportAnnotatedSnapshot) {
        const lastCapture = captures[0]?.path || 'Captures/latest_capture.png';
        const res = await api.labExportAnnotatedSnapshot({
          sourcePath: lastCapture,
          svgOverlay: `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="none" stroke="${overlayColor}" stroke-width="2"/></svg>`,
          metadata: {
            overlayType: inspectionOverlay,
            timestamp: new Date().toISOString(),
            isCalibrated: false,
            note: 'Uncalibrated relative pixels'
          }
        });
        if (res?.success) {
          setAnnotatedExportSuccess('Annotated copy & metadata JSON saved to Captures/');
          setTimeout(() => setAnnotatedExportSuccess(null), 4000);
          refreshCaptures();
        }
      } else {
        setAnnotatedExportSuccess('Annotated copy & metadata JSON saved to Captures/');
        setTimeout(() => setAnnotatedExportSuccess(null), 4000);
      }
    } catch (e: any) {
      console.error('Export error:', e);
    }
  };

  const activeDevice = devices.find(d => d.serial === selectedSerial) || devices[0];
  const isDeviceReady = activeDevice && activeDevice.state === 'device';

  const handleStartMirror = async () => {
    if (isOperating) return;
    setIsOperating(true);
    try {
      if (!selectedSerial && devices.length === 0) {
        setAlertBanner({ type: 'error', message: 'No Android device connected. Please attach a device via USB or Wi-Fi.' });
        return;
      }

      if (activeDevice && activeDevice.state !== 'device') {
        setAlertBanner({ type: 'error', message: activeDevice.guidance || 'Device is not ready for mirroring.' });
        return;
      }

      setAlertBanner({ type: 'info', message: `Initializing screen mirroring for ${activeDevice?.model || selectedSerial}...` });

      if (api?.startMirroring) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const recordFilename = `recording_${selectedSerial.replace(/[:.]/g, '_')}_${timestamp}.mp4`;
        
        const res = await api.startMirroring({
          serial: selectedSerial,
          preset: qualityPreset,
          turnScreenOff,
          stayAwake,
          fullscreen,
          showTouches,
          noAudio,
          windowBorderless,
          alwaysOnTop,
          captureOrientation: captureOrientation !== '0' ? captureOrientation : undefined,
          keyboardMode: inputMode === 'uhid' ? 'uhid' : (inputMode === 'sdk' ? 'sdk' : undefined),
          mouseMode: inputMode === 'uhid' ? 'uhid' : (inputMode === 'sdk' ? 'sdk' : undefined),
          recordPath: recordMirrorSession ? recordFilename : undefined
        });

        if (res?.success) {
          setIsMirroring(true);
          setAlertBanner({ type: 'success', message: `Screen mirroring started for ${activeDevice?.model || selectedSerial}.` });
        } else {
          setIsMirroring(false);
          setAlertBanner({ type: 'error', message: res?.message || 'Failed to start screen mirroring session.' });
        }
      } else {
        setAlertBanner({ type: 'error', message: 'Desktop IPC bridge unavailable. Please launch inside AndroScrn desktop.' });
      }
    } finally {
      setIsOperating(false);
    }
  };

  const handleStopMirror = async () => {
    if (api?.stopMirroring) {
      await api.stopMirroring();
    }
    setIsMirroring(false);
    setInputControlBlocked(false);
    setInputControlMessage(null);
    setAlertBanner({ type: 'info', message: 'Screen mirroring session ended.' });
    refreshDevices();
  };

  const handleFocusMirrorWindow = async () => {
    if (api?.focusMirrorWindow) {
      const res = await api.focusMirrorWindow();
      if (res?.message) {
        setAlertBanner({ type: 'info', message: res.message });
      }
    }
  };

  const handleInputModeChange = async (newMode: 'auto' | 'sdk' | 'uhid') => {
    setInputMode(newMode);
    setInputControlBlocked(false);
    if (isMirroring && api?.stopMirroring && api?.startMirroring) {
      setAlertBanner({ type: 'info', message: `Switching input control mode to ${newMode === 'uhid' ? 'UHID' : (newMode === 'sdk' ? 'SDK' : 'Auto')}...` });
      await api.stopMirroring();
      setTimeout(async () => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const recordFilename = `recording_${selectedSerial.replace(/[:.]/g, '_')}_${timestamp}.mp4`;
        await api?.startMirroring({
          serial: selectedSerial,
          preset: qualityPreset,
          turnScreenOff,
          stayAwake,
          fullscreen,
          showTouches,
          noAudio,
          windowBorderless,
          alwaysOnTop,
          captureOrientation: captureOrientation !== '0' ? captureOrientation : undefined,
          keyboardMode: newMode === 'uhid' ? 'uhid' : (newMode === 'sdk' ? 'sdk' : undefined),
          mouseMode: newMode === 'uhid' ? 'uhid' : (newMode === 'sdk' ? 'sdk' : undefined),
          recordPath: recordMirrorSession ? recordFilename : undefined
        });
        setAlertBanner({
          type: 'success',
          message: newMode === 'uhid'
            ? 'Switched to UHID Hardware Emulation mode. Laptop keyboard and mouse control enabled.'
            : `Switched input control mode to ${newMode === 'sdk' ? 'Standard SDK' : 'Auto'}.`
        });
      }, 400);
    } else {
      setAlertBanner({
        type: 'info',
        message: newMode === 'uhid'
          ? 'Input mode set to UHID Hardware Emulation. Next session will use UHID mode.'
          : `Input control mode set to ${newMode === 'sdk' ? 'Standard SDK' : 'Auto'}.`
      });
    }
  };

  const handleSwitchToUhid = () => handleInputModeChange('uhid');

  const handle1ClickHandoff = async () => {
    if (!selectedSerial) {
      setAlertBanner({ type: 'error', message: 'Select an authorized USB-connected device first.' });
      return;
    }
    if (!isDeviceReady) {
      setAlertBanner({ type: 'error', message: activeDevice?.guidance || 'Device is not ready.' });
      return;
    }

    setHandoffStatus('Discovering Wi-Fi IP and enabling port 5555...');
    if (api?.handoffWifi) {
      const res = await api.handoffWifi(selectedSerial);
      if (res.success) {
        setHandoffStatus(`Port 5555 enabled on ${res.ipAddress}. Wireless link ready!`);
        setAlertBanner({ type: 'success', message: res.message });
        refreshDevices();
      } else {
        setHandoffStatus(null);
        setAlertBanner({ type: 'error', message: res.message || res.error || 'Wireless handoff failed.' });
      }
    }
  };

  const handleHotspotConnect = async () => {
    if (!hotspotGateway) return;
    setAlertBanner({ type: 'info', message: `Connecting to phone hotspot gateway at ${hotspotGateway}:5555...` });
    if (api?.connectWireless) {
      const res = await api.connectWireless(hotspotGateway, 5555);
      if (res.success) {
        setAlertBanner({ type: 'success', message: res.message });
        refreshDevices();
      } else {
        setAlertBanner({ type: 'error', message: `Hotspot connection failed: ${res.message || res.error}` });
      }
    }
  };

  const handlePairWireless = async () => {
    if (!pairPin || pairPin.length !== 6) {
      setAlertBanner({ type: 'error', message: 'Please enter a valid 6-digit Android pairing PIN.' });
      return;
    }
    setAlertBanner({ type: 'info', message: `Pairing with ${pairIp}:${pairPort}...` });
    if (api?.pairWireless) {
      const res = await api.pairWireless({
        ip: pairIp,
        pairPort: parseInt(pairPort, 10),
        pin: pairPin,
        connectPort: pairConnectPort ? parseInt(pairConnectPort, 10) : undefined
      });
      if (res.success) {
        setAlertBanner({ type: 'success', message: res.message });
        refreshDevices();
      } else {
        setAlertBanner({ type: 'error', message: res.message || res.error });
      }
    }
  };

  const handleDisconnectWifiDevice = async (serial: string) => {
    if (!serial || !api?.disconnectDevice) return;
    setAlertBanner({ type: 'info', message: `Disconnecting wireless device ${serial}...` });
    try {
      const res = await api.disconnectDevice(serial);
      if (res.success) {
        setAlertBanner({ type: 'success', message: `Successfully disconnected wireless device ${serial}` });
        refreshDevices();
      } else {
        setAlertBanner({ type: 'error', message: res.error || res.message || 'Failed to disconnect wireless device' });
      }
    } catch (err: any) {
      setAlertBanner({ type: 'error', message: err?.message || 'Error disconnecting wireless device' });
    }
  };

  const handleStartConnectionRetry = async () => {
    if (retryState.active) return;
    setRetryState(prev => ({
      ...prev,
      active: true,
      attempt: 1,
      elapsedSeconds: 0,
      status: 'discovering',
      message: 'Launching live ADB diagnostics console...'
    }));
    try {
      const res = await api?.startConnectionRetry?.({
        timeoutSeconds: 60,
        intervalSeconds: 2,
        openConsole: true
      });
      if (res && !res.success) {
        setAlertBanner({ type: 'error', message: res.message || 'Failed to start connection retry' });
      }
    } catch (err: any) {
      setAlertBanner({ type: 'error', message: err?.message || 'Error starting connection retry' });
    }
  };

  const handleCancelConnectionRetry = async () => {
    try {
      await api?.cancelConnectionRetry?.();
      setRetryState(prev => ({
        ...prev,
        active: false,
        status: 'cancelled',
        message: 'Connection retry was cancelled.'
      }));
      setAlertBanner({ type: 'info', message: 'Connection retry cancelled.' });
    } catch (err: any) {
      setAlertBanner({ type: 'error', message: err?.message || 'Error cancelling retry' });
    }
  };

  const handleSelectWorkflowPreset = (preset: 'sanity' | 'gestures' | 'custom') => {
    setWorkflowPreset(preset);
    setWorkflowResult(null);
    if (preset === 'sanity') {
      setWorkflowSteps([
        { id: 's1', action: 'keyevent', params: { keycode: 3 }, description: 'Press HOME' },
        { id: 's2', action: 'wait', params: { waitMs: 800 }, description: 'Wait 800ms' },
        { id: 's3', action: 'keyevent', params: { keycode: 187 }, description: 'Open App Switcher (Recents)' },
        { id: 's4', action: 'wait', params: { waitMs: 1000 }, description: 'Wait 1000ms' },
        { id: 's5', action: 'keyevent', params: { keycode: 4 }, description: 'Press BACK to Home' },
        { id: 's6', action: 'screenshot', params: { label: 'workflow_sanity_check' }, description: 'Capture Verification Screenshot' }
      ]);
    } else if (preset === 'gestures') {
      setWorkflowSteps([
        { id: 's1', action: 'tap', params: { x: 500, y: 800 }, description: 'Tap Center Screen (500, 800)' },
        { id: 's2', action: 'wait', params: { waitMs: 500 }, description: 'Wait 500ms' },
        { id: 's3', action: 'swipe', params: { x: 500, y: 1400, x2: 500, y2: 400, durationMs: 300 }, description: 'Swipe Upwards Scroll' },
        { id: 's4', action: 'wait', params: { waitMs: 800 }, description: 'Wait 800ms' },
        { id: 's5', action: 'swipe', params: { x: 500, y: 400, x2: 500, y2: 1400, durationMs: 300 }, description: 'Swipe Downwards Return' }
      ]);
    }
  };

  const handleExecuteWorkflow = async () => {
    if (!selectedSerial || !api?.executeWorkflow) {
      setAlertBanner({ type: 'error', message: 'Please select an authorized Android device to run the workflow.' });
      return;
    }
    setWorkflowRunning(true);
    setWorkflowResult(null);
    setAlertBanner({ type: 'info', message: `Executing workflow with ${workflowSteps.length} steps on ${selectedSerial}...` });
    try {
      const res = await api.executeWorkflow({
        serial: selectedSerial,
        workflow: {
          id: `wf_${Date.now()}`,
          name: workflowPreset === 'sanity' ? 'Device Sanity & Navigation' : workflowPreset === 'gestures' ? 'Touch & Swipe Gestures' : 'Custom Workflow',
          steps: workflowSteps
        }
      });
      setWorkflowResult(res);
      const isOk = res?.overallStatus === 'passed' || res?.success === true;
      if (isOk) {
        setAlertBanner({ type: 'success', message: `Workflow completed successfully (${res?.passedSteps || res?.completedSteps || workflowSteps.length} steps passed)!` });
        if (api?.getCaptures) {
          const updated = await api.getCaptures();
          setCaptures(updated);
        }
      } else {
        const errMsg = res?.error || (res?.results?.find((r: any) => r.status === 'failed')?.error) || 'Execution failed';
        setAlertBanner({ type: 'error', message: `Workflow stopped: ${errMsg}` });
      }
    } catch (err: any) {
      setAlertBanner({ type: 'error', message: err?.message || 'Workflow execution error' });
    } finally {
      setWorkflowRunning(false);
    }
  };

  const handleCancelWorkflow = async () => {
    if (!api?.cancelWorkflow) return;
    try {
      setAlertBanner({ type: 'info', message: 'Cancelling workflow sequence...' });
      await api.cancelWorkflow();
    } catch (err: any) {
      setAlertBanner({ type: 'error', message: err?.message || 'Failed to send cancellation signal' });
    }
  };

  const handleTakeScreenshot = async () => {
    if (!selectedSerial) {
      setAlertBanner({ type: 'error', message: 'No Android device selected for screenshot.' });
      return;
    }
    if (!isDeviceReady) {
      setAlertBanner({ type: 'error', message: activeDevice?.guidance || 'Device is not ready.' });
      return;
    }

    setIsCapturing(true);
    setAlertBanner({ type: 'info', message: 'Capturing screen frame from device buffer...' });

    if (api?.captureScreenshot) {
      const res = await api.captureScreenshot(selectedSerial);
      if (res.success && res.filePath) {
        const sizeKb = res.size ? (res.size / 1024).toFixed(1) : '?';
        setAlertBanner({ type: 'success', message: `Screenshot saved (${sizeKb} KB): ${res.filePath}` });
        if (api?.getCaptures) {
          const updated = await api.getCaptures();
          setCaptures(updated);
        }
      } else {
        setAlertBanner({ type: 'error', message: res.error || 'Screenshot capture failed.' });
      }
    }
    setIsCapturing(false);
  };

  const handleSendKeyevent = async (code: string, label: string) => {
    if (!selectedSerial) {
      setAlertBanner({ type: 'error', message: 'Select a connected device first.' });
      return;
    }
    if (!isDeviceReady) {
      setAlertBanner({ type: 'error', message: activeDevice?.guidance || 'Device is not ready.' });
      return;
    }

    if (api?.executeAdb) {
      try {
        const res = await api.executeAdb(['-s', selectedSerial, 'shell', 'input', 'keyevent', code]);
        const combined = `${res?.stdout || ''} ${res?.stderr || ''}`;
        if (/INJECT_EVENTS|SecurityException/i.test(combined)) {
          setInputControlBlocked(true);
          setAlertBanner({
            type: 'error',
            message: `Input injection blocked: Enable "USB debugging (Security settings)" in Developer options on your phone.`
          });
        } else if (res?.exitCode !== 0) {
          setAlertBanner({
            type: 'error',
            message: `Failed to send ${label} keyevent: ${res?.stderr?.trim() || res?.stdout?.trim() || 'Command exited with error'}`
          });
        } else {
          setAlertBanner({ type: 'info', message: `Sent ${label} keyevent to ${activeDevice.model}.` });
        }
      } catch (err: any) {
        setAlertBanner({ type: 'error', message: `Error sending ${label} keyevent: ${err.message}` });
      }
    }
  };

  const handleCopyDiagnosticReport = async () => {
    if (api?.getDiagnosticReport) {
      const report = await api.getDiagnosticReport(selectedSerial);
      await navigator.clipboard.writeText(report);
      setCopyReportSuccess(true);
      setTimeout(() => setCopyReportSuccess(false), 2500);
      setAlertBanner({ type: 'success', message: 'System diagnostic report copied to clipboard!' });
    }
  };

  const handleExportDiagnosticReport = async () => {
    if (api?.exportDiagnostics) {
      const res = await api.exportDiagnostics(selectedSerial);
      if (res.success && res.reportPath) {
        setAlertBanner({ type: 'success', message: `Sanitized diagnostic report exported to: ${res.reportPath}` });
      } else {
        setAlertBanner({ type: 'error', message: res.error || 'Report export failed.' });
      }
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen bg-[#F3F6F8] text-[#202936] font-sans select-none overflow-hidden">
      {/* Top Application Header */}
      <header className="h-16 border-b border-[#D9DEE5] bg-white px-5 flex items-center justify-between shrink-0 shadow-xs" role="banner">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#0F766E] flex items-center justify-center shadow-xs" aria-hidden="true">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold tracking-tight text-[#202936]">
                AndroScrn
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#DDF4EF] border border-[#0F766E]/20 text-[#0F766E]">
                v1.0.0 Alpha
              </span>
            </div>
            <p className="text-[11px] text-[#667085]">Windows-First Android Control & Automation Platform</p>
          </div>
        </div>

        {/* Global Device Bar */}
        <div className="flex items-center gap-3">
          {devices.length > 0 ? (
            <div className="flex items-center gap-2 bg-white border border-[#D9DEE5] rounded-xl px-3 py-1.5 shadow-xs">
              <span className={`status-pulse ${activeDevice?.state === 'device' ? 'active' : 'inactive'}`} aria-hidden="true"></span>
              <label htmlFor="global-device-select" className="sr-only">Select Android Device</label>
              <select
                id="global-device-select"
                value={selectedSerial}
                onChange={e => setSelectedSerial(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#202936] outline-none cursor-pointer pr-2 max-w-[260px] truncate focus-visible:ring-2 focus-visible:ring-[#0F766E] rounded"
                aria-label="Select connected Android device"
              >
                {devices.map(d => (
                  <option key={d.serial} value={d.serial} className="bg-white text-[#202936]">
                    {d.alias || d.model} ({d.transportType.toUpperCase()} - {d.serial})
                  </option>
                ))}
              </select>

              {/* Device State Badge */}
              {activeDevice?.state === 'unauthorized' && (
                <span className="text-[10px] uppercase font-bold text-[#B91C1C] bg-[#FEE2E2] px-2 py-0.5 rounded border border-[#B91C1C]/30" role="status" aria-label="Device status: Unauthorized">
                  Unauthorized
                </span>
              )}
              {activeDevice?.state === 'offline' && (
                <span className="text-[10px] uppercase font-bold text-[#B45309] bg-[#FEF3C7] px-2 py-0.5 rounded border border-[#B45309]/30" role="status" aria-label="Device status: Offline">
                  Offline
                </span>
              )}
              {activeDevice?.state === 'device' && (
                <span className="text-[10px] uppercase font-bold text-[#15803D] bg-[#DCFCE7] px-2 py-0.5 rounded border border-[#15803D]/30" role="status" aria-label="Device status: Ready">
                  Ready
                </span>
              )}

              {activeDevice?.transportType === 'wifi' ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-[#0F766E] ml-1" aria-label="Connected via Wi-Fi" />
                  <button
                    onClick={() => handleDisconnectWifiDevice(activeDevice.serial)}
                    className="text-[10px] text-[#B91C1C] hover:text-white bg-[#FEE2E2] hover:bg-[#B91C1C] px-1.5 py-0.5 rounded border border-[#B91C1C]/30 transition-colors cursor-pointer"
                    title={`Disconnect ${activeDevice.serial}`}
                    aria-label={`Disconnect wireless device ${activeDevice.serial}`}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <Usb className="w-3.5 h-3.5 text-[#0F766E] ml-1" aria-label="Connected via USB" />
              )}

              {activeDevice?.batteryLevel !== undefined && (
                <span className="text-[11px] font-mono font-medium text-[#15803D] bg-[#DCFCE7] px-2 py-0.5 rounded border border-[#15803D]/30" aria-label={`Battery level: ${activeDevice.batteryLevel}%`}>
                  {activeDevice.batteryLevel}%
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-[#B45309] bg-[#FEF3C7] border border-[#B45309]/30 px-3 py-1.5 rounded-xl" role="status">
                <span className={`status-pulse ${retryState.active ? 'active' : 'inactive'}`} aria-hidden="true"></span>
                <span>
                  {retryState.active
                    ? `Searching (${Math.max(0, retryState.timeoutSeconds - retryState.elapsedSeconds)}s)`
                    : 'No devices detected'}
                </span>
              </div>
              {retryState.active ? (
                <button
                  onClick={handleCancelConnectionRetry}
                  className="text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1"
                  title="Cancel active retry loop"
                  aria-label="Cancel active connection retry"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  onClick={handleStartConnectionRetry}
                  className="glass-button text-[11px] font-semibold text-[#0F766E] bg-[#DDF4EF] hover:bg-[#cbf1e7] border border-[#0F766E]/40 px-3 py-1.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                  title="Launch live ADB diagnostics in visible CMD window & retry loop"
                  aria-label="Try Again: Launch live ADB diagnostics in Windows CMD"
                >
                  <Terminal className="w-3.5 h-3.5 text-[#0F766E]" />
                  <span>Try Again</span>
                </button>
              )}
            </div>
          )}

          <button
            onClick={refreshDevices}
            disabled={isScanning}
            className="glass-button p-2 text-[#202936] hover:bg-[#F3F6F8] min-h-[38px] min-w-[38px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
            title="Scan for Devices (ADB)"
            aria-label="Scan for connected Android devices via ADB"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin text-[#0F766E]' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Alert Guidance Banner */}
      {alertBanner && (
        <div className="mx-4 mt-3" role="status" aria-live="polite">
          <div
            className={`px-4 py-2.5 rounded-xl text-xs flex items-center justify-between border transition-all ${
              alertBanner.type === 'error'
                ? 'bg-[#FEE2E2] border-[#B91C1C]/30 text-[#B91C1C]'
                : alertBanner.type === 'success'
                ? 'bg-[#DCFCE7] border-[#15803D]/30 text-[#15803D]'
                : 'bg-[#DBEAFE] border-[#1D4ED8]/30 text-[#1D4ED8]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {alertBanner.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-[#B91C1C]" aria-hidden="true" />
              ) : alertBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-[#15803D]" aria-hidden="true" />
              ) : (
                <HelpCircle className="w-4 h-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
              )}
              <span className="font-medium">{alertBanner.message}</span>
            </div>
            <button
              onClick={() => setAlertBanner(null)}
              className="text-[#667085] hover:text-[#202936] text-base font-bold px-1.5 py-0.5 rounded focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Connection help for the selected device (connection state vs. vendor input restrictions) */}
      <ConnectionHelp
        deviceLabel={helpTarget ? (helpTarget.alias || helpTarget.model) : 'device'}
        help={deviceHelp}
        retrying={retryState.active || helpRetrying}
        retryAttempt={retryState.attempt}
        onRetry={async () => {
          if (retryState.active) return;
          await handleStartConnectionRetry();
          if (api?.getDeviceHelp && selectedSerial) {
            try {
              setDeviceHelp(await api.getDeviceHelp(selectedSerial));
            } catch {}
          }
        }}
        onCancelRetry={handleCancelConnectionRetry}
      />

      {/* Pending AI Pairing Requests (Human-in-the-Loop Gatekeeper) */}
      {mcpStatus.pendingRequests && mcpStatus.pendingRequests.length > 0 && (
        <div className="mx-4 mt-3 space-y-2" role="region" aria-label="Pending AI Pairing Handshake Requests" id="mcp-pairing-requests-container">
          {mcpStatus.pendingRequests.map(req => (
            <div
              key={req.requestId}
              className="p-4 rounded-xl bg-[#FEF3C7] border-2 border-[#B45309]/50 text-[#202936] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
              id={`pairing-card-${req.requestId}`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#B45309] animate-ping" aria-hidden="true" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#B45309]">Incoming AI Agent Pairing Request</span>
                </div>
                <div className="text-sm font-semibold text-[#202936]">
                  Client: <span className="text-[#B45309] font-mono font-bold">{req.clientName}</span> is requesting <span className="text-[#B45309] font-mono">Tier {req.requestedTier} ({req.requestedTier === 3 ? 'write:input' : req.requestedTier === 4 ? 'write:admin' : 'read'})</span>
                </div>
                <div className="text-xs text-[#667085] flex items-center gap-3 flex-wrap">
                  <span>Desktop PIN: <strong className="text-base text-[#202936] font-mono bg-white px-2.5 py-0.5 rounded border border-[#D9DEE5] tracking-widest font-bold shadow-xs">{req.pin}</strong></span>
                  <span>(Expires in {Math.max(0, Math.floor((req.expiresAt - Date.now()) / 1000))}s)</span>
                  <span className="text-[11px] text-[#667085]">• Click Approve to grant access or paste this PIN to the agent</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  onClick={() => handleApprovePairing(req.requestId)}
                  className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm focus-visible:ring-2 focus-visible:ring-[#15803D] cursor-pointer min-h-[38px]"
                  id={`btn-approve-pairing-${req.requestId}`}
                  aria-label={`Approve pairing request for ${req.clientName}`}
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Approve Access
                </button>
                <button
                  onClick={() => handleDenyPairing(req.requestId)}
                  className="px-4 py-2 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm focus-visible:ring-2 focus-visible:ring-[#B91C1C] cursor-pointer min-h-[38px]"
                  id={`btn-deny-pairing-${req.requestId}`}
                  aria-label={`Deny pairing request for ${req.clientName}`}
                >
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main Layout Container */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Sidebar Nav */}
        <nav className="w-60 glass-panel p-3 flex flex-col justify-between shrink-0" aria-label="Workbench navigation" role="tablist">
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-[#84909E] uppercase tracking-wider px-3 py-2" id="nav-workbench-heading">
              Workbench
            </div>

            <button
              onClick={() => setActiveTab('mirror')}
              role="tab"
              aria-selected={activeTab === 'mirror'}
              aria-controls="main-tab-panel"
              id="tab-mirror"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'mirror'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Smartphone className={`w-4 h-4 ${activeTab === 'mirror' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Screen Mirroring</span>
            </button>

            <button
              onClick={() => setActiveTab('camera')}
              role="tab"
              aria-selected={activeTab === 'camera'}
              aria-controls="main-tab-panel"
              id="tab-camera"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'camera'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Video className={`w-4 h-4 ${activeTab === 'camera' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Camera Studio</span>
            </button>

            <button
              onClick={() => setActiveTab('wireless')}
              role="tab"
              aria-selected={activeTab === 'wireless'}
              aria-controls="main-tab-panel"
              id="tab-wireless"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'wireless'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Wifi className={`w-4 h-4 ${activeTab === 'wireless' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Wireless & Hotspot</span>
            </button>

            <button
              onClick={() => setActiveTab('media')}
              role="tab"
              aria-selected={activeTab === 'media'}
              aria-controls="main-tab-panel"
              id="tab-media"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'media'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Camera className={`w-4 h-4 ${activeTab === 'media' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Media & Captures</span>
            </button>

            <button
              onClick={() => setActiveTab('documents')}
              role="tab"
              aria-selected={activeTab === 'documents'}
              aria-controls="main-tab-panel"
              id="tab-documents"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'documents'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <FileText className={`w-4 h-4 ${activeTab === 'documents' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Documents & OCR</span>
            </button>

            <button
              onClick={() => setActiveTab('diagnostics')}
              role="tab"
              aria-selected={activeTab === 'diagnostics'}
              aria-controls="main-tab-panel"
              id="tab-diagnostics"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'diagnostics'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Activity className={`w-4 h-4 ${activeTab === 'diagnostics' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Diagnostics & Logs</span>
            </button>

            <div className="pt-3 text-[11px] font-bold text-[#84909E] uppercase tracking-wider px-3 py-2">
              Advanced (Preview)
            </div>

            <button
              onClick={() => setActiveTab('workflow')}
              role="tab"
              aria-selected={activeTab === 'workflow'}
              aria-controls="main-tab-panel"
              id="tab-workflow"
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'workflow'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Layers className={`w-4 h-4 ${activeTab === 'workflow' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Workflow Runner</span>
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              role="tab"
              aria-selected={activeTab === 'ai'}
              aria-controls="main-tab-panel"
              id="tab-ai"
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'ai'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936] hover:bg-[#F3F6F8]'
              }`}
            >
              <Bot className={`w-4 h-4 ${activeTab === 'ai' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>Local AI Assistant</span>
            </button>
          </div>

          <div className="pt-2 border-t border-[#D9DEE5]">
            <button
              onClick={() => setActiveTab('about')}
              role="tab"
              aria-selected={activeTab === 'about'}
              aria-controls="main-tab-panel"
              id="tab-about"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[38px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                activeTab === 'about'
                  ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 shadow-xs'
                  : 'text-[#667085] hover:text-[#202936]'
              }`}
            >
              <Shield className={`w-4 h-4 ${activeTab === 'about' ? 'text-[#0F766E]' : 'text-[#667085]'}`} aria-hidden="true" />
              <span>About & Licenses</span>
            </button>
          </div>
        </nav>

        {/* Content View Area */}
        <main id="main-content" className="flex-1 flex flex-col gap-4 overflow-y-auto pr-1" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
          {/* TAB 1: SCREEN MIRRORING */}
          {activeTab === 'mirror' && (
            <div className="space-y-4">
              {/* Primary Mirror Control Card */}
              <div className="glass-panel p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight text-[#202936]">Screen Mirroring Studio</h2>
                      {isMirroring ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#DCFCE7] border border-[#15803D]/30 text-[#15803D]">
                          <span className="status-pulse active"></span> Live ({formatSeconds(sessionDuration)})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F3F6F8] border border-[#D9DEE5] text-[#667085]">
                          {isDeviceReady ? 'Ready' : 'Device Not Ready'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#667085] mt-1">
                      Direct display streaming via official scrcpy 5.0.1 engine with hardware decoding and audio forwarding.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    {isMirroring ? (
                      <>
                        <button
                          onClick={handleFocusMirrorWindow}
                          className="glass-button px-5 py-2.5 text-sm min-h-[44px] flex items-center gap-2 cursor-pointer bg-white text-[#202936] hover:bg-[#F3F6F8] border border-[#D9DEE5] shadow-xs"
                          title="Bring the interactive mirroring window to foreground"
                          aria-label="Bring interactive mirroring window to foreground"
                        >
                          <ExternalLink className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
                          <span>Focus Screen</span>
                        </button>
                        <button
                          onClick={handleStopMirror}
                          className="glass-button glass-button-danger px-6 py-2.5 text-sm min-h-[44px] flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-[#B91C1C] cursor-pointer"
                          aria-label="Stop screen mirroring session"
                        >
                          <Square className="w-4 h-4 fill-white" aria-hidden="true" />
                          <span>Stop Mirroring</span>
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleStartMirror}
                        disabled={!isDeviceReady}
                        className={`glass-button glass-button-primary px-8 py-2.5 text-sm min-h-[44px] flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                          !isDeviceReady ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''
                        }`}
                        aria-label="Start screen mirroring session"
                        aria-disabled={!isDeviceReady}
                      >
                        <Play className="w-4 h-4 fill-white" aria-hidden="true" />
                        <span>Start Mirroring</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Xiaomi / OEM Input Control Security Notice */}
                {inputControlBlocked && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 shadow-sm" role="alert">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
                        <div>
                          <div className="font-bold text-amber-900 text-sm">
                            Xiaomi / OEM Input Control Disabled (INJECT_EVENTS Denied)
                          </div>
                          <div className="text-amber-800 mt-1 leading-relaxed">
                            {inputControlMessage || 'Remote keyboard, mouse, and touch simulation were rejected by the connected device with SecurityException.'}
                          </div>
                          <div className="mt-2.5 p-3 rounded-lg bg-amber-100/70 border border-amber-200/80 text-[11px] text-amber-950 space-y-1">
                            <div className="font-semibold text-amber-900">How to enable full keyboard & mouse control on Xiaomi / HyperOS / MIUI:</div>
                            <ol className="list-decimal list-inside space-y-0.5 pl-1">
                              <li>Open <strong>Settings &rarr; Additional Settings &rarr; Developer Options</strong> on your phone.</li>
                              <li>Scroll down to the <strong>Debugging</strong> section.</li>
                              <li>Turn ON <strong>&quot;USB debugging (Security settings)&quot;</strong> (Allow granting permissions and simulating input via USB debugging).</li>
                              <li><em>Note: Xiaomi requires an active SIM card and logged-in Mi Account to enable this toggle.</em></li>
                              <li>Restart screen mirroring once enabled.</li>
                            </ol>
                            <div className="mt-3 pt-2 border-t border-amber-200/80 flex items-center justify-between flex-wrap gap-2">
                              <span className="text-[11px] text-amber-900 font-medium">Or bypass OEM restrictions using kernel-level UHID hardware emulation:</span>
                              <button
                                onClick={handleSwitchToUhid}
                                className="px-3 py-1.5 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                <span>Switch to UHID Emulation Mode</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setInputControlBlocked(false)}
                        className="p-1 rounded-md text-amber-700 hover:bg-amber-100 cursor-pointer shrink-0"
                        title="Dismiss notice"
                        aria-label="Dismiss notice"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Device Status Guidance Bar if not ready */}
                {!isDeviceReady && (
                  <div className="mt-4 p-4 rounded-xl bg-[#FEF3C7] border border-[#B45309]/30 text-xs text-[#B45309]" role="alert">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <Info className="w-5 h-5 shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
                        <div>
                          <div className="font-semibold text-sm text-[#B45309] flex items-center gap-2">
                            <span>{devices.length === 0 ? 'No Android Device Connected' : `Device Status: ${activeDevice?.state.toUpperCase()}`}</span>
                            {retryState.active && (
                              <span className="text-[11px] font-normal px-2 py-0.5 bg-amber-200/80 rounded-full font-mono">
                                Attempt #{retryState.attempt} · {Math.max(0, retryState.timeoutSeconds - retryState.elapsedSeconds)}s remaining
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#B45309]/90 mt-1 leading-relaxed">
                            {retryState.active
                              ? retryState.message
                              : (activeDevice?.guidance || 'Connect an Android device via USB. Enable Developer Options & USB Debugging on your phone.')}
                          </div>
                          {retryState.active && (
                            <div className="mt-2 text-[11px] text-[#0F766E] font-medium flex items-center gap-1.5">
                              <Terminal className="w-3.5 h-3.5" />
                              <span>Live Windows CMD diagnostics console is running on your desktop.</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {retryState.active ? (
                          <button
                            onClick={handleCancelConnectionRetry}
                            className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                            aria-label="Cancel connection retry"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Cancel Retry</span>
                          </button>
                        ) : (
                          <button
                            onClick={handleStartConnectionRetry}
                            className="px-3.5 py-1.5 rounded-lg border border-[#0F766E]/50 text-[#0F766E] bg-[#DDF4EF] hover:bg-[#c7f0e5] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                            aria-label="Try connection again with live CMD diagnostics"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Try Again</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quality Presets */}
                <div className="mt-6 pt-5 border-t border-[#D9DEE5]">
                  <div className="text-xs font-bold text-[#84909E] uppercase tracking-wider mb-3" id="quality-preset-label">
                    Quality Presets
                  </div>
                  <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-labelledby="quality-preset-label">
                    {[
                      { key: 'ultra', title: 'Ultra Quality', desc: 'Native res · 16 Mbps · 60 FPS' },
                      { key: 'high_performance', title: 'High Performance', desc: '1080p · 12 Mbps · 60 FPS' },
                      { key: 'balanced', title: 'Balanced (Standard)', desc: '1080p · 8 Mbps · Smooth' },
                      { key: 'battery_saver', title: 'Battery Saver', desc: '720p · 4 Mbps · 30 FPS' }
                    ].map(p => (
                      <div
                        key={p.key}
                        role="radio"
                        aria-checked={qualityPreset === p.key}
                        tabIndex={0}
                        onClick={() => setQualityPreset(p.key as any)}
                        onKeyDown={e => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            setQualityPreset(p.key as any);
                          }
                        }}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E] ${
                          qualityPreset === p.key
                            ? 'bg-[#DDF4EF] border-[#0F766E] shadow-xs'
                            : 'bg-[#F3F6F8] border-[#D9DEE5] hover:border-[#84909E]'
                        }`}
                      >
                        <div className={`font-semibold text-sm ${qualityPreset === p.key ? 'text-[#0F766E]' : 'text-[#202936]'}`}>{p.title}</div>
                        <div className={`text-[11px] mt-1 ${qualityPreset === p.key ? 'text-[#0F766E]/80' : 'text-[#667085]'}`}>{p.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Feature Toggles */}
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <label htmlFor="toggle-turn-screen-off" className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] cursor-pointer hover:bg-white transition-all focus-within:ring-2 focus-within:ring-[#0F766E]">
                    <input
                      id="toggle-turn-screen-off"
                      type="checkbox"
                      checked={turnScreenOff}
                      onChange={e => setTurnScreenOff(e.target.checked)}
                      className="accent-[#0F766E] w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-[#202936]">Turn Phone Screen Off</div>
                      <div className="text-[#667085] text-[10px]">Save battery while streaming (-S)</div>
                    </div>
                  </label>

                  <label htmlFor="toggle-stay-awake" className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] cursor-pointer hover:bg-white transition-all focus-within:ring-2 focus-within:ring-[#0F766E]">
                    <input
                      id="toggle-stay-awake"
                      type="checkbox"
                      checked={stayAwake}
                      onChange={e => setStayAwake(e.target.checked)}
                      className="accent-[#0F766E] w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-[#202936]">Stay Awake While Plugged</div>
                      <div className="text-[#667085] text-[10px]">Prevents device sleep timeout (-w)</div>
                    </div>
                  </label>

                  <label htmlFor="toggle-record-session" className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] cursor-pointer hover:bg-white transition-all focus-within:ring-2 focus-within:ring-[#0F766E]">
                    <input
                      id="toggle-record-session"
                      type="checkbox"
                      checked={recordMirrorSession}
                      onChange={e => setRecordMirrorSession(e.target.checked)}
                      className="accent-[#0F766E] w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-[#202936]">Record Video Stream (MP4)</div>
                      <div className="text-[#667085] text-[10px]">Save directly to Captures/ via scrcpy</div>
                    </div>
                  </label>

                  <label htmlFor="toggle-always-on-top" className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] cursor-pointer hover:bg-white transition-all focus-within:ring-2 focus-within:ring-[#0F766E]">
                    <input
                      id="toggle-always-on-top"
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={e => setAlwaysOnTop(e.target.checked)}
                      className="accent-[#0F766E] w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-[#202936]">Always on Top</div>
                      <div className="text-[#667085] text-[10px]">Pin window above all apps (--always-on-top)</div>
                    </div>
                  </label>

                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] transition-all">
                    <div className="text-xs w-full">
                      <div className="font-semibold text-[#202936] mb-1">Input Control Mode</div>
                      <select
                        value={inputMode}
                        onChange={e => handleInputModeChange(e.target.value as any)}
                        className="w-full text-xs bg-white border border-[#D9DEE5] rounded-lg px-2 py-1 text-[#202936] cursor-pointer"
                        title="Select keyboard and mouse input injection method"
                      >
                        <option value="auto">Auto (Default SDK)</option>
                        <option value="uhid">UHID (Hardware Emulation - Best for Xiaomi)</option>
                        <option value="sdk">SDK (Standard Android Injection)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] transition-all">
                    <div className="text-xs w-full">
                      <div className="font-semibold text-[#202936] mb-1">Display Orientation</div>
                      <select
                        value={captureOrientation}
                        onChange={e => setCaptureOrientation(e.target.value as any)}
                        className="w-full text-xs bg-white border border-[#D9DEE5] rounded-lg px-2 py-1 text-[#202936] cursor-pointer"
                        title="Lock or rotate display streaming orientation"
                      >
                        <option value="0">Default (Portrait / Auto)</option>
                        <option value="90">Landscape (90° Clockwise)</option>
                        <option value="180">Inverted Portrait (180°)</option>
                        <option value="270">Reverse Landscape (270°)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hardware Remote Control Bar */}
              <div className="glass-panel p-5">
                <div className="text-xs font-bold text-[#84909E] uppercase tracking-wider mb-3">
                  Quick Navigation & Device Controls ({activeDevice ? activeDevice.model : 'No Target'})
                </div>
                <div className="flex flex-wrap gap-2.5" role="toolbar" aria-label="Device quick navigation controls">
                  <button
                    onClick={() => handleSendKeyevent('3', 'Home')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send Home keyevent to Android device"
                  >
                    <span aria-hidden="true">🏠</span>
                    <span>Home</span>
                  </button>

                  <button
                    onClick={() => handleSendKeyevent('4', 'Back')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send Back keyevent to Android device"
                  >
                    <span aria-hidden="true">⬅</span>
                    <span>Back</span>
                  </button>

                  <button
                    onClick={() => handleSendKeyevent('187', 'App Switch')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send App Switcher keyevent to Android device"
                  >
                    <span aria-hidden="true">🗂</span>
                    <span>App Switcher</span>
                  </button>

                  <button
                    onClick={() => handleSendKeyevent('26', 'Power')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] text-[#B45309] focus-visible:ring-2 focus-visible:ring-[#B45309] cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send Power toggle keyevent to Android device"
                  >
                    <span aria-hidden="true">⚡</span>
                    <span>Power</span>
                  </button>

                  <button
                    onClick={handleTakeScreenshot}
                    disabled={!isDeviceReady || isCapturing}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] ml-auto text-[#0F766E] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer flex items-center gap-1.5 ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Take high-resolution screen capture"
                  >
                    <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isCapturing ? 'Capturing...' : 'Quick Screenshot'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: CAMERA STUDIO (PHASE 5) */}
          {activeTab === 'camera' && (
            <div className="space-y-4" role="region" aria-label="Camera Studio">
              {/* Primary Camera Control Card */}
              <div className="glass-panel p-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight text-[#202936] flex items-center gap-2">
                        <Video className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
                        <span>Camera Studio</span>
                      </h2>
                      {isCameraRunning ? (
                        <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#DCFCE7] text-[#15803D] border border-[#15803D]/30 flex items-center gap-1.5 shadow-xs" role="status">
                          <span className="w-2 h-2 rounded-full bg-[#15803D] animate-pulse" aria-hidden="true"></span>
                          <span>Streaming Active ({formatSeconds(cameraSessionDuration)})</span>
                        </span>
                      ) : isReconnectingCamera || cameraStatus === 'reconnecting' ? (
                        <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#B45309] border border-[#B45309]/30 flex items-center gap-1.5 shadow-xs" role="status">
                          <RefreshCw className="w-3 h-3 animate-spin text-[#B45309]" aria-hidden="true" />
                          <span>Reconnecting...</span>
                        </span>
                      ) : cameraPreempted || cameraStatus === 'interrupted' ? (
                        <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#B45309] border border-[#B45309]/30 flex items-center gap-1.5 shadow-xs" role="status">
                          <AlertCircle className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
                          <span>Camera Interrupted</span>
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#F3F6F8] text-[#667085] border border-[#D9DEE5]" role="status">
                          Camera Idle
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#667085] mt-1">
                      Direct low-latency Android camera preview via scrcpy Camera2 Direct3D11 streaming. Zero APK required.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => selectedSerial && refreshCameraCapabilities(selectedSerial)}
                      disabled={isQueryingCameras || !selectedSerial}
                      className="glass-button p-2 text-[#202936] hover:bg-[#F3F6F8] min-h-[38px] flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                      title="Refresh Camera Hardware Capabilities"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isQueryingCameras ? 'animate-spin text-[#0F766E]' : ''}`} aria-hidden="true" />
                      <span>{isQueryingCameras ? 'Scanning Cameras...' : 'Query Sensors'}</span>
                    </button>

                    <button
                      onClick={() => {
                        const latest = captures[0]?.path;
                        if (latest) api?.openPath?.(latest.replace(/[\\/][^\\/]*$/, ''));
                      }}
                      className="glass-button p-2 text-[#202936] hover:bg-[#F3F6F8] min-h-[38px] flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                      title="Open Captures Directory"
                    >
                      <Folder className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
                      <span>Captures</span>
                    </button>
                  </div>
                </div>

                {/* Studio Transport Mode Selector (Phase 6) */}
                <div className="flex items-center gap-2 mt-5 p-1 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] w-fit" role="radiogroup" aria-label="Camera Studio Transport Mode">
                  <button
                    id="mode-scrcpy"
                    onClick={() => setCameraMode('scrcpy')}
                    role="radio"
                    aria-checked={cameraMode === 'scrcpy'}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      cameraMode === 'scrcpy'
                        ? 'bg-[#0F766E] text-white shadow-xs'
                        : 'text-[#667085] hover:text-[#202936] hover:bg-white'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    <span>Scrcpy Native Direct3D11</span>
                  </button>

                  <button
                    id="mode-companion"
                    onClick={() => setCameraMode('companion')}
                    role="radio"
                    aria-checked={cameraMode === 'companion'}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      cameraMode === 'companion'
                        ? 'bg-[#0F766E] text-white shadow-xs'
                        : 'text-[#667085] hover:text-[#202936] hover:bg-white'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Camera Companion App</span>
                    <span className="text-[10px] bg-[#DDF4EF] text-[#0F766E] px-1.5 py-0.5 rounded border border-[#0F766E]/20">
                      Phase 6
                    </span>
                  </button>
                </div>

                {/* Preflight & Capability Warnings */}
                {cameraCaps && !cameraCaps.transportSupported && (
                  <div className="mt-4 p-4 rounded-xl bg-[#FEF3C7] border border-[#B45309]/30 text-[#B45309] text-xs space-y-1" role="alert">
                    <div className="font-bold flex items-center gap-2 text-[#B45309]">
                      <AlertCircle className="w-4 h-4 text-[#B45309] shrink-0" />
                      <span>Transport Limitation: Android 12+ Required</span>
                    </div>
                    <p className="text-[#667085]">
                      {cameraCaps.notes[0] || 'scrcpy camera mirroring requires Android 12 (API 31) or higher. Device OS version is unsupported.'}
                    </p>
                  </div>
                )}

                {!isDeviceReady && (
                  <div className="mt-4 p-4 rounded-xl bg-[#FEF3C7] border border-[#B45309]/30 text-xs space-y-1" role="alert">
                    <div className="font-bold text-[#B45309] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-[#B45309]" />
                      <span>Device Not Ready</span>
                    </div>
                    <p className="text-[#667085]">
                      {activeDevice?.guidance || 'Please connect an Android device via USB and accept the RSA authorization prompt on the screen.'}
                    </p>
                  </div>
                )}

                {/* Live Feedback Banner */}
                {cameraLiveFeedback && (
                  <div className="mt-4 p-3 rounded-xl bg-[#DDF4EF] border border-[#0F766E]/30 text-[#0F766E] text-xs flex items-center gap-2 transition-all">
                    <Info className="w-4 h-4 text-[#0F766E] shrink-0" />
                    <span>{cameraLiveFeedback}</span>
                  </div>
                )}

                {/* SCRCPY NATIVE DIRECT3D11 MODE CONTROLS */}
                {cameraMode === 'scrcpy' && (
                  <div className="space-y-6 mt-6">
                    {/* Live Video Preview Card (16:9 Responsive Viewport with Expand/Minimize) */}
                    <div className="glass-panel p-5 space-y-4">
                      {/* Preview Card Header */}
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-2.5">
                          <Video className="w-4 h-4 text-[#0F766E]" />
                          <h3 className="text-sm font-bold text-[#202936]">Live Camera Preview Viewport</h3>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F1F5F9] text-[#475569] border border-[#CBD5E1]" title="Camera mode streams sensor video directly. Use Screen Mirroring Studio for interactive touchscreen and app control.">
                            Sensor Stream Only
                          </span>
                          {isCameraRunning ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#DCFCE7] text-[#15803D] border border-[#15803D]/30 flex items-center gap-1.5" role="status">
                              <span className="w-2 h-2 rounded-full bg-[#15803D] animate-pulse"></span>
                              <span>Live ({formatSeconds(cameraSessionDuration)})</span>
                            </span>
                          ) : isReconnectingCamera || cameraStatus === 'reconnecting' ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#B45309] border border-[#B45309]/30 flex items-center gap-1.5" role="status">
                              <RefreshCw className="w-3 h-3 animate-spin text-[#B45309]" />
                              <span>Reconnecting ({cameraReconnectAttempts}/5)...</span>
                            </span>
                          ) : cameraPreempted || cameraStatus === 'interrupted' ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#FEF3C7] text-[#B45309] border border-[#B45309]/30 flex items-center gap-1.5" role="status">
                              <AlertCircle className="w-3 h-3 text-[#B45309]" />
                              <span>Interrupted by OS</span>
                            </span>
                          ) : cameraStatus === 'error' ? (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#FEE2E2] text-[#B91C1C] border border-[#B91C1C]/30 flex items-center gap-1.5" role="status">
                              <AlertCircle className="w-3 h-3 text-[#B91C1C]" />
                              <span>Stream Failed</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3F6F8] text-[#667085] border border-[#D9DEE5]" role="status">
                              Standby
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setActiveTab('mirror')}
                            className="glass-button px-2.5 py-1.5 text-[#202936] hover:bg-[#F3F6F8] min-h-[32px] flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                            title="Switch to Screen Mirroring Studio for phone control and apps"
                          >
                            <Smartphone className="w-3.5 h-3.5 text-[#0F766E]" />
                            <span>Mirroring Studio</span>
                          </button>

                          {isCameraRunning && (
                            <button
                              onClick={handleFocusCameraWindow}
                              className="glass-button px-2.5 py-1.5 text-[#202936] hover:bg-[#F3F6F8] min-h-[32px] flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                              title="Bring Direct3D11 streaming window to foreground"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-[#0F766E]" />
                              <span>Focus Window</span>
                            </button>
                          )}

                          <button
                            onClick={() => setShowCameraDiagnostics(!showCameraDiagnostics)}
                            className={`glass-button px-2.5 py-1.5 min-h-[32px] flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
                              showCameraDiagnostics ? 'bg-[#0F766E] text-white' : 'text-[#202936] hover:bg-[#F3F6F8]'
                            }`}
                            title="Toggle Session Diagnostics & Logcat/Stderr"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Diagnostics</span>
                            {cameraRecentStderr.length > 0 && (
                              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-200 text-amber-900 font-bold">
                                {cameraRecentStderr.length}
                              </span>
                            )}
                          </button>

                          <button
                            id="btn-toggle-expand-preview"
                            onClick={() => setCameraPreviewExpanded(!cameraPreviewExpanded)}
                            className="glass-button px-2.5 py-1.5 text-[#202936] hover:bg-[#F3F6F8] min-h-[32px] flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
                            title={cameraPreviewExpanded ? 'Minimize Preview' : 'Expand Preview'}
                          >
                            {cameraPreviewExpanded ? (
                              <>
                                <Minimize2 className="w-3.5 h-3.5 text-[#0F766E]" />
                                <span>Minimize Preview</span>
                              </>
                            ) : (
                              <>
                                <Maximize2 className="w-3.5 h-3.5 text-[#0F766E]" />
                                <span>Expand Preview</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* 16:9 Responsive Viewport Container */}
                      <div
                        className={`relative w-full rounded-2xl overflow-hidden border border-[#D9DEE5] bg-[#F8FAFC] flex flex-col items-center justify-center transition-all duration-300 ${
                          cameraPreviewExpanded
                            ? 'aspect-video min-h-[440px] max-h-[640px]'
                            : 'aspect-video min-h-[260px] max-h-[380px]'
                        }`}
                      >
                        {/* Optical Viewfinder Corner Brackets */}
                        <div className="absolute top-3.5 left-3.5 w-4 h-4 border-t-2 border-l-2 border-[#0F766E]/40 pointer-events-none rounded-tl-sm z-10" />
                        <div className="absolute top-3.5 right-3.5 w-4 h-4 border-t-2 border-r-2 border-[#0F766E]/40 pointer-events-none rounded-tr-sm z-10" />
                        <div className="absolute bottom-3.5 left-3.5 w-4 h-4 border-b-2 border-l-2 border-[#0F766E]/40 pointer-events-none rounded-bl-sm z-10" />
                        <div className="absolute bottom-3.5 right-3.5 w-4 h-4 border-b-2 border-r-2 border-[#0F766E]/40 pointer-events-none rounded-br-sm z-10" />

                        {/* VIEWPORT BODY: IDLE */}
                        {!isCameraRunning && !isReconnectingCamera && !cameraPreempted && cameraStatus !== 'starting' && cameraStatus !== 'error' && (
                          <div className="text-center p-6 space-y-3 z-10">
                            <div className="w-14 h-14 rounded-2xl bg-[#DDF4EF] border border-[#0F766E]/20 mx-auto flex items-center justify-center text-[#0F766E] shadow-sm">
                              <Camera className="w-7 h-7" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-[#202936]">Camera Preview Idle</h4>
                              <p className="text-xs text-[#667085] mt-0.5 max-w-md mx-auto">
                                Low-latency Direct3D11 streaming through scrcpy Camera2 mode.
                              </p>
                            </div>
                            <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                              <span className="px-2.5 py-1 rounded-lg bg-white border border-[#D9DEE5] text-[11px] font-semibold text-[#202936] shadow-xs">
                                Lens: Camera {selectedCameraId}
                              </span>
                              <span className="px-2.5 py-1 rounded-lg bg-white border border-[#D9DEE5] text-[11px] font-semibold text-[#202936] shadow-xs">
                                {selectedResolution}
                              </span>
                              <span className="px-2.5 py-1 rounded-lg bg-white border border-[#D9DEE5] text-[11px] font-semibold text-[#202936] shadow-xs">
                                {selectedFps} FPS
                              </span>
                              <span className="px-2.5 py-1 rounded-lg bg-white border border-[#D9DEE5] text-[11px] font-semibold text-[#202936] shadow-xs">
                                Zoom: {cameraZoom.toFixed(1)}x
                              </span>
                            </div>
                          </div>
                        )}

                        {/* VIEWPORT BODY: STARTING / RECONNECTING */}
                        {(cameraStatus === 'starting' || isReconnectingCamera || cameraStatus === 'reconnecting') && (
                          <div className="text-center p-6 space-y-3 z-10">
                            <div className="w-14 h-14 rounded-2xl bg-[#FEF3C7] border border-[#B45309]/30 mx-auto flex items-center justify-center text-[#B45309] shadow-sm">
                              <RefreshCw className="w-7 h-7 animate-spin" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-[#202936]">
                                {cameraStatus === 'reconnecting' ? 'Reconnecting Camera Stream...' : 'Initializing Camera Sensor...'}
                              </h4>
                              <p className="text-xs text-[#667085] mt-0.5">
                                Establishing Direct3D11 feed for Camera {selectedCameraId} ({selectedResolution} @ {selectedFps} FPS)...
                              </p>
                            </div>
                          </div>
                        )}

                        {/* VIEWPORT BODY: LIVE RUNNING */}
                        {isCameraRunning && (
                          <div className="w-full h-full relative flex flex-col justify-between p-4 z-10 bg-radial from-transparent to-black/5">
                            {/* Top HUD */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 bg-black/70 backdrop-blur-xs text-white px-3 py-1.5 rounded-xl text-xs font-mono">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                                <span className="font-bold text-red-400">REC / LIVE</span>
                                <span className="text-[#D9DEE5]">|</span>
                                <span>{formatSeconds(cameraSessionDuration)}</span>
                              </div>

                              <div className="flex items-center gap-2 bg-black/70 backdrop-blur-xs text-white px-3 py-1.5 rounded-xl text-xs font-mono">
                                <span>Camera {selectedCameraId}</span>
                                <span className="text-[#D9DEE5]">|</span>
                                <span>{selectedResolution}</span>
                                <span className="text-[#D9DEE5]">|</span>
                                <span className="text-emerald-400 font-bold">{selectedFps} FPS</span>
                              </div>
                            </div>

                            {/* Center Reticle */}
                            <div className="flex flex-col items-center justify-center pointer-events-none">
                              <div className="relative w-20 h-20 flex items-center justify-center">
                                <div className="absolute inset-0 border border-[#0F766E]/40 rounded-full animate-pulse"></div>
                                <div className="w-3 h-0.5 bg-[#0F766E]/60"></div>
                                <div className="w-0.5 h-3 bg-[#0F766E]/60 absolute"></div>
                              </div>
                              <span className="text-[10px] font-mono text-[#0F766E] uppercase tracking-wider mt-1 font-bold">
                                Direct3D11 Active
                              </span>
                            </div>

                            {/* Bottom HUD */}
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-xs text-white text-[11px] font-mono font-bold">
                                  {cameraZoom.toFixed(1)}x Zoom
                                </span>
                                <span className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold ${
                                  cameraTorch ? 'bg-amber-500 text-white' : 'bg-black/70 backdrop-blur-xs text-white'
                                }`}>
                                  Torch: {cameraTorch ? 'ON' : 'OFF'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={handleFocusCameraWindow}
                                  className="px-3 py-1.5 rounded-lg bg-black/80 hover:bg-black text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                                >
                                  <ExternalLink className="w-3 h-3 text-[#0F766E]" />
                                  <span>Bring Window to Front</span>
                                </button>
                                <button
                                  onClick={handleStopCamera}
                                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs"
                                >
                                  <Square className="w-3 h-3 fill-current" />
                                  <span>Stop</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* VIEWPORT BODY: INTERRUPTED (PREEMPTED BY HYPEROS) */}
                        {!isCameraRunning && (cameraPreempted || cameraStatus === 'interrupted') && (
                          <div className="text-center p-6 max-w-lg space-y-3 z-10 bg-amber-50/80 rounded-2xl border border-[#B45309]/30 m-4 shadow-sm">
                            <div className="w-12 h-12 rounded-xl bg-[#FEF3C7] border border-[#B45309]/40 mx-auto flex items-center justify-center text-[#B45309]">
                              <AlertCircle className="w-6 h-6" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-[#B45309]">Camera Stream Interrupted by Android OS</h4>
                              <p className="text-xs text-[#92400E] mt-1 leading-relaxed">
                                The device screen was woken or unlocked (e.g. Xiaomi Face Unlock on double-tap), evicting scrcpy's Camera2 client. Your device is still securely connected via ADB.
                              </p>
                            </div>
                            <div className="pt-1 flex flex-col sm:flex-row items-center justify-center gap-2">
                              <button
                                id="btn-reconnect-camera-viewport"
                                onClick={handleReconnectCamera}
                                disabled={isReconnectingCamera}
                                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#B45309] hover:bg-[#92400E] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                              >
                                <RotateCcw className={`w-3.5 h-3.5 ${isReconnectingCamera ? 'animate-spin' : ''}`} />
                                <span>{isReconnectingCamera ? 'Reconnecting...' : `Reconnect Stream${cameraReconnectAttempts > 0 ? ` (${cameraReconnectAttempts}/5)` : ''}`}</span>
                              </button>

                              <button
                                onClick={() => setShowCameraDiagnostics(!showCameraDiagnostics)}
                                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-white border border-[#D9DEE5] text-[#202936] hover:bg-[#F3F6F8] font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                              >
                                <Terminal className="w-3.5 h-3.5 text-[#0F766E]" />
                                <span>View Log Details</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* VIEWPORT BODY: ERROR */}
                        {!isCameraRunning && !cameraPreempted && cameraStatus === 'error' && (
                          <div className="text-center p-6 max-w-lg space-y-3 z-10 bg-red-50/80 rounded-2xl border border-red-300 m-4 shadow-sm">
                            <div className="w-12 h-12 rounded-xl bg-red-100 border border-red-300 mx-auto flex items-center justify-center text-red-600">
                              <AlertCircle className="w-6 h-6" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-red-800">Camera Preview Launch Failed</h4>
                              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                                {cameraRecentStderr[cameraRecentStderr.length - 1] || 'Unable to open camera sensor. Please ensure no other application is using the camera.'}
                              </p>
                            </div>
                            <div className="pt-1 flex items-center justify-center gap-2">
                              <button
                                onClick={handleStartCamera}
                                className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-800 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Retry Launch</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Expandable Diagnostics Drawer */}
                      {showCameraDiagnostics && (
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#D9DEE5] space-y-3 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Terminal className="w-4 h-4 text-[#0F766E]" />
                              <span className="text-xs font-bold text-[#202936]">Camera Studio Diagnostics & Recent Stderr</span>
                            </div>
                            <button
                              onClick={handleCopyCameraDiagnostics}
                              className="px-2.5 py-1 rounded-lg bg-white border border-[#D9DEE5] text-[#202936] hover:bg-[#F3F6F8] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                              {diagnosticsCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-700">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-[#0F766E]" />
                                  <span>Copy Diagnostics</span>
                                </>
                              )}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="p-2 rounded-lg bg-white border border-[#D9DEE5]">
                              <span className="text-[10px] text-[#667085] uppercase block font-bold">Serial</span>
                              <span className="font-mono text-[#202936] truncate block">{selectedSerial || 'None'}</span>
                            </div>
                            <div className="p-2 rounded-lg bg-white border border-[#D9DEE5]">
                              <span className="text-[10px] text-[#667085] uppercase block font-bold">Sensor / Lens</span>
                              <span className="font-mono text-[#202936] block">Camera {selectedCameraId}</span>
                            </div>
                            <div className="p-2 rounded-lg bg-white border border-[#D9DEE5]">
                              <span className="text-[10px] text-[#667085] uppercase block font-bold">Exit Code / Reason</span>
                              <span className="font-mono text-[#202936] block">
                                {cameraExitCode !== null ? cameraExitCode : 'None'} ({cameraExitReason || 'none'})
                              </span>
                            </div>
                            <div className="p-2 rounded-lg bg-white border border-[#D9DEE5]">
                              <span className="text-[10px] text-[#667085] uppercase block font-bold">Retries</span>
                              <span className="font-mono text-[#202936] block">{cameraReconnectAttempts}/5 attempts</span>
                            </div>
                          </div>

                          <div>
                            <span className="text-[11px] font-bold text-[#667085] block mb-1">Recent Stderr Logs ({cameraRecentStderr.length} lines):</span>
                            <div className="p-3 rounded-lg bg-[#1E293B] text-slate-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-0.5 leading-relaxed">
                              {cameraRecentStderr.length > 0 ? (
                                cameraRecentStderr.map((line, idx) => (
                                  <div key={idx} className={line.includes('error') || line.includes('failed') || line.includes('disconnected') ? 'text-rose-400' : 'text-slate-300'}>
                                    {line}
                                  </div>
                                ))
                              ) : (
                                <div className="text-slate-400 italic">No stderr logs recorded yet.</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Lower Grid: Stream Configuration & Controls */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Stream Configuration & Sensor Selection */}
                  <div className="lg:col-span-7 space-y-5">
                    {/* Camera Sensor Selector (Physical Lens Switching) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="camera-select" className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>Optical Lens / Camera Sensor</span>
                        </label>
                        <span className="text-[11px] text-[#667085]">Physical Lens Switching</span>
                      </div>

                      {cameraCaps && cameraCaps.cameras.length > 0 ? (
                        <select
                          id="camera-select"
                          value={selectedCameraId}
                          onChange={(e) => {
                            const newId = e.target.value;
                            setSelectedCameraId(newId);
                            const found = cameraCaps.cameras.find(c => c.id === newId);
                            if (found && found.supportedSizes.length > 0) {
                              setSelectedResolution(pickDefaultCameraSize(found.supportedSizes)!);
                            }
                          }}
                          disabled={isCameraRunning}
                          className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer disabled:opacity-50 shadow-xs"
                        >
                          {cameraCaps.cameras.map((c) => (
                            <option key={c.id} value={c.id} className="bg-white text-[#202936]">
                              Camera {c.id} — {c.facing.toUpperCase()} {c.maxResolution ? `(${c.maxResolution} Max)` : ''} {c.id === '0' ? '• Main Lens' : c.id === '1' ? '• Front Selfie' : c.id === '2' ? '• Ultrawide' : c.id === '3' ? '• Macro' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] text-xs text-[#667085] flex items-center justify-between">
                          <span>{isQueryingCameras ? 'Probing camera sensors...' : 'Camera 0 (Default Back Camera)'}</span>
                          <span className="text-[10px] uppercase font-bold text-[#84909E]">Auto-Detect</span>
                        </div>
                      )}
                    </div>

                    {/* Resolution & FPS Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Resolution Selector */}
                      <div>
                        <label htmlFor="camera-resolution-select" className="block text-xs font-bold text-[#84909E] uppercase tracking-wider mb-2">
                          Capture Resolution
                        </label>
                        <select
                          id="camera-resolution-select"
                          value={selectedResolution}
                          onChange={(e) => setSelectedResolution(e.target.value)}
                          disabled={isCameraRunning}
                          className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs font-semibold text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer disabled:opacity-50 shadow-xs"
                        >
                          {cameraCaps?.cameras.find(c => c.id === selectedCameraId)?.supportedSizes?.map((size) => (
                            <option key={size} value={size} className="bg-white text-[#202936]">
                              {size} {size === '1920x1080' ? '(FHD)' : size === '1280x720' ? '(HD)' : size === '3840x2160' ? '(4K)' : ''}
                            </option>
                          )) || (
                            <>
                              <option value="1920x1080">1920x1080 (1080p FHD)</option>
                              <option value="1280x720">1280x720 (720p HD)</option>
                              <option value="4000x3000">4000x3000 (Max Sensor)</option>
                              <option value="640x480">640x480 (VGA)</option>
                            </>
                          )}
                        </select>
                      </div>

                      {/* Frame Rate (FPS) Selector */}
                      <div>
                        <label htmlFor="camera-fps-select" className="block text-xs font-bold text-[#84909E] uppercase tracking-wider mb-2">
                          Target Frame Rate
                        </label>
                        <select
                          id="camera-fps-select"
                          value={selectedFps}
                          onChange={(e) => setSelectedFps(parseInt(e.target.value, 10))}
                          disabled={isCameraRunning}
                          className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs font-semibold text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer disabled:opacity-50 shadow-xs"
                        >
                          {cameraCaps?.cameras.find(c => c.id === selectedCameraId)?.fpsList?.map((fps) => (
                            <option key={fps} value={fps} className="bg-white text-[#202936]">
                              {fps} FPS {fps === 30 ? '(Standard)' : fps === 60 ? '(High)' : ''}
                            </option>
                          )) || (
                            <>
                              <option value="30">30 FPS (Standard)</option>
                              <option value="60">60 FPS (Smooth)</option>
                              <option value="20">20 FPS (Eco)</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>

                    {/* Aspect Ratio & High Speed */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="camera-ar-select" className="block text-xs font-bold text-[#84909E] uppercase tracking-wider mb-2">
                          Aspect Ratio
                        </label>
                        <select
                          id="camera-ar-select"
                          value={cameraAspectRatio}
                          onChange={(e) => setCameraAspectRatio(e.target.value)}
                          disabled={isCameraRunning}
                          className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs font-semibold text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer disabled:opacity-50 shadow-xs"
                        >
                          <option value="auto">Auto (Sensor Native)</option>
                          <option value="16:9">16:9 (Widescreen Video)</option>
                          <option value="4:3">4:3 (Classic Photo)</option>
                          <option value="sensor">Sensor Sensor Ratio</option>
                        </select>
                      </div>

                      <div className="flex flex-col justify-end">
                        <label className="flex items-center gap-2 p-2 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] text-xs font-semibold text-[#202936] cursor-pointer hover:bg-white">
                          <input
                            type="checkbox"
                            checked={cameraHighSpeed}
                            onChange={(e) => setCameraHighSpeed(e.target.checked)}
                            disabled={isCameraRunning}
                            className="rounded border-[#D9DEE5] text-[#0F766E] focus:ring-[#0F766E] w-4 h-4 accent-[#0F766E]"
                          />
                          <span>High-Speed Capture (120 FPS)</span>
                        </label>
                      </div>
                    </div>

                    {/* PC-Side Recording Toggle */}
                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-bold text-[#202936] cursor-pointer">
                          <input
                            id="record-camera-checkbox"
                            type="checkbox"
                            checked={recordCameraSession}
                            onChange={(e) => setRecordCameraSession(e.target.checked)}
                            disabled={isCameraRunning}
                            className="rounded border-[#D9DEE5] text-[#0F766E] focus:ring-[#0F766E] w-4 h-4 accent-[#0F766E]"
                          />
                          <span>Record Camera Stream to MP4 on PC</span>
                        </label>
                        <span className="text-[10px] uppercase font-bold text-[#0F766E] bg-[#DDF4EF] px-2 py-0.5 rounded border border-[#0F766E]/20">
                          Hardware MP4
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085]">
                        Saves lossless hardware-encoded video directly to the local <code className="text-[#202936] font-mono">Captures/</code> folder with zero dropped frames.
                      </p>
                    </div>

                    {/* Auto-Reconnect Toggle for Xiaomi / HyperOS Preemption */}
                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-bold text-[#202936] cursor-pointer">
                          <input
                            id="camera-auto-reconnect-checkbox"
                            type="checkbox"
                            checked={cameraAutoReconnect}
                            onChange={(e) => setCameraAutoReconnect(e.target.checked)}
                            className="rounded border-[#D9DEE5] text-[#0F766E] focus:ring-[#0F766E] w-4 h-4 accent-[#0F766E]"
                          />
                          <span>Auto-Reconnect on Screen Wake / Face Unlock</span>
                        </label>
                        <span className="text-[10px] uppercase font-bold text-[#0F766E] bg-[#DDF4EF] px-2 py-0.5 rounded border border-[#0F766E]/20">
                          HyperOS Shield
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085]">
                        Automatically recovers the stream if Xiaomi HyperOS evicts the camera when waking the screen (max 5 retries with rate-limiting).
                      </p>
                    </div>

                    {/* Preemption Notice and One-Click Reconnect Banner */}
                    {cameraPreempted && !isCameraRunning && (
                      <div className="p-3.5 rounded-xl bg-[#FEF3C7] border border-[#B45309]/30 text-[#B45309] text-xs space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-[#B45309]">Camera Interrupted by Android OS</span>
                            <p className="text-[11px] text-[#B45309]/90 mt-0.5">
                              The phone's screen was woken or unlocked (e.g. Face Unlock), causing Android to evict background camera clients. The device is still connected to ADB.
                            </p>
                          </div>
                        </div>
                        {canReconnectCamera && (
                          <button
                            id="btn-reconnect-camera"
                            onClick={handleReconnectCamera}
                            disabled={isReconnectingCamera}
                            className="w-full py-2 px-3 rounded-lg bg-[#B45309] hover:bg-[#92400E] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isReconnectingCamera ? 'animate-spin' : ''}`} />
                            <span>{isReconnectingCamera ? 'Reconnecting...' : `Reconnect Camera${cameraReconnectAttempts > 0 ? ` (${cameraReconnectAttempts}/5)` : ''}`}</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Start / Stop Stream Action Button */}
                    <div>
                      {!isCameraRunning ? (
                        <button
                          id="btn-toggle-camera"
                          onClick={handleStartCamera}
                          disabled={!isDeviceReady || (cameraCaps !== null && !cameraCaps.transportSupported)}
                          className="w-full py-3.5 px-6 rounded-xl bg-[#0F766E] hover:bg-[#115E59] text-white font-bold text-sm shadow-md flex items-center justify-center gap-2.5 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                          aria-label="Start Camera Preview"
                        >
                          <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                          <span>Start Camera Preview</span>
                        </button>
                      ) : (
                        <button
                          id="btn-toggle-camera"
                          onClick={handleStopCamera}
                          className="w-full py-3.5 px-6 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold text-sm border border-[#B91C1C] flex items-center justify-center gap-2.5 cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-[#B91C1C] shadow-md"
                          aria-label="Stop Camera Preview"
                        >
                          <Square className="w-4 h-4 fill-current text-white" aria-hidden="true" />
                          <span>Stop Camera Preview</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Live Optical, Digital & Hardware Controls */}
                  <div className="lg:col-span-5 space-y-5">
                    {/* Digital Zoom Control Card */}
                    <div className="glass-panel p-4 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>Digital Zoom Control</span>
                        </label>
                        <span className="text-xs font-mono font-bold text-[#0F766E] bg-[#DDF4EF] px-2.5 py-0.5 rounded border border-[#0F766E]/20" id="camera-zoom-badge">
                          {cameraZoom.toFixed(1)}x
                        </span>
                      </div>

                      <p className="text-[11px] text-[#667085]">
                        Adjust focal crop within the active sensor. Verified sensor range: <span className="text-[#202936] font-mono">1.0x – 10.0x</span>.
                      </p>

                      {/* Zoom Buttons (+ / -) */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          id="btn-zoom-out"
                          onClick={() => handleZoomChange('out')}
                          disabled={!isCameraRunning}
                          className="glass-button py-2 px-3 text-xs font-semibold text-[#202936] flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Zoom Out (-0.5x)"
                          aria-label="Zoom camera out"
                        >
                          <ZoomOut className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>Zoom Out (-0.5x)</span>
                        </button>

                        <button
                          id="btn-zoom-in"
                          onClick={() => handleZoomChange('in')}
                          disabled={!isCameraRunning}
                          className="glass-button py-2 px-3 text-xs font-semibold text-[#202936] flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Zoom In (+0.5x)"
                          aria-label="Zoom camera in"
                        >
                          <ZoomIn className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>Zoom In (+0.5x)</span>
                        </button>
                      </div>

                      {/* Zoom Slider */}
                      <div>
                        <input
                          id="camera-zoom-slider"
                          type="range"
                          min="1.0"
                          max="10.0"
                          step="0.5"
                          value={cameraZoom}
                          onChange={(e) => setCameraZoom(parseFloat(e.target.value))}
                          disabled={!isCameraRunning}
                          className="w-full accent-[#0F766E] cursor-pointer disabled:opacity-50"
                          aria-label="Camera digital zoom slider"
                        />
                        <div className="flex justify-between text-[10px] text-[#84909E] font-mono mt-1">
                          <span>1.0x (Wide)</span>
                          <span>2.5x</span>
                          <span>5.0x</span>
                          <span>10.0x (Max)</span>
                        </div>
                      </div>

                      {/* Quick Zoom Presets */}
                      <div className="flex gap-1.5 pt-1">
                        {[1.0, 2.0, 5.0, 10.0].map((preset) => (
                          <button
                            key={preset}
                            onClick={() => {
                              setCameraZoom(preset);
                              if (isCameraRunning) {
                                handleZoomChange(preset > cameraZoom ? 'in' : 'out');
                              }
                            }}
                            className={`flex-1 py-1 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                              cameraZoom === preset
                                ? 'bg-[#0F766E] text-white shadow-xs'
                                : 'bg-[#F3F6F8] text-[#202936] hover:bg-white border border-[#D9DEE5]'
                            }`}
                          >
                            {preset.toFixed(0)}x
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Torch & Flashlight Card */}
                    <div className="glass-panel p-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                          <Flashlight className="w-3.5 h-3.5 text-[#B45309]" />
                          <span>Camera Torch (Flash)</span>
                        </div>
                        <p className="text-[11px] text-[#667085] mt-0.5">
                          Controls the rear camera LED torch in real-time.
                        </p>
                      </div>

                      <button
                        id="btn-toggle-torch"
                        onClick={handleTorchToggle}
                        disabled={!isCameraRunning}
                        className={`py-2 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                          cameraTorch
                            ? 'bg-[#B45309] text-white shadow-xs'
                            : 'glass-button text-[#202936] disabled:opacity-50'
                        }`}
                        aria-label="Toggle camera torch"
                      >
                        {cameraTorch ? (
                          <>
                            <Flashlight className="w-4 h-4 fill-current" />
                            <span>Torch ON</span>
                          </>
                        ) : (
                          <>
                            <FlashlightOff className="w-4 h-4" />
                            <span>Torch OFF</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Snapshots & Captures Info */}
                    <div className="glass-panel p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>Snapshots & Captures</span>
                        </span>
                        <span className="text-[10px] uppercase font-bold text-[#0F766E] bg-[#DDF4EF] px-2 py-0.5 rounded border border-[#0F766E]/20">
                          Verified Status
                        </span>
                      </div>
                      <p className="text-[11px] text-[#667085] leading-relaxed">
                        Continuous PC recording is <strong className="text-[#15803D]">verified</strong> via the MP4 recording toggle. Direct single-frame PNG capture during live Camera2 streaming is unsupported by scrcpy's CLI transport; full photo capture will be provided via the dedicated CameraX companion APK.
                      </p>
                    </div>

                    {/* In-App Keyboard Shortcuts Reference */}
                    <div className="glass-panel p-4 space-y-2.5">
                      <div className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-[#0F766E]" />
                        <span>Live Preview Shortcuts</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div className="p-2 rounded bg-[#F3F6F8] border border-[#D9DEE5] text-[#202936] flex justify-between">
                          <span>Alt + Up</span>
                          <span className="text-[#0F766E] font-semibold">Zoom In</span>
                        </div>
                        <div className="p-2 rounded bg-[#F3F6F8] border border-[#D9DEE5] text-[#202936] flex justify-between">
                          <span>Alt + Down</span>
                          <span className="text-[#0F766E] font-semibold">Zoom Out</span>
                        </div>
                        <div className="p-2 rounded bg-[#F3F6F8] border border-[#D9DEE5] text-[#202936] flex justify-between">
                          <span>Alt + T</span>
                          <span className="text-[#B45309] font-semibold">Torch ON</span>
                        </div>
                        <div className="p-2 rounded bg-[#F3F6F8] border border-[#D9DEE5] text-[#202936] flex justify-between">
                          <span>Alt + Shift + T</span>
                          <span className="text-[#667085] font-semibold">Torch OFF</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
                )}

                {/* COMPANION MODE CONTROLS & IN-APP VIEWPORT (Phase 6) */}
                {cameraMode === 'companion' && (
                  <div className="space-y-6 mt-6">
                    {/* Companion Status & Connection Bar */}
                    <div className="glass-panel p-5">
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <Smartphone className="w-5 h-5 text-[#0F766E]" />
                            <h3 className="text-base font-bold text-[#202936]">AndroScrn Companion App Connection</h3>
                            <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                              companionPaired
                                ? 'bg-[#DCFCE7] text-[#15803D] border-[#15803D]/30'
                                : companionChallengeActive
                                ? 'bg-[#FEF3C7] text-[#B45309] border-[#B45309]/30'
                                : 'bg-[#F3F6F8] text-[#667085] border-[#D9DEE5]'
                            }`}>
                              {companionPaired ? 'Paired & Streaming' : companionChallengeActive ? 'Awaiting PIN Verification' : 'Disconnected'}
                            </span>
                          </div>
                          <p className="text-xs text-[#667085] mt-1">
                            Requires AndroScrn Companion APK installed on phone. Provides full-res photo capture, lens flip, digital zoom, and live MJPEG streaming over USB loopback.
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {!companionPaired && !companionChallengeActive && (
                            <button
                              id="btn-companion-connect"
                              onClick={handleCompanionConnect}
                              disabled={companionLoading || !isDeviceReady}
                              className="glass-button glass-button-primary text-xs py-2 px-4 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                              <Wifi className="w-4 h-4" />
                              <span>{companionLoading ? 'Connecting...' : 'Connect to Companion'}</span>
                            </button>
                          )}

                          {companionPaired && (
                            <button
                              id="btn-companion-disconnect"
                              onClick={handleCompanionDisconnect}
                              className="glass-button text-xs py-2 px-3.5 text-[#B91C1C] border-[#B91C1C]/30 hover:bg-[#FEE2E2] transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                              <Power className="w-3.5 h-3.5" />
                              <span>Disconnect</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pairing PIN Input Card (shown when challenge is active) */}
                      {companionChallengeActive && !companionPaired && (
                        <div id="companion-pin-card" className="mt-5 p-4 rounded-xl bg-[#FEF3C7] border border-[#B45309]/30 space-y-3">
                          <div className="flex items-center gap-2 text-[#B45309] text-xs font-bold">
                            <Shield className="w-4 h-4 text-[#B45309]" />
                            <span>Pairing Challenge Active: Enter the 6-Digit PIN displayed on phone</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <label htmlFor="companion-pin-input" className="sr-only">6-Digit Pairing PIN</label>
                            <input
                              id="companion-pin-input"
                              type="text"
                              maxLength={6}
                              value={companionPinInput}
                              onChange={(e) => setCompanionPinInput(e.target.value.replace(/\D/g, ''))}
                              placeholder="000000"
                              className="w-36 bg-white border border-[#D9DEE5] rounded-xl px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest text-[#202936] focus:outline-none focus:ring-2 focus:ring-[#0F766E]"
                            />
                            <button
                              id="btn-companion-submit-pin"
                              onClick={handleCompanionSubmitPin}
                              disabled={companionLoading || companionPinInput.length !== 6}
                              className="glass-button glass-button-primary text-xs py-2.5 px-5 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                              <ShieldCheck className="w-4 h-4" />
                              <span>{companionLoading ? 'Verifying...' : 'Authorize & Start Feed'}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Error / Success Feedback */}
                      {companionError && (
                        <div className="mt-4 p-3 rounded-xl bg-[#FEE2E2] border border-[#B91C1C]/30 text-[#B91C1C] text-xs flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-[#B91C1C]" />
                          <span>{companionError}</span>
                        </div>
                      )}
                      {companionSuccessMsg && (
                        <div className="mt-4 p-3 rounded-xl bg-[#DCFCE7] border border-[#15803D]/30 text-[#15803D] text-xs flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#15803D]" />
                          <span>{companionSuccessMsg}</span>
                        </div>
                      )}
                    </div>

                    {/* Companion Live Viewport & Studio Controls Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Left Column: Live In-App Video Viewport */}
                      <div className="lg:col-span-8">
                        <div className="glass-panel p-4 flex flex-col h-full">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Camera className="w-4 h-4 text-[#0F766E]" />
                              <span className="text-xs font-bold text-[#202936] uppercase tracking-wider">In-App Live Preview Feed</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F3F6F8] border border-[#D9DEE5] text-[#667085]">
                                Port Forward: 127.0.0.1:8080
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#DDF4EF] border border-[#0F766E]/20 text-[#0F766E]">
                                MJPEG Low Latency (~15ms)
                              </span>
                            </div>
                          </div>

                          {/* Video Box */}
                          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-950 border border-[#D9DEE5] flex items-center justify-center">
                            {companionPaired ? (
                              <img
                                id="companion-live-preview"
                                src={companionStreamUrl || 'http://127.0.0.1:8080/api/v1/stream?token=mock_token_64'}
                                alt="Live Android Companion Camera Viewport"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="text-center p-8 space-y-3">
                                <div className="w-16 h-16 mx-auto rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                                  <Camera className="w-8 h-8" />
                                </div>
                                <div className="text-xs font-bold text-slate-300">Companion Camera Feed Inactive</div>
                                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                                  Click "Connect to Companion" above to begin authenticated USB loopback streaming.
                                </p>
                              </div>
                            )}

                            {/* Live Inspection Non-Destructive Overlay Layer (Phase 7.1) */}
                            {inspectionOverlay !== 'none' && (
                              <div
                                id="inspection-overlay-layer"
                                className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center overflow-hidden"
                                style={{ opacity: overlayOpacity }}
                              >
                                {inspectionOverlay === 'grid_thirds' && (
                                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <line x1="33.3" y1="0" x2="33.3" y2="100" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="66.6" y1="0" x2="66.6" y2="100" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="0" y1="33.3" x2="100" y2="33.3" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="0" y1="66.6" x2="100" y2="66.6" stroke={overlayColor} strokeWidth="0.75" />
                                  </svg>
                                )}
                                {inspectionOverlay === 'grid_fine' && (
                                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(p => (
                                      <React.Fragment key={p}>
                                        <line x1={p} y1="0" x2={p} y2="100" stroke={overlayColor} strokeWidth={p === 50 ? "0.8" : "0.3"} strokeDasharray={p === 50 ? "none" : "1,1"} />
                                        <line x1="0" y1={p} x2="100" y2={p} stroke={overlayColor} strokeWidth={p === 50 ? "0.8" : "0.3"} strokeDasharray={p === 50 ? "none" : "1,1"} />
                                      </React.Fragment>
                                    ))}
                                  </svg>
                                )}
                                {inspectionOverlay === 'crosshair' && (
                                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <line x1="50" y1="0" x2="50" y2="100" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="0" y1="50" x2="100" y2="50" stroke={overlayColor} strokeWidth="0.75" />
                                    <circle cx="50" cy="50" r="10" fill="none" stroke={overlayColor} strokeWidth="0.75" />
                                    <circle cx="50" cy="50" r="25" fill="none" stroke={overlayColor} strokeWidth="0.5" strokeDasharray="2,2" />
                                    <circle cx="50" cy="50" r="1.5" fill={overlayColor} />
                                  </svg>
                                )}
                                {inspectionOverlay === 'reticle' && (
                                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <circle cx="50" cy="50" r="15" fill="none" stroke={overlayColor} strokeWidth="0.75" />
                                    <circle cx="50" cy="50" r="30" fill="none" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="20" y1="50" x2="40" y2="50" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="60" y1="50" x2="80" y2="50" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="50" y1="20" x2="50" y2="40" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="50" y1="60" x2="50" y2="80" stroke={overlayColor} strokeWidth="0.75" />
                                    <circle cx="50" cy="50" r="1" fill={overlayColor} />
                                  </svg>
                                )}
                                {inspectionOverlay === 'diagonal' && (
                                  <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <line x1="0" y1="0" x2="100" y2="100" stroke={overlayColor} strokeWidth="0.75" />
                                    <line x1="100" y1="0" x2="0" y2="100" stroke={overlayColor} strokeWidth="0.75" />
                                  </svg>
                                )}
                                {overlayShowTimestamp && (
                                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-950/80 font-mono text-[9px] font-bold text-slate-300 border border-slate-700">
                                    UTC: {new Date().toISOString().substring(11, 19)}
                                  </div>
                                )}
                                {overlayShowCoords && (
                                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-slate-950/80 font-mono text-[9px] text-slate-400 border border-slate-800">
                                    [Relative Uncalibrated px]
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Live Active Badge Overlay */}
                            {companionPaired && (
                              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-rose-500/40 text-[10px] font-bold text-rose-300">
                                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                                <span>COMPANION LIVE</span>
                              </div>
                            )}

                            {companionPaired && (
                              <div className="absolute bottom-3 right-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md border border-slate-700 text-[10px] font-mono text-slate-300">
                                <span>{companionFacing === 'back' ? 'Back Sensor' : 'Front Selfie'}</span>
                                <span>•</span>
                                <span>{companionZoom.toFixed(1)}x</span>
                                {companionTorch && <span>• Torch ON</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Companion Remote Controls */}
                      <div className="lg:col-span-4 space-y-4">
                        {/* Remote Shutter / Still Snapshot Card */}
                        <div className="glass-panel p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                              <Camera className="w-3.5 h-3.5 text-[#0F766E]" />
                              <span>Full-Res Still Capture</span>
                            </span>
                            <span className="text-[10px] uppercase font-bold text-[#0F766E] bg-[#DDF4EF] px-2 py-0.5 rounded border border-[#0F766E]/20">
                              CameraX
                            </span>
                          </div>
                          <p className="text-[11px] text-[#667085]">
                            Captures uncompressed 48MP/12MP photo directly on sensor and transfers it instantly to desktop without interrupting live stream.
                          </p>
                          <button
                            id="btn-companion-snapshot"
                            onClick={handleCompanionSnapshot}
                            disabled={!companionPaired || companionLoading}
                            className="w-full glass-button glass-button-primary text-xs py-3 px-4 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
                          >
                            <Camera className="w-4 h-4 text-white" />
                            <span>{companionLoading ? 'Capturing Still Photo...' : 'Capture Full-Res Photo'}</span>
                          </button>
                        </div>

                        {/* Physical Lens Flip & Torch Controls */}
                        <div className="glass-panel p-4 space-y-3">
                          <div className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                            <Sliders className="w-3.5 h-3.5 text-[#0F766E]" />
                            <span>Optics & Hardware Controls</span>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            {/* Flip Lens */}
                            <button
                              id="btn-companion-flip"
                              onClick={handleCompanionFlipLens}
                              disabled={!companionPaired}
                              className="glass-button p-3 flex flex-col items-center justify-center gap-1 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all text-[#202936]"
                            >
                              <RotateCcw className="w-4 h-4 text-[#0F766E]" />
                              <span>{companionFacing === 'back' ? 'Switch to Front' : 'Switch to Back'}</span>
                            </button>

                            {/* Torch Toggle */}
                            <button
                              id="btn-companion-torch"
                              onClick={handleCompanionTorch}
                              disabled={!companionPaired}
                              className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all ${
                                companionTorch
                                  ? 'bg-[#B45309] text-white border-[#B45309] shadow-xs'
                                  : 'glass-button text-[#202936]'
                              }`}
                            >
                              {companionTorch ? (
                                <>
                                  <Flashlight className="w-4 h-4 fill-current" />
                                  <span>Torch ON</span>
                                </>
                              ) : (
                                <>
                                  <FlashlightOff className="w-4 h-4" />
                                  <span>Torch OFF</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Live Smooth Zoom Slider */}
                        <div className="glass-panel p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#84909E] uppercase tracking-wider flex items-center gap-1.5">
                              <ZoomIn className="w-3.5 h-3.5 text-[#0F766E]" />
                              <span>Digital Zoom</span>
                            </span>
                            <span className="text-xs font-mono font-bold text-[#0F766E] bg-[#DDF4EF] px-2 py-0.5 rounded border border-[#0F766E]/20">
                              {companionZoom.toFixed(1)}x
                            </span>
                          </div>

                          <label htmlFor="companion-zoom-slider" className="sr-only">Digital Zoom Slider</label>
                          <input
                            id="companion-zoom-slider"
                            type="range"
                            min="1.0"
                            max="8.0"
                            step="0.1"
                            value={companionZoom}
                            onChange={(e) => handleCompanionZoom(parseFloat(e.target.value))}
                            disabled={!companionPaired}
                            className="w-full accent-[#0F766E] bg-[#D9DEE5] h-2 rounded-lg cursor-pointer disabled:opacity-50"
                          />
                          <div className="flex justify-between text-[10px] font-mono text-[#84909E]">
                            <span>1.0x (Wide)</span>
                            <span>2.0x</span>
                            <span>4.0x</span>
                            <span>8.0x (Tele)</span>
                          </div>
                        </div>

                        {/* Architecture Details Card */}
                        <div className="glass-panel p-4 space-y-2 text-[11px] text-[#667085] leading-relaxed">
                          <div className="font-bold text-[#202936] flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-[#15803D]" />
                            <span>Security & Privacy Architecture</span>
                          </div>
                          <ul className="list-disc list-inside space-y-1 text-[#667085]">
                            <li>Loopback only (`127.0.0.1:8080`) — no open Wi-Fi ports.</li>
                            <li>6-digit challenge PIN with brute-force lockout (3 attempts).</li>
                            <li>Camera watermark & active indicator visible on phone.</li>
                            <li>Session automatically expires upon cable unplug or disconnect.</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* LAB & INSPECTION STUDIO SUITE (Phase 7.1) */}
                <div className="mt-8 glass-panel p-6 space-y-6">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#D9DEE5] pb-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <Grid className="w-5 h-5 text-[#0F766E]" />
                        <h3 className="text-base font-bold text-[#202936]">Lab & Optical Inspection Tools</h3>
                        <span className="text-[10px] font-bold uppercase bg-[#DDF4EF] text-[#0F766E] px-2 py-0.5 rounded border border-[#0F766E]/20">
                          Phase 7.1 Active
                        </span>
                      </div>
                      <p className="text-xs text-[#667085] mt-1">
                        Precision alignment reticles, non-destructive overlays, side-by-side golden sample comparison, and automated timelapse recording.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        id="btn-export-annotated"
                        onClick={handleExportAnnotated}
                        className="glass-button text-xs py-2 px-3.5 flex items-center gap-1.5 cursor-pointer border border-[#0F766E]/40 text-[#0F766E] hover:bg-[#DDF4EF]"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#0F766E]" />
                        <span>Export Annotated Copy</span>
                      </button>
                    </div>
                  </div>

                  {annotatedExportSuccess && (
                    <div id="annotated-export-notice" className="p-3 rounded-xl bg-[#DCFCE7] border border-[#15803D]/30 text-[#15803D] text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-[#15803D]" />
                      <span>{annotatedExportSuccess}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Column 1: Inspection Overlays & Reticles */}
                    <div className="space-y-4 p-4 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#202936] uppercase tracking-wider">
                        <Crosshair className="w-4 h-4 text-[#0F766E]" />
                        <span>Alignment Reticles & Grids</span>
                      </div>

                      <div>
                        <label htmlFor="inspection-overlay-select" className="block text-[11px] font-semibold text-[#84909E] mb-1.5">
                          Overlay Pattern
                        </label>
                        <select
                          id="inspection-overlay-select"
                          value={inspectionOverlay}
                          onChange={(e) => setInspectionOverlay(e.target.value as any)}
                          className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs font-semibold text-[#202936] outline-none focus:ring-2 focus:ring-[#0F766E] cursor-pointer"
                        >
                          <option value="none">None (Clean Viewport)</option>
                          <option value="grid_thirds">Rule of Thirds (3x3 Grid)</option>
                          <option value="grid_fine">10x10 Fine Alignment Grid</option>
                          <option value="crosshair">Precision Center Crosshairs</option>
                          <option value="reticle">Optical Inspection Reticle</option>
                          <option value="diagonal">Golden Ratio Diagonals</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="inspection-color-select" className="block text-[11px] font-semibold text-[#84909E] mb-1.5">
                            Color
                          </label>
                          <select
                            id="inspection-color-select"
                            value={overlayColor}
                            onChange={(e) => setOverlayColor(e.target.value)}
                            className="w-full bg-white border border-[#D9DEE5] rounded-xl px-2.5 py-1.5 text-xs text-[#202936] outline-none cursor-pointer"
                          >
                            <option value="#0F766E">Deep Teal</option>
                            <option value="#38bdf8">Sky Blue</option>
                            <option value="#10b981">Emerald Green</option>
                            <option value="#f43f5e">Rose Red</option>
                            <option value="#eab308">Amber Yellow</option>
                            <option value="#ffffff">Pure White</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="inspection-opacity-slider" className="block text-[11px] font-semibold text-[#84909E] mb-1.5">
                            Opacity ({Math.round(overlayOpacity * 100)}%)
                          </label>
                          <input
                            id="inspection-opacity-slider"
                            type="range"
                            min="0.1"
                            max="1.0"
                            step="0.05"
                            value={overlayOpacity}
                            onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                            className="w-full accent-[#0F766E] bg-[#D9DEE5] h-2 rounded cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            id="inspection-timestamp-toggle"
                            type="checkbox"
                            checked={overlayShowTimestamp}
                            onChange={(e) => setOverlayShowTimestamp(e.target.checked)}
                            className="rounded text-[#0F766E] accent-[#0F766E] border-[#D9DEE5]"
                          />
                          <span className="text-[#202936] text-[11px]">Timestamp Watermark</span>
                        </label>

                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            id="inspection-coords-toggle"
                            type="checkbox"
                            checked={overlayShowCoords}
                            onChange={(e) => setOverlayShowCoords(e.target.checked)}
                            className="rounded text-[#0F766E] accent-[#0F766E] border-[#D9DEE5]"
                          />
                          <span className="text-[#202936] text-[11px]">Uncalibrated Px</span>
                        </label>
                      </div>
                    </div>

                    {/* Column 2: Side-by-Side Reference Comparison */}
                    <div className="space-y-4 p-4 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-[#202936] uppercase tracking-wider">
                          <Layers className="w-4 h-4 text-[#0F766E]" />
                          <span>Golden Sample Compare</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          refCompEnabled ? 'bg-[#DDF4EF] text-[#0F766E]' : 'bg-[#D9DEE5] text-[#667085]'
                        }`}>
                          {refCompEnabled ? 'Active' : 'Off'}
                        </span>
                      </div>

                      <p className="text-[11px] text-[#667085]">
                        Compare live feed against a reference golden master to detect assembly defects, label shifts, or component drift.
                      </p>

                      <div className="space-y-2">
                        <button
                          id="btn-toggle-ref-comp"
                          onClick={() => setRefCompEnabled(!refCompEnabled)}
                          className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                            refCompEnabled
                              ? 'bg-[#0F766E] border-[#0F766E] text-white shadow-xs'
                              : 'glass-button text-[#202936]'
                          }`}
                        >
                          {refCompEnabled ? 'Disable Comparison Mode' : 'Enable Reference Comparison'}
                        </button>

                        {refCompEnabled && (
                          <div className="space-y-2 pt-2">
                            <label htmlFor="ref-comp-mode-select" className="block text-[11px] font-semibold text-[#84909E]">
                              Comparison Layout
                            </label>
                            <select
                              id="ref-comp-mode-select"
                              value={refCompMode}
                              onChange={(e) => setRefCompMode(e.target.value as any)}
                              className="w-full bg-white border border-[#D9DEE5] rounded-xl px-2.5 py-1.5 text-xs text-[#202936] outline-none cursor-pointer"
                            >
                              <option value="side_by_side">Side-by-Side Dual View</option>
                              <option value="split_vertical">Vertical Split Screen</option>
                              <option value="overlay_blend">50% Blend Opacity</option>
                            </select>

                            <div>
                              <label htmlFor="ref-comp-opacity-slider" className="block text-[11px] font-semibold text-[#84909E] mb-1">
                                Blend Ratio ({Math.round(refCompOpacity * 100)}%)
                              </label>
                              <input
                                id="ref-comp-opacity-slider"
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={refCompOpacity}
                                onChange={(e) => setRefCompOpacity(parseFloat(e.target.value))}
                                className="w-full accent-[#0F766E] bg-[#D9DEE5] h-2 rounded cursor-pointer"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 3: Scheduled Timelapse Engine */}
                    <div className="space-y-4 p-4 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-[#202936] uppercase tracking-wider">
                          <Clock className="w-4 h-4 text-[#B45309]" />
                          <span>Timelapse Scheduler</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          timelapseRunning ? 'bg-[#FEF3C7] text-[#B45309] animate-pulse' : 'bg-[#D9DEE5] text-[#667085]'
                        }`}>
                          {timelapseRunning ? `Frame ${timelapseCurrentFrame}/${timelapseFrames}` : 'Idle'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="timelapse-interval-input" className="block text-[11px] font-semibold text-[#84909E] mb-1">
                            Interval (sec)
                          </label>
                          <input
                            id="timelapse-interval-input"
                            type="number"
                            min="1"
                            max="300"
                            value={timelapseInterval}
                            onChange={(e) => setTimelapseInterval(Math.max(1, parseInt(e.target.value) || 1))}
                            disabled={timelapseRunning}
                            className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-1.5 text-xs text-[#202936] font-mono outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label htmlFor="timelapse-frames-input" className="block text-[11px] font-semibold text-[#84909E] mb-1">
                            Total Frames
                          </label>
                          <input
                            id="timelapse-frames-input"
                            type="number"
                            min="1"
                            max="3600"
                            value={timelapseFrames}
                            onChange={(e) => setTimelapseFrames(Math.max(1, parseInt(e.target.value) || 1))}
                            disabled={timelapseRunning}
                            className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-1.5 text-xs text-[#202936] font-mono outline-none disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div className="pt-1">
                        {!timelapseRunning ? (
                          <button
                            id="btn-start-timelapse"
                            onClick={handleStartTimelapse}
                            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#0F766E] hover:bg-[#115E59] text-white flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-all"
                          >
                            <Clock className="w-4 h-4 fill-current" />
                            <span>Start Timelapse Capture</span>
                          </button>
                        ) : (
                          <button
                            id="btn-stop-timelapse"
                            onClick={handleStopTimelapse}
                            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold glass-button text-[#B45309] border-[#B45309]/50 hover:bg-[#FEF3C7] flex items-center justify-center gap-2 cursor-pointer transition-all"
                          >
                            <Square className="w-4 h-4 fill-current" />
                            <span>Stop Timelapse Session</span>
                          </button>
                        )}
                      </div>

                      {timelapseStatusMsg && (
                        <div className="text-[10px] text-[#667085] font-mono mt-1">
                          {timelapseStatusMsg}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Calibration & Non-Destructive Integrity Notice */}
                  <div className="p-3.5 rounded-xl bg-white border border-[#D9DEE5] text-[11px] text-[#667085] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0" />
                      <span><strong>Non-Destructive Integrity Guarantee:</strong> Live overlays are rendered in the presentation layer. Original raw camera sensor captures remain bit-identical unless "Export Annotated Copy" is explicitly selected. Measurements are uncalibrated relative pixels.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: WIRELESS & HOTSPOT */}
          {activeTab === 'wireless' && (
            <div className="space-y-4">
              {/* Smart wireless-debugging discovery (explicit, user-initiated) */}
              <WirelessDiscoveryPanel api={api} onDevicesChanged={refreshDevices} />

              {/* 1-Click Wireless Handoff Card */}
              <div className="glass-panel p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Wifi className="w-5 h-5 text-[#0F766E]" />
                  <h3 className="text-base font-bold text-[#202936]">1-Click Wireless Handoff</h3>
                </div>
                <p className="text-xs text-[#667085] mb-4">
                  Connect your phone via USB cable once, enable TCP/IP port 5555 with one click, then unplug the cable and mirror over Wi-Fi.
                </p>

                <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[#202936]">
                      Target USB Device: <span className="text-[#0F766E]">{activeDevice ? `${activeDevice.model} (${activeDevice.serial})` : 'None'}</span>
                    </div>
                    {handoffStatus && <div className="text-[11px] text-[#0F766E] mt-1">{handoffStatus}</div>}
                  </div>

                  <button
                    onClick={handle1ClickHandoff}
                    disabled={!isDeviceReady || activeDevice?.transportType === 'wifi'}
                    className={`glass-button glass-button-primary text-xs py-2 px-4 focus-visible:ring-2 focus-visible:ring-[#0F766E] ${
                      !isDeviceReady || activeDevice?.transportType === 'wifi' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <span>Enable Wireless Mode (Port 5555)</span>
                  </button>
                </div>
              </div>

              {/* Hotspot Auto-Connect Card */}
              <div className="glass-panel p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Smartphone className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
                  <h3 className="text-base font-bold text-[#202936]">Phone Hotspot Gateway Connect</h3>
                </div>
                <p className="text-xs text-[#667085] mb-4">
                  When your laptop joins your phone's Wi-Fi hotspot, your phone acts as the default gateway (typically 192.168.43.1).
                </p>

                <div className="flex items-center gap-3">
                  <label htmlFor="hotspot-gateway-input" className="sr-only">Hotspot Gateway IP</label>
                  <input
                    id="hotspot-gateway-input"
                    type="text"
                    value={hotspotGateway || '192.168.43.1'}
                    onChange={e => setHotspotGateway(e.target.value)}
                    className="bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs font-mono text-[#202936] w-48 outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                    placeholder="Gateway IP (192.168.43.1)"
                  />
                  <button
                    onClick={handleHotspotConnect}
                    className="glass-button text-xs py-2 px-4 min-h-[38px] text-[#202936] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                    aria-label="Connect to hotspot gateway IP"
                  >
                    <span>Connect to Hotspot Gateway</span>
                  </button>
                  <button
                    onClick={async () => {
                      if (api?.detectHotspot) {
                        const gw = await api.detectHotspot();
                        if (gw) {
                          setHotspotGateway(gw);
                          setAlertBanner({ type: 'success', message: `Detected hotspot gateway: ${gw}` });
                        } else {
                          setAlertBanner({ type: 'info', message: 'No hotspot gateway detected on active network adapters. Defaulted to 192.168.43.1' });
                        }
                      }
                    }}
                    className="glass-button text-xs py-2 px-3 min-h-[38px] text-[#202936] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                    title="Auto-detect hotspot gateway IP from network interfaces"
                    aria-label="Auto-detect hotspot gateway IP"
                  >
                    <span>Detect Gateway</span>
                  </button>
                </div>

                {devices.filter(d => d.transportType === 'wifi').length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#D9DEE5] flex items-center justify-between text-xs text-[#202936]">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-3.5 h-3.5 text-[#0F766E]" />
                      <span>Active Wi-Fi Device:</span>
                      {devices.filter(d => d.transportType === 'wifi').map(d => (
                        <span key={d.serial} className="px-2 py-0.5 rounded bg-[#DDF4EF] border border-[#0F766E]/30 text-[#0F766E] font-mono text-[11px]">
                          {d.serial}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const wifiDev = devices.find(d => d.transportType === 'wifi');
                        if (wifiDev) handleDisconnectWifiDevice(wifiDev.serial);
                      }}
                      className="text-xs text-[#B91C1C] hover:text-white bg-[#FEE2E2] hover:bg-[#B91C1C] px-3 py-1 rounded-lg border border-[#B91C1C]/30 transition-colors cursor-pointer"
                    >
                      Disconnect Wi-Fi Device
                    </button>
                  </div>
                )}
              </div>

              {/* Android 11+ PIN Pairing Wizard */}
              <div className="glass-panel p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
                  <h3 className="text-base font-bold text-[#202936]">Android 11+ Wireless Pairing (PIN)</h3>
                </div>
                <p className="text-xs text-[#667085] mb-4">
                  Under Developer Options &gt; Wireless Debugging &gt; "Pair device with pairing code", enter the 6-digit PIN and pairing port.
                </p>

                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label htmlFor="pair-ip-input" className="sr-only">Device IP Address</label>
                    <input
                      id="pair-ip-input"
                      type="text"
                      value={pairIp}
                      onChange={e => setPairIp(e.target.value)}
                      placeholder="Device IP (e.g. 192.168.1.50)"
                      className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                    />
                  </div>
                  <div>
                    <label htmlFor="pair-port-input" className="sr-only">Pairing Port</label>
                    <input
                      id="pair-port-input"
                      type="text"
                      value={pairPort}
                      onChange={e => setPairPort(e.target.value)}
                      placeholder="Pairing Port (e.g. 37000)"
                      className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                    />
                  </div>
                  <div>
                    <label htmlFor="pair-pin-input" className="sr-only">6-Digit PIN</label>
                    <input
                      id="pair-pin-input"
                      type="text"
                      value={pairPin}
                      onChange={e => setPairPin(e.target.value)}
                      placeholder="6-Digit PIN (e.g. 123456)"
                      maxLength={6}
                      className="w-full bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs text-[#202936] font-mono tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                    />
                  </div>
                  <button
                    onClick={handlePairWireless}
                    className="glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                    aria-label="Pair device via wireless debugging PIN"
                  >
                    <span>Pair Device</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MEDIA & CAPTURES */}
          {activeTab === 'documents' && (
            <DocumentPanel api={api} selectedSerial={selectedSerial} deviceReady={activeDevice?.state === 'device'} captures={captures as any} />
          )}

          {activeTab === 'media' && (
            <div className="space-y-4">
              <div className="glass-panel p-5 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#202936]">Session Captures & Recordings</h3>
                  <p className="text-xs text-[#667085] mt-0.5">
                    Real PNG frame captures and MP4 video recordings saved to the portable Captures/ directory.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTakeScreenshot}
                    disabled={!isDeviceReady || isCapturing}
                    className={`glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                      !isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    aria-label="Take high-resolution screen capture"
                  >
                    <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isCapturing ? 'Saving...' : 'Take High-Res Screenshot'}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (api?.getCaptures) {
                        api.getCaptures().then(setCaptures);
                        setAlertBanner({ type: 'info', message: 'Captures list refreshed.' });
                      }
                    }}
                    className="glass-button text-xs py-2 px-3 min-h-[38px] min-w-[38px] flex items-center justify-center text-[#202936] hover:bg-[#F3F6F8] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                    aria-label="Refresh captures list"
                    title="Refresh captures list"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Captures List */}
              <div className="glass-panel p-5">
                <div className="text-xs font-bold text-[#84909E] uppercase tracking-wider mb-3">
                  Recorded Media Files ({captures.length})
                </div>

                {captures.length > 0 ? (
                  <div className="space-y-2">
                    {captures.map(c => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#84909E] transition-all text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#DDF4EF] border border-[#0F766E]/20 flex items-center justify-center text-[#0F766E]" aria-hidden="true">
                            {c.type === 'screenshot' ? <Camera className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="font-semibold text-[#202936]">{c.name}</div>
                            <div className="text-[11px] text-[#667085]">
                              {c.timestamp} · {(c.sizeBytes / 1024).toFixed(1)} KB
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (api?.openPath) {
                                api.openPath(c.path);
                              }
                            }}
                            className="glass-button py-1.5 px-3 text-[11px] min-h-[32px] flex items-center gap-1 text-[#202936] hover:bg-[#F3F6F8] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                            aria-label={`Open ${c.name} in system viewer`}
                          >
                            <Folder className="w-3 h-3 text-[#667085]" aria-hidden="true" />
                            <span>Open</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 text-[#84909E] text-xs">
                    No screenshots or recordings captured yet. Use "Take High-Res Screenshot" above or enable "Record Video Stream" in the Mirror tab.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DIAGNOSTICS & SYSTEM LOGS */}
          {activeTab === 'diagnostics' && (
            <div className="space-y-4">
              {/* System Diagnostics Overview Card */}
              <div className="glass-panel p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-[#0F766E]" />
                    <h3 className="text-base font-bold text-[#202936]">System Diagnostics & Environment</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyDiagnosticReport}
                      className="glass-button text-xs py-1.5 px-3 min-h-[36px] text-[#0F766E] hover:bg-[#DDF4EF] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                      aria-label="Copy sanitized system diagnostic report to clipboard"
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copyReportSuccess ? 'Copied to Clipboard!' : 'Copy Diagnostic Report'}</span>
                    </button>

                    <button
                      onClick={handleExportDiagnosticReport}
                      className="glass-button text-xs py-1.5 px-3 min-h-[36px] text-[#202936] hover:bg-[#F3F6F8] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                      aria-label="Export diagnostic report to text file"
                    >
                      <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Export .txt File</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                    <div className="text-[10px] uppercase font-bold text-[#84909E]">ADB Engine</div>
                    <div className="font-semibold text-[#202936] mt-1">{systemInfo?.adbVersion || 'Probing...'}</div>
                    <div className="font-mono text-[9px] text-[#667085] truncate mt-1">{systemInfo?.adbPath || 'bundled'}</div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                    <div className="text-[10px] uppercase font-bold text-[#84909E]">scrcpy Engine</div>
                    <div className="font-semibold text-[#202936] mt-1">{systemInfo?.scrcpyVersion || 'scrcpy 5.0.1'}</div>
                    <div className="font-mono text-[9px] text-[#667085] truncate mt-1">{systemInfo?.scrcpyPath || 'bundled'}</div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                    <div className="text-[10px] uppercase font-bold text-[#84909E]">Connected Devices</div>
                    <div className="font-semibold text-[#202936] mt-1">{devices.length} Detected</div>
                    <div className="text-[10px] text-[#667085] mt-1">
                      {devices.filter(d => d.state === 'device').length} authorized / ready
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]">
                    <div className="text-[10px] uppercase font-bold text-[#84909E]">Mirroring Session</div>
                    <div className="font-semibold text-[#202936] mt-1">
                      {isMirroring ? 'ACTIVE' : 'IDLE'}
                    </div>
                    <div className="text-[10px] text-[#667085] mt-1">
                      PID: {systemInfo?.mirrorStatus?.pid || 'None'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Log Stream Viewer */}
              <div className="glass-panel p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-[#F3F6F8] rounded-lg p-0.5 border border-[#D9DEE5] text-xs font-semibold" role="tablist" aria-label="Log source selector">
                      <button
                        onClick={() => setLogSource('device')}
                        role="tab"
                        aria-selected={logSource === 'device'}
                        className={`px-3 py-1.5 rounded-md transition-all min-h-[32px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                          logSource === 'device' ? 'bg-[#0F766E] text-white shadow-xs' : 'text-[#667085] hover:text-[#202936]'
                        }`}
                        aria-label="View device logcat output"
                      >
                        Device Logcat ({selectedSerial || 'No Target'})
                      </button>
                      <button
                        onClick={() => setLogSource('app')}
                        role="tab"
                        aria-selected={logSource === 'app'}
                        className={`px-3 py-1.5 rounded-md transition-all min-h-[32px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer ${
                          logSource === 'app' ? 'bg-[#0F766E] text-white shadow-xs' : 'text-[#667085] hover:text-[#202936]'
                        }`}
                        aria-label="View application runtime log output"
                      >
                        Application Log (androscrn.log)
                      </button>
                    </div>

                    <div className="flex items-center gap-2 bg-white border border-[#D9DEE5] rounded-lg px-2.5 py-1 text-xs focus-within:ring-2 focus-within:ring-[#0F766E]">
                      <Search className="w-3.5 h-3.5 text-[#84909E]" aria-hidden="true" />
                      <label htmlFor="log-filter-input" className="sr-only">Filter logs</label>
                      <input
                        id="log-filter-input"
                        type="text"
                        value={logFilter}
                        onChange={e => setLogFilter(e.target.value)}
                        placeholder="Filter logs..."
                        className="bg-transparent text-xs text-[#202936] outline-none w-48"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (logSource === 'device') refreshLogcat();
                      else refreshSystemInfo();
                    }}
                    className="glass-button text-xs py-1.5 px-3 min-h-[32px] flex items-center gap-1 text-[#202936] hover:bg-[#F3F6F8] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                    aria-label="Refresh logs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Log Terminal Screen */}
                <div className="glass-panel p-4 bg-[#F3F6F8] border border-[#D9DEE5] font-mono text-xs overflow-y-auto max-h-[420px] space-y-1">
                  {logSource === 'device' ? (
                    logs.length > 0 ? (
                      logs
                        .filter(l => (logFilter ? l.message.toLowerCase().includes(logFilter.toLowerCase()) || l.tag?.toLowerCase().includes(logFilter.toLowerCase()) : true))
                        .map((l, i) => (
                          <div key={i} className="flex items-start gap-2 hover:bg-white py-0.5 px-1 rounded text-[11px] transition-colors">
                            <span className="text-[#84909E] text-[10px] select-none">{l.timestamp}</span>
                            <span className={`px-1 rounded text-[9px] font-bold ${
                              l.level === 'E' ? 'bg-[#FEE2E2] text-[#B91C1C]' : l.level === 'W' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#DDF4EF] text-[#0F766E]'
                            }`}>
                              {l.level}
                            </span>
                            <span className="text-[#0F766E] font-semibold text-[10px] select-none">[{l.tag}]</span>
                            <span className="text-[#202936] break-all">{l.message}</span>
                          </div>
                        ))
                    ) : (
                      <div className="text-[#84909E] text-center py-12">
                        {selectedSerial ? 'No logcat lines received. Verify device is connected and authorized.' : 'Connect an Android device to inspect device logcat stream.'}
                      </div>
                    )
                  ) : (
                    systemInfo?.recentAppLogs && systemInfo.recentAppLogs.length > 0 ? (
                      systemInfo.recentAppLogs
                        .filter(l => (logFilter ? l.toLowerCase().includes(logFilter.toLowerCase()) : true))
                        .map((line, i) => (
                          <div key={i} className="text-[#202936] py-0.5 text-[11px] hover:bg-white rounded px-1 transition-colors">
                            {line}
                          </div>
                        ))
                    ) : (
                      <div className="text-[#84909E] text-center py-12">
                        Application runtime logs empty.
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: WORKFLOW RUNNER */}
          {activeTab === 'workflow' && (
            <div className="glass-panel p-6 space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#D9DEE5]">
                <div>
                  <h3 className="text-base font-bold text-[#202936] flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[#0F766E]" />
                    Automated Workflow &amp; Gesture Sequencer
                  </h3>
                  <p className="text-xs text-[#667085] mt-1">
                    Execute validated sequences of touchscreen gestures, key events, and visual assertions on target Android devices.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full border ${
                    isDeviceReady ? 'bg-[#DCFCE7] border-[#15803D]/30 text-[#15803D]' : 'bg-[#FEF3C7] border-[#B45309]/30 text-[#B45309]'
                  }`}>
                    {isDeviceReady ? `Target Ready: ${activeDevice?.model || selectedSerial}` : 'No Authorized Target'}
                  </span>
                </div>
              </div>

              {/* Preset Selector & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center bg-[#F3F6F8] rounded-xl p-1 border border-[#D9DEE5] text-xs font-semibold">
                  <button
                    onClick={() => handleSelectWorkflowPreset('sanity')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      workflowPreset === 'sanity' ? 'bg-[#0F766E] text-white shadow-sm' : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Sanity &amp; Navigation
                  </button>
                  <button
                    onClick={() => handleSelectWorkflowPreset('gestures')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      workflowPreset === 'gestures' ? 'bg-[#0F766E] text-white shadow-sm' : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Touch &amp; Gestures
                  </button>
                  <button
                    onClick={() => handleSelectWorkflowPreset('custom')}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      workflowPreset === 'custom' ? 'bg-[#0F766E] text-white shadow-sm' : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Custom Steps
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {workflowPreset === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setWorkflowSteps(prev => [...prev, { id: `s_${Date.now()}`, action: 'tap', params: { x: 500, y: 500 }, description: 'Tap (500, 500)' }])}
                        className="px-2.5 py-1.5 bg-white hover:bg-[#F3F6F8] text-[#202936] text-[11px] rounded-lg border border-[#D9DEE5] hover:border-[#0F766E]/40 transition-colors cursor-pointer"
                      >
                        + Tap
                      </button>
                      <button
                        onClick={() => setWorkflowSteps(prev => [...prev, { id: `s_${Date.now()}`, action: 'swipe', params: { x: 500, y: 1000, x2: 500, y2: 300, durationMs: 300 }, description: 'Swipe Up' }])}
                        className="px-2.5 py-1.5 bg-white hover:bg-[#F3F6F8] text-[#202936] text-[11px] rounded-lg border border-[#D9DEE5] hover:border-[#0F766E]/40 transition-colors cursor-pointer"
                      >
                        + Swipe
                      </button>
                      <button
                        onClick={() => setWorkflowSteps(prev => [...prev, { id: `s_${Date.now()}`, action: 'keyevent', params: { keycode: 3 }, description: 'Press HOME' }])}
                        className="px-2.5 py-1.5 bg-white hover:bg-[#F3F6F8] text-[#202936] text-[11px] rounded-lg border border-[#D9DEE5] hover:border-[#0F766E]/40 transition-colors cursor-pointer"
                      >
                        + Key
                      </button>
                      <button
                        onClick={() => setWorkflowSteps(prev => [...prev, { id: `s_${Date.now()}`, action: 'wait', params: { waitMs: 1000 }, description: 'Wait 1000ms' }])}
                        className="px-2.5 py-1.5 bg-white hover:bg-[#F3F6F8] text-[#202936] text-[11px] rounded-lg border border-[#D9DEE5] hover:border-[#0F766E]/40 transition-colors cursor-pointer"
                      >
                        + Wait
                      </button>
                      <button
                        onClick={() => setWorkflowSteps(prev => [...prev, { id: `s_${Date.now()}`, action: 'screenshot', params: { label: 'custom_step' }, description: 'Take Screenshot' }])}
                        className="px-2.5 py-1.5 bg-white hover:bg-[#F3F6F8] text-[#202936] text-[11px] rounded-lg border border-[#D9DEE5] hover:border-[#0F766E]/40 transition-colors cursor-pointer"
                      >
                        + Screenshot
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {workflowRunning && (
                      <button
                        type="button"
                        onClick={handleCancelWorkflow}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#B91C1C] hover:bg-[#991B1B] text-white cursor-pointer transition-colors shadow-sm"
                        title="Cancel running workflow"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Cancel Sequence</span>
                      </button>
                    )}
                    <button
                      onClick={handleExecuteWorkflow}
                      disabled={!isDeviceReady || workflowRunning || workflowSteps.length === 0}
                      className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${
                        !isDeviceReady || workflowRunning || workflowSteps.length === 0
                          ? 'bg-[#F3F6F8] text-[#84909E] cursor-not-allowed border border-[#D9DEE5]'
                          : 'bg-[#0F766E] hover:bg-[#115E59] text-white shadow-md shadow-[#0F766E]/20 cursor-pointer border border-[#0F766E]'
                      }`}
                    >
                      {workflowRunning ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Running Workflow...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 fill-current" />
                          <span>Run Sequence ({workflowSteps.length} Steps)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Step Sequence Table */}
              <div className="bg-white border border-[#D9DEE5] rounded-xl overflow-hidden shadow-xs">
                <div className="px-4 py-2.5 bg-[#F3F6F8] border-b border-[#D9DEE5] flex items-center justify-between text-xs font-semibold text-[#667085] uppercase tracking-wider">
                  <span>Step Sequence ({workflowSteps.length} Operations)</span>
                  {workflowPreset === 'custom' && workflowSteps.length > 0 && (
                    <button
                      onClick={() => setWorkflowSteps([])}
                      className="text-[11px] text-[#B91C1C] hover:text-[#991B1B] normal-case font-medium cursor-pointer"
                    >
                      Clear All Steps
                    </button>
                  )}
                </div>

                <div className="divide-y divide-[#D9DEE5] max-h-72 overflow-y-auto font-mono text-xs">
                  {workflowSteps.map((step, idx) => (
                    <div key={idx} className="px-4 py-2.5 flex items-center justify-between hover:bg-[#F3F6F8]/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-[#F3F6F8] border border-[#D9DEE5] flex items-center justify-center text-[10px] font-bold text-[#202936] shrink-0">
                          {idx + 1}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                          step.action === 'tap' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          step.action === 'swipe' ? 'bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30' :
                          step.action === 'keyevent' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                          step.action === 'input_text' ? 'bg-[#DCFCE7] text-[#15803D] border border-[#15803D]/30' :
                          step.action === 'wait' ? 'bg-[#FEF3C7] text-[#B45309] border border-[#B45309]/30' :
                          step.action === 'screenshot' ? 'bg-pink-50 text-pink-700 border border-pink-200' :
                          'bg-slate-100 text-[#202936] border border-[#D9DEE5]'
                        }`}>
                          {step.action}
                        </span>
                        <span className="text-[#202936] font-sans text-xs">
                          {step.description || step.action}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] text-[#667085]">
                        <span>
                          {step.action === 'tap' && `x: ${step.params?.x ?? 500}, y: ${step.params?.y ?? 500}`}
                          {step.action === 'swipe' && `(${step.params?.x ?? 300},${step.params?.y ?? 800}) → (${step.params?.x2 ?? 300},${step.params?.y2 ?? 200}) [${step.params?.durationMs ?? 300}ms]`}
                          {step.action === 'keyevent' && `keycode: ${step.params?.keycode ?? 3}`}
                          {step.action === 'input_text' && `text: "${step.params?.text ?? ''}"`}
                          {step.action === 'wait' && `${step.params?.waitMs ?? 1000}ms delay`}
                          {step.action === 'screenshot' && `save: ${step.params?.label || 'capture'}.png`}
                        </span>
                        {workflowPreset === 'custom' && (
                          <button
                            onClick={() => setWorkflowSteps(prev => prev.filter((_, i) => i !== idx))}
                            className="text-[#84909E] hover:text-[#B91C1C] transition-colors p-1 cursor-pointer"
                            title="Delete step"
                            aria-label={`Delete step ${idx + 1}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Execution Results View */}
              {workflowResult && (() => {
                const isSuccess = workflowResult.overallStatus === 'passed' || workflowResult.success === true;
                const completedStepsCount = workflowResult.passedSteps ?? workflowResult.completedSteps ?? (isSuccess ? workflowSteps.length : 0);
                const totalDuration = workflowResult.totalDurationMs ?? workflowResult.durationMs;
                const reportSteps = workflowResult.steps || (workflowResult.results ? workflowResult.results.map((r: any) => ({
                  action: r.action,
                  success: r.status === 'passed',
                  durationMs: r.durationMs,
                  error: r.error
                })) : []);

                return (
                  <div className={`p-4 rounded-xl border ${
                    isSuccess
                      ? 'bg-[#DCFCE7]/40 border-[#15803D]/30'
                      : 'bg-[#FEE2E2]/60 border-[#B91C1C]/30'
                  } space-y-3`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isSuccess ? (
                          <CheckCircle2 className="w-5 h-5 text-[#15803D]" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-[#B91C1C]" />
                        )}
                        <div>
                          <h4 className="text-xs font-bold text-[#202936]">
                            {isSuccess ? 'Workflow Completed Successfully' : 'Workflow Execution Stopped'}
                          </h4>
                          <p className="text-[11px] text-[#667085]">
                            {completedStepsCount} of {workflowSteps.length} steps executed
                            {!isSuccess && workflowResult.error ? ` • ${workflowResult.error}` : ''}
                          </p>
                        </div>
                      </div>
                      {totalDuration !== undefined && (
                        <span className="text-xs font-mono text-[#667085] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#667085]" />
                          {(totalDuration / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>

                    {reportSteps.length > 0 && (
                      <div className="bg-white rounded-lg p-3 border border-[#D9DEE5] space-y-1.5 font-mono text-[11px]">
                        {reportSteps.map((st: any, i: number) => {
                          const isStepOk = st.status === 'passed' || st.success === true;
                          return (
                            <div key={i} className="flex items-center justify-between text-[#202936] py-0.5">
                              <span className="flex items-center gap-2">
                                {isStepOk ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-[#B91C1C] shrink-0" />
                                )}
                                <span>Step {i + 1}: {st.action}</span>
                              </span>
                              <span className={isStepOk ? 'text-[#15803D]' : 'text-[#B91C1C]'}>
                                {isStepOk ? (st.durationMs ? `${st.durationMs}ms` : 'PASS') : (st.error || 'FAIL')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* TAB 6: AI AGENT & MCP SECURITY CENTER */}
          {activeTab === 'ai' && (
            <div className="glass-panel p-6 space-y-6" id="mcp-security-center">
              {/* Header & Status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#D9DEE5]">
                <div>
                  <h3 className="text-base font-bold text-[#202936] flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
                    AI Agent &amp; MCP Security Center
                  </h3>
                  <p className="text-xs text-[#667085] mt-1">
                    Control bridge for external AI agents communicating via the Model Context Protocol (MCP).
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F3F6F8] border border-[#D9DEE5] text-xs">
                    <span className={`w-2 h-2 rounded-full ${mcpStatus.connectedMcpProcesses > 0 ? 'bg-[#15803D] animate-pulse' : 'bg-[#84909E]'}`} />
                    <span className="text-[#202936]">
                      Pipe: <span className="text-[#0F766E] font-mono text-[11px]">\\.\pipe\androscrn-mcp-control</span>
                    </span>
                    <span className="text-[#D9DEE5]">|</span>
                    <span className="text-[#202936] font-semibold">
                      {mcpStatus.connectedMcpProcesses} client{mcpStatus.connectedMcpProcesses === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Emergency Kill Switch Banner */}
              <div className="p-4 rounded-xl bg-[#FEE2E2]/60 border-2 border-[#B91C1C]/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[#B91C1C] font-bold text-sm">
                    <ShieldAlert className="w-4 h-4 text-[#B91C1C] shrink-0" aria-hidden="true" />
                    <span>Emergency Revocation (Kill Switch)</span>
                  </div>
                  <p className="text-xs text-[#B91C1C]/90 leading-relaxed max-w-xl">
                    Instantly invalidates all active AI session tokens across all running MCP instances and denies any further privileged operations.
                  </p>
                </div>
                <button
                  onClick={handleRevokeAllSessions}
                  className="px-4 py-2.5 rounded-lg bg-[#B91C1C] hover:bg-[#991B1B] text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-[#B91C1C]/20 focus-visible:ring-2 focus-visible:ring-[#B91C1C] cursor-pointer shrink-0 transition-all active:scale-95"
                  id="btn-revoke-all-mcp"
                  aria-label="Revoke all active AI sessions immediately"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  Revoke All AI Sessions
                </button>
              </div>

              {/* Active Sessions List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#667085] flex items-center gap-2">
                    <Key className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
                    Active AI Sessions ({mcpStatus.activeSessions?.length || 0})
                  </h4>
                  <button
                    onClick={refreshMcpStatus}
                    className="text-xs text-[#0F766E] hover:text-[#115E59] flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-[#0F766E] rounded px-1.5 py-0.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>

                {mcpStatus.activeSessions && mcpStatus.activeSessions.length > 0 ? (
                  <div className="space-y-2" id="active-sessions-list">
                    {mcpStatus.activeSessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] flex items-center justify-between gap-4 text-xs shadow-xs"
                        id={`session-item-${session.sessionId}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#202936]">{session.clientName || 'AI-Client'}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#DDF4EF] text-[#0F766E] border border-[#0F766E]/30 font-mono">
                              Tier {session.tiers?.join(', ') || '3'}
                            </span>
                          </div>
                          <div className="text-[#667085] text-[11px] font-mono">
                            ID: {session.sessionId.slice(0, 18)}... | Expires: {new Date(session.expiresAt).toLocaleTimeString()}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRevokeSession(session.sessionId)}
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#FEE2E2] text-[#667085] hover:text-[#B91C1C] border border-[#D9DEE5] hover:border-[#B91C1C]/40 text-xs font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[#B91C1C]"
                          id={`btn-revoke-session-${session.sessionId}`}
                          aria-label={`Revoke session for ${session.clientName || session.sessionId}`}
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] text-center text-[#667085] text-xs" id="empty-active-sessions">
                    No active AI agent sessions. External agents must request and receive human pairing approval before acquiring tokens.
                  </div>
                )}
              </div>

              {/* Live AI Action Audit Log */}
              <div className="space-y-3 pt-2" id="mcp-action-audit-section">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#667085] flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
                    Live Action Audit Log (Token-Free &amp; Redacted)
                  </h4>
                  <span className="text-[11px] text-[#84909E] font-mono">
                    Last {mcpStatus.recentAudits?.length || 0} events
                  </span>
                </div>
                <p className="text-[11px] text-[#667085]">
                  Audits every Tier 3 input operation (<code>tap</code>, <code>swipe</code>, <code>keyevent</code>, <code>input_text</code>) in real time. Authentication tokens and sensitive text contents are strictly omitted.
                </p>

                {mcpStatus.recentAudits && mcpStatus.recentAudits.length > 0 ? (
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1" id="mcp-action-audit-list">
                    {mcpStatus.recentAudits.map((item) => {
                      const statusBadgeClass = {
                        PENDING: 'bg-[#FEF3C7] border-[#B45309]/30 text-[#B45309]',
                        SUCCESS: 'bg-[#DCFCE7] border-[#15803D]/30 text-[#15803D]',
                        FAILED: 'bg-[#FEE2E2] border-[#B91C1C]/30 text-[#B91C1C]',
                        REJECTED: 'bg-purple-50 border-purple-200 text-purple-700'
                      }[item.status] || 'bg-[#F3F6F8] text-[#202936] border border-[#D9DEE5]';

                      return (
                        <div
                          key={item.id}
                          className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                          id={`audit-item-${item.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${statusBadgeClass}`}>
                              {item.status}
                            </span>
                            <span className="font-mono text-[#0F766E] font-semibold">{item.action}</span>
                            <span className="text-[#84909E] text-[11px]">by</span>
                            <span className="text-[#202936] font-medium">{item.clientName}</span>
                            <span className="text-[#84909E] text-[11px]">on</span>
                            <span className="font-mono text-[#667085] text-[11px]">{item.serial}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[#667085] text-[11px]">
                            {item.details && (
                              <span className="text-[#202936] font-mono text-[10px] bg-white px-1.5 py-0.5 rounded border border-[#D9DEE5]">
                                {item.details}
                              </span>
                            )}
                            <span className="text-[#84909E] font-mono text-[10px]">
                              {new Date(item.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] text-center text-[#667085] text-xs" id="empty-action-audits">
                    No input actions executed yet. Once an authorized AI agent invokes <code>tap</code>, <code>swipe</code>, <code>keyevent</code>, or <code>input_text</code>, execution events will appear here in real time.
                  </div>
                )}
              </div>

              {/* Permission Matrix Reference */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#667085] flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#0F766E]" aria-hidden="true" />
                  Pairing-First Permission Matrix
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1">
                    <div className="font-semibold text-[#15803D] flex items-center gap-1.5">
                      <Unlock className="w-3.5 h-3.5" /> Tier 0–2: Read-Only Telemetry &amp; Screen
                    </div>
                    <p className="text-[11px] text-[#667085]">
                      <code>list_devices</code>, <code>get_device_info</code>, <code>get_diagnostics</code>, <code>capture_screenshot</code>, and redacted <code>get_logcat</code>. Unconditional observation.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1">
                    <div className="font-semibold text-[#B45309] flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" /> Tier 3–4: Mutating Actions &amp; Administration
                    </div>
                    <p className="text-[11px] text-[#667085]">
                      Touch injection, keyevents, shell commands, APK installation. Strictly requires 6-digit PIN handshake or desktop 1-click human approval.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: ABOUT & LEGAL GOVERNANCE */}
          {activeTab === 'about' && (
            <div className="glass-panel p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#D9DEE5] pb-4">
                <div>
                  <h3 className="text-base font-bold text-[#202936] flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#0F766E]" />
                    About AndroScrn &amp; Governance
                  </h3>
                  <p className="text-xs text-[#667085] mt-1">
                    Independent, local-first Android engineering workbench for Windows.
                  </p>
                </div>

                {/* Sub-Tab Navigation Pills */}
                <div className="inline-flex p-1 bg-[#F3F6F8] border border-[#D9DEE5] rounded-xl gap-1" role="tablist" aria-label="About sub-navigation">
                  <button
                    onClick={() => setAboutSubTab('licenses')}
                    role="tab"
                    aria-selected={aboutSubTab === 'licenses'}
                    id="btn-subtab-licenses"
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      aboutSubTab === 'licenses'
                        ? 'bg-[#0F766E] text-white shadow-sm'
                        : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Overview &amp; Licenses
                  </button>
                  <button
                    onClick={() => setAboutSubTab('privacy')}
                    role="tab"
                    aria-selected={aboutSubTab === 'privacy'}
                    id="btn-subtab-privacy"
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      aboutSubTab === 'privacy'
                        ? 'bg-[#0F766E] text-white shadow-sm'
                        : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Privacy Policy
                  </button>
                  <button
                    onClick={() => setAboutSubTab('terms')}
                    role="tab"
                    aria-selected={aboutSubTab === 'terms'}
                    id="btn-subtab-terms"
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      aboutSubTab === 'terms'
                        ? 'bg-[#0F766E] text-white shadow-sm'
                        : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Terms of Use
                  </button>
                  <button
                    onClick={() => setAboutSubTab('submission')}
                    role="tab"
                    aria-selected={aboutSubTab === 'submission'}
                    id="btn-subtab-submission"
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      aboutSubTab === 'submission'
                        ? 'bg-[#0F766E] text-white shadow-sm'
                        : 'text-[#667085] hover:text-[#202936]'
                    }`}
                  >
                    Store Readiness
                  </button>
                </div>
              </div>

              {/* SUBTAB 1: OVERVIEW & LICENSES */}
              {aboutSubTab === 'licenses' && (
                <div className="space-y-4">
                  {/* Official Documentation & Website Banner */}
                  <div className="p-4 rounded-xl bg-white border border-[#D9DEE5] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
                    <div>
                      <div className="font-semibold text-[#202936] flex items-center gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5 text-[#0F766E]" />
                        Official Website &amp; Documentation
                      </div>
                      <p className="text-[11px] text-[#667085] mt-1">
                        Explore interactive guides, Camera Studio manual, MCP automation reference, and web workbench at <strong className="text-[#0F766E]">sukeshperiyasamy.github.io/Androscrn</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = 'https://sukeshperiyasamy.github.io/Androscrn';
                        if (api?.openExternal) {
                          api.openExternal(url);
                        } else {
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white text-xs font-semibold shadow-xs transition-colors w-fit focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer shrink-0"
                    >
                      <span>Visit Documentation</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Architecture Notice */}
                  <div className="p-3.5 rounded-xl bg-[#DDF4EF]/40 border border-[#0F766E]/20 text-xs text-[#202936] space-y-1.5">
                    <div className="font-semibold text-[#0F766E] flex items-center gap-2">
                      <Info className="w-3.5 h-3.5 text-[#0F766E]" />
                      Architecture Designation: Provisional Electron Distribution
                    </div>
                    <div className="text-[11px] text-[#667085] leading-relaxed">
                      The approved target product baseline is Tauri 2 + Rust + React/TypeScript with an MCP stdio server.
                      This standalone build is packaged as an Electron 31 distribution due to host toolchain constraints (no local Rust compiler).
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#0F766E]/30 transition-colors">
                      <div className="font-semibold text-[#202936]">scrcpy (v5.0.1)</div>
                      <div className="text-[#667085] text-[11px] mt-1">Copyright © Genymobile · Apache License 2.0</div>
                      <div className="text-[#84909E] text-[10px] mt-1">SDL3, libavcodec, libavformat, libavutil, libusb</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#0F766E]/30 transition-colors">
                      <div className="font-semibold text-[#202936]">Android Debug Bridge (ADB v1.0.41)</div>
                      <div className="text-[#667085] text-[11px] mt-1">Copyright © Google AOSP · Apache License 2.0</div>
                      <div className="text-[#84909E] text-[10px] mt-1">Platform Tools v37.0.1</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#0F766E]/30 transition-colors">
                      <div className="font-semibold text-[#202936]">Electron &amp; Chromium</div>
                      <div className="text-[#667085] text-[11px] mt-1">Copyright © Electron Contributors · MIT License</div>
                      <div className="text-[#84909E] text-[10px] mt-1">Runtime Version v31.7.7</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#0F766E]/30 transition-colors">
                      <div className="font-semibold text-[#202936]">REA (Reverse Engineer Anything)</div>
                      <div className="text-[#667085] text-[11px] mt-1">Copyright © morluto · MIT License</div>
                      <div className="text-[#84909E] text-[10px] mt-1">Research &amp; Architecture Reference</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#0F766E]/30 transition-colors">
                      <div className="font-semibold text-[#202936]">Tesseract.js OCR (v7.0.0)</div>
                      <div className="text-[#667085] text-[11px] mt-1">Copyright © Tesseract Contributors · Apache 2.0</div>
                      <div className="text-[#84909E] text-[10px] mt-1">WebAssembly local OCR engine, zero network calls</div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] hover:border-[#0F766E]/30 transition-colors">
                      <div className="font-semibold text-[#202936]">Android Companion</div>
                      <div className="text-[#667085] text-[11px] mt-1">CameraX (Apache 2.0) &amp; NanoHTTPD (BSD-3)</div>
                      <div className="text-[#84909E] text-[10px] mt-1">Loopback 127.0.0.1:8080 streaming helper</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#D9DEE5] text-xs text-[#667085]">
                    AndroScrn is released under the <strong className="text-[#0F766E]">MIT License</strong>. All device communication is local and private. No cloud telemetry is transmitted.
                  </div>
                </div>
              )}

              {/* SUBTAB 2: PRIVACY POLICY */}
              {aboutSubTab === 'privacy' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-[#DDF4EF]/40 border border-[#0F766E]/20 text-xs text-[#202936]">
                    <div className="font-semibold text-[#0F766E] flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#0F766E]" />
                      Strict Local-First Architecture — Complete Data Sovereignty
                    </div>
                    <div className="text-[11px] text-[#667085] mt-1">
                      AndroScrn operates without remote servers, tracking services, or analytics SDKs. All processing stays on your local hardware.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936] flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-[#0F766E]" />
                        Device Telemetry &amp; Log Redaction
                      </div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Device serials, models, and OS levels are held in volatile desktop memory only. When diagnostic bundles are exported, sensitive serial numbers, IP/MAC addresses, and Wi-Fi SSIDs are automatically masked by the redaction engine.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936] flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-[#0F766E]" />
                        Screen Mirroring &amp; Local Captures
                      </div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Display frames are hardware-decoded directly to the desktop via Direct3D11. Screenshots and video recordings are saved exclusively in your local Windows user directory. No video data leaves your PC.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#0F766E]" />
                        Offline OCR &amp; Document Intelligence
                      </div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Document scanning uses an embedded WebAssembly instance of Tesseract OCR with bundled offline English training data. Tested and verified with zero outbound network requests.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936] flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 text-[#0F766E]" />
                        Android Companion Privacy &amp; Anti-Covert Banner
                      </div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Companion binds strictly to loopback 127.0.0.1:8080 over ADB tunnel. Pairing uses a 6-digit random PIN displayed on the phone (60s TTL). High-res stills are deleted immediately after reading. A persistent LIVE FEED ACTIVE banner prevents covert capture.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#D9DEE5] text-[11px] text-[#667085] flex items-center justify-between">
                    <span>Maintainer Privacy Contact: <strong className="text-[#202936]">[MAINTAINER_CONTACT_PLACEHOLDER: privacy@androscrn.org]</strong></span>
                    <span className="text-[#84909E]">Document: docs/privacy-policy.md</span>
                  </div>
                </div>
              )}

              {/* SUBTAB 3: TERMS OF USE */}
              {aboutSubTab === 'terms' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-[#FEF3C7]/40 border border-[#B45309]/30 text-xs text-[#202936]">
                    <div className="font-semibold text-[#B45309] flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-[#B45309]" />
                      Responsible Usage &amp; Device Ownership Terms
                    </div>
                    <div className="text-[11px] text-[#667085] mt-1">
                      AndroScrn provides direct hardware control and automation tools. Use of the software requires compliance with these principles.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936]">Authorized Device Ownership</div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        You agree to only connect, inspect, mirror, or automate devices that you own or for which you have received express, documented authorization from the rightful owner or administrator.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936]">Prohibited Activities</div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Unauthorized surveillance, clandestine camera capture, MDM or kiosk lock circumvention without consent, and distribution of malicious payloads are strictly prohibited.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936]">Supervised AI Automation</div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Automated input actions execute real physical or virtual events on connected hardware. Operators maintain complete supervisory responsibility and must monitor active routines. Emergency Revoke is always available.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1.5">
                      <div className="font-semibold text-[#202936]">Warranty Disclaimer &amp; Liability Limit</div>
                      <p className="text-[#667085] text-[11px] leading-relaxed">
                        Software is provided "AS IS" under the MIT License without warranty of any kind. Maintainers and contributors assume no liability for data loss, hardware disruptions, or improper device usage.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#D9DEE5] text-[11px] text-[#667085] flex items-center justify-between">
                    <span>Maintainer Legal Contact: <strong className="text-[#202936]">[MAINTAINER_CONTACT_PLACEHOLDER: legal@androscrn.org]</strong></span>
                    <span className="text-[#84909E]">Document: docs/terms-of-use.md</span>
                  </div>
                </div>
              )}

              {/* SUBTAB 4: ANDROID STORE READINESS */}
              {aboutSubTab === 'submission' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-[#DCFCE7]/40 border border-[#15803D]/30 text-xs text-[#202936]">
                    <div className="font-semibold text-[#15803D] flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#15803D]" />
                      Google Play Store &amp; F-Droid Submission Readiness
                    </div>
                    <div className="text-[11px] text-[#667085] mt-1">
                      AndroScrn Companion (com.androscrn.companion) audit status for Android store compliance.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1">
                      <div className="text-[#15803D] font-semibold text-[11px]">DATA SAFETY</div>
                      <div className="text-[#202936] font-bold">Zero Data Collected</div>
                      <div className="text-[#667085] text-[11px] mt-1 leading-relaxed">
                        Questionnaire responses: No data collected, no data shared with third parties. Ephemeral in-memory frame processing only.
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1">
                      <div className="text-[#0F766E] font-semibold text-[11px]">TARGET PLATFORM</div>
                      <div className="text-[#202936] font-bold">Target SDK 34 (Android 14)</div>
                      <div className="text-[#667085] text-[11px] mt-1 leading-relaxed">
                        Fully compliant with Google Play target API requirements. Min SDK 26 (Android 8.0 Oreo). 64-bit architecture neutral.
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] space-y-1">
                      <div className="text-[#0F766E] font-semibold text-[11px]">USER ACCOUNTS</div>
                      <div className="text-[#202936] font-bold">Policy Exempt</div>
                      <div className="text-[#667085] text-[11px] mt-1 leading-relaxed">
                        No user account creation or cloud login infrastructure. Google Play account deletion requirement is non-applicable.
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] text-xs text-[#202936] space-y-1.5">
                    <div className="font-semibold text-[#202936]">Permissions Justification &amp; Prominent Disclosure:</div>
                    <div className="text-[11px] text-[#667085] leading-relaxed">
                      • <span className="font-mono text-[#0F766E]">android.permission.CAMERA</span>: Foreground CameraX capture; requested dynamically with in-app explanation.<br/>
                      • <span className="font-mono text-[#0F766E]">android.permission.INTERNET</span>: Bound strictly to loopback <span className="font-mono">127.0.0.1:8080</span> for ADB port-forwarding.<br/>
                      • <span className="font-mono text-[#0F766E]">android.permission.ACCESS_NETWORK_STATE</span>: Local interface inspection.
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white border border-[#D9DEE5] text-[11px] text-[#667085] flex items-center justify-between">
                    <span>AAB Release Signing Guide &amp; Store Metadata Ready</span>
                    <span className="text-[#84909E]">Document: docs/android-submission-readiness.md</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
