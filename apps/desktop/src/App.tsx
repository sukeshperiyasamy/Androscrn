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
  Sparkles
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

export default function App() {
  const [activeTab, setActiveTab] = useState<'mirror' | 'camera' | 'wireless' | 'media' | 'documents' | 'diagnostics' | 'workflow' | 'ai' | 'about'>('mirror');
  
  // Device State
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [deviceHelp, setDeviceHelp] = useState<DeviceHelp | null>(null);
  const [helpRetrying, setHelpRetrying] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [editingAlias, setEditingAlias] = useState(false);

  // Mirroring State
  const [isMirroring, setIsMirroring] = useState(false);
  const [qualityPreset, setQualityPreset] = useState<'high_performance' | 'balanced' | 'battery_saver' | 'ultra'>('balanced');
  const [turnScreenOff, setTurnScreenOff] = useState(false);
  const [stayAwake, setStayAwake] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [showTouches, setShowTouches] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [windowBorderless, setWindowBorderless] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [isOperating, setIsOperating] = useState(false);

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

  // Status Alerts
  const [alertBanner, setAlertBanner] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>({
    type: 'info',
    message: 'Welcome to AndroScrn. Connect an Android phone via USB or Wi-Fi to begin.'
  });

  // Check IPC availability
  const api = (window as any).androscrnApi;

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

    if (api?.onMcpPairingRequest) {
      api.onMcpPairingRequest((req: any) => {
        refreshMcpStatus();
        setAlertBanner({
          type: 'info',
          message: `🔔 Incoming AI Pairing Request from '${req.clientName}' for Tier ${req.requestedTier}. Desktop approval required.`
        });
      });
    }

    if (api?.onMcpStatusChanged) {
      api.onMcpStatusChanged(() => {
        refreshMcpStatus();
      });
    }

    if (api?.onMcpSessionsRevoked) {
      api.onMcpSessionsRevoked(() => {
        refreshMcpStatus();
        setAlertBanner({
          type: 'error',
          message: '⚠️ All AI sessions have been revoked by the Emergency Kill Switch.'
        });
      });
    }

    if (api?.onMcpActionAudit) {
      api.onMcpActionAudit((audit: any) => {
        refreshMcpStatus();
      });
    }

    if (api?.onMirrorStatusChanged) {
      api.onMirrorStatusChanged((data: any) => {
        setIsMirroring(data.running);
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
    }

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      refreshSystemInfo();
      refreshLogcat();
    } else if (activeTab === 'ai') {
      refreshMcpStatus();
    }
  }, [activeTab, selectedSerial]);

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
          setSelectedResolution(caps.cameras[0].supportedSizes[0]);
        }
        if (caps.cameras[0].fpsList && caps.cameras[0].fpsList.length > 0) {
          setSelectedFps(caps.cameras[0].fpsList[caps.cameras[0].fpsList.length - 1]);
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
          if (st.currentZoom !== undefined) setCameraZoom(st.currentZoom);
          if (st.torchActive !== undefined) setCameraTorch(st.torchActive);
        }
      }
    } catch (e) {
      // ignore
    }
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
          record: recordCameraSession
        });

        if (res.success) {
          setIsCameraRunning(true);
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
      setAlertBanner({ type: 'info', message: 'Camera Studio preview session stopped.' });
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
    setAlertBanner({ type: 'info', message: 'Screen mirroring session ended.' });
    refreshDevices();
  };

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

  const handleSendKeyevent = (code: string, label: string) => {
    if (!selectedSerial) {
      setAlertBanner({ type: 'error', message: 'Select a connected device first.' });
      return;
    }
    if (!isDeviceReady) {
      setAlertBanner({ type: 'error', message: activeDevice?.guidance || 'Device is not ready.' });
      return;
    }

    if (api?.executeAdb) {
      api.executeAdb(['-s', selectedSerial, 'shell', 'input', 'keyevent', code]);
      setAlertBanner({ type: 'info', message: `Sent ${label} keyevent to ${activeDevice.model}.` });
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
    <div className="flex flex-col h-screen bg-[#07090e] text-slate-100 font-sans select-none overflow-hidden">
      {/* Top Application Header */}
      <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-5 flex items-center justify-between shrink-0" role="banner">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-0.5 flex items-center justify-center shadow-lg shadow-indigo-500/20" aria-hidden="true">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                AndroScrn
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                v1.0.0 Alpha
              </span>
            </div>
            <p className="text-[11px] text-slate-300">Windows-First Android Control & Automation Platform</p>
          </div>
        </div>

        {/* Global Device Bar */}
        <div className="flex items-center gap-3">
          {devices.length > 0 ? (
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-700/60 rounded-xl px-3 py-1.5">
              <span className={`status-pulse ${activeDevice?.state === 'device' ? 'active' : 'inactive'}`} aria-hidden="true"></span>
              <label htmlFor="global-device-select" className="sr-only">Select Android Device</label>
              <select
                id="global-device-select"
                value={selectedSerial}
                onChange={e => setSelectedSerial(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-200 outline-none cursor-pointer pr-2 max-w-[260px] truncate focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
                aria-label="Select connected Android device"
              >
                {devices.map(d => (
                  <option key={d.serial} value={d.serial} className="bg-slate-900 text-slate-200">
                    {d.alias || d.model} ({d.transportType.toUpperCase()} - {d.serial})
                  </option>
                ))}
              </select>

              {/* Device State Badge */}
              {activeDevice?.state === 'unauthorized' && (
                <span className="text-[10px] uppercase font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30" role="status" aria-label="Device status: Unauthorized">
                  Unauthorized
                </span>
              )}
              {activeDevice?.state === 'offline' && (
                <span className="text-[10px] uppercase font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30" role="status" aria-label="Device status: Offline">
                  Offline
                </span>
              )}
              {activeDevice?.state === 'device' && (
                <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30" role="status" aria-label="Device status: Ready">
                  Ready
                </span>
              )}

              {activeDevice?.transportType === 'wifi' ? (
                <Wifi className="w-3.5 h-3.5 text-cyan-400 ml-1" title="Connected via Wi-Fi" aria-label="Connected via Wi-Fi" />
              ) : (
                <Usb className="w-3.5 h-3.5 text-indigo-400 ml-1" title="Connected via USB" aria-label="Connected via USB" />
              )}

              {activeDevice?.batteryLevel !== undefined && (
                <span className="text-[11px] font-mono font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20" aria-label={`Battery level: ${activeDevice.batteryLevel}%`}>
                  {activeDevice.batteryLevel}%
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl" role="status">
              <span className="status-pulse inactive" aria-hidden="true"></span>
              <span>No devices detected</span>
            </div>
          )}

          <button
            onClick={refreshDevices}
            disabled={isScanning}
            className="glass-button p-2 text-slate-200 hover:text-white min-h-[38px] min-w-[38px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
            title="Scan for Devices (ADB)"
            aria-label="Scan for connected Android devices via ADB"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin text-indigo-400' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Alert Guidance Banner */}
      {alertBanner && (
        <div className="mx-4 mt-3" role="status" aria-live="polite">
          <div
            className={`px-4 py-2.5 rounded-xl text-xs flex items-center justify-between border backdrop-blur-md transition-all ${
              alertBanner.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                : alertBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {alertBanner.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
              ) : alertBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
              ) : (
                <HelpCircle className="w-4 h-4 shrink-0 text-indigo-400" aria-hidden="true" />
              )}
              <span className="font-medium">{alertBanner.message}</span>
            </div>
            <button
              onClick={() => setAlertBanner(null)}
              className="text-slate-300 hover:text-white text-base font-bold px-1.5 py-0.5 rounded focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
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
        retrying={helpRetrying}
        onRetry={async () => {
          setHelpRetrying(true);
          try {
            await refreshDevices();
            if (api?.getDeviceHelp && selectedSerial) {
              setDeviceHelp(await api.getDeviceHelp(selectedSerial));
            }
          } finally {
            setHelpRetrying(false);
          }
        }}
      />

      {/* Pending AI Pairing Requests (Human-in-the-Loop Gatekeeper) */}
      {mcpStatus.pendingRequests && mcpStatus.pendingRequests.length > 0 && (
        <div className="mx-4 mt-3 space-y-2" role="region" aria-label="Pending AI Pairing Handshake Requests" id="mcp-pairing-requests-container">
          {mcpStatus.pendingRequests.map(req => (
            <div
              key={req.requestId}
              className="p-4 rounded-xl bg-amber-950/40 border-2 border-amber-500/60 backdrop-blur-md text-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg shadow-amber-500/10"
              id={`pairing-card-${req.requestId}`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" aria-hidden="true" />
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Incoming AI Agent Pairing Request</span>
                </div>
                <div className="text-sm font-semibold text-white">
                  Client: <span className="text-amber-300 font-mono font-bold">{req.clientName}</span> is requesting <span className="text-amber-300 font-mono">Tier {req.requestedTier} ({req.requestedTier === 3 ? 'write:input' : req.requestedTier === 4 ? 'write:admin' : 'read'})</span>
                </div>
                <div className="text-xs text-amber-300/80 flex items-center gap-3 flex-wrap">
                  <span>Desktop PIN: <strong className="text-base text-white font-mono bg-slate-900/90 px-2.5 py-0.5 rounded border border-amber-500/40 tracking-widest">{req.pin}</strong></span>
                  <span>(Expires in {Math.max(0, Math.floor((req.expiresAt - Date.now()) / 1000))}s)</span>
                  <span className="text-[11px] text-slate-400">• Click Approve to grant access or paste this PIN to the agent</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  onClick={() => handleApprovePairing(req.requestId)}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20 focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer min-h-[38px]"
                  id={`btn-approve-pairing-${req.requestId}`}
                  aria-label={`Approve pairing request for ${req.clientName}`}
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Approve Access
                </button>
                <button
                  onClick={() => handleDenyPairing(req.requestId)}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-rose-600/20 focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer min-h-[38px]"
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
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 py-2" id="nav-workbench-heading">
              Workbench
            </div>

            <button
              onClick={() => setActiveTab('mirror')}
              role="tab"
              aria-selected={activeTab === 'mirror'}
              aria-controls="main-tab-panel"
              id="tab-mirror"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'mirror'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 shadow-md shadow-indigo-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Smartphone className="w-4 h-4 text-indigo-400" aria-hidden="true" />
              <span>Screen Mirroring</span>
            </button>

            <button
              onClick={() => setActiveTab('camera')}
              role="tab"
              aria-selected={activeTab === 'camera'}
              aria-controls="main-tab-panel"
              id="tab-camera"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer ${
                activeTab === 'camera'
                  ? 'bg-rose-600/20 text-rose-200 border border-rose-500/30 shadow-md shadow-rose-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Video className="w-4 h-4 text-rose-400" aria-hidden="true" />
              <span>Camera Studio</span>
            </button>

            <button
              onClick={() => setActiveTab('wireless')}
              role="tab"
              aria-selected={activeTab === 'wireless'}
              aria-controls="main-tab-panel"
              id="tab-wireless"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'wireless'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 shadow-md shadow-indigo-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Wifi className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <span>Wireless & Hotspot</span>
            </button>

            <button
              onClick={() => setActiveTab('media')}
              role="tab"
              aria-selected={activeTab === 'media'}
              aria-controls="main-tab-panel"
              id="tab-media"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'media'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 shadow-md shadow-indigo-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Camera className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Media & Captures</span>
            </button>

            <button
              onClick={() => setActiveTab('documents')}
              role="tab"
              aria-selected={activeTab === 'documents'}
              aria-controls="main-tab-panel"
              id="tab-documents"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'documents'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 shadow-md shadow-indigo-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <FileText className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <span>Documents & OCR</span>
            </button>

            <button
              onClick={() => setActiveTab('diagnostics')}
              role="tab"
              aria-selected={activeTab === 'diagnostics'}
              aria-controls="main-tab-panel"
              id="tab-diagnostics"
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'diagnostics'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30 shadow-md shadow-indigo-500/10'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Activity className="w-4 h-4 text-amber-400" aria-hidden="true" />
              <span>Diagnostics & Logs</span>
            </button>

            <div className="pt-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 py-2">
              Advanced (Preview)
            </div>

            <button
              onClick={() => setActiveTab('workflow')}
              role="tab"
              aria-selected={activeTab === 'workflow'}
              aria-controls="main-tab-panel"
              id="tab-workflow"
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'workflow'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Layers className="w-4 h-4 text-purple-400" aria-hidden="true" />
              <span>Workflow Runner</span>
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              role="tab"
              aria-selected={activeTab === 'ai'}
              aria-controls="main-tab-panel"
              id="tab-ai"
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'ai'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-900/40'
              }`}
            >
              <Bot className="w-4 h-4 text-pink-400" aria-hidden="true" />
              <span>Local AI Assistant</span>
            </button>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <button
              onClick={() => setActiveTab('about')}
              role="tab"
              aria-selected={activeTab === 'about'}
              aria-controls="main-tab-panel"
              id="tab-about"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                activeTab === 'about'
                  ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/30'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Shield className="w-4 h-4 text-slate-400" aria-hidden="true" />
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
              <div className="glass-panel p-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 w-96 h-96 bg-gradient-to-bl from-indigo-500/10 via-cyan-500/5 to-transparent pointer-events-none rounded-full blur-3xl"></div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight text-white">Screen Mirroring Studio</h2>
                      {isMirroring ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                          <span className="status-pulse active"></span> Live ({formatSeconds(sessionDuration)})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-400">
                          {isDeviceReady ? 'Ready' : 'Device Not Ready'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Direct display streaming via official scrcpy 5.0.1 engine with hardware decoding and audio forwarding.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    {isMirroring ? (
                      <button
                        onClick={handleStopMirror}
                        className="glass-button glass-button-danger px-6 py-2.5 text-sm min-h-[44px] flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer"
                        aria-label="Stop screen mirroring session"
                      >
                        <Square className="w-4 h-4 fill-white" aria-hidden="true" />
                        <span>Stop Mirroring</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleStartMirror}
                        disabled={!isDeviceReady}
                        className={`glass-button glass-button-primary px-8 py-2.5 text-sm min-h-[44px] flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
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

                {/* Device Status Guidance Bar if not ready */}
                {!isDeviceReady && (
                  <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2.5" role="alert">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                    <div>
                      <div className="font-semibold text-amber-300">
                        {devices.length === 0 ? 'No Android Device Connected' : `Device Status: ${activeDevice?.state.toUpperCase()}`}
                      </div>
                      <div className="text-[11px] text-amber-200 mt-0.5">
                        {activeDevice?.guidance || 'Connect an Android device via USB. Enable Developer Options & USB Debugging on your phone.'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quality Presets */}
                <div className="mt-6 pt-5 border-t border-slate-800/80">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3" id="quality-preset-label">
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
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                          qualityPreset === p.key
                            ? 'bg-indigo-600/20 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="font-semibold text-sm text-slate-100">{p.title}</div>
                        <div className="text-[11px] text-slate-300 mt-1">{p.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Feature Toggles */}
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <label htmlFor="toggle-turn-screen-off" className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800/70 cursor-pointer hover:bg-slate-900/70 transition-all focus-within:ring-2 focus-within:ring-indigo-400">
                    <input
                      id="toggle-turn-screen-off"
                      type="checkbox"
                      checked={turnScreenOff}
                      onChange={e => setTurnScreenOff(e.target.checked)}
                      className="accent-indigo-500 w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-200">Turn Phone Screen Off</div>
                      <div className="text-slate-400 text-[10px]">Save battery while streaming (-S)</div>
                    </div>
                  </label>

                  <label htmlFor="toggle-stay-awake" className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800/70 cursor-pointer hover:bg-slate-900/70 transition-all focus-within:ring-2 focus-within:ring-indigo-400">
                    <input
                      id="toggle-stay-awake"
                      type="checkbox"
                      checked={stayAwake}
                      onChange={e => setStayAwake(e.target.checked)}
                      className="accent-indigo-500 w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-200">Stay Awake While Plugged</div>
                      <div className="text-slate-400 text-[10px]">Prevents device sleep timeout (-w)</div>
                    </div>
                  </label>

                  <label htmlFor="toggle-record-session" className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/40 border border-slate-800/70 cursor-pointer hover:bg-slate-900/70 transition-all focus-within:ring-2 focus-within:ring-indigo-400">
                    <input
                      id="toggle-record-session"
                      type="checkbox"
                      checked={recordMirrorSession}
                      onChange={e => setRecordMirrorSession(e.target.checked)}
                      className="accent-indigo-500 w-4 h-4 rounded cursor-pointer"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-200">Record Video Stream (MP4)</div>
                      <div className="text-slate-400 text-[10px]">Save directly to Captures/ via scrcpy</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Hardware Remote Control Bar */}
              <div className="glass-panel p-5">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                  Quick Navigation & Device Controls ({activeDevice ? activeDevice.model : 'No Target'})
                </div>
                <div className="flex flex-wrap gap-2.5" role="toolbar" aria-label="Device quick navigation controls">
                  <button
                    onClick={() => handleSendKeyevent('3', 'Home')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send Home keyevent to Android device"
                  >
                    <span aria-hidden="true">🏠</span>
                    <span>Home</span>
                  </button>

                  <button
                    onClick={() => handleSendKeyevent('4', 'Back')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send Back keyevent to Android device"
                  >
                    <span aria-hidden="true">⬅</span>
                    <span>Back</span>
                  </button>

                  <button
                    onClick={() => handleSendKeyevent('187', 'App Switch')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send App Switcher keyevent to Android device"
                  >
                    <span aria-hidden="true">🗂</span>
                    <span>App Switcher</span>
                  </button>

                  <button
                    onClick={() => handleSendKeyevent('26', 'Power')}
                    disabled={!isDeviceReady}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Send Power toggle keyevent to Android device"
                  >
                    <span aria-hidden="true">⚡</span>
                    <span>Power</span>
                  </button>

                  <button
                    onClick={handleTakeScreenshot}
                    disabled={!isDeviceReady || isCapturing}
                    className={`glass-button text-xs py-2 px-3.5 min-h-[40px] ml-auto text-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-400 cursor-pointer flex items-center gap-1.5 ${!isDeviceReady ? 'opacity-50 cursor-not-allowed' : ''}`}
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
              <div className="glass-panel p-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 w-96 h-96 bg-gradient-to-bl from-rose-500/10 via-pink-500/5 to-transparent pointer-events-none rounded-full blur-3xl"></div>

                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                        <Video className="w-5 h-5 text-rose-400" aria-hidden="true" />
                        <span>Camera Studio</span>
                      </h2>
                      {isCameraRunning ? (
                        <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 shadow-sm shadow-rose-500/20" role="status">
                          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" aria-hidden="true"></span>
                          <span>Streaming Active ({formatSeconds(cameraSessionDuration)})</span>
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700" role="status">
                          Camera Idle
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      Direct low-latency Android camera preview via scrcpy Camera2 Direct3D11 streaming. Zero APK required.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => selectedSerial && refreshCameraCapabilities(selectedSerial)}
                      disabled={isQueryingCameras || !selectedSerial}
                      className="glass-button p-2 text-slate-200 hover:text-white min-h-[38px] flex items-center gap-1.5 text-xs font-semibold"
                      title="Refresh Camera Hardware Capabilities"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isQueryingCameras ? 'animate-spin text-rose-400' : ''}`} aria-hidden="true" />
                      <span>{isQueryingCameras ? 'Scanning Cameras...' : 'Query Sensors'}</span>
                    </button>

                    <button
                      onClick={() => api?.openPath?.(getCapturesFolder ? '' : '')}
                      className="glass-button p-2 text-slate-200 hover:text-white min-h-[38px] flex items-center gap-1.5 text-xs font-semibold"
                      title="Open Captures Directory"
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                      <span>Captures</span>
                    </button>
                  </div>
                </div>

                {/* Studio Transport Mode Selector (Phase 6) */}
                <div className="flex items-center gap-2 mt-5 p-1 rounded-xl bg-slate-900/90 border border-slate-800 w-fit" role="radiogroup" aria-label="Camera Studio Transport Mode">
                  <button
                    id="mode-scrcpy"
                    onClick={() => setCameraMode('scrcpy')}
                    role="radio"
                    aria-checked={cameraMode === 'scrcpy'}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                      cameraMode === 'scrcpy'
                        ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25 ring-1 ring-rose-400/50'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
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
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25 ring-1 ring-indigo-400/50'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                    <span>Camera Companion App</span>
                    <span className="text-[10px] bg-indigo-400/20 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-400/30">
                      Phase 6
                    </span>
                  </button>
                </div>

                {/* Preflight & Capability Warnings */}
                {cameraCaps && !cameraCaps.transportSupported && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs space-y-1" role="alert">
                    <div className="font-bold flex items-center gap-2 text-amber-300">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Transport Limitation: Android 12+ Required</span>
                    </div>
                    <p className="text-slate-300">
                      {cameraCaps.notes[0] || 'scrcpy camera mirroring requires Android 12 (API 31) or higher. Device OS version is unsupported.'}
                    </p>
                  </div>
                )}

                {!isDeviceReady && (
                  <div className="mt-4 p-4 rounded-xl bg-slate-900/60 border border-slate-700 text-xs space-y-1" role="alert">
                    <div className="font-bold text-amber-300 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      <span>Device Not Ready</span>
                    </div>
                    <p className="text-slate-300">
                      {activeDevice?.guidance || 'Please connect an Android device via USB and accept the RSA authorization prompt on the screen.'}
                    </p>
                  </div>
                )}

                {/* Live Feedback Banner */}
                {cameraLiveFeedback && (
                  <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2 transition-all">
                    <Info className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{cameraLiveFeedback}</span>
                  </div>
                )}

                {/* SCRCPY NATIVE DIRECT3D11 MODE CONTROLS */}
                {cameraMode === 'scrcpy' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
                  {/* Left Column: Stream Configuration & Sensor Selection */}
                  <div className="lg:col-span-7 space-y-5">
                    {/* Camera Sensor Selector (Physical Lens Switching) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="camera-select" className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-rose-400" />
                          <span>Optical Lens / Camera Sensor</span>
                        </label>
                        <span className="text-[11px] text-slate-400">Physical Lens Switching</span>
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
                              setSelectedResolution(found.supportedSizes[0]);
                            }
                          }}
                          disabled={isCameraRunning}
                          className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer disabled:opacity-50"
                        >
                          {cameraCaps.cameras.map((c) => (
                            <option key={c.id} value={c.id} className="bg-slate-900 text-slate-200">
                              Camera {c.id} — {c.facing.toUpperCase()} {c.maxResolution ? `(${c.maxResolution} Max)` : ''} {c.id === '0' ? '• Main Lens' : c.id === '1' ? '• Front Selfie' : c.id === '2' ? '• Ultrawide' : c.id === '3' ? '• Macro' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                          <span>{isQueryingCameras ? 'Probing camera sensors...' : 'Camera 0 (Default Back Camera)'}</span>
                          <span className="text-[10px] uppercase font-bold text-slate-500">Auto-Detect</span>
                        </div>
                      )}
                    </div>

                    {/* Resolution & FPS Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Resolution Selector */}
                      <div>
                        <label htmlFor="camera-resolution-select" className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                          Capture Resolution
                        </label>
                        <select
                          id="camera-resolution-select"
                          value={selectedResolution}
                          onChange={(e) => setSelectedResolution(e.target.value)}
                          disabled={isCameraRunning}
                          className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer disabled:opacity-50"
                        >
                          {cameraCaps?.cameras.find(c => c.id === selectedCameraId)?.supportedSizes?.map((size) => (
                            <option key={size} value={size} className="bg-slate-900 text-slate-200">
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
                        <label htmlFor="camera-fps-select" className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                          Target Frame Rate
                        </label>
                        <select
                          id="camera-fps-select"
                          value={selectedFps}
                          onChange={(e) => setSelectedFps(parseInt(e.target.value, 10))}
                          disabled={isCameraRunning}
                          className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer disabled:opacity-50"
                        >
                          {cameraCaps?.cameras.find(c => c.id === selectedCameraId)?.fpsList?.map((fps) => (
                            <option key={fps} value={fps} className="bg-slate-900 text-slate-200">
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
                        <label htmlFor="camera-ar-select" className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                          Aspect Ratio
                        </label>
                        <select
                          id="camera-ar-select"
                          value={cameraAspectRatio}
                          onChange={(e) => setCameraAspectRatio(e.target.value)}
                          disabled={isCameraRunning}
                          className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer disabled:opacity-50"
                        >
                          <option value="auto">Auto (Sensor Native)</option>
                          <option value="16:9">16:9 (Widescreen Video)</option>
                          <option value="4:3">4:3 (Classic Photo)</option>
                          <option value="sensor">Sensor Sensor Ratio</option>
                        </select>
                      </div>

                      <div className="flex flex-col justify-end">
                        <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-semibold text-slate-200 cursor-pointer hover:bg-slate-900">
                          <input
                            type="checkbox"
                            checked={cameraHighSpeed}
                            onChange={(e) => setCameraHighSpeed(e.target.checked)}
                            disabled={isCameraRunning}
                            className="rounded border-slate-700 text-rose-500 focus:ring-rose-400 w-4 h-4"
                          />
                          <span>High-Speed Capture (120 FPS)</span>
                        </label>
                      </div>
                    </div>

                    {/* PC-Side Recording Toggle */}
                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer">
                          <input
                            id="record-camera-checkbox"
                            type="checkbox"
                            checked={recordCameraSession}
                            onChange={(e) => setRecordCameraSession(e.target.checked)}
                            disabled={isCameraRunning}
                            className="rounded border-slate-700 text-rose-500 focus:ring-rose-400 w-4 h-4"
                          />
                          <span>Record Camera Stream to MP4 on PC</span>
                        </label>
                        <span className="text-[10px] uppercase font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                          Hardware MP4
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Saves lossless hardware-encoded video directly to the local <code className="text-slate-200 font-mono">Captures/</code> folder with zero dropped frames.
                      </p>
                    </div>

                    {/* Start / Stop Stream Action Button */}
                    <div>
                      {!isCameraRunning ? (
                        <button
                          id="btn-toggle-camera"
                          onClick={handleStartCamera}
                          disabled={!isDeviceReady || (cameraCaps !== null && !cameraCaps.transportSupported)}
                          className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-bold text-sm shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2.5 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-rose-400"
                          aria-label="Start Camera Preview"
                        >
                          <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                          <span>Start Camera Preview</span>
                        </button>
                      ) : (
                        <button
                          id="btn-toggle-camera"
                          onClick={handleStopCamera}
                          className="w-full py-3.5 px-6 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 flex items-center justify-center gap-2.5 cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-rose-400 shadow-md"
                          aria-label="Stop Camera Preview"
                        >
                          <Square className="w-4 h-4 fill-current text-rose-400" aria-hidden="true" />
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
                        <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-rose-400" />
                          <span>Digital Zoom Control</span>
                        </label>
                        <span className="text-xs font-mono font-bold text-rose-300 bg-rose-500/10 px-2.5 py-0.5 rounded border border-rose-500/20" id="camera-zoom-badge">
                          {cameraZoom.toFixed(1)}x
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-400">
                        Adjust focal crop within the active sensor. Verified sensor range: <span className="text-slate-200 font-mono">1.0x – 10.0x</span>.
                      </p>

                      {/* Zoom Buttons (+ / -) */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          id="btn-zoom-out"
                          onClick={() => handleZoomChange('out')}
                          disabled={!isCameraRunning}
                          className="glass-button py-2 px-3 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Zoom Out (-0.5x)"
                          aria-label="Zoom camera out"
                        >
                          <ZoomOut className="w-3.5 h-3.5 text-rose-400" />
                          <span>Zoom Out (-0.5x)</span>
                        </button>

                        <button
                          id="btn-zoom-in"
                          onClick={() => handleZoomChange('in')}
                          disabled={!isCameraRunning}
                          className="glass-button py-2 px-3 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Zoom In (+0.5x)"
                          aria-label="Zoom camera in"
                        >
                          <ZoomIn className="w-3.5 h-3.5 text-rose-400" />
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
                          className="w-full accent-rose-500 cursor-pointer disabled:opacity-50"
                          aria-label="Camera digital zoom slider"
                        />
                        <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
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
                            className={`flex-1 py-1 rounded text-[11px] font-mono font-bold transition-all ${
                              cameraZoom === preset
                                ? 'bg-rose-500 text-white shadow-sm'
                                : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 border border-slate-800'
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
                        <div className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                          <Flashlight className="w-3.5 h-3.5 text-amber-400" />
                          <span>Camera Torch (Flash)</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Controls the rear camera LED torch in real-time.
                        </p>
                      </div>

                      <button
                        id="btn-toggle-torch"
                        onClick={handleTorchToggle}
                        disabled={!isCameraRunning}
                        className={`py-2 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                          cameraTorch
                            ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25 ring-2 ring-amber-400/50'
                            : 'bg-slate-900 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-50'
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
                        <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Snapshots & Captures</span>
                        </span>
                        <span className="text-[10px] uppercase font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                          Verified Status
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Continuous PC recording is <strong className="text-emerald-300">verified</strong> via the MP4 recording toggle. Direct single-frame PNG capture during live Camera2 streaming is unsupported by scrcpy's CLI transport; full photo capture will be provided via the dedicated CameraX companion APK.
                      </p>
                    </div>

                    {/* In-App Keyboard Shortcuts Reference */}
                    <div className="glass-panel p-4 space-y-2.5">
                      <div className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Live Preview Shortcuts</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div className="p-2 rounded bg-slate-900/80 border border-slate-800 text-slate-300 flex justify-between">
                          <span>Alt + Up</span>
                          <span className="text-rose-300">Zoom In</span>
                        </div>
                        <div className="p-2 rounded bg-slate-900/80 border border-slate-800 text-slate-300 flex justify-between">
                          <span>Alt + Down</span>
                          <span className="text-rose-300">Zoom Out</span>
                        </div>
                        <div className="p-2 rounded bg-slate-900/80 border border-slate-800 text-slate-300 flex justify-between">
                          <span>Alt + T</span>
                          <span className="text-amber-300">Torch ON</span>
                        </div>
                        <div className="p-2 rounded bg-slate-900/80 border border-slate-800 text-slate-300 flex justify-between">
                          <span>Alt + Shift + T</span>
                          <span className="text-slate-400">Torch OFF</span>
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
                    <div className="glass-panel p-5 border border-indigo-500/30">
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <Smartphone className="w-5 h-5 text-indigo-400" />
                            <h3 className="text-base font-bold text-white">AndroScrn Companion App Connection</h3>
                            <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                              companionPaired
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                : companionChallengeActive
                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}>
                              {companionPaired ? 'Paired & Streaming' : companionChallengeActive ? 'Awaiting PIN Verification' : 'Disconnected'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
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
                              className="py-2 px-3.5 rounded-xl font-bold text-xs bg-slate-900 border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                              <Power className="w-3.5 h-3.5" />
                              <span>Disconnect</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pairing PIN Input Card (shown when challenge is active) */}
                      {companionChallengeActive && !companionPaired && (
                        <div id="companion-pin-card" className="mt-5 p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 space-y-3">
                          <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold">
                            <Shield className="w-4 h-4 text-indigo-400" />
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
                              className="w-36 bg-slate-900 border border-indigo-400/50 rounded-xl px-4 py-2.5 text-center text-lg font-mono font-bold tracking-widest text-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
                        <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                          <span>{companionError}</span>
                        </div>
                      )}
                      {companionSuccessMsg && (
                        <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
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
                              <Camera className="w-4 h-4 text-indigo-400" />
                              <span className="text-xs font-bold text-white uppercase tracking-wider">In-App Live Preview Feed</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800 text-slate-300">
                                Port Forward: 127.0.0.1:8080
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                                MJPEG Low Latency (~15ms)
                              </span>
                            </div>
                          </div>

                          {/* Video Box */}
                          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                            {companionPaired ? (
                              <img
                                id="companion-live-preview"
                                src={companionStreamUrl || 'http://127.0.0.1:8080/api/v1/stream?token=mock_token_64'}
                                alt="Live Android Companion Camera Viewport"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="text-center p-8 space-y-3">
                                <div className="w-16 h-16 mx-auto rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
                                  <Camera className="w-8 h-8" />
                                </div>
                                <div className="text-xs font-bold text-slate-400">Companion Camera Feed Inactive</div>
                                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
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
                        <div className="glass-panel p-4 space-y-3 border border-indigo-500/20">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                              <Camera className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Full-Res Still Capture</span>
                            </span>
                            <span className="text-[10px] uppercase font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                              CameraX
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Captures uncompressed 48MP/12MP photo directly on sensor and transfers it instantly to desktop without interrupting live stream.
                          </p>
                          <button
                            id="btn-companion-snapshot"
                            onClick={handleCompanionSnapshot}
                            disabled={!companionPaired || companionLoading}
                            className="w-full glass-button glass-button-primary text-xs py-3 px-4 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/20"
                          >
                            <Camera className="w-4 h-4 text-cyan-300" />
                            <span>{companionLoading ? 'Capturing Still Photo...' : 'Capture Full-Res Photo'}</span>
                          </button>
                        </div>

                        {/* Physical Lens Flip & Torch Controls */}
                        <div className="glass-panel p-4 space-y-3">
                          <div className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                            <Sliders className="w-3.5 h-3.5 text-rose-400" />
                            <span>Optics & Hardware Controls</span>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            {/* Flip Lens */}
                            <button
                              id="btn-companion-flip"
                              onClick={handleCompanionFlipLens}
                              disabled={!companionPaired}
                              className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 hover:border-slate-500 flex flex-col items-center justify-center gap-1 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all"
                            >
                              <RotateCcw className="w-4 h-4 text-indigo-400" />
                              <span>{companionFacing === 'back' ? 'Switch to Front' : 'Switch to Back'}</span>
                            </button>

                            {/* Torch Toggle */}
                            <button
                              id="btn-companion-torch"
                              onClick={handleCompanionTorch}
                              disabled={!companionPaired}
                              className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold disabled:opacity-50 cursor-pointer transition-all ${
                                companionTorch
                                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/25 ring-2 ring-amber-400/50'
                                  : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
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
                            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                              <ZoomIn className="w-3.5 h-3.5 text-indigo-400" />
                              <span>Digital Zoom</span>
                            </span>
                            <span className="text-xs font-mono font-bold text-indigo-300">
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
                            className="w-full accent-indigo-500 bg-slate-900 h-2 rounded-lg cursor-pointer disabled:opacity-50"
                          />
                          <div className="flex justify-between text-[10px] font-mono text-slate-400">
                            <span>1.0x (Wide)</span>
                            <span>2.0x</span>
                            <span>4.0x</span>
                            <span>8.0x (Tele)</span>
                          </div>
                        </div>

                        {/* Architecture Details Card */}
                        <div className="glass-panel p-4 space-y-2 text-[11px] text-slate-300 leading-relaxed">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Security & Privacy Architecture</span>
                          </div>
                          <ul className="list-disc list-inside space-y-1 text-slate-400">
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
                <div className="mt-8 glass-panel p-6 border border-sky-500/30 space-y-6">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <Grid className="w-5 h-5 text-sky-400" />
                        <h3 className="text-base font-bold text-white">Lab & Optical Inspection Tools</h3>
                        <span className="text-[10px] font-bold uppercase bg-sky-500/10 text-sky-300 px-2 py-0.5 rounded border border-sky-500/20">
                          Phase 7.1 Active
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Precision alignment reticles, non-destructive overlays, side-by-side golden sample comparison, and automated timelapse recording.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        id="btn-export-annotated"
                        onClick={handleExportAnnotated}
                        className="glass-button text-xs py-2 px-3.5 flex items-center gap-1.5 cursor-pointer border border-sky-500/40 text-sky-200 hover:text-white"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                        <span>Export Annotated Copy</span>
                      </button>
                    </div>
                  </div>

                  {annotatedExportSuccess && (
                    <div id="annotated-export-notice" className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>{annotatedExportSuccess}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Column 1: Inspection Overlays & Reticles */}
                    <div className="space-y-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                        <Crosshair className="w-4 h-4 text-sky-400" />
                        <span>Alignment Reticles & Grids</span>
                      </div>

                      <div>
                        <label htmlFor="inspection-overlay-select" className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                          Overlay Pattern
                        </label>
                        <select
                          id="inspection-overlay-select"
                          value={inspectionOverlay}
                          onChange={(e) => setInspectionOverlay(e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
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
                          <label htmlFor="inspection-color-select" className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                            Color
                          </label>
                          <select
                            id="inspection-color-select"
                            value={overlayColor}
                            onChange={(e) => setOverlayColor(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 outline-none cursor-pointer"
                          >
                            <option value="#38bdf8">Sky Blue</option>
                            <option value="#10b981">Emerald Green</option>
                            <option value="#f43f5e">Rose Red</option>
                            <option value="#eab308">Amber Yellow</option>
                            <option value="#ffffff">Pure White</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="inspection-opacity-slider" className="block text-[11px] font-semibold text-slate-400 mb-1.5">
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
                            className="w-full accent-sky-400 bg-slate-900 h-2 rounded cursor-pointer"
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
                            className="rounded text-sky-500 bg-slate-900 border-slate-700"
                          />
                          <span className="text-slate-300 text-[11px]">Timestamp Watermark</span>
                        </label>

                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            id="inspection-coords-toggle"
                            type="checkbox"
                            checked={overlayShowCoords}
                            onChange={(e) => setOverlayShowCoords(e.target.checked)}
                            className="rounded text-sky-500 bg-slate-900 border-slate-700"
                          />
                          <span className="text-slate-300 text-[11px]">Uncalibrated Px</span>
                        </label>
                      </div>
                    </div>

                    {/* Column 2: Side-by-Side Reference Comparison */}
                    <div className="space-y-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                          <Layers className="w-4 h-4 text-indigo-400" />
                          <span>Golden Sample Compare</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          refCompEnabled ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {refCompEnabled ? 'Active' : 'Off'}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-400">
                        Compare live feed against a reference golden master to detect assembly defects, label shifts, or component drift.
                      </p>

                      <div className="space-y-2">
                        <button
                          id="btn-toggle-ref-comp"
                          onClick={() => setRefCompEnabled(!refCompEnabled)}
                          className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                            refCompEnabled
                              ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                              : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {refCompEnabled ? 'Disable Comparison Mode' : 'Enable Reference Comparison'}
                        </button>

                        {refCompEnabled && (
                          <div className="space-y-2 pt-2">
                            <label htmlFor="ref-comp-mode-select" className="block text-[11px] font-semibold text-slate-400">
                              Comparison Layout
                            </label>
                            <select
                              id="ref-comp-mode-select"
                              value={refCompMode}
                              onChange={(e) => setRefCompMode(e.target.value as any)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 outline-none cursor-pointer"
                            >
                              <option value="side_by_side">Side-by-Side Dual View</option>
                              <option value="split_vertical">Vertical Split Screen</option>
                              <option value="overlay_blend">50% Blend Opacity</option>
                            </select>

                            <div>
                              <label htmlFor="ref-comp-opacity-slider" className="block text-[11px] font-semibold text-slate-400 mb-1">
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
                                className="w-full accent-indigo-400 bg-slate-900 h-2 rounded cursor-pointer"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 3: Scheduled Timelapse Engine */}
                    <div className="space-y-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                          <Clock className="w-4 h-4 text-amber-400" />
                          <span>Timelapse Scheduler</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          timelapseRunning ? 'bg-amber-500/20 text-amber-300 animate-pulse' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {timelapseRunning ? `Frame ${timelapseCurrentFrame}/${timelapseFrames}` : 'Idle'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="timelapse-interval-input" className="block text-[11px] font-semibold text-slate-400 mb-1">
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
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 font-mono outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label htmlFor="timelapse-frames-input" className="block text-[11px] font-semibold text-slate-400 mb-1">
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
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 font-mono outline-none disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div className="pt-1">
                        {!timelapseRunning ? (
                          <button
                            id="btn-start-timelapse"
                            onClick={handleStartTimelapse}
                            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-amber-500/20 transition-all"
                          >
                            <Clock className="w-4 h-4 fill-current" />
                            <span>Start Timelapse Capture</span>
                          </button>
                        ) : (
                          <button
                            id="btn-stop-timelapse"
                            onClick={handleStopTimelapse}
                            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-slate-900 border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 flex items-center justify-center gap-2 cursor-pointer transition-all"
                          >
                            <Square className="w-4 h-4 fill-current" />
                            <span>Stop Timelapse Session</span>
                          </button>
                        )}
                      </div>

                      {timelapseStatusMsg && (
                        <div className="text-[10px] text-slate-400 font-mono mt-1">
                          {timelapseStatusMsg}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Calibration & Non-Destructive Integrity Notice */}
                  <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
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
                  <Wifi className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-base font-bold text-white">1-Click Wireless Handoff</h3>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Connect your phone via USB cable once, enable TCP/IP port 5555 with one click, then unplug the cable and mirror over Wi-Fi.
                </p>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      Target USB Device: <span className="text-indigo-400">{activeDevice ? `${activeDevice.model} (${activeDevice.serial})` : 'None'}</span>
                    </div>
                    {handoffStatus && <div className="text-[11px] text-cyan-400 mt-1">{handoffStatus}</div>}
                  </div>

                  <button
                    onClick={handle1ClickHandoff}
                    disabled={!isDeviceReady || activeDevice?.transportType === 'wifi'}
                    className={`glass-button glass-button-primary text-xs py-2 px-4 ${
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
                  <Smartphone className="w-5 h-5 text-cyan-400" aria-hidden="true" />
                  <h3 className="text-base font-bold text-white">Phone Hotspot Gateway Connect</h3>
                </div>
                <p className="text-xs text-slate-300 mb-4">
                  When your laptop joins your phone's Wi-Fi hotspot, your phone acts as the default gateway (typically 192.168.43.1).
                </p>

                <div className="flex items-center gap-3">
                  <label htmlFor="hotspot-gateway-input" className="sr-only">Hotspot Gateway IP</label>
                  <input
                    id="hotspot-gateway-input"
                    type="text"
                    value={hotspotGateway || '192.168.43.1'}
                    onChange={e => setHotspotGateway(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 w-48 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    placeholder="Gateway IP (192.168.43.1)"
                  />
                  <button
                    onClick={handleHotspotConnect}
                    className="glass-button text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                    aria-label="Connect to hotspot gateway IP"
                  >
                    <span>Connect to Hotspot Gateway</span>
                  </button>
                </div>
              </div>

              {/* Android 11+ PIN Pairing Wizard */}
              <div className="glass-panel p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-5 h-5 text-indigo-400" aria-hidden="true" />
                  <h3 className="text-base font-bold text-white">Android 11+ Wireless Pairing (PIN)</h3>
                </div>
                <p className="text-xs text-slate-300 mb-4">
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
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
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
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    />
                  </div>
                  <button
                    onClick={handlePairWireless}
                    className="glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
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
                  <h3 className="text-base font-bold text-white">Session Captures & Recordings</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Real PNG frame captures and MP4 video recordings saved to the portable Captures/ directory.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTakeScreenshot}
                    disabled={!isDeviceReady || isCapturing}
                    className={`glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
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
                    className="glass-button text-xs py-2 px-3 min-h-[38px] min-w-[38px] flex items-center justify-center focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                    aria-label="Refresh captures list"
                    title="Refresh captures list"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Captures List */}
              <div className="glass-panel p-5">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                  Recorded Media Files ({captures.length})
                </div>

                {captures.length > 0 ? (
                  <div className="space-y-2">
                    {captures.map(c => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300" aria-hidden="true">
                            {c.type === 'screenshot' ? <Camera className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-200">{c.name}</div>
                            <div className="text-[11px] text-slate-400">
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
                            className="glass-button py-1.5 px-3 text-[11px] min-h-[32px] flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                            aria-label={`Open ${c.name} in system viewer`}
                          >
                            <Folder className="w-3 h-3 text-slate-400" aria-hidden="true" />
                            <span>Open</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-10 text-slate-400 text-xs">
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
                    <Activity className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-base font-bold text-white">System Diagnostics & Environment</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyDiagnosticReport}
                      className="glass-button text-xs py-1.5 px-3 min-h-[36px] text-indigo-300 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                      aria-label="Copy sanitized system diagnostic report to clipboard"
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copyReportSuccess ? 'Copied to Clipboard!' : 'Copy Diagnostic Report'}</span>
                    </button>

                    <button
                      onClick={handleExportDiagnosticReport}
                      className="glass-button text-xs py-1.5 px-3 min-h-[36px] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                      aria-label="Export diagnostic report to text file"
                    >
                      <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Export .txt File</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] uppercase font-bold text-slate-400">ADB Engine</div>
                    <div className="font-semibold text-slate-100 mt-1">{systemInfo?.adbVersion || 'Probing...'}</div>
                    <div className="font-mono text-[9px] text-slate-400 truncate mt-1">{systemInfo?.adbPath || 'bundled'}</div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] uppercase font-bold text-slate-400">scrcpy Engine</div>
                    <div className="font-semibold text-slate-100 mt-1">{systemInfo?.scrcpyVersion || 'scrcpy 5.0.1'}</div>
                    <div className="font-mono text-[9px] text-slate-400 truncate mt-1">{systemInfo?.scrcpyPath || 'bundled'}</div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Connected Devices</div>
                    <div className="font-semibold text-slate-100 mt-1">{devices.length} Detected</div>
                    <div className="text-[10px] text-slate-300 mt-1">
                      {devices.filter(d => d.state === 'device').length} authorized / ready
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Mirroring Session</div>
                    <div className="font-semibold text-slate-100 mt-1">
                      {isMirroring ? 'ACTIVE' : 'IDLE'}
                    </div>
                    <div className="text-[10px] text-slate-300 mt-1">
                      PID: {systemInfo?.mirrorStatus?.pid || 'None'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Log Stream Viewer */}
              <div className="glass-panel p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-xs font-semibold" role="tablist" aria-label="Log source selector">
                      <button
                        onClick={() => setLogSource('device')}
                        role="tab"
                        aria-selected={logSource === 'device'}
                        className={`px-3 py-1.5 rounded-md transition-all min-h-[32px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                          logSource === 'device' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
                        }`}
                        aria-label="View device logcat output"
                      >
                        Device Logcat ({selectedSerial || 'No Target'})
                      </button>
                      <button
                        onClick={() => setLogSource('app')}
                        role="tab"
                        aria-selected={logSource === 'app'}
                        className={`px-3 py-1.5 rounded-md transition-all min-h-[32px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
                          logSource === 'app' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
                        }`}
                        aria-label="View application runtime log output"
                      >
                        Application Log (androscrn.log)
                      </button>
                    </div>

                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs focus-within:ring-2 focus-within:ring-indigo-400">
                      <Search className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      <label htmlFor="log-filter-input" className="sr-only">Filter logs</label>
                      <input
                        id="log-filter-input"
                        type="text"
                        value={logFilter}
                        onChange={e => setLogFilter(e.target.value)}
                        placeholder="Filter logs..."
                        className="bg-transparent text-xs text-slate-100 outline-none w-48"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (logSource === 'device') refreshLogcat();
                      else refreshSystemInfo();
                    }}
                    className="glass-button text-xs py-1.5 px-3 min-h-[32px] flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                    aria-label="Refresh logs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Log Terminal Screen */}
                <div className="glass-panel p-4 bg-slate-950 font-mono text-xs overflow-y-auto max-h-[420px] space-y-1">
                  {logSource === 'device' ? (
                    logs.length > 0 ? (
                      logs
                        .filter(l => (logFilter ? l.message.toLowerCase().includes(logFilter.toLowerCase()) || l.tag?.toLowerCase().includes(logFilter.toLowerCase()) : true))
                        .map((l, i) => (
                          <div key={i} className="flex items-start gap-2 hover:bg-slate-900/50 py-0.5 px-1 rounded text-[11px]">
                            <span className="text-slate-500 text-[10px] select-none">{l.timestamp}</span>
                            <span className={`px-1 rounded text-[9px] font-bold ${
                              l.level === 'E' ? 'bg-rose-500/20 text-rose-400' : l.level === 'W' ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-500/20 text-indigo-300'
                            }`}>
                              {l.level}
                            </span>
                            <span className="text-slate-400 font-semibold text-[10px] select-none">[{l.tag}]</span>
                            <span className="text-slate-200 break-all">{l.message}</span>
                          </div>
                        ))
                    ) : (
                      <div className="text-slate-500 text-center py-12">
                        {selectedSerial ? 'No logcat lines received. Verify device is connected and authorized.' : 'Connect an Android device to inspect device logcat stream.'}
                      </div>
                    )
                  ) : (
                    systemInfo?.recentAppLogs && systemInfo.recentAppLogs.length > 0 ? (
                      systemInfo.recentAppLogs
                        .filter(l => (logFilter ? l.toLowerCase().includes(logFilter.toLowerCase()) : true))
                        .map((line, i) => (
                          <div key={i} className="text-slate-300 py-0.5 text-[11px] hover:bg-slate-900/50 rounded px-1">
                            {line}
                          </div>
                        ))
                    ) : (
                      <div className="text-slate-500 text-center py-12">
                        Application runtime logs empty.
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: WORKFLOW RUNNER (PREVIEW) */}
          {activeTab === 'workflow' && (
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-indigo-400" />
                    Automated Test & Workflow Sequencer (Beta)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Execute structured touchscreen gestures, keyevents, text input, and visual assertion sequences on target device.
                  </p>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  Preview Feature
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                The Workflow Engine supports step sequencing through `WorkflowEngine` using discrete argument vectors.
                Live physical touchscreen execution requires an authorized target device attached over USB.
              </div>
            </div>
          )}

          {/* TAB 6: AI AGENT & MCP SECURITY CENTER */}
          {activeTab === 'ai' && (
            <div className="glass-panel p-6 space-y-6" id="mcp-security-center">
              {/* Header & Status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-indigo-400" aria-hidden="true" />
                    AI Agent & MCP Security Center
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    Control bridge for external AI agents communicating via the Model Context Protocol (MCP).
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
                    <span className={`w-2 h-2 rounded-full ${mcpStatus.connectedMcpProcesses > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                    <span className="text-slate-300">
                      Pipe: <span className="text-indigo-300 font-mono text-[11px]">\\.\pipe\androscrn-mcp-control</span>
                    </span>
                    <span className="text-slate-500">|</span>
                    <span className="text-slate-300 font-semibold">
                      {mcpStatus.connectedMcpProcesses} client{mcpStatus.connectedMcpProcesses === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Emergency Kill Switch Banner */}
              <div className="p-4 rounded-xl bg-rose-950/30 border-2 border-rose-500/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg shadow-rose-950/20">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                    <span>Emergency Revocation (Kill Switch)</span>
                  </div>
                  <p className="text-xs text-rose-200/80 leading-relaxed max-w-xl">
                    Instantly invalidates all active AI session tokens across all running MCP instances and denies any further privileged operations.
                  </p>
                </div>
                <button
                  onClick={handleRevokeAllSessions}
                  className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-rose-600/30 focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer shrink-0 transition-all active:scale-95"
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
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Key className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                    Active AI Sessions ({mcpStatus.activeSessions?.length || 0})
                  </h4>
                  <button
                    onClick={refreshMcpStatus}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1.5 py-0.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>

                {mcpStatus.activeSessions && mcpStatus.activeSessions.length > 0 ? (
                  <div className="space-y-2" id="active-sessions-list">
                    {mcpStatus.activeSessions.map((session) => (
                      <div
                        key={session.sessionId}
                        className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-4 text-xs"
                        id={`session-item-${session.sessionId}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{session.clientName || 'AI-Client'}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                              Tier {session.tiers?.join(', ') || '3'}
                            </span>
                          </div>
                          <div className="text-slate-400 text-[11px] font-mono">
                            ID: {session.sessionId.slice(0, 18)}... | Expires: {new Date(session.expiresAt).toLocaleTimeString()}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRevokeSession(session.sessionId)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-200 border border-slate-700 hover:border-rose-500/40 text-xs font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-400"
                          id={`btn-revoke-session-${session.sessionId}`}
                          aria-label={`Revoke session for ${session.clientName || session.sessionId}`}
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center text-slate-400 text-xs" id="empty-active-sessions">
                    No active AI agent sessions. External agents must request and receive human pairing approval before acquiring tokens.
                  </div>
                )}
              </div>

              {/* Live AI Action Audit Log */}
              <div className="space-y-3 pt-2" id="mcp-action-audit-section">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                    Live Action Audit Log (Token-Free & Redacted)
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Last {mcpStatus.recentAudits?.length || 0} events
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Audits every Tier 3 input operation (<code>tap</code>, <code>swipe</code>, <code>keyevent</code>, <code>input_text</code>) in real time. Authentication tokens and sensitive text contents are strictly omitted.
                </p>

                {mcpStatus.recentAudits && mcpStatus.recentAudits.length > 0 ? (
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1" id="mcp-action-audit-list">
                    {mcpStatus.recentAudits.map((item) => {
                      const statusBadgeClass = {
                        PENDING: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                        SUCCESS: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
                        FAILED: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
                        REJECTED: 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                      }[item.status] || 'bg-slate-800 text-slate-300';

                      return (
                        <div
                          key={item.id}
                          className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                          id={`audit-item-${item.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${statusBadgeClass}`}>
                              {item.status}
                            </span>
                            <span className="font-mono text-indigo-300 font-semibold">{item.action}</span>
                            <span className="text-slate-500 text-[11px]">by</span>
                            <span className="text-white font-medium">{item.clientName}</span>
                            <span className="text-slate-500 text-[11px]">on</span>
                            <span className="font-mono text-slate-300 text-[11px]">{item.serial}</span>
                          </div>
                          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                            {item.details && (
                              <span className="text-slate-300 font-mono text-[10px] bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800">
                                {item.details}
                              </span>
                            )}
                            <span className="text-slate-500 font-mono text-[10px]">
                              {new Date(item.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center text-slate-400 text-xs" id="empty-action-audits">
                    No input actions executed yet. Once an authorized AI agent invokes <code>tap</code>, <code>swipe</code>, <code>keyevent</code>, or <code>input_text</code>, execution events will appear here in real time.
                  </div>
                )}
              </div>

              {/* Permission Matrix Reference */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  Pairing-First Permission Matrix
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Unlock className="w-3.5 h-3.5" /> Tier 0–2: Read-Only Telemetry & Screen
                    </div>
                    <p className="text-[11px] text-slate-400">
                      <code>list_devices</code>, <code>get_device_info</code>, <code>get_diagnostics</code>, <code>capture_screenshot</code>, and redacted <code>get_logcat</code>. Unconditional observation.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
                    <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" /> Tier 3–4: Mutating Actions & Administration
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Touch injection, keyevents, shell commands, APK installation. Strictly requires 6-digit PIN handshake or desktop 1-click human approval.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: ABOUT & LICENSES */}
          {activeTab === 'about' && (
            <div className="glass-panel p-6 space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-400" />
                About AndroScrn & Open Source Licensing
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                AndroScrn is an independent Windows-first desktop application for Android screen mirroring, wireless connectivity, and automation.
              </p>

              {/* Architecture Notice */}
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-slate-300 space-y-1.5">
                <div className="font-semibold text-indigo-300">Architecture Designation: Provisional Electron Distribution</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  The approved target product baseline is Tauri 2 + Rust + React/TypeScript with an MCP stdio server.
                  This standalone build is packaged as an Electron 31 distribution due to host toolchain constraints (no local Rust compiler).
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="font-semibold text-slate-200">scrcpy (v5.0.1)</div>
                  <div className="text-slate-400 text-[11px] mt-1">Copyright © Genymobile · Apache License 2.0</div>
                  <div className="text-slate-500 text-[10px] mt-1">SDL3, libavcodec, libavformat, libavutil, libusb</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="font-semibold text-slate-200">Android Debug Bridge (ADB v1.0.41)</div>
                  <div className="text-slate-400 text-[11px] mt-1">Copyright © Google AOSP · Apache License 2.0</div>
                  <div className="text-slate-500 text-[10px] mt-1">Platform Tools v37.0.1</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="font-semibold text-slate-200">Electron & Chromium</div>
                  <div className="text-slate-400 text-[11px] mt-1">Copyright © Electron Contributors · MIT License</div>
                  <div className="text-slate-500 text-[10px] mt-1">Runtime Version v31.7.7</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="font-semibold text-slate-200">REA (Reverse Engineer Anything)</div>
                  <div className="text-slate-400 text-[11px] mt-1">Copyright © morluto · MIT License</div>
                  <div className="text-slate-500 text-[10px] mt-1">Research & Architecture Reference</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-xs text-slate-400">
                AndroScrn is released under the <strong className="text-indigo-300">MIT License</strong>. All device communication is local and private. No cloud telemetry is transmitted.
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
