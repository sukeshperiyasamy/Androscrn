import crypto from 'crypto';
import { DeviceManager } from '../device_manager';
import { ConnectionManager } from '../connection_manager';
import { SecurityValidator } from '../security';

/**
 * Explicit, user-initiated discovery of Android wireless-debugging endpoints through ADB's built-in
 * mDNS support (`adb mdns check` / `adb mdns services`).
 *
 * Boundaries (see docs/compatibility.md):
 *  - Discovery only reads what the bundled ADB already sees. It does not scan networks or probe hosts.
 *  - Only private (RFC 1918) and link-local IPv4 endpoints are accepted.
 *  - Discovery never connects or pairs. Connecting/pairing needs a separate call that requires explicit
 *    confirmation and an endpoint handle issued by a recent discovery.
 *  - Nothing here grants MCP permissions. Device pairing and MCP client pairing stay separate.
 */

export type WirelessServiceKind = 'connect' | 'pairing';

export type WirelessEndpointStatus =
  | 'connected'
  | 'needs-authorization'
  | 'pairing-required'
  | 'connectable';

export interface WirelessEndpoint {
  /** Opaque handle issued by this process; the only value accepted by connect/pair. */
  id: string;
  /** Redacted instance label that is safe to display and log. */
  label: string;
  serviceType: string;
  kind: WirelessServiceKind;
  ip: string;
  port: number;
  status: WirelessEndpointStatus;
  note: string;
}

export interface IgnoredRecord {
  reason: string;
  line: string;
}

export interface MdnsParseResult {
  endpoints: Array<Omit<WirelessEndpoint, 'id' | 'status' | 'note'> & { instanceName: string }>;
  ignored: IgnoredRecord[];
}

export interface DiscoveryResult {
  success: boolean;
  supported: boolean;
  cancelled: boolean;
  timedOut: boolean;
  endpoints: WirelessEndpoint[];
  ignoredCount: number;
  mdnsVersion?: string;
  message: string;
  /** Concrete USB / manual fallbacks, always present when discovery could not run. */
  fallback: string[];
}

export interface ActionResult {
  success: boolean;
  cancelled?: boolean;
  message: string;
}

export type ConfirmFn = (details: { action: 'connect' | 'pair'; label: string; ip: string; port: number }) => Promise<boolean>;

const SERVICE_TYPES: Record<string, WirelessServiceKind> = {
  '_adb-tls-connect._tcp': 'connect',
  '_adb-tls-pairing._tcp': 'pairing'
};

export const DISCOVERY_TTL_MS = 2 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;

export const WIRELESS_FALLBACK_STEPS = [
  'USB: connect the phone with a data cable, enable USB debugging, and accept the prompt on the phone.',
  'Manual wireless: on Android 11+ open Developer options > Wireless debugging > Pair device with pairing code, then use "Pair" with the IP, pairing port and 6-digit code shown on the phone.',
  'Classic TCP/IP: connect once over USB and use "Enable Wireless Mode (Port 5555)".'
];

function endpointId(serviceType: string, ip: string, port: number, instance: string): string {
  return crypto.createHash('sha256').update(`${serviceType}|${ip}|${port}|${instance}`).digest('hex').slice(0, 16);
}

function redactLabel(instance: string): string {
  // Instance names look like "adb-<serial>-<suffix>"; hide the serial portion.
  const m = instance.match(/^adb-(.+)-([A-Za-z0-9]{4,8})$/);
  if (m) return `adb-${SecurityValidator.redactSerial(m[1])}-${m[2]}`;
  return SecurityValidator.redactSerial(instance) || 'unnamed';
}

/**
 * Parses `adb mdns services` output. Malformed, non-IPv4, non-local or unrecognized records are counted
 * and skipped instead of throwing.
 */
