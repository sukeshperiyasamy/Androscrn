/**
 * Generates the small, synthetic OCR validation set in tests/fixtures/ocr/.
 *
 * Pages are rendered by headless Chrome from text written for this project (no third-party content, no private data),
 * so they are free to redistribute. They are clean, computer-typeset English pages - the easiest possible OCR input.
 *
 *   node scripts/generate-ocr-samples.js
 *
 * Requires Chrome at the path used by the UI tests. The committed PNGs are what the validation uses, so running this
 * is only necessary to regenerate them.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.resolve(__dirname, '..', 'tests', 'fixtures', 'ocr');
fs.mkdirSync(outDir, { recursive: true });

const samples = {
  'printed-clean': {
    description: 'Clean printed English page, dark text on white, three short paragraphs.',
    style: { color: '#111111', background: '#ffffff' },
    paragraphs: [
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.',
      'A document scanner turns a photograph of a page into text that you can search, copy and edit.',
      'Please check the recognized words carefully before relying on them.'
    ]
  },
  'multi-paragraph-punctuation': {
    description: 'Several paragraphs with numbers, currency, quotation marks, parentheses and mixed punctuation.',
    style: { color: '#1a1a1a', background: '#fdfdfd' },
    paragraphs: [
      'Invoice No. 4821 (due 15 March 2027): the total is $1,250.75, including 8.5% tax.',
      'She said, "Meet me at 9:30 a.m. near the station; bring the red folder."',
      'Items: 3 x cable, 12 x adapter, 1 x charger - shipping is free over $50.',
      'Questions? Email support, or call the office between Monday and Friday.'
    ]
  },
  'low-contrast': {
    description: 'Low-contrast page: mid-gray text on a light-gray background (same text as printed-clean).',
    style: { color: '#8c8c8c', background: '#cfcfcf' },
    paragraphs: [
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.',
      'A document scanner turns a photograph of a page into text that you can search, copy and edit.',
      'Please check the recognized words carefully before relying on them.'
    ]
  }
};

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 })).newPage();
  const manifest = {};
  for (const [name, s] of Object.entries(samples)) {
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${s.style.background}">
      <div style="width:900px;box-sizing:border-box;padding:56px 64px;font:24px/1.55 'Segoe UI',Arial,sans-serif;color:${s.style.color}">
      ${s.paragraphs.map(p => `<p style="margin:0 0 22px 0">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')}</div>`;
    await page.setContent(html);
    const box = await page.locator('div').first().boundingBox();
    await page.screenshot({ path: path.join(outDir, `${name}.png`), clip: { x: 0, y: 0, width: 900, height: Math.ceil(box.height) } });
    const reference = s.paragraphs.join('\n');
    fs.writeFileSync(path.join(outDir, `${name}.txt`), reference + '\n', 'utf8');
    manifest[name] = { description: s.description, font: "Segoe UI (Windows system font) rendered by Chrome, 24px", width: 900, height: Math.ceil(box.height), source: 'synthetic: text written for this project, rendered locally' };
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log('Generated', Object.keys(samples).join(', '), 'in', outDir);
})();
