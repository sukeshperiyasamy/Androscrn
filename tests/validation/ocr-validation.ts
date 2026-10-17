import fs from 'fs';
import net from 'net';
import path from 'path';
import os from 'os';
import {
  DocumentWorkflow,
  DocumentError,
  TesseractOcrEngine,
  decodeImage,
  encodePng,
  rotateQuarterTurns,
  rotateDegrees,
  estimateSkewAngle,
  RawImage
} from '../../modules/document_intelligence';
import { placePageOnBackground } from '../unit/fixtures/document-fixtures';

/**
 * OCR sample validation (NOT part of `npm test`; run with `npm run validate:ocr`).
 *
 * Runs the real local engine on a tiny, synthetic, clean-typeset English sample set (tests/fixtures/ocr) plus
 * deterministic distortions of it, and reports character/word error rates against known reference text. The set is
 * small and unrepresentative: it says nothing about accuracy on real photographs, other fonts, handwriting or other
 * languages.
 */

const fixtureDir = path.resolve(__dirname, '../../../tests/fixtures/ocr');
const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();

function levenshtein<T>(a: ArrayLike<T>, b: ArrayLike<T>): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const cer = (ref: string, hyp: string) => levenshtein(Array.from(normalize(ref)), Array.from(normalize(hyp))) / Math.max(1, normalize(ref).length);
const wer = (ref: string, hyp: string) => levenshtein(normalize(ref).split(' '), normalize(hyp).split(' ')) / Math.max(1, normalize(ref).split(' ').length);

interface Row {
  sample: string;
  variant: string;
  settings: string;
  size: string;
  cer: number;
  wer: number;
  meanConfidence: number | null;
  words: number;
  lowConfidence: number;
  wrongWords: number;
  wrongWordsFlagged: number;
  ms: number;
  extracted: string;
}

