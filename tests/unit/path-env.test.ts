import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  AndroScrnCli,
  MemoryUserPathStore,
  PowerShellUserPathStore,
  normalizePathEntry,
  parsePathList,
  addPathEntry,
  removePathEntry,
  pathListContains
} from '../../modules/cli';

type AssertFn = (condition: boolean, name: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, name: string) => void;
type SkipFn = (name: string, reason: string) => void;

/**
 * Read-only snapshot of the developer's real persistent User PATH. It is used purely as a guard to prove the
 * suite never changes it; nothing in these tests writes to it.
 */
export function snapshotRealUserPath(): { ok: boolean; value: string | null; error?: string } {
  if (os.platform() !== 'win32') return { ok: false, value: null, error: 'not a Windows host' };
  try {
    return { ok: true, value: new PowerShellUserPathStore(20000).read() };
  } catch (err: any) {
    return { ok: false, value: null, error: err.message };
  }
}

export function assertRealUserPathUnchanged(
  before: { ok: boolean; value: string | null; error?: string },
  assert: AssertFn,
  skip: SkipFn
) {
  console.log('\nTest Group: Real User PATH Isolation Guard');
  if (!before.ok) {
    skip('Real User PATH unchanged by the test suite', `could not snapshot real User PATH (${before.error})`);
    return;
  }
  const after = snapshotRealUserPath();
  if (!after.ok) {
    skip('Real User PATH unchanged by the test suite', `could not re-read real User PATH (${after.error})`);
    return;
  }
  assert(after.value === before.value, 'Real persistent User PATH is byte-for-byte unchanged after the whole unit suite');
}

