import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SecurityValidator } from '../security';

export type QualityPreset = 'ultra' | 'high_performance' | 'balanced' | 'battery_saver';
export type InputMode = 'auto' | 'sdk' | 'uhid';

export type CaptureOrientation = '0' | '90' | '180' | '270';

/** Session settings a profile can hold: only options the mirroring screen really supports. */
export interface ProfileSettings {
  qualityPreset: QualityPreset;
  inputMode: InputMode;
  turnScreenOff: boolean;
  stayAwake: boolean;
  alwaysOnTop: boolean;
  captureOrientation: CaptureOrientation;
  recordSession: boolean;
  playAudio: boolean;
  clipboardSync: boolean;
}

export interface DeviceProfile {
  id: string;
  name: string;
  /** When set, the profile is meant for this phone; applying it to another phone needs confirmation. */
  deviceSerial?: string;
  deviceLabel?: string;
  /** Possibly partial when loaded from an older or damaged file; invalid fields are dropped, never guessed. */
  settings: Partial<ProfileSettings>;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  version: 2;
  aliases: Record<string, string>;
  qualityPreset: QualityPreset;
  inputMode: InputMode;
  /** Automatic clipboard sync during mirroring (scrcpy autosync). Off unless the user turns it on. */
  clipboardSync: boolean;
  profiles: DeviceProfile[];
}

export const SETTINGS_VERSION = 2;
export const MAX_PROFILES = 50;
export const MAX_PROFILE_NAME = 48;

export type SettingsLoadStatus = 'missing' | 'loaded' | 'repaired' | 'corrupt';

export interface SettingsLoadResult {
  status: SettingsLoadStatus;
  /** Path the unreadable file was moved to, when status is 'corrupt'. */
  backupPath?: string;
  /** Fields that were present but invalid and were reset to defaults. */
  droppedFields: string[];
}

const QUALITY_PRESETS: QualityPreset[] = ['ultra', 'high_performance', 'balanced', 'battery_saver'];
const INPUT_MODES: InputMode[] = ['auto', 'sdk', 'uhid'];
export const MAX_ALIAS_LENGTH = 64;
export const MAX_ALIASES = 200;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isStorableSerial(serial: unknown): serial is string {
  return typeof serial === 'string' && !RESERVED_KEYS.has(serial) && SecurityValidator.isValidSerial(serial);
}

export function defaultSettings(): AppSettings {
  return { version: 2, aliases: {}, qualityPreset: 'balanced', inputMode: 'auto', clipboardSync: false, profiles: [] };
}

const ORIENTATIONS: CaptureOrientation[] = ['0', '90', '180', '270'];
const BOOLEAN_PROFILE_FIELDS = ['turnScreenOff', 'stayAwake', 'alwaysOnTop', 'recordSession', 'playAudio', 'clipboardSync'] as const;
export const PROFILE_SETTING_KEYS: Array<keyof ProfileSettings> = [
  'qualityPreset', 'inputMode', 'turnScreenOff', 'stayAwake', 'alwaysOnTop', 'captureOrientation', 'recordSession', 'playAudio', 'clipboardSync'
];

/** Validates profile settings field by field; unknown fields are ignored and reported. */
export function sanitizeProfileSettings(raw: unknown): { settings: Partial<ProfileSettings>; invalid: string[]; unknown: string[] } {
  const settings: Partial<ProfileSettings> = {};
  const invalid: string[] = [];
  const unknown: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { settings, invalid: ['settings'], unknown };
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(PROFILE_SETTING_KEYS as string[]).includes(key)) unknown.push(key.slice(0, 32));
  }
  if ('qualityPreset' in obj) {
    if (isQualityPreset(obj.qualityPreset)) settings.qualityPreset = obj.qualityPreset;
    else invalid.push('qualityPreset');
  }
  if ('inputMode' in obj) {
    if (isInputMode(obj.inputMode)) settings.inputMode = obj.inputMode;
    else invalid.push('inputMode');
  }
  if ('captureOrientation' in obj) {
    if (typeof obj.captureOrientation === 'string' && (ORIENTATIONS as string[]).includes(obj.captureOrientation)) {
      settings.captureOrientation = obj.captureOrientation as CaptureOrientation;
    } else invalid.push('captureOrientation');
  }
  for (const key of BOOLEAN_PROFILE_FIELDS) {
    if (key in obj) {
      if (typeof obj[key] === 'boolean') settings[key] = obj[key] as boolean;
      else invalid.push(key);
    }
  }
  return { settings, invalid, unknown };
}

