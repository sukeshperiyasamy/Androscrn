/**
 * OEM-specific and connection-state troubleshooting guidance.
 *
 * Pure functions only: nothing here talks to ADB or changes any phone setting. All steps are
 * instructions for the user to perform themselves, each carrying an evidence level so the UI never
 * presents a vendor-specific hint as a universal fact.
 */

export type GuidanceFeature = 'input-injection' | 'usb-debugging' | 'wireless-debugging' | 'general';
export type GuidanceCategory = 'connection' | 'vendor-input';
export type EvidenceLevel = 'documented' | 'community-reported' | 'none';

export interface OemDeviceInfo {
  manufacturer?: string;
  brand?: string;
  model?: string;
  androidVersion?: string;
  apiLevel?: number;
  /** e.g. "MIUI 14" or "HyperOS 1.0" when the system exposes it. */
  osSkin?: string;
}

export interface GuidanceReference {
  label: string;
  url: string;
}

export interface OemGuidance {
  id: string;
  category: GuidanceCategory;
  manufacturer: string;
  family?: string;
  feature: GuidanceFeature;
  title: string;
  restriction: string;
  uncertainty: string;
  steps: string[];
  reference?: GuidanceReference;
  evidence: EvidenceLevel;
}

export interface ConnectionGuidance {
  id: string;
  category: 'connection';
  state: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  steps: string[];
}

export interface DeviceHelp {
  /** Stable key that changes only when the guidance content would change (used to avoid repeated notices). */
  key: string;
  connection: ConnectionGuidance | null;
  vendor: OemGuidance[];
}

const SCRCPY_FAQ: GuidanceReference = {
  label: 'scrcpy FAQ — input does not work on some devices',
  url: 'https://github.com/Genymobile/scrcpy/blob/master/FAQ.md'
};

const ANDROID_WIRELESS_DEBUGGING: GuidanceReference = {
  label: 'Android Developers — ADB wireless debugging',
  url: 'https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi'
};

function clean(value?: string): string {
  return (value ?? '').trim();
}

/**
 * Returns the recognized Xiaomi-group family name, or null when the device is not recognized.
 */
export function detectXiaomiFamily(info: OemDeviceInfo): 'Xiaomi' | 'Redmi' | 'POCO' | null {
  const tokens = [clean(info.brand), clean(info.manufacturer)].map(t => t.toLowerCase());
  if (tokens.includes('redmi')) return 'Redmi';
  if (tokens.includes('poco')) return 'POCO';
  if (tokens.includes('xiaomi')) return 'Xiaomi';
  return null;
}

/**
 * Detects an input-injection failure from ADB output so callers never report it as success.
 */
export function isInputInjectionBlocked(output: { stdout?: string; stderr?: string }): boolean {
  const text = `${output.stdout ?? ''}\n${output.stderr ?? ''}`;
  return /INJECT_EVENTS|SecurityException/i.test(text);
}

/**
 * Builds vendor-specific guidance for a device. Always returns at least one entry so the UI is
 * useful when the manufacturer is unknown or the property query failed.
 */
export function getOemGuidance(info: OemDeviceInfo | null | undefined): OemGuidance[] {
  const device = info ?? {};
  const family = detectXiaomiFamily(device);
  const results: OemGuidance[] = [];

  if (family) {
    const skin = clean(device.osSkin);
    results.push({
      id: 'xiaomi-input-injection',
      category: 'vendor-input',
      manufacturer: 'Xiaomi',
      family,
      feature: 'input-injection',
      title: `${family} devices can restrict simulated touch and key input`,
      restriction:
        'Some MIUI and HyperOS configurations block simulated taps, swipes, key events and text entry over ADB even when screen mirroring works.' +
        (skin ? ` Detected system skin: ${skin}.` : ''),
      uncertainty:
        'The exact switch name and its location vary by model, region and software version, and some builds may ask for extra confirmation. ' +
        'AndroScrn cannot verify this on your phone, so treat these as things to check rather than guaranteed fixes.',
      steps: [
        'Open Settings > Additional settings > Developer options (the path differs between MIUI and HyperOS).',
        'Confirm "USB debugging" is on.',
        'Look for a separate option such as "USB debugging (Security settings)" and enable it if it is present.',
        'If your phone shows a confirmation prompt, read it before accepting.',
        'Disconnect and reconnect the cable (or reconnect wirelessly), then press Retry.'
      ],
      reference: SCRCPY_FAQ,
      evidence: 'documented'
    });
  } else {
    const name = clean(device.manufacturer) || clean(device.brand);
    results.push({
      id: 'generic-input-injection',
      category: 'vendor-input',
      manufacturer: name || 'Unknown',
      feature: 'general',
      title: name ? `No ${name}-specific guidance is available` : 'Device manufacturer could not be determined',
      restriction:
        'Some vendor Android builds restrict simulated input over ADB. AndroScrn has no verified guidance for this manufacturer.',
      uncertainty: 'This is general advice, not a documented fix for your specific device.',
      steps: [
        'Check Developer options for any extra debugging or security-related switch near "USB debugging".',
        'Check the manufacturer\'s documentation for input or debugging restrictions.',
        'Reconnect the device and press Retry.'
      ],
      reference: SCRCPY_FAQ,
      evidence: 'none'
    });
  }

  return results;
}