export async function runPathEnvironmentTests(assert: AssertFn, assertEqual: AssertEqualFn, skip: SkipFn = () => {}) {
  console.log('\nTest Group: User PATH Logic (pure functions, injected persistence)');

  // ---- normalization ----
  assertEqual(normalizePathEntry('  C:\\Tools\\AndroScrn\\  '), 'c:\\tools\\androscrn', 'Normalization trims, lowercases and drops trailing separator');
  assertEqual(normalizePathEntry('"C:\\Program Files\\AndroScrn"'), 'c:\\program files\\androscrn', 'Normalization strips surrounding quotes');
  assertEqual(normalizePathEntry('C:/Tools/AndroScrn'), 'c:\\tools\\androscrn', 'Normalization converts forward slashes');
  assertEqual(normalizePathEntry('C:\\\\Tools\\\\AndroScrn'), 'c:\\tools\\androscrn', 'Normalization collapses repeated separators');
  assertEqual(normalizePathEntry('C:\\'), 'c:\\', 'Drive root keeps its trailing separator');
  assertEqual(normalizePathEntry('\\\\Server\\Share\\Tools\\'), '\\\\server\\share\\tools', 'UNC paths keep their leading double separator');
  assertEqual(normalizePathEntry(''), '', 'Empty entry normalizes to empty');

  // ---- parsing: empty, missing, malformed ----
  assertEqual(parsePathList(null).length, 0, 'Missing PATH parses to no entries');
  assertEqual(parsePathList(undefined).length, 0, 'Undefined PATH parses to no entries');
  assertEqual(parsePathList('').length, 0, 'Empty PATH parses to no entries');
  assertEqual(parsePathList(';;  ;').length, 0, 'Separator-only PATH parses to no entries');
  assertEqual(parsePathList(' C:\\A ; ; D:\\B;').join('|'), 'C:\\A|D:\\B', 'Whitespace and empty segments are dropped');
  assertEqual(parsePathList('"C:\\Broken;D:\\Ok').join('|'), '"C:\\Broken|D:\\Ok', 'Malformed quoted entries are preserved verbatim');

  // ---- add ----
  const dir = 'C:\\Users\\Test User\\AndroScrn Portable';
  const addEmpty = addPathEntry('', dir);
  assert(addEmpty.changed && addEmpty.value === dir, 'Adding to an empty PATH yields just the directory');
  const addNull = addPathEntry(null, dir);
  assert(addNull.changed && addNull.value === dir, 'Adding when PATH is unset yields just the directory');
  const existing = 'C:\\Windows\\System32;C:\\Program Files\\Node.JS;D:\\Mixed Case\\Bin';
  const added = addPathEntry(existing, dir);
  assertEqual(added.value, `${existing};${dir}`, 'Adding preserves unrelated entries exactly (order and case)');
  assert(!addPathEntry(added.value, dir).changed, 'Adding the same directory again is a no-op (idempotent)');
  assertEqual(addPathEntry(added.value, dir).value, added.value, 'Idempotent add leaves the value unchanged');
  assert(!addPathEntry(added.value, dir.toUpperCase()).changed, 'Duplicate detection is case-insensitive');
  assert(!addPathEntry(added.value, `${dir}\\`).changed, 'Duplicate detection ignores a trailing separator');
  assert(!addPathEntry(added.value, `"${dir}"`).changed, 'Duplicate detection ignores surrounding quotes');
  assert(!addPathEntry(added.value, dir.replace(/\\/g, '/')).changed, 'Duplicate detection ignores slash direction');
  assert(addPathEntry(added.value, `${dir}2`).changed, 'A directory that merely shares a prefix is not treated as a duplicate');
  assert(!addPathEntry(existing, '').changed && !addPathEntry(existing, '   ').changed, 'Empty targets are never added');
  assertEqual(addPathEntry('C:\\A;;C:\\B;', 'C:\\C').value, 'C:\\A;C:\\B;C:\\C', 'Adding also tidies empty segments');

  // ---- remove ----
  const removed = removePathEntry(added.value, dir);
  assert(removed.changed && removed.removed === 1, 'Removing deletes exactly the intended entry');
  assertEqual(removed.value, existing, 'Removal preserves every unrelated entry exactly');
  assert(!removePathEntry(removed.value, dir).changed, 'Removing again is a no-op (idempotent)');
  const dupes = `${dir};C:\\Other;${dir.toLowerCase()}\\;"${dir}"`;
  const removedDupes = removePathEntry(dupes, dir);
  assertEqual(removedDupes.removed, 3, 'Removal deletes every duplicate spelling of the target');
  assertEqual(removedDupes.value, 'C:\\Other', 'Only the unrelated entry remains after removing duplicates');
  const similar = 'C:\\Tools\\AndroScrn;C:\\Tools\\AndroScrn2;C:\\Tools\\AndroScrn Test;C:\\Tools';
  assertEqual(removePathEntry(similar, 'C:\\Tools\\AndroScrn').value, 'C:\\Tools\\AndroScrn2;C:\\Tools\\AndroScrn Test;C:\\Tools', 'Removal never touches prefix-similar siblings or parents');
  assertEqual(removePathEntry(dir, dir).value, '', 'Removing the only entry leaves an empty PATH');
  assert(!removePathEntry('', dir).changed && !removePathEntry(null, dir).changed, 'Removing from empty or missing PATH is a no-op');
  assert(!removePathEntry(existing, '').changed, 'Removing an empty target is a no-op');
  assert(pathListContains(parsePathList(added.value), dir) && !pathListContains(parsePathList(existing), dir), 'pathListContains reflects membership');

  // ---- optional: the real persistence layer, against a DISPOSABLE variable (never PATH) ----
  console.log('\nTest Group: Real Persistence Layer (disposable variable)');
  if (process.env.ANDROSCRN_TEST_REAL_ENV === '1' && os.platform() === 'win32') {
    const varName = `ANDROSCRN_TEST_PATH_${process.pid}_${Date.now()}`;
    const real = new PowerShellUserPathStore(30000, 90000, varName);
    const tricky = 'C:\\Dir With Spaces;C:\\100%PATH%\\x;C:\\Tom\'s & Co;D:\\$env\\ok';
    try {
      assertEqual(real.read(), null, 'Disposable variable starts unset');
      real.write(tricky);
      assertEqual(real.read(), tricky, 'Round-trip read returns exactly what was written (spaces, %PATH%, quotes, ampersand, $ intact)');
    } finally {
      try {
        real.deleteVariable();
      } catch {
        // cleanup failure is reported below
      }
    }
    assertEqual(real.read(), null, 'Disposable variable is deleted afterwards');
  } else {
    skip('Real PowerShell persistence round-trip', 'opt-in: set ANDROSCRN_TEST_REAL_ENV=1 (writes then deletes a disposable User variable, ~30 s; never touches PATH)');
  }

  // ---- CLI behavior through an injected store, using real temp directories with spaces ----
  console.log('\nTest Group: setup-path / remove-path via Injected Store');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn path test '));
  const spaced = path.join(base, 'Dir With Spaces');
  const other = path.join(base, 'Dir With Spaces Two');
  fs.mkdirSync(spaced);
  fs.mkdirSync(other);
  const appDir = path.resolve(__dirname, '../../..');

  try {
    const store = new MemoryUserPathStore(null);
    const cli = new AndroScrnCli({ appDir, pathStore: store });

    const first = cli.handleSetupPath([spaced]);
    assertEqual(first.exitCode, 0, 'setup-path succeeds on an unset PATH with a folder containing spaces');
    assert(first.stdout.includes('Successfully added to User PATH'), 'setup-path reports success');
    assertEqual(store.value, spaced, 'Store receives the exact path including spaces (no extra quoting)');
    assertEqual(store.writes, 1, 'First setup-path performs exactly one write');

    const again = cli.handleSetupPath([spaced]);
    assertEqual(again.exitCode, 0, 'Repeated setup-path exits 0');
    assert(again.stdout.includes('already present in User PATH'), 'Repeated setup-path reports duplicate');
    assertEqual(store.writes, 1, 'Repeated setup-path performs no additional write (idempotent)');

    const upper = cli.handleSetupPath([spaced.toUpperCase()]);
    assert(upper.stdout.includes('already present'), 'setup-path treats a different-case spelling as the same folder');
    assertEqual(store.writes, 1, 'Case-variant setup-path performs no write');

    const preSeed = new MemoryUserPathStore('C:\\Windows\\System32;"C:\\Broken;D:\\Keep Me');
    const cli2 = new AndroScrnCli({ appDir, pathStore: preSeed });
    cli2.handleSetupPath([spaced]);
    cli2.handleSetupPath([other]);
    assertEqual(preSeed.value, `C:\\Windows\\System32;"C:\\Broken;D:\\Keep Me;${spaced};${other}`, 'setup-path preserves pre-existing and malformed entries while appending');

    const rem = cli2.handleRemovePath([spaced]);
    assertEqual(rem.exitCode, 0, 'remove-path succeeds');
    assert(rem.stdout.includes('Successfully removed from User PATH'), 'remove-path reports success');
    assertEqual(preSeed.value, `C:\\Windows\\System32;"C:\\Broken;D:\\Keep Me;${other}`, 'remove-path removes only the intended entry (similar sibling kept)');
    const writesAfterRemove = preSeed.writes;
    const remAgain = cli2.handleRemovePath([spaced]);
    assertEqual(remAgain.exitCode, 0, 'Repeated remove-path exits 0');
    assert(remAgain.stdout.includes('not found in User PATH'), 'Repeated remove-path reports not found');
    assertEqual(preSeed.writes, writesAfterRemove, 'Repeated remove-path performs no write (idempotent)');

    const emptyStore = new MemoryUserPathStore('');
    const cli3 = new AndroScrnCli({ appDir, pathStore: emptyStore });
    assertEqual(cli3.handleRemovePath([spaced]).exitCode, 0, 'remove-path on an empty PATH is a clean no-op');
    assertEqual(emptyStore.writes, 0, 'remove-path on an empty PATH does not write');

    const defaultStore = new MemoryUserPathStore('C:\\X');
    const cli4 = new AndroScrnCli({ appDir, pathStore: defaultStore });
    assertEqual(cli4.handleSetupPath([]).exitCode, 0, 'setup-path with no argument targets the application directory');
    assert(defaultStore.value === `C:\\X;${appDir}`, 'Default target is the application directory, written to the injected store only');
    assertEqual(cli4.handleRemovePath([]).exitCode, 0, 'remove-path with no argument removes the application directory');
    assertEqual(defaultStore.value, 'C:\\X', 'Default removal restores the original PATH');

    // Failure handling never corrupts PATH
    const failRead = new MemoryUserPathStore('C:\\Keep', false, true);
    const readRes = new AndroScrnCli({ appDir, pathStore: failRead }).handleSetupPath([spaced]);
    assertEqual(readRes.exitCode, 1, 'setup-path fails when the PATH cannot be read');
    assert(failRead.writes === 0 && failRead.value === 'C:\\Keep', 'A failed read never triggers a write (existing PATH cannot be overwritten)');
    const failWrite = new MemoryUserPathStore('C:\\Keep', true, false);
    const writeRes = new AndroScrnCli({ appDir, pathStore: failWrite }).handleSetupPath([spaced]);
    assertEqual(writeRes.exitCode, 1, 'setup-path reports failure when the write fails');
    assert(writeRes.stderr.includes('Failed to update User PATH'), 'Write failure explains what went wrong');
    assertEqual(failWrite.value, 'C:\\Keep', 'Failed write leaves the stored PATH unchanged');
    const remFail = new AndroScrnCli({ appDir, pathStore: new MemoryUserPathStore('C:\\Keep', false, true) }).handleRemovePath([spaced]);
    assertEqual(remFail.exitCode, 1, 'remove-path fails cleanly when the PATH cannot be read');

    const missing = cli.handleSetupPath([path.join(base, 'does not exist')]);
    assertEqual(missing.exitCode, 1, 'setup-path rejects a directory that does not exist');
    assertEqual(store.writes, 1, 'Rejected setup-path performs no write');
  } finally {
    // Remove only the directories this test created.
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of the test's own temp folder
    }
  }
}