/** Trimmed profile name, or null when empty, too long or containing control characters. */
export function normalizeProfileName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_PROFILE_NAME || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeProfile(raw: unknown): DeviceProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = normalizeProfileName(o.name);
  if (typeof o.id !== 'string' || !/^p_[0-9a-f]{16}$/.test(o.id) || !name) return null;
  const { settings } = sanitizeProfileSettings(o.settings);
  const profile: DeviceProfile = {
    id: o.id,
    name,
    settings,
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : 0,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : 0
  };
  if (o.deviceSerial !== undefined) {
    if (!isStorableSerial(o.deviceSerial)) return null;
    profile.deviceSerial = o.deviceSerial;
    const label = normalizeAlias(o.deviceLabel);
    if (label) profile.deviceLabel = label;
  }
  return profile;
}

/** Returns the trimmed alias, '' to clear it, or null when it is not acceptable. */
export function normalizeAlias(alias: unknown): string | null {
  if (typeof alias !== 'string') return null;
  const trimmed = alias.trim();
  if (trimmed.length > MAX_ALIAS_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

export function isQualityPreset(value: unknown): value is QualityPreset {
  return typeof value === 'string' && (QUALITY_PRESETS as string[]).includes(value);
}

export function isInputMode(value: unknown): value is InputMode {
  return typeof value === 'string' && (INPUT_MODES as string[]).includes(value);
}

/**
 * Validates untrusted parsed JSON field by field. Valid fields are kept, invalid ones fall back to defaults,
 * so one bad value never discards the user's other preferences.
 */
export function sanitizeSettings(raw: unknown): { settings: AppSettings; droppedFields: string[] } {
  const settings = defaultSettings();
  const droppedFields: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { settings, droppedFields: ['<root>'] };
  }
  const obj = raw as Record<string, unknown>;

  if ('qualityPreset' in obj) {
    if (isQualityPreset(obj.qualityPreset)) settings.qualityPreset = obj.qualityPreset;
    else droppedFields.push('qualityPreset');
  }
  if ('inputMode' in obj) {
    if (isInputMode(obj.inputMode)) settings.inputMode = obj.inputMode;
    else droppedFields.push('inputMode');
  }
  if ('aliases' in obj) {
    const aliases = obj.aliases;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      droppedFields.push('aliases');
    } else {
      for (const [serial, value] of Object.entries(aliases as Record<string, unknown>)) {
        const alias = normalizeAlias(value);
        if (!isStorableSerial(serial) || !alias) {
          droppedFields.push(`aliases.${serial.slice(0, 32)}`);
          continue;
        }
        if (Object.keys(settings.aliases).length >= MAX_ALIASES) {
          droppedFields.push(`aliases.${serial.slice(0, 32)}`);
          continue;
        }
        settings.aliases[serial] = alias;
      }
    }
  }
  if ('clipboardSync' in obj) {
    if (typeof obj.clipboardSync === 'boolean') settings.clipboardSync = obj.clipboardSync;
    else droppedFields.push('clipboardSync');
  }
  if ('profiles' in obj) {
    if (!Array.isArray(obj.profiles)) {
      droppedFields.push('profiles');
    } else {
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();
      obj.profiles.forEach((rawProfile, i) => {
        const profile = sanitizeProfile(rawProfile);
        const nameKey = profile?.name.toLowerCase();
        if (!profile || seenIds.has(profile.id) || seenNames.has(nameKey!) || settings.profiles.length >= MAX_PROFILES) {
          droppedFields.push(`profiles[${i}]`);
          return;
        }
        // Invalid individual settings inside a profile are dropped but do not count as a damaged profile.
        const original = (rawProfile as any)?.settings;
        if (original && typeof original === 'object' && Object.keys(profile.settings).length < Object.keys(original).length) {
          droppedFields.push(`profiles[${i}].settings`);
        }
        seenIds.add(profile.id);
        seenNames.add(nameKey!);
        settings.profiles.push(profile);
      });
    }
  }
  // Version 1 files have no clipboardSync/profiles: the defaults above are the migration. Any other version is
  // read the same way (field by field); the file is rewritten as the current version on the next save.
  return { settings, droppedFields };
}

