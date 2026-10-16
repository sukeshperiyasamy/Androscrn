import React, { useState, useEffect } from 'react';
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
  Info
} from 'lucide-react';

interface AndroidDevice {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | 'connecting' | 'unknown';
  model: string;
  product: string;
  device: string;
  transportType: 'usb' | 'wifi';
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
  const [activeTab, setActiveTab] = useState<'mirror' | 'wireless' | 'media' | 'diagnostics' | 'workflow' | 'ai' | 'about'>('mirror');
  
  // Device State
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
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

  // Status Alerts
  const [alertBanner, setAlertBanner] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>({
    type: 'info',
    message: 'Welcome to AndroScrn. Connect an Android phone via USB or Wi-Fi to begin.'
  });

  // Check IPC availability
  const api = (window as any).androscrnApi;

  // Refresh devices and mirror status
  const refreshDevices = async () => {
    setIsScanning(true);
    try {
      if (api?.getDevices) {
        const devList: AndroidDevice[] = await api.getDevices();
        setDevices(devList);
        
        // Auto-select first device or maintain valid user selection using functional updater
        setSelectedSerial(current => {
          if (devList.length === 0) return '';
          if (current && devList.some(d => d.serial === current)) return current;
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

  useEffect(() => {
    refreshDevices();
    refreshSystemInfo();
    const interval = setInterval(() => {
      refreshDevices();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab === 'diagnostics') {
      refreshSystemInfo();
      refreshLogcat();
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

  const activeDevice = devices.find(d => d.serial === selectedSerial) || devices[0];
  const isDeviceReady = activeDevice && activeDevice.state === 'device';

  const handleStartMirror = async () => {
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

          {/* TAB 2: WIRELESS & HOTSPOT */}
          {activeTab === 'wireless' && (
            <div className="space-y-4">
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

          {/* TAB 6: LOCAL AI & OCR (EXPERIMENTAL) */}
          {activeTab === 'ai' && (
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Bot className="w-5 h-5 text-indigo-400" />
                    Local AI Assistant & OCR Studio (Experimental)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    On-device visual extraction and LLM diagnostic intelligence running 100% locally on your machine.
                  </p>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  Host Service Integration
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                Host environment verification:
                <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
                  <li>Tesseract OCR binary: <code className="text-indigo-300">C:\Program Files\Tesseract-OCR\tesseract.exe</code> (Version 5.3)</li>
                  <li>Ollama local API: <code className="text-indigo-300">http://localhost:11434</code> (v0.34.4)</li>
                </ul>
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
