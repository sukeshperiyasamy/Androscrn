import { runNativeCliTests } from './native-cli.test';
import { installLaunchGuard, assertNoBrowserLaunches } from './launch-guard';
import { runPathEnvironmentTests, snapshotRealUserPath, assertRealUserPathUnchanged } from './path-env.test';
import { runDiscoveryTests } from './discovery.test';
import { runWirelessValidationTests } from './wireless-validation.test';
import { runDocumentTests } from './document.test';
import { runDocumentPrivacyTests } from './document-privacy.test';
import { runStylingTests } from './styling.test';

/**
 * Runs one unit-test group on its own: `node dist/tests/unit/targeted.js <native|path|discovery|document|styling>`.
 * Exit code is 1 on any failure, 0 otherwise. Skips are counted and printed, never reported as passes.
 */
let total = 0;
let passed = 0;
let failed = 0;
const skipped: string[] = [];

function assert(condition: boolean, name: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

function assertEqual<T>(actual: T, expected: T, name: string) {
  assert(actual === expected, `${name} (Expected: ${expected}, Got: ${actual})`);
}

function skip(name: string, reason: string) {
  skipped.push(`${name} (${reason})`);
  console.log(`  - SKIP: ${name} - ${reason}`);
}

async function main() {
  // Block (and record) any browser/URL launch for the whole run; asserted at the end.
  installLaunchGuard();
  const group = process.argv[2];
  const before = snapshotRealUserPath();

  switch (group) {
    case 'native':
      await runNativeCliTests(assert, assertEqual, skip);
      break;
    case 'path':
      await runPathEnvironmentTests(assert, assertEqual, skip);
      assertRealUserPathUnchanged(before, assert, skip);
      break;
    case 'discovery':
      await runDiscoveryTests(assert, assertEqual);
      await runWirelessValidationTests(assert, assertEqual);
      break;
    case 'styling':
      runStylingTests(assert, skip);
      break;
    case 'document':
      await runDocumentTests(assert, assertEqual, skip);
      await runDocumentPrivacyTests(assert);
      break;
    default:
      console.error('Usage: node dist/tests/unit/targeted.js <native|path|discovery|document>');
      process.exit(2);
  }

  assertNoBrowserLaunches(assert);
  console.log(`\nTARGETED RESULTS (${group}): ${passed}/${total} Passed (${failed} Failed, ${skipped.length} Skipped)`);
  for (const s of skipped) console.log(`  SKIPPED: ${s}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Targeted test execution error:', err);
  process.exit(1);
});