/**
 * Small JSON settings store (userData/settings.json). Only durable user preferences live here; runtime
 * state such as running sessions is never persisted. Writes are atomic (temp file + rename) and an
 * unreadable file is moved aside to settings.json.corrupt-<timestamp> instead of being overwritten.
 */
export class SettingsStore {
  private filePath: string;
  private settings: AppSettings = defaultSettings();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public getPath(): string {
    return this.filePath;
  }

  public load(): SettingsLoadResult {
    let text: string;
    try {
      text = fs.readFileSync(this.filePath, 'utf8');
    } catch (err: any) {
      this.settings = defaultSettings();
      if (err?.code === 'ENOENT') return { status: 'missing', droppedFields: [] };
      return { status: 'corrupt', droppedFields: [], backupPath: this.moveAside() };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      this.settings = defaultSettings();
      return { status: 'corrupt', droppedFields: [], backupPath: this.moveAside() };
    }

    const { settings, droppedFields } = sanitizeSettings(parsed);
    this.settings = settings;
    if (droppedFields.includes('<root>')) {
      return { status: 'corrupt', droppedFields, backupPath: this.moveAside() };
    }
    if (droppedFields.length > 0) {
      // Rewrite so the repaired file no longer carries the invalid values.
      this.save();
      return { status: 'repaired', droppedFields };
    }
    return { status: 'loaded', droppedFields };
  }

  public get(): AppSettings {
    return {
      ...this.settings,
      aliases: { ...this.settings.aliases },
      profiles: this.settings.profiles.map(p => ({ ...p, settings: { ...p.settings } }))
    };
  }

  public listProfiles(): DeviceProfile[] {
    return this.get().profiles;
  }

  /**
   * Creates (no id) or updates (existing id) a profile. Names are unique (case-insensitive). Every setting is
   * validated; any invalid or unknown setting rejects the whole save so nothing is stored half-understood.
   */
  public saveProfile(input: {
    id?: unknown;
    name?: unknown;
    deviceSerial?: unknown;
    deviceLabel?: unknown;
    settings?: unknown;
  }): { success: boolean; message?: string; profile?: DeviceProfile } {
    if (!input || typeof input !== 'object') return { success: false, message: 'Invalid profile.' };
    const name = normalizeProfileName(input.name);
    if (!name) return { success: false, message: `Give the profile a name (1–${MAX_PROFILE_NAME} characters).` };
    const { settings, invalid, unknown } = sanitizeProfileSettings(input.settings);
    if (invalid.length || unknown.length) {
      return { success: false, message: `Unsupported profile settings: ${[...invalid, ...unknown].join(', ')}.` };
    }
    const missing = PROFILE_SETTING_KEYS.filter(k => !(k in settings));
    if (missing.length) return { success: false, message: `Missing profile settings: ${missing.join(', ')}.` };

    let deviceSerial: string | undefined;
    let deviceLabel: string | undefined;
    if (input.deviceSerial !== undefined && input.deviceSerial !== null && input.deviceSerial !== '') {
      if (!isStorableSerial(input.deviceSerial)) return { success: false, message: 'Invalid device for this profile.' };
      deviceSerial = input.deviceSerial;
      deviceLabel = normalizeAlias(input.deviceLabel) || undefined;
    }

    const next = this.get();
    const now = Date.now();
    const existing = typeof input.id === 'string' ? next.profiles.find(p => p.id === input.id) : undefined;
    if (input.id !== undefined && !existing) return { success: false, message: 'That profile no longer exists.' };
    if (next.profiles.some(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== existing?.id)) {
      return { success: false, message: `A profile named "${name}" already exists.` };
    }
    let profile: DeviceProfile;
    if (existing) {
      profile = { ...existing, name, settings, deviceSerial, deviceLabel, updatedAt: now };
      next.profiles = next.profiles.map(p => (p.id === existing.id ? profile : p));
    } else {
      if (next.profiles.length >= MAX_PROFILES) return { success: false, message: `At most ${MAX_PROFILES} profiles can be saved.` };
      profile = { id: `p_${crypto.randomBytes(8).toString('hex')}`, name, settings, deviceSerial, deviceLabel, createdAt: now, updatedAt: now };
      next.profiles = [...next.profiles, profile];
    }
    if (!profile.deviceSerial) {
      delete profile.deviceSerial;
      delete profile.deviceLabel;
    }
    const res = this.commit(next);
    return res.success ? { success: true, profile: { ...profile, settings: { ...profile.settings } } } : { success: false, message: res.message };
  }

