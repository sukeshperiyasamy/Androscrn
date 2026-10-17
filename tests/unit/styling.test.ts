import fs from 'fs';
import path from 'path';

type AssertFn = (condition: boolean, name: string) => void;
type SkipFn = (name: string, reason: string) => void;

/**
 * Regression checks for the desktop UI styling pipeline. The React components use Tailwind utility classes; if
 * Tailwind is not part of the build, those classes silently produce no CSS (this happened before Phase 11.1).
 * The artifact checks need `npm run build` output and are skipped, with a reason, when it is absent.
 */
export function runStylingTests(assert: AssertFn, skip: SkipFn) {
  console.log('\nTest Group: Desktop UI Styling Pipeline (Tailwind)');
  const root = path.resolve(__dirname, '../../..');
  const desktop = path.join(root, 'apps', 'desktop');

  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
  const dev = pkg.devDependencies || {};
  assert(!!dev.tailwindcss && !!dev.postcss && !!dev.autoprefixer, 'Tailwind, PostCSS and Autoprefixer are declared as desktop build dependencies');
  assert(fs.existsSync(path.join(desktop, 'tailwind.config.js')) && fs.existsSync(path.join(desktop, 'postcss.config.js')), 'Tailwind and PostCSS configuration files exist');
  const twConfig = fs.readFileSync(path.join(desktop, 'tailwind.config.js'), 'utf8');
  assert(/src\/\*\*\/\*\.\{ts,tsx\}/.test(twConfig) && /index\.html/.test(twConfig), 'Tailwind scans the React sources and index.html for class names');
  const css = fs.readFileSync(path.join(desktop, 'src', 'index.css'), 'utf8');
  assert(/@tailwind base;/.test(css) && /@tailwind components;/.test(css) && /@tailwind utilities;/.test(css), 'The CSS entry point includes the Tailwind directives');
  assert(!css.includes('fonts.googleapis.com'), 'CSS entry point does not make external font network requests');
  assert(css.includes('--font-sans') && css.includes('system-ui'), 'CSS defines a high-quality local/system font stack for UI typography');
  const indexHtml = fs.readFileSync(path.join(desktop, 'index.html'), 'utf8');
  assert(!indexHtml.includes('fonts.googleapis.com') && !indexHtml.includes('fonts.gstatic.com'), 'index.html contains no external Google Fonts references');

  const expectedSelectors: Array<[string, RegExp]> = [
    ['flex layout utility', /\.flex\{/],
    ['dark background utility', /\.bg-slate-950\{/],
    ['arbitrary-value utility', /\.max-w-\\\[260px\\\]\{/],
    ['focus-visible variant', /\.focus-visible\\:ring-2:focus-visible/],
    ['screen-reader-only utility', /\.sr-only\{/],
    ['custom glass-panel component class', /\.glass-panel\{/]
  ];

  const check = (label: string, assetsDir: string) => {
    if (!fs.existsSync(assetsDir)) {
      skip(`${label} CSS artifact`, `${path.relative(root, assetsDir)} not found; run \`npm run build\` (or \`npm run build:portable\`)`);
      return;
    }
    const cssFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.css'));
    assert(cssFiles.length === 1, `${label}: exactly one compiled CSS file exists`);
    if (cssFiles.length !== 1) return;
    const text = fs.readFileSync(path.join(assetsDir, cssFiles[0]), 'utf8');
    assert(text.length > 20_000, `${label}: compiled CSS contains generated utilities (${(text.length / 1024).toFixed(1)} KB, was ~3 KB without Tailwind)`);
    for (const [name, re] of expectedSelectors) assert(re.test(text), `${label}: CSS contains ${name}`);
    const html = fs.readFileSync(path.join(assetsDir, '..', 'index.html'), 'utf8');
    assert(html.includes(`assets/${cssFiles[0]}`), `${label}: index.html links the compiled stylesheet`);
  };

  check('Production build', path.join(desktop, 'dist', 'assets'));
  check('Portable build', path.join(root, 'dist-release', 'AndroScrn-portable-win-x64', 'resources', 'app', 'dist', 'assets'));
}