/**
 * Explains an ADB connection state. Connection problems are kept separate from vendor input restrictions.
 */
export function getConnectionGuidance(
  state: string | undefined,
  connectionType?: 'usb' | 'tcpip' | 'wireless-debugging' | 'emulator'
): ConnectionGuidance | null {
  const wireless = connectionType === 'wireless-debugging' || connectionType === 'tcpip';
  switch (state) {
    case 'unauthorized':
      return {
        id: 'state-unauthorized',
        category: 'connection',
        state,
        severity: 'error',
        title: 'This computer is not authorized on the phone yet',
        steps: [
          'Unlock the phone and look for the "Allow USB debugging?" prompt.',
          'Check the RSA fingerprint matches, then tap Allow (optionally tick "Always allow from this computer").',
          wireless
            ? 'For wireless debugging, pair this computer from Developer options > Wireless debugging > Pair device with pairing code.'
            : 'If no prompt appears, unplug the cable, toggle USB debugging off and on, or use "Revoke USB debugging authorizations", then reconnect.',
          'Press Retry once you have responded on the phone.'
        ]
      };
    case 'offline':
      return {
        id: 'state-offline',
        category: 'connection',
        state,
        severity: 'warning',
        title: 'The phone is visible but not responding to ADB',
        steps: [
          wireless
            ? 'Make sure the phone and this computer are on the same network and Wireless debugging is still on.'
            : 'Reconnect the USB cable and use a data-capable cable and a direct USB port.',
          'Toggle USB debugging off and on in Developer options.',
          'If it stays offline, unplug and reconnect the phone, then press Retry.'
        ]
      };
    case 'connecting':
    case 'authorizing':
      return {
        id: `state-${state}`,
        category: 'connection',
        state,
        severity: 'info',
        title: 'ADB is still establishing the connection',
        steps: ['Wait a few seconds, and confirm any prompt shown on the phone, then press Retry.']
      };
    case 'no permissions':
      return {
        id: 'state-no-permissions',
        category: 'connection',
        state,
        severity: 'error',
        title: 'Windows or the phone denied access to the USB device',
        steps: [
          'Install the phone manufacturer\'s USB driver or the Google USB driver.',
          'Reconnect the cable and press Retry.'
        ]
      };
    case 'recovery':
    case 'sideload':
    case 'bootloader':
      return {
        id: `state-${state}`,
        category: 'connection',
        state,
        severity: 'warning',
        title: `The phone is in ${state} mode`,
        steps: ['Reboot the phone into normal Android, then press Retry.']
      };
    case 'unknown':
      return {
        id: 'state-unknown',
        category: 'connection',
        state,
        severity: 'warning',
        title: 'ADB reported a state AndroScrn does not recognize',
        steps: ['Reconnect the device and press Retry. If it persists, export a diagnostic report.']
      };
    default:
      return null;
  }
}

export interface HelpTargetDevice extends OemDeviceInfo {
  state?: string;
  connectionType?: 'usb' | 'tcpip' | 'wireless-debugging' | 'emulator';
}

/**
 * Combined help for the currently selected device. For devices that are not in the `device` state only
 * connection guidance is returned, because vendor input restrictions are meaningless until ADB is usable.
 */
export function buildDeviceHelp(device: HelpTargetDevice | null | undefined): DeviceHelp {
  if (!device) {
    return { key: 'none', connection: null, vendor: [] };
  }
  const connection = getConnectionGuidance(device.state, device.connectionType);
  const vendor = device.state === 'device' ? getOemGuidance(device) : [];
  const key = [connection?.id ?? '-', ...vendor.map(v => v.id)].join('|');
  return { key, connection, vendor };
}

export { ANDROID_WIRELESS_DEBUGGING };
