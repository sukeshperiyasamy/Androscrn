import React, { useRef, useState } from 'react';
import { Wifi, Search, XCircle } from 'lucide-react';

export interface WirelessEndpoint {
  id: string;
  label: string;
  serviceType: string;
  kind: 'connect' | 'pairing';
  ip: string;
  port: number;
  status: 'connected' | 'needs-authorization' | 'pairing-required' | 'connectable';
  note: string;
}

interface DiscoveryResult {
  success: boolean;
  supported: boolean;
  cancelled: boolean;
  timedOut: boolean;
  endpoints: WirelessEndpoint[];
  ignoredCount: number;
  mdnsVersion?: string;
  message: string;
  fallback: string[];
}

interface Props {
  api: any;
  onDevicesChanged: () => void;
}

const STATUS_LABEL: Record<WirelessEndpoint['status'], string> = {
  connected: 'Connected',
  'needs-authorization': 'Needs authorization',
  'pairing-required': 'Pairing required',
  connectable: 'Ready to connect'
};

/**
 * Explicit wireless-debugging discovery. Nothing runs until the user presses "Discover Wireless Devices";
 * connecting or pairing is a separate, confirmed step (the desktop shell shows its own confirmation dialog).
 */
export default function WirelessDiscoveryPanel({ api, onDevicesChanged }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [status, setStatus] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const runToken = useRef(0);

  const discover = async () => {
    if (!api?.discoverWirelessDevices || running) return;
    const token = ++runToken.current;
    setRunning(true);
    setStatus(null);
    try {
      const res: DiscoveryResult = await api.discoverWirelessDevices();
      if (token !== runToken.current) return;
      setResult(res);
      if (res.cancelled) setStatus({ type: 'info', message: 'Discovery cancelled.' });
    } catch {
      if (token === runToken.current) {
        setStatus({ type: 'error', message: 'Wireless discovery failed unexpectedly.' });
      }
    } finally {
      if (token === runToken.current) setRunning(false);
    }
  };

  const cancel = async () => {
    runToken.current++;
    setRunning(false);
    setStatus({ type: 'info', message: 'Discovery cancelled.' });
    try {
      await api?.cancelWirelessDiscovery?.();
    } catch {
      // The scan is already abandoned in the UI.
    }
  };

  const connect = async (endpoint: WirelessEndpoint) => {
    setBusyId(endpoint.id);
    setStatus({ type: 'info', message: `Waiting for your confirmation to connect to ${endpoint.ip}:${endpoint.port}…` });
    try {
      const res = await api.connectDiscoveredDevice(endpoint.id);
      setStatus({ type: res.success ? 'success' : 'error', message: res.message });
      if (res.success) onDevicesChanged();
    } finally {
      setBusyId(null);
    }
  };

  const pair = async (endpoint: WirelessEndpoint) => {
    const pin = (pins[endpoint.id] || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      setStatus({ type: 'error', message: 'Enter the 6-digit pairing code shown on the phone.' });
      return;
    }
    setBusyId(endpoint.id);
    setStatus({ type: 'info', message: `Waiting for your confirmation to pair with ${endpoint.ip}:${endpoint.port}…` });
    try {
      const res = await api.pairDiscoveredDevice(endpoint.id, pin);
      setStatus({ type: res.success ? 'success' : 'error', message: res.message });
      // The code is single-use: clear it whatever the outcome.
      setPins(p => ({ ...p, [endpoint.id]: '' }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="glass-panel p-5" data-testid="wireless-discovery-panel">
      <div className="flex items-center gap-2 mb-2">
        <Search className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
        <h3 className="text-base font-bold text-[#202936]">Discover Wireless Devices</h3>
      </div>
      <p className="text-xs text-[#667085] mb-3">
        Looks for phones on your local network that are advertising Android Wireless debugging (ADB mDNS). Turn on
        Wireless debugging on the phone yourself first (Developer options). AndroScrn never enables it for you, never
        scans other networks, and only pairs or connects after you select a device and confirm.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={discover}
          disabled={running}
          className="glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
        >
          <Wifi className="w-4 h-4" aria-hidden="true" />
          <span>{running ? 'Searching…' : 'Discover Wireless Devices'}</span>
        </button>
        {running && (
          <button
            type="button"
            onClick={cancel}
            className="glass-button text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
          >
            <XCircle className="w-4 h-4" aria-hidden="true" />
            <span>Cancel</span>
          </button>
        )}
      </div>

      <div role="status" aria-live="polite" className="mt-3 space-y-2">
        {status && (
          <div
            className={`text-xs ${
              status.type === 'error' ? 'text-[#B91C1C]' : status.type === 'success' ? 'text-[#15803D]' : 'text-[#0F766E]'
            }`}
          >
            {status.message}
          </div>
        )}
        {result && !result.cancelled && <div className="text-xs text-[#202936]">{result.message}</div>}
      </div>

      {result && result.fallback.length > 0 && (
        <div className="mt-3 p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5] text-xs text-[#202936]">
          <div className="font-semibold text-[#202936] mb-1">
            {result.supported ? 'Other ways to connect' : 'Wireless discovery is unavailable here — use one of these instead'}
          </div>
          <ul className="list-disc pl-5 space-y-1 text-[#667085]">
            {result.fallback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {result && result.endpoints.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Discovered wireless debugging endpoints">
          {result.endpoints.map(ep => (
            <li key={ep.id} className="p-3 rounded-xl bg-[#F3F6F8] border border-[#D9DEE5]" data-testid="wireless-endpoint">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs font-semibold text-[#202936] font-mono">
                    {ep.ip}:{ep.port}
                  </div>
                  <div className="text-[11px] text-[#667085]">
                    {ep.label} · {ep.kind === 'pairing' ? 'Pairing service' : 'Connection service'} · {STATUS_LABEL[ep.status]}
                  </div>
                  <div className="text-[11px] text-[#84909E] mt-0.5">{ep.note}</div>
                </div>

                {ep.kind === 'pairing' ? (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`pin-${ep.id}`}>
                      6-digit pairing code for {ep.ip}
                    </label>
                    <input
                      id={`pin-${ep.id}`}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={pins[ep.id] || ''}
                      onChange={e => setPins(p => ({ ...p, [ep.id]: e.target.value.replace(/\D/g, '') }))}
                      className="bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs font-mono text-[#202936] w-28 outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]"
                      placeholder="6-digit code"
                    />
                    <button
                      type="button"
                      onClick={() => pair(ep)}
                      disabled={busyId === ep.id}
                      className="glass-button text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                    >
                      <span>Pair…</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => connect(ep)}
                    disabled={busyId === ep.id || ep.status === 'connected'}
                    className="glass-button text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer"
                  >
                    <span>{ep.status === 'connected' ? 'Connected' : 'Connect…'}</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
