import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsStore, sanitizeSettings, MAX_ALIAS_LENGTH } from '../../modules/settings_store';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

export async function runSettingsStoreUnitTests(assert: AssertFn, assertEqual: AssertEqualFn): Promise<void> {
  console.log('\nTest Group: Settings store (persistence, validation, corrupt-file recovery)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-settings-'));
  const file = path.join(dir, 'nested', 'settings.json');

  try {
    // Missing file -> defaults, nothing written yet
    const fresh = new SettingsStore(file);
    assertEqual(fresh.load().status, 'missing', 'Missing file loads as "missing"');
    assertEqual(fresh.get().qualityPreset, 'balanced', 'Default quality preset is balanced');
    assertEqual(fresh.get().inputMode, 'auto', 'Default input mode is auto');

    // Round trip across instances (simulated restart)
    assert(fresh.update({ qualityPreset: 'battery_saver', inputMode: 'uhid' }).success, 'Valid update succeeds');
    assert(fresh.setAlias('kjizrsgekfsglvgi', '  Redmi Note  ').success, 'Valid alias saved');
    const reopened = new SettingsStore(file);
    assertEqual(reopened.load().status, 'loaded', 'Saved file reloads cleanly');
    assertEqual(reopened.get().qualityPreset, 'battery_saver', 'Quality preset survives restart');
    assertEqual(reopened.get().inputMode, 'uhid', 'Input mode survives restart');
    assertEqual(reopened.get().aliases['kjizrsgekfsglvgi'], 'Redmi Note', 'Alias survives restart (trimmed)');
    assert(!fs.readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp')), 'Atomic write leaves no temp file');

    // Validation rejects bad input without changing stored values
    assert(!reopened.update({ qualityPreset: 'max' }).success, 'Unknown quality preset rejected');
    assert(!reopened.update({ inputMode: 'aoa', qualityPreset: 'ultra' }).success, 'Update with one invalid field is rejected as a whole');
    assertEqual(reopened.get().qualityPreset, 'battery_saver', 'Rejected update leaves preset unchanged');
    assert(!reopened.setAlias('bad;serial', 'x').success, 'Alias for invalid serial rejected');
    assert(!reopened.setAlias('kjizrsgekfsglvgi', 'x'.repeat(MAX_ALIAS_LENGTH + 1)).success, 'Over-long alias rejected');
    assert(!reopened.setAlias('kjizrsgekfsglvgi', 'line\nbreak').success, 'Alias with control characters rejected');
    assert(!reopened.setAlias('kjizrsgekfsglvgi', 42).success, 'Non-string alias rejected');
    assert(reopened.setAlias('kjizrsgekfsglvgi', '').success, 'Empty alias clears it');
    assertEqual(new SettingsStore(file).get().aliases['kjizrsgekfsglvgi'], undefined, 'Fresh instance before load has defaults');
    const afterClear = new SettingsStore(file);
    afterClear.load();
    assertEqual(afterClear.get().aliases['kjizrsgekfsglvgi'], undefined, 'Cleared alias stays cleared after restart');

    // Partially invalid file -> valid fields kept, invalid ones reset, file repaired
    fs.writeFileSync(file, JSON.stringify({ version: 1, qualityPreset: 'ultra', inputMode: 'telepathy', aliases: { good: 'Phone', 'bad serial': 'x', other: 7 } }));
    const partial = new SettingsStore(file);
    const partialRes = partial.load();
    assertEqual(partialRes.status, 'repaired', 'Partially invalid file is repaired');
    assertEqual(partial.get().qualityPreset, 'ultra', 'Valid preset kept from partially invalid file');
    assertEqual(partial.get().inputMode, 'auto', 'Invalid input mode reset to default');
    assertEqual(JSON.stringify(partial.get().aliases), JSON.stringify({ good: 'Phone' }), 'Only valid aliases kept');
    assertEqual(JSON.parse(fs.readFileSync(file, 'utf8')).inputMode, 'auto', 'Repaired values written back to disk');

    // Corrupt JSON -> defaults, original moved aside (never silently overwritten)
    fs.writeFileSync(file, '{"qualityPreset": "ultra", ');
    const corrupt = new SettingsStore(file);
    const corruptRes = corrupt.load();
    assertEqual(corruptRes.status, 'corrupt', 'Truncated JSON detected as corrupt');
    assert(!!corruptRes.backupPath && fs.existsSync(corruptRes.backupPath), 'Corrupt file preserved as backup');
    assertEqual(fs.readFileSync(corruptRes.backupPath!, 'utf8'), '{"qualityPreset": "ultra", ', 'Backup keeps the original bytes');
    assertEqual(corrupt.get().qualityPreset, 'balanced', 'Corrupt file falls back to defaults');
    assert(corrupt.update({ inputMode: 'sdk' }).success, 'Store is writable again after corruption');
    const recovered = new SettingsStore(file);
    assertEqual(recovered.load().status, 'loaded', 'New file loads cleanly after recovery');

    // Wrong top-level shape and BOM handling
    fs.writeFileSync(file, '[1,2,3]');
    assertEqual(new SettingsStore(file).load().status, 'corrupt', 'Array root treated as corrupt');
    fs.writeFileSync(file, '﻿' + JSON.stringify({ inputMode: 'uhid' }));
    const bom = new SettingsStore(file);
    assertEqual(bom.load().status, 'loaded', 'UTF-8 BOM tolerated');
    assertEqual(bom.get().inputMode, 'uhid', 'Value read from BOM-prefixed file');

    // Prototype keys in aliases are not treated as data
    const proto = sanitizeSettings(JSON.parse('{"aliases": {"__proto__": "x", "constructor": "y"}}'));
    assertEqual(Object.prototype.hasOwnProperty.call(proto.settings.aliases, '__proto__'), false, '__proto__ alias key ignored');

    // Unwritable location -> failure reported, in-memory state unchanged
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const unwritable = new SettingsStore(path.join(blocker, 'settings.json'));
    unwritable.load();
    const writeRes = unwritable.update({ qualityPreset: 'ultra' });
    assert(!writeRes.success && /Could not save settings/.test(writeRes.message || ''), 'Write failure reported to caller');
    assertEqual(unwritable.get().qualityPreset, 'balanced', 'Failed write does not change in-memory settings');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
