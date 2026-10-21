#!/usr/bin/env node
/**
 * Builds the Android companion APK from android/companion and stages it for the desktop app at
 * bin/companion/androscrn-companion.apk with a metadata file (version, protocol, SHA-256, source commit).
 *
 * The staged APK is always the output of this build; the script never copies an older artifact.
 *
 * Usage: node scripts/build-companion.js [--release]
 * Requires: Android SDK (local.properties or ANDROID_HOME) and JDK 17+ (JAVA_HOME, or Android Studio's bundled JBR).
 */
const { spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const projectDir = path.join(root, 'android', 'companion');
const outDir = path.join(root, 'bin', 'companion');
const release = process.argv.includes('--release');
const variant = release ? 'release' : 'debug';
const PROTOCOL_VERSION = 2;

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin'))) return process.env.JAVA_HOME;
  const candidates = [
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Android\\Android Studio\\jre',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'bin')));
}

const javaHome = findJavaHome();
if (!javaHome) {
  console.error('JDK not found. Set JAVA_HOME to a JDK 17+ (Android Studio ships one in <install>/jbr).');
  process.exit(1);
}

const gradlew = path.join(projectDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const task = release ? 'assembleRelease' : 'assembleDebug';
console.log(`Building companion (${variant}) with JAVA_HOME=${javaHome}`);
const build = spawnSync(gradlew, ['--no-daemon', task, 'testDebugUnitTest'], {
  cwd: projectDir,
  env: { ...process.env, JAVA_HOME: javaHome },
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (build.status !== 0) {
  console.error(`Gradle ${task} failed (exit ${build.status}).`);
  process.exit(build.status || 1);
}

const apkDir = path.join(projectDir, 'app', 'build', 'outputs', 'apk', variant);
const meta = JSON.parse(fs.readFileSync(path.join(apkDir, 'output-metadata.json'), 'utf8'));
const element = meta.elements && meta.elements[0];
if (!element) {
  console.error('Gradle output-metadata.json has no APK element.');
  process.exit(1);
}
const apkPath = path.join(apkDir, element.outputFile);
if (!fs.existsSync(apkPath)) {
  console.error(`Built APK not found at ${apkPath}` + (release ? ' (release builds need a signing config; see docs/companion/DEVELOPMENT.md).' : ''));
  process.exit(1);
}

const buf = fs.readFileSync(apkPath);
let sourceCommit = null;
try {
  sourceCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
} catch {
  // not a git checkout
}

fs.mkdirSync(outDir, { recursive: true });
const stagedApk = path.join(outDir, 'androscrn-companion.apk');
fs.copyFileSync(apkPath, stagedApk);
const info = {
  packageName: meta.applicationId,
  versionCode: element.versionCode,
  versionName: element.versionName,
  protocolVersion: PROTOCOL_VERSION,
  variant,
  sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  sizeBytes: buf.length,
  builtAt: new Date().toISOString(),
  sourceCommit
};
fs.writeFileSync(path.join(outDir, 'androscrn-companion.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`Staged ${stagedApk}`);
console.log(JSON.stringify(info, null, 2));
