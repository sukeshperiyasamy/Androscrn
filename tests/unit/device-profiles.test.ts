import fs from 'fs';
import os from 'os';
import path from 'path';
import { SettingsStore, MAX_PROFILES, ProfileSettings, DeviceProfile, planProfileApplication } from '../../modules/settings_store';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

const full = (over: Partial<ProfileSettings> = {}): ProfileSettings => ({
  qualityPreset: 'balanced',
  inputMode: 'uhid',
  turnScreenOff: false,
  stayAwake: true,
  alwaysOnTop: false,
  captureOrientation: '0',
  recordSession: false,
  playAudio: true,
  clipboardSync: false,
  ...over
});

export async function runDeviceProfileUnitTests(assert: AssertFn, assertEqual: AssertEqualFn): Promise<void> {
  console.log('\nTest Group: Device profiles and clipboard preference (settings store)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-profiles-'));
  const file = path.join(dir, 'settings.json');
  try {
    const store = new SettingsStore(file);
    store.load();
    assertEqual(store.get().clipboardSync, false, 'Clipboard sync is off by default (opt-in)');
    assertEqual(store.listProfiles().length, 0, 'No profiles by default');

    // Create
    const a = store.saveProfile({ name: '  Gaming  ', settings: full({ qualityPreset: 'ultra' }) });
    assert(a.success && !!a.profile && /^p_[0-9a-f]{16}$/.test(a.profile.id), 'Profile created with a generated id');
    assertEqual(a.profile!.name, 'Gaming', 'Profile name trimmed');
    const b = store.saveProfile({ name: 'Work phone', deviceSerial: 'kjizrsgekfsglvgi', deviceLabel: '21091116I', settings: full() });
    assert(b.success && b.profile!.deviceSerial === 'kjizrsgekfsglvgi', 'Device-specific profile keeps its device');

    // Persistence across restart
    const reopened = new SettingsStore(file);
    assertEqual(reopened.load().status, 'loaded', 'Profiles file reloads cleanly');
    assertEqual(reopened.listProfiles().map(p => p.name).join('|'), 'Gaming|Work phone', 'Profiles survive restart in order');
    assertEqual(reopened.listProfiles()[0].settings.qualityPreset, 'ultra', 'Profile settings survive restart');
    assertEqual(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2, 'File is written as version 2');

    // Update / rename
    const renamed = reopened.saveProfile({ id: a.profile!.id, name: 'Gaming (fast)', settings: full({ qualityPreset: 'high_performance' }) });
    assert(renamed.success, 'Profile can be renamed and edited');
    assertEqual(reopened.listProfiles()[0].settings.qualityPreset, 'high_performance', 'Edited setting stored');
    assertEqual(reopened.listProfiles()[0].createdAt, a.profile!.createdAt, 'Edit keeps the creation time');
    assert(!reopened.saveProfile({ id: 'p_0000000000000000', name: 'Ghost', settings: full() }).success, 'Editing a missing profile is refused');

    // Duplicate names
    assert(!reopened.saveProfile({ name: 'work PHONE', settings: full() }).success, 'Duplicate name (case-insensitive) is refused');

    // Invalid input
    assert(!reopened.saveProfile({ name: '', settings: full() }).success, 'Empty name refused');
    assert(!reopened.saveProfile({ name: 'x'.repeat(49), settings: full() }).success, 'Over-long name refused');
    assert(!reopened.saveProfile({ name: 'Bad', settings: full({ qualityPreset: 'max' as any }) }).success, 'Unsupported preset refused');
    const unk = reopened.saveProfile({ name: 'Flags', settings: { ...full(), extraArgs: '--shell rm' } as any });
    assert(!unk.success && /extraArgs/.test(unk.message || ''), 'Unknown fields (e.g. raw scrcpy arguments) are refused and named');
    assert(!reopened.saveProfile({ name: 'Partial', settings: { qualityPreset: 'ultra' } }).success, 'Incomplete settings refused');
    assert(!reopened.saveProfile({ name: 'Bad device', deviceSerial: 'a;rm -rf', settings: full() }).success, 'Invalid device serial refused');

    // Clipboard preference
    assert(reopened.update({ clipboardSync: true }).success, 'Clipboard sync can be turned on');
    assert(!reopened.update({ clipboardSync: 'yes' }).success, 'Non-boolean clipboard setting refused');
    assertEqual(new SettingsStore(file).load() && (() => { const s = new SettingsStore(file); s.load(); return s.get().clipboardSync; })(), true, 'Clipboard preference survives restart');

    // Unrelated settings preserved by profile operations
    reopened.setAlias('kjizrsgekfsglvgi', 'My Redmi');
    reopened.update({ qualityPreset: 'battery_saver' });
    reopened.saveProfile({ name: 'Third', settings: full() });
    assertEqual(reopened.get().aliases['kjizrsgekfsglvgi'], 'My Redmi', 'Saving a profile keeps aliases');
    assertEqual(reopened.get().qualityPreset, 'battery_saver', 'Saving a profile keeps the current session settings');

    // Delete
    const third = reopened.listProfiles().find(p => p.name === 'Third')!;
    assert(reopened.deleteProfile(third.id).success, 'Profile deleted');
    assert(!reopened.deleteProfile(third.id).success, 'Deleting twice is reported');
    assertEqual(reopened.listProfiles().length, 2, 'Two profiles remain');

    // Limit
    const many = new SettingsStore(path.join(dir, 'many.json'));
    many.load();
    for (let i = 0; i < MAX_PROFILES; i++) many.saveProfile({ name: `P${i}`, settings: full() });
    assert(!many.saveProfile({ name: 'one too many', settings: full() }).success, `At most ${MAX_PROFILES} profiles`);

    // Migration from version 1 (no clipboardSync, no profiles)
    const v1 = path.join(dir, 'v1.json');
    fs.writeFileSync(v1, JSON.stringify({ version: 1, aliases: { ABC: 'Old' }, qualityPreset: 'ultra', inputMode: 'sdk' }));
    const mig = new SettingsStore(v1);
    assertEqual(mig.load().status, 'loaded', 'Version 1 file loads without errors');
    assert(mig.get().qualityPreset === 'ultra' && mig.get().aliases.ABC === 'Old', 'Version 1 values are kept');
    assert(mig.get().clipboardSync === false && mig.get().profiles.length === 0, 'Version 1 gets the new defaults');

    // Malformed profile data: bad entries dropped, the rest kept, file repaired
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({
      version: 2,
      qualityPreset: 'balanced',
      profiles: [
        { id: 'p_1111111111111111', name: 'Good', settings: full(), createdAt: 1, updatedAt: 1 },
        { id: 'not-an-id', name: 'Bad id', settings: full() },
        { id: 'p_2222222222222222', name: 'good', settings: full() },
        { id: 'p_3333333333333333', name: 'Weird values', settings: { ...full(), inputMode: 'telepathy', hack: 1 } },
        'garbage'
      ]
    }));
    const badStore = new SettingsStore(bad);
    const badRes = badStore.load();
    assertEqual(badRes.status, 'repaired', 'Malformed profiles are repaired, not fatal');
    assertEqual(badStore.listProfiles().map(p => p.name).join('|'), 'Good|Weird values', 'Valid profiles kept; bad id, duplicate name and garbage dropped');
    const weird = badStore.listProfiles()[1];
    assert(weird.settings.inputMode === undefined && weird.settings.qualityPreset === 'balanced', 'Invalid setting inside a profile dropped, valid ones kept');
    assert(!('hack' in weird.settings), 'Unknown setting inside a stored profile is not loaded');

    const notArray = path.join(dir, 'notarray.json');
    fs.writeFileSync(notArray, JSON.stringify({ profiles: { a: 1 }, inputMode: 'uhid' }));
    const na = new SettingsStore(notArray);
    na.load();
    assert(na.listProfiles().length === 0 && na.get().inputMode === 'uhid', 'Non-array profiles field dropped, other settings kept');

    // Storage unavailable
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    const ro = new SettingsStore(path.join(blocker, 'settings.json'));
    ro.load();
    const roSave = ro.saveProfile({ name: 'Nowhere', settings: full() });
    assert(!roSave.success && /Could not save/.test(roSave.message || ''), 'Unwritable storage is reported');
    assertEqual(ro.listProfiles().length, 0, 'Failed save does not leave a phantom profile in memory');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Applying a profile (pure planning: nothing is started or changed by it)
  {
    const profile = (over: Partial<DeviceProfile> = {}, settings: Partial<ProfileSettings> = {}): DeviceProfile => ({
      id: 'p_aaaaaaaaaaaaaaaa', name: 'P', settings: { ...full(), ...settings }, createdAt: 1, updatedAt: 1, ...over
    });
    const ctx = (over: any = {}) => ({ selectedSerial: 'PHONE1', mirroring: false, current: full({ inputMode: 'auto' }), ...over });

    const none = planProfileApplication(profile(), ctx({ selectedSerial: '' }));
    assert(!none.allowed && /select a phone/i.test(none.reason || ''), 'No phone selected: applying is refused with guidance');

    const plan = planProfileApplication(profile({}, { qualityPreset: 'ultra' }), ctx());
    assertEqual(JSON.stringify(plan.changes), JSON.stringify({ qualityPreset: 'ultra', inputMode: 'uhid' }), 'Only settings that differ are changed');
    assert(plan.allowed && !plan.needsSessionRestart && !plan.needsDeviceConfirmation, 'Idle phone: no restart or confirmation needed');

    const running = planProfileApplication(profile({}, { qualityPreset: 'ultra' }), ctx({ mirroring: true }));
    assert(running.needsSessionRestart, 'Changing settings during mirroring needs an explicit restart');
    const same = planProfileApplication(profile(), ctx({ mirroring: true, current: full() }));
    assert(!same.needsSessionRestart && Object.keys(same.changes).length === 0, 'Identical settings during mirroring change nothing and need no restart');

    const other = planProfileApplication(profile({ deviceSerial: 'OTHER' }), ctx());
    assert(other.needsDeviceConfirmation, 'A profile made for another phone needs confirmation');
    const mine = planProfileApplication(profile({ deviceSerial: 'PHONE1' }), ctx());
    assert(!mine.needsDeviceConfirmation, 'A profile for this phone needs no confirmation');

    const partial = planProfileApplication({ ...profile(), settings: { qualityPreset: 'ultra' } }, ctx());
    assert(partial.skipped.includes('inputMode') && partial.changes.inputMode === undefined, 'Missing settings are skipped and left as they are');
    assert(!('qualityPreset' in planProfileApplication(profile({}, { qualityPreset: 'balanced' }), ctx()).changes), 'Unchanged settings are not re-applied');
  }
}
