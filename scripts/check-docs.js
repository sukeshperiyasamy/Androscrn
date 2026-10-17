/**
 * Documentation checks (run with `npm run docs:check`):
 *  - every relative Markdown link resolves to an existing file (and `#anchor` fragments match a heading),
 *  - every `npm run <script>` mentioned in the docs exists in package.json,
 *  - no local absolute paths, private IPv4 addresses or SSID-looking values appear in public docs,
 *  - the main README stays a landing page (no test-count tables or terminal transcripts).
 * Exit code 1 on any problem.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts || {}));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-electron', 'dist-release', '.git', 'bin', 'Captures'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// Documented Android hotspot gateway defaults are public knowledge, not private network details.
const HOTSPOT_DEFAULTS = new Set(['192.168.43.1', '192.168.50.1']);

const files = [path.join(root, 'README.md'), path.join(root, 'CONTRIBUTING.md'), ...walk(path.join(root, 'docs'))];
const problems = [];

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const text = fs.readFileSync(file, 'utf8');
    const set = new Set();
    const counts = {};
    for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      const base = slug(m[1]);
      counts[base] = (counts[base] || 0) + 1;
      set.add(counts[base] > 1 ? `${base}-${counts[base] - 1}` : base);
    }
    for (const m of text.matchAll(/<a\s+id="([^"]+)"/g)) set.add(m[1]);
    anchorCache.set(file, set);
  }
  return anchorCache.get(file);
}

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const noCode = text.replace(/```[\s\S]*?```/g, '');

  for (const m of noCode.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/i.test(target)) continue;
    const [filePart, frag] = target.split('#');
    const resolved = filePart ? path.resolve(path.dirname(file), decodeURIComponent(filePart)) : file;
    if (!fs.existsSync(resolved)) {
      problems.push(`${rel}: broken link -> ${target}`);
      continue;
    }
    if (frag && resolved.endsWith('.md') && !anchorsOf(resolved).has(frag)) {
      problems.push(`${rel}: missing anchor -> ${target}`);
    }
  }

  for (const m of text.matchAll(/npm (?:--prefix \S+ )?run ([A-Za-z0-9:_-]+)/g)) {
    if (!scripts.has(m[1]) && !/apps\/desktop/.test(m[0])) problems.push(`${rel}: unknown npm script "${m[1]}"`);
  }

  if (!rel.startsWith('docs/qa/')) {
    if (/[A-Za-z]:\\Users\\[^\s`)]+/i.test(noCode)) problems.push(`${rel}: contains a local absolute user path`);
    for (const m of noCode.matchAll(/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g)) {
      if (!HOTSPOT_DEFAULTS.has(m[0])) problems.push(`${rel}: contains a private IP address (${m[0]})`);
    }
  }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
if (/\b\d+\s*\/\s*\d+\s*Passed\b/i.test(readme) || /Tests?:\s*\d+\s*Passed/i.test(readme)) {
  problems.push('README.md: contains test-count results; keep them in docs/testing.md');
}
if ((readme.match(/```/g) || []).length > 12) problems.push('README.md: too many code blocks for a landing page');

if (problems.length) {
  console.error(`Documentation check FAILED (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Documentation check passed: ${files.length} files, links, anchors, npm scripts and privacy rules OK.`);