  public deleteProfile(id: unknown): { success: boolean; message?: string } {
    if (typeof id !== 'string') return { success: false, message: 'Invalid profile.' };
    const next = this.get();
    if (!next.profiles.some(p => p.id === id)) return { success: false, message: 'That profile no longer exists.' };
    next.profiles = next.profiles.filter(p => p.id !== id);
    const res = this.commit(next);
    return { success: res.success, message: res.message };
  }

  /** Applies a partial preference update. Rejects the whole update if any field is invalid. */
  public update(patch: { qualityPreset?: unknown; inputMode?: unknown; clipboardSync?: unknown }): { success: boolean; message?: string; settings: AppSettings } {
    if (!patch || typeof patch !== 'object') {
      return { success: false, message: 'Invalid settings update.', settings: this.get() };
    }
    if ('qualityPreset' in patch && !isQualityPreset(patch.qualityPreset)) {
      return { success: false, message: 'Invalid quality preset.', settings: this.get() };
    }
    if ('inputMode' in patch && !isInputMode(patch.inputMode)) {
      return { success: false, message: 'Invalid input mode.', settings: this.get() };
    }
    if ('clipboardSync' in patch && typeof patch.clipboardSync !== 'boolean') {
      return { success: false, message: 'Invalid clipboard setting.', settings: this.get() };
    }
    const next = this.get();
    if (patch.qualityPreset !== undefined) next.qualityPreset = patch.qualityPreset as QualityPreset;
    if (patch.inputMode !== undefined) next.inputMode = patch.inputMode as InputMode;
    if (patch.clipboardSync !== undefined) next.clipboardSync = patch.clipboardSync as boolean;
    return this.commit(next);
  }

  /** Sets or (with an empty alias) clears a device alias. */
  public setAlias(serial: unknown, alias: unknown): { success: boolean; message?: string; settings: AppSettings } {
    if (!isStorableSerial(serial)) {
      return { success: false, message: 'Invalid device serial.', settings: this.get() };
    }
    const normalized = normalizeAlias(alias);
    if (normalized === null) {
      return { success: false, message: `Alias must be text of at most ${MAX_ALIAS_LENGTH} characters.`, settings: this.get() };
    }
    const next = this.get();
    if (normalized === '') {
      delete next.aliases[serial];
    } else {
      if (!(serial in next.aliases) && Object.keys(next.aliases).length >= MAX_ALIASES) {
        return { success: false, message: `At most ${MAX_ALIASES} aliases can be stored.`, settings: this.get() };
      }
      next.aliases[serial] = normalized;
    }
    return this.commit(next);
  }

  private commit(next: AppSettings): { success: boolean; message?: string; settings: AppSettings } {
    const previous = this.settings;
    this.settings = next;
    const saved = this.save();
    if (!saved.success) {
      this.settings = previous;
      return { success: false, message: saved.message, settings: this.get() };
    }
    return { success: true, settings: this.get() };
  }

  private save(): { success: boolean; message?: string } {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ ...this.settings, version: SETTINGS_VERSION }, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
      return { success: true };
    } catch (err: any) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // ignore cleanup failure
      }
      return { success: false, message: `Could not save settings: ${err?.message || err}` };
    }
  }

  private moveAside(): string | undefined {
    const backup = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(this.filePath, backup);
      return backup;
    } catch {
      return undefined;
    }
  }
}
export * from './apply';
