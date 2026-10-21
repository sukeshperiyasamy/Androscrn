import fs from 'fs';
import path from 'path';
import { SecurityValidator } from '../security';

export type QualityPreset = 'ultra' | 'high_performance' | 'balanced' | 'battery_saver';
export type InputMode = 'auto' | 'sdk' | 'uhid';

export interface AppSettings {
  version: 1;
  aliases: Record<string, string>;
  qualityPreset: QualityPreset;
  inputMode: InputMode;
}

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
  return { version: 1, aliases: {}, qualityPreset: 'balanced', inputMode: 'auto' };
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
    return { ...this.settings, aliases: { ...this.settings.aliases } };
  }

  /** Applies a partial preference update. Rejects the whole update if any field is invalid. */
  public update(patch: { qualityPreset?: unknown; inputMode?: unknown }): { success: boolean; message?: string; settings: AppSettings } {
    if (!patch || typeof patch !== 'object') {
      return { success: false, message: 'Invalid settings update.', settings: this.get() };
    }
    if ('qualityPreset' in patch && !isQualityPreset(patch.qualityPreset)) {
      return { success: false, message: 'Invalid quality preset.', settings: this.get() };
    }
    if ('inputMode' in patch && !isInputMode(patch.inputMode)) {
      return { success: false, message: 'Invalid input mode.', settings: this.get() };
    }
    const next = this.get();
    if (patch.qualityPreset !== undefined) next.qualityPreset = patch.qualityPreset as QualityPreset;
    if (patch.inputMode !== undefined) next.inputMode = patch.inputMode as InputMode;
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
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
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
