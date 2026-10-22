import { DeviceProfile, ProfileSettings, PROFILE_SETTING_KEYS } from './index';

export interface ApplyContext {
  /** Serial of the phone that is currently selected, or '' when none is. */
  selectedSerial: string;
  /** True while a mirroring session is running. */
  mirroring: boolean;
  /** Settings as they currently are in the UI. */
  current: ProfileSettings;
}

export interface ApplyPlan {
  /** False when nothing may be applied until the problem is resolved (e.g. no phone is selected). */
  allowed: boolean;
  reason?: string;
  /** The profile belongs to another phone: the user must confirm applying it to this one. */
  needsDeviceConfirmation: boolean;
  /** Settings that will change (only those that differ from the current ones). */
  changes: Partial<ProfileSettings>;
  /** Settings in the profile that are missing or unusable and are left as they are. */
  skipped: string[];
  /** Applying changes how the running session behaves: it must be restarted to take effect. */
  needsSessionRestart: boolean;
}

/** Settings that only take effect when mirroring starts. Changing them during a session needs a restart. */
export const RESTART_REQUIRED_KEYS: Array<keyof ProfileSettings> = [
  'qualityPreset', 'inputMode', 'turnScreenOff', 'stayAwake', 'alwaysOnTop', 'captureOrientation', 'recordSession', 'playAudio', 'clipboardSync'
];

/**
 * Decides what applying a profile would do, without doing it. Pure so it can be tested; the UI shows the plan
 * (changes, skipped settings, confirmations) and only then applies it. Nothing here starts mirroring, the camera
 * or any device power action: profiles only change settings.
 */
export function planProfileApplication(profile: DeviceProfile, ctx: ApplyContext): ApplyPlan {
  if (!ctx.selectedSerial) {
    return { allowed: false, reason: 'Connect and select a phone first.', needsDeviceConfirmation: false, changes: {}, skipped: [], needsSessionRestart: false };
  }
  const changes: Partial<ProfileSettings> = {};
  const skipped: string[] = [];
  for (const key of PROFILE_SETTING_KEYS) {
    const value = profile.settings[key];
    if (value === undefined) {
      skipped.push(key);
      continue;
    }
    if (value !== ctx.current[key]) (changes as Record<string, unknown>)[key] = value;
  }
  const changedKeys = Object.keys(changes) as Array<keyof ProfileSettings>;
  return {
    allowed: true,
    needsDeviceConfirmation: !!profile.deviceSerial && profile.deviceSerial !== ctx.selectedSerial,
    changes,
    skipped,
    needsSessionRestart: ctx.mirroring && changedKeys.some(k => RESTART_REQUIRED_KEYS.includes(k))
  };
}

/** Plain-language names for settings, used in confirmations and summaries. */
export const PROFILE_SETTING_LABELS: Record<keyof ProfileSettings, string> = {
  qualityPreset: 'Quality',
  inputMode: 'Input mode',
  turnScreenOff: 'Phone screen off',
  stayAwake: 'Stay awake',
  alwaysOnTop: 'Always on top',
  captureOrientation: 'Orientation',
  recordSession: 'Record video',
  playAudio: 'Phone audio',
  clipboardSync: 'Clipboard sync'
};