export function parseMdnsServices(stdout: string): MdnsParseResult {
  const endpoints: MdnsParseResult['endpoints'] = [];
  const ignored: IgnoredRecord[] = [];
  const seen = new Set<string>();

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^list of discovered mdns services/i.test(line)) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      ignored.push({ reason: 'malformed record', line: line.slice(0, 80) });
      continue;
    }
    const [instance, serviceType, hostPort] = parts;
    const kind = SERVICE_TYPES[serviceType];
    if (!kind) {
      ignored.push({ reason: 'unrecognized service type', line: redactLabel(instance) });
      continue;
    }
    if (!/^[A-Za-z0-9._-]{1,96}$/.test(instance)) {
      ignored.push({ reason: 'invalid instance name', line: line.slice(0, 40) });
      continue;
    }
    const hp = hostPort.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
    if (!hp) {
      ignored.push({ reason: 'endpoint is not an IPv4 address:port', line: redactLabel(instance) });
      continue;
    }
    const ip = hp[1];
    const port = parseInt(hp[2], 10);
    if (!SecurityValidator.isValidIPv4(ip) || !SecurityValidator.isValidPort(port)) {
      ignored.push({ reason: 'invalid IP address or port', line: redactLabel(instance) });
      continue;
    }
    if (!SecurityValidator.isLocalNetworkIPv4(ip)) {
      ignored.push({ reason: 'endpoint is outside the local network', line: redactLabel(instance) });
      continue;
    }
    const dedupeKey = `${serviceType}|${ip}|${port}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    endpoints.push({ instanceName: instance, label: redactLabel(instance), serviceType, kind, ip, port });
  }

  return { endpoints, ignored };
}

export type IpcParse<T> = ({ ok: true } & T) | { ok: false; message: string };

/** Validates the payload of the `connect-discovered-device` IPC channel. */
export function parseConnectRequest(payload: unknown): IpcParse<{ endpointId: string }> {
  const p = payload as { endpointId?: unknown } | null;
  if (!p || typeof p !== 'object' || !SecurityValidator.isValidEndpointId(p.endpointId)) {
    return { ok: false, message: 'Invalid endpoint selection.' };
  }
  return { ok: true, endpointId: p.endpointId };
}

/** Validates the payload of the `pair-discovered-device` IPC channel. */
export function parsePairRequest(payload: unknown): IpcParse<{ endpointId: string; pin: string }> {
  const p = payload as { endpointId?: unknown; pin?: unknown } | null;
  if (!p || typeof p !== 'object' || !SecurityValidator.isValidEndpointId(p.endpointId)) {
    return { ok: false, message: 'Invalid endpoint selection.' };
  }
  if (typeof p.pin !== 'string' || !SecurityValidator.isValidPairingCode(p.pin)) {
    return { ok: false, message: 'Enter the 6-digit pairing code shown on the phone.' };
  }
  return { ok: true, endpointId: p.endpointId, pin: p.pin.trim() };
}

/** Validates the payload of the `get-device-help` IPC channel. */
export function parseDeviceHelpRequest(payload: unknown): IpcParse<{ serial: string }> {
  const p = payload as { serial?: unknown } | null;
  if (!p || typeof p !== 'object' || typeof p.serial !== 'string' || !SecurityValidator.isValidSerial(p.serial)) {
    return { ok: false, message: 'Invalid device serial identifier.' };
  }
  return { ok: true, serial: p.serial };
}

interface StoredEndpoint {
  endpoint: WirelessEndpoint;
  issuedAt: number;
}

export class WirelessDiscovery {
  private registry = new Map<string, StoredEndpoint>();
  private controller: AbortController | null = null;

  constructor(
    private deviceManager: DeviceManager,
    private connectionManager: ConnectionManager,
    private now: () => number = () => Date.now()
  ) {}

  /** True while a discovery run is in flight. */
  public get isRunning(): boolean {
    return this.controller !== null;
  }

  /** Aborts an in-flight discovery and kills its ADB child process. */
  public cancel(): void {
    this.controller?.abort();
  }

  /** Forgets all issued endpoint handles. */
  public clear(): void {
    this.registry.clear();
  }

  public async checkSupport(
    signal?: AbortSignal
  ): Promise<{ supported: boolean; version?: string; message: string; timedOut?: boolean; aborted?: boolean }> {
    const res = await this.deviceManager.executeAdb(['mdns', 'check'], 5000, signal);
    const out = `${res.stdout}\n${res.stderr}`;
    if (res.aborted) {
      return { supported: false, aborted: true, message: 'Discovery was cancelled.' };
    }
    if (/timed out/i.test(res.stderr)) {
      return {
        supported: false,
        timedOut: true,
        message: 'ADB did not answer the mDNS support check in time. Restart ADB or try again; this is not proof that mDNS is unsupported.'
      };
    }
    if (res.code !== 0 && /not found/i.test(res.stderr)) {
      return { supported: false, message: res.stderr.trim() || 'ADB executable not found.' };
    }
    if (res.code !== 0 || /unavailable|not supported|unknown command|error/i.test(out)) {
      return {
        supported: false,
        message: 'The bundled ADB or this computer does not provide mDNS discovery (adb mdns check failed).'
      };
    }
    const version = out.match(/mdns daemon version \[([^\]]+)\]/i)?.[1];
    if (!version && !/mdns/i.test(out)) {
      return { supported: false, message: 'ADB did not report an mDNS daemon.' };
    }
    return { supported: true, version, message: 'mDNS discovery is available.' };
  }

  /**
   * Runs one bounded discovery pass. Safe to cancel; cleans up the child process and the in-flight flag.
   */
  public async discover(options: { timeoutMs?: number } = {}): Promise<DiscoveryResult> {
    if (this.controller) {
      return this.failure('A discovery scan is already running.', { supported: true });
    }

    const controller = new AbortController();
    this.controller = controller;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const support = await this.checkSupport(controller.signal);
      if (controller.signal.aborted || support.aborted) {
        return this.failure('Discovery was cancelled.', { cancelled: true, supported: true });
      }
      if (!support.supported) {
        return this.failure(support.message, { supported: false, timedOut: support.timedOut });
      }

      const svc = await this.deviceManager.executeAdb(['mdns', 'services'], timeoutMs, controller.signal);
      if (svc.aborted || controller.signal.aborted) {
        return this.failure('Discovery was cancelled.', { cancelled: true, supported: true, version: support.version });
      }
      if (/timed out/i.test(svc.stderr)) {
        return this.failure('Wireless discovery timed out. Check that the phone is on the same network, then try again.', {
          timedOut: true,
          supported: true,
          version: support.version
        });
      }
      if (svc.code !== 0) {
        return this.failure(`Wireless discovery failed: ${svc.stderr.trim() || 'ADB returned an error.'}`, {
          supported: true,
          version: support.version
        });
      }

      const parsed = parseMdnsServices(svc.stdout);
      const connectedSerials = await this.readDevices(controller.signal);
      if (controller.signal.aborted) {
        return this.failure('Discovery was cancelled.', { cancelled: true, supported: true, version: support.version });
      }
      this.registry.clear();
      const issuedAt = this.now();

      const endpoints: WirelessEndpoint[] = parsed.endpoints.map(e => {
        const { status, note } = this.classify(e, connectedSerials);
        const id = endpointId(e.serviceType, e.ip, e.port, e.instanceName);
        const endpoint: WirelessEndpoint = {
          id,
          label: e.label,
          serviceType: e.serviceType,
          kind: e.kind,
          ip: e.ip,
          port: e.port,
          status,
          note
        };
        this.registry.set(id, { endpoint, issuedAt });
        return endpoint;
      });

      return {
        success: true,
        supported: true,
        cancelled: false,
        timedOut: false,
        endpoints,
        ignoredCount: parsed.ignored.length,
        mdnsVersion: support.version,
        message:
          endpoints.length === 0
            ? 'No wireless-debugging endpoints were found. Turn on Wireless debugging on the phone (Developer options) and keep it on the same Wi-Fi network.'
            : `Found ${endpoints.length} wireless-debugging endpoint${endpoints.length === 1 ? '' : 's'}. Select one to pair or connect.`,
        fallback: endpoints.length === 0 ? WIRELESS_FALLBACK_STEPS : []
      };
    } finally {
      this.controller = null;
    }
  }

  /**
   * Connects to a previously discovered `connect` endpoint after explicit user confirmation.
   */
  public async connect(id: unknown, confirm: ConfirmFn): Promise<ActionResult> {
    const stored = this.lookup(id, 'connect');
    if (!('endpoint' in stored)) return stored;
    const { endpoint } = stored;

    const approved = await confirm({ action: 'connect', label: endpoint.label, ip: endpoint.ip, port: endpoint.port });
    if (!approved) return { success: false, cancelled: true, message: 'Connection cancelled.' };

    const res = await this.connectionManager.connectWireless(endpoint.ip, endpoint.port);
    return { success: res.success, message: SecurityValidator.redactSensitiveText(res.message) };
  }

  /**
   * Pairs with a previously discovered `pairing` endpoint using the code the user typed from the phone.
   * The code is never logged or echoed back.
   */
  public async pair(id: unknown, pin: unknown, confirm: ConfirmFn): Promise<ActionResult> {
    const stored = this.lookup(id, 'pairing');
    if (!('endpoint' in stored)) return stored;
    const { endpoint } = stored;

    if (typeof pin !== 'string' || !SecurityValidator.isValidPairingCode(pin)) {
      return { success: false, message: 'Enter the 6-digit pairing code shown on the phone.' };
    }

    const approved = await confirm({ action: 'pair', label: endpoint.label, ip: endpoint.ip, port: endpoint.port });
    if (!approved) return { success: false, cancelled: true, message: 'Pairing cancelled.' };

    const res = await this.connectionManager.pairWireless(endpoint.ip, endpoint.port, pin.trim());
    const message = SecurityValidator.redactSensitiveText(res.message).split(pin.trim()).join('[REDACTED_PIN]');
    return {
      success: res.success,
      message: res.success
        ? 'Paired successfully. Run Discover again, then connect to the device endpoint.'
        : message
    };
  }

  private lookup(
    id: unknown,
    kind: WirelessServiceKind
  ): StoredEndpoint | { success: false; message: string } {
    if (!SecurityValidator.isValidEndpointId(id)) {
      return { success: false, message: 'Invalid endpoint selection.' };
    }
    const stored = this.registry.get(id);
    if (!stored) {
      return { success: false, message: 'That endpoint is no longer available. Run Discover again.' };
    }
    if (this.now() - stored.issuedAt > DISCOVERY_TTL_MS) {
      this.registry.delete(id);
      return { success: false, message: 'Discovery results expired. Run Discover again.' };
    }
    if (stored.endpoint.kind !== kind) {
      return {
        success: false,
        message: kind === 'connect' ? 'This endpoint is for pairing, not connecting.' : 'This endpoint is for connecting, not pairing.'
      };
    }
    return stored;
  }

  private async readDevices(signal: AbortSignal) {
    const res = await this.deviceManager.executeAdb(['devices', '-l'], 5000, signal);
    return this.deviceManager.parseDevicesOutput(res.stdout);
  }

  private classify(
    e: MdnsParseResult['endpoints'][number],
    devices: ReturnType<DeviceManager['parseDevicesOutput']>
  ): { status: WirelessEndpointStatus; note: string } {
    if (e.kind === 'pairing') {
      return {
        status: 'pairing-required',
        note: 'Pairing code screen is open on the phone. Enter the 6-digit code to pair this computer.'
      };
    }
    const match = devices.find(
      d => d.serial === `${e.ip}:${e.port}` || d.serial.includes(e.instanceName)
    );
    if (match?.state === 'device') {
      return { status: 'connected', note: 'Already connected and authorized.' };
    }
    if (match?.state === 'unauthorized') {
      return { status: 'needs-authorization', note: 'Visible to ADB but not authorized. Pair this computer from the phone, then connect.' };
    }
    return {
      status: 'connectable',
      note: 'If this computer has not been paired with the phone before, connecting will be refused. Pair first.'
    };
  }

  private failure(
    message: string,
    extra: { supported: boolean; cancelled?: boolean; timedOut?: boolean; version?: string }
  ): DiscoveryResult {
    return {
      success: false,
      supported: extra.supported,
      cancelled: extra.cancelled ?? false,
      timedOut: extra.timedOut ?? false,
      endpoints: [],
      ignoredCount: 0,
      mdnsVersion: extra.version,
      message,
      fallback: extra.cancelled ? [] : WIRELESS_FALLBACK_STEPS
    };
  }
}
