/**
 * Copies the production dependency closure of the given packages from ./node_modules into a target
 * node_modules folder. Used by the portable packager for modules that cannot be bundled by esbuild because they
 * load worker scripts and WebAssembly files at runtime (tesseract.js).
 *
 * Usage: node copy-runtime-deps.js <targetNodeModules> <package> [<package> ...]
 */
const fs = require('fs');
const path = require('path');

const [target, ...roots] = process.argv.slice(2);
if (!target || roots.length === 0) {
  console.error('Usage: node copy-runtime-deps.js <targetNodeModules> <package> [<package> ...]');
  process.exit(2);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const nodeModules = path.join(repoRoot, 'node_modules');

function packageDir(name, from) {
  const candidates = [path.join(from, 'node_modules', name), path.join(nodeModules, name)];
  for (const c of candidates) if (fs.existsSync(path.join(c, 'package.json'))) return c;
  throw new Error(`Cannot locate package "${name}" (required by ${from})`);
}

// Per-package copy filters keep large optional data out of the portable build.
const filters = {
  '@tesseract.js-data/eng': rel => rel === 'package.json' || rel === 'index.js' || rel.startsWith('4.0.0_best_int'),
};

function copyDir(src, dst, include) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (include && !include(entry.name + '/')) continue;
      copyDir(from, to, include && (rel => include(entry.name + '/' + rel)));
    } else if (!include || include(entry.name)) {
      fs.copyFileSync(from, to);
    }
  }
}

const seen = new Set();
let copied = 0;
function visit(name, from) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = packageDir(name, from);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const dst = path.join(target, name);
  copyDir(dir, dst, filters[name]);
  copied++;
  for (const dep of Object.keys(pkg.dependencies || {})) visit(dep, dir);
}

for (const r of roots) visit(r, repoRoot);
console.log(`Copied ${copied} packages into ${target}: ${[...seen].join(', ')}`);