export async function main() {
  const out: { generatedAt: string; environment: any; rows: Row[]; lifecycle: any } = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length },
    rows: [],
    lifecycle: {}
  };

  // Watch for any non-loopback network connection while OCR runs.
  const remoteConnections: string[] = [];
  const origConnect = net.Socket.prototype.connect;
  (net.Socket.prototype as any).connect = function (...args: any[]) {
    const o = args[0];
    const host = typeof o === 'object' ? o.host : args[1];
    if (host && !['127.0.0.1', 'localhost', '::1'].includes(String(host))) remoteConnections.push(`${host}`);
    return (origConnect as any).apply(this, args);
  };

  const engine = new TesseractOcrEngine();
  const availability = await engine.isAvailable();
  if (!availability.available) throw new Error(`OCR engine unavailable: ${availability.reason}`);
  const workflow = new DocumentWorkflow(engine);

  const load = (name: string) => {
    const bytes = fs.readFileSync(path.join(fixtureDir, `${name}.png`));
    return { bytes, image: decodeImage(bytes).image, reference: fs.readFileSync(path.join(fixtureDir, `${name}.txt`), 'utf8') };
  };

  const run = async (sample: string, variant: string, settings: string, image: RawImage, reference: string, process: any) => {
    const session = workflow.importBytes(encodePng(image), `${sample}-${variant}.png`);
    workflow.analyze(session);
    workflow.process(session, process);
    const started = Date.now();
    const ocr = await workflow.recognize(session, {});
    const hypothesis = ocr.text;
    const refWords = normalize(reference).split(' ');
    const pool = new Map<string, number>();
    for (const w of refWords) pool.set(w, (pool.get(w) || 0) + 1);
    let wrong = 0, flagged = 0;
    for (const w of ocr.words) {
      const left = pool.get(w.text) || 0;
      if (left > 0) pool.set(w.text, left - 1);
      else { wrong++; if (w.confidence < 60) flagged++; }
    }
    const processed = workflow.workingImage(session);
    out.rows.push({
      sample, variant, settings, size: `${image.width}x${image.height} -> ${processed.width}x${processed.height}`,
      cer: cer(reference, hypothesis), wer: wer(reference, hypothesis), meanConfidence: ocr.meanConfidence,
      words: ocr.words.length, lowConfidence: ocr.lowConfidenceWords, wrongWords: wrong, wrongWordsFlagged: flagged,
      ms: Date.now() - started, extracted: hypothesis
    });
  };

  const clean = load('printed-clean');
  const multi = load('multi-paragraph-punctuation');
  const low = load('low-contrast');

  await run('printed-clean', 'baseline', 'no processing', clean.image, clean.reference, { corners: null });
  await run('multi-paragraph-punctuation', 'baseline', 'no processing', multi.image, multi.reference, { corners: null });

  // rotated 90 degrees
  const rotated = rotateQuarterTurns(clean.image, 1);
  await run('printed-clean', 'rotated-90 (unprocessed)', 'no processing', rotated, clean.reference, { corners: null });
  await run('printed-clean', 'rotated-90 (corrected)', 'rotate 3 quarter turns', rotated, clean.reference, { corners: null, rotationQuarterTurns: 3 });

  // skewed 6 degrees
  const skewed = rotateDegrees(clean.image, 6);
  const suggested = estimateSkewAngle(skewed);
  await run('printed-clean', 'skewed-6deg (unprocessed)', 'no processing', skewed, clean.reference, { corners: null });
  await run('printed-clean', 'skewed-6deg (deskewed)', `fine rotation ${(-suggested).toFixed(1)} deg (app suggestion; estimate ${suggested.toFixed(1)})`, skewed, clean.reference, { corners: null, rotationDegrees: -suggested });

  // perspective: page photographed on a dark table
  const W = clean.image.width + 260, H = clean.image.height + 260;
  const quad = [{ x: 150, y: 90 }, { x: W - 70, y: 130 }, { x: W - 110, y: H - 80 }, { x: 90, y: H - 130 }];
  const photo = placePageOnBackground(clean.image, W, H, quad);
  await run('printed-clean', 'perspective (unprocessed)', 'no processing', photo, clean.reference, { corners: null });
  await run('printed-clean', 'perspective (auto crop + enhance)', 'detected corners, enhance', photo, clean.reference, { enhance: true });

  // low contrast
  await run('low-contrast', 'baseline', 'no processing', low.image, low.reference, { corners: null });
  await run('low-contrast', 'enhanced', 'enhance contrast', low.image, low.reference, { corners: null, enhance: true });

  // very low contrast: the clean page's tonal range squeezed into 165..195 (a washed-out photo)
  const washed: RawImage = { width: clean.image.width, height: clean.image.height, data: new Uint8Array(clean.image.data) };
  for (let i = 0; i < washed.data.length; i += 4) for (let c = 0; c < 3; c++) washed.data[i + c] = 165 + Math.round((washed.data[i + c] / 255) * 30);
  await run('printed-clean', 'very-low-contrast (unprocessed)', 'no processing; tonal range 165-195', washed, clean.reference, { corners: null });
  await run('printed-clean', 'very-low-contrast (enhanced)', 'enhance contrast', washed, clean.reference, { corners: null, enhance: true });

  // ---- worker lifecycle: repeated runs and cancellation ----
  const active = () => (process as any).getActiveResourcesInfo().filter((r: string) => r !== 'TTYWrap' && r !== 'Timeout' && r !== 'TTY').length;
  const baseline = active();
  const timings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const s = workflow.importBytes(encodePng(clean.image), 'repeat.png');
    const t = Date.now();
    await workflow.recognize(s, {});
    timings.push(Date.now() - t);
  }
  await new Promise(r => setTimeout(r, 300));
  const afterRepeats = active();

  const ac = new AbortController();
  const s2 = workflow.importBytes(encodePng(multi.image), 'cancel.png');
  const cancelStart = Date.now();
  const pending = workflow.recognize(s2, { signal: ac.signal }).then(() => 'completed', (e: any) => (e instanceof DocumentError ? e.code : 'ERR'));
  setTimeout(() => ac.abort(), 150);
  const cancelOutcome = await pending;
  const cancelMs = Date.now() - cancelStart;
  await new Promise(r => setTimeout(r, 300));
  const afterCancel = active();
  const recovery = workflow.importBytes(encodePng(clean.image), 'recover.png');
  const recovered = (await workflow.recognize(recovery, {})).text.length > 0;

  const missing = new TesseractOcrEngine({ langPath: fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-nodata-')), useBundledData: false });
  const missingStatus = await missing.isAvailable();
  let missingCode = 'NO_ERROR';
  try { await missing.recognize(encodePng(clean.image)); } catch (e: any) { missingCode = e.code; }

  const cacheFiles = fs.readdirSync(process.cwd()).filter(f => /traineddata/i.test(f));
  out.lifecycle = {
    repeatedRunMs: timings,
    activeResourcesBaseline: baseline,
    activeResourcesAfter5Runs: afterRepeats,
    cancel: { outcome: cancelOutcome, msUntilSettled: cancelMs, activeResourcesAfter: afterCancel, engineRecoveredAfterCancel: recovered },
    missingModel: { available: missingStatus.available, errorCode: missingCode },
    remoteConnectionsDuringOcr: remoteConnections,
    languageCacheFilesWrittenToCwd: cacheFiles
  };
  net.Socket.prototype.connect = origConnect;

  fs.mkdirSync(path.resolve(__dirname, '../../../docs/qa'), { recursive: true });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const md = [
    '# OCR sample validation (synthetic, small, unrepresentative)',
    '',
    `Generated by \`npm run validate:ocr\` on ${out.generatedAt.slice(0, 10)} (${out.environment.platform}, Node ${out.environment.node}). Engine: tesseract.js (bundled English data).`,
    '',
    '## Dataset',
    '',
    'Three computer-typeset English pages in `tests/fixtures/ocr/` (Segoe UI 24 px, rendered by headless Chrome from text written for this project; no third-party or private content). Distortions are applied deterministically by `tests/validation/ocr-validation.ts`: 90 degree rotation, 6 degree skew, a perspective placement on a dark table, and reduced contrast. These are the easiest possible inputs (clean fonts, no noise, no blur, no handwriting, no tables). **Results must not be read as general OCR accuracy.**',
    '',
    '## Results',
    '',
    'CER / WER = character / word error rate against the known reference after whitespace normalization (lower is better; can exceed 100%). "Wrong words flagged" = recognized words not found in the reference that the app would list as low-confidence (< 60%).',
    '',
    '| Sample | Variant | Settings | Size (in -> processed) | CER | WER | Mean conf. | Wrong words (flagged) | Time |',
    '| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |',
    ...out.rows.map(r => `| ${r.sample} | ${r.variant} | ${r.settings} | ${r.size} | ${pct(r.cer)} | ${pct(r.wer)} | ${r.meanConfidence ?? 'n/a'} | ${r.wrongWords} (${r.wrongWordsFlagged}) | ${r.ms} ms |`),
    '',
    '## Lifecycle, offline behavior and cancellation (real engine)',
    '',
    `- Five consecutive recognitions: ${out.lifecycle.repeatedRunMs.join(', ')} ms each (about 0.9 s per page of this size, including worker start-up; a new worker is created and terminated per run).`,
    `- Active Node resources before / after the five runs: ${out.lifecycle.activeResourcesBaseline} / ${out.lifecycle.activeResourcesAfter5Runs} (no leftover workers).`,
    `- Cancellation after 150 ms: outcome ${out.lifecycle.cancel.outcome}, settled in ${out.lifecycle.cancel.msUntilSettled} ms, resources afterwards ${out.lifecycle.cancel.activeResourcesAfter}; a following OCR run ${out.lifecycle.cancel.engineRecoveredAfterCancel ? 'succeeded' : 'FAILED'}.`,
    `- Missing language data: available=${out.lifecycle.missingModel.available}, error code ${out.lifecycle.missingModel.errorCode}.`,
    `- Non-loopback network connections opened during all runs: ${out.lifecycle.remoteConnectionsDuringOcr.length} (monitored by wrapping \`net.Socket.connect\`).`,
    `- Language-data cache files written to the working directory: ${out.lifecycle.languageCacheFilesWrittenToCwd.length}.`,
    '',
    '## Extracted text (for transparency)',
    '',
    ...out.rows.filter(r => r.cer > 0).flatMap(r => [`**${r.sample} - ${r.variant}** (CER ${pct(r.cer)}):`, '', '```text', r.extracted.slice(0, 600), '```', ''])
  ].join('\n');
  fs.writeFileSync(path.resolve(__dirname, '../../../docs/qa/ocr-sample-validation.md'), md + '\n');
  console.log(JSON.stringify(out.rows.map(r => ({ s: r.sample, v: r.variant, cer: +(r.cer * 100).toFixed(1), wer: +(r.wer * 100).toFixed(1), conf: r.meanConfidence, wrong: r.wrongWords, flagged: r.wrongWordsFlagged, ms: r.ms })), null, 0));
  console.log(JSON.stringify(out.lifecycle));
}

if (require.main === module) {
  main().catch(err => {
    console.error('Validation failed:', err);
    process.exit(1);
  });
}
