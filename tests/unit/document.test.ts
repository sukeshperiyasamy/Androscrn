import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { PNG } from 'pngjs';
import {
  DocumentWorkflow,
  DocumentError,
  RawImage,
  decodeImage,
  encodePng,
  encodeJpeg,
  detectFormat,
  readJpegOrientation,
  MAX_INPUT_BYTES,
  toGrayscale,
  otsuThreshold,
  detectDocumentCorners,
  perspectiveWarp,
  rotateQuarterTurns,
  rotateDegrees,
  estimateSkewAngle,
  enhanceForOcr,
  validateQuad,
  orderCorners,
  buildOcrResult,
  TesseractOcrEngine,
  OcrEngine,
  OcrResult,
  LOW_CONFIDENCE_THRESHOLD,
  buildSearchablePdf,
  extractTextLayer,
  escapePdfString,
  Quad
} from '../../modules/document_intelligence';
import { createImage, fillRect, makeTextPage, placePageOnBackground, meanAbsDiff } from './fixtures/document-fixtures';

type AssertFn = (condition: boolean, name: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, name: string) => void;
type SkipFn = (name: string, reason: string) => void;

const hashPixels = (img: RawImage) => crypto.createHash('sha256').update(img.data).digest('hex');

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e: any) {
    return e instanceof DocumentError ? e.code : `OTHER:${e?.message}`;
  }
}

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e: any) {
    return e instanceof DocumentError ? e.code : `OTHER:${e?.message}`;
  }
}

function withExifOrientation(jpegBytes: Buffer, orientation: number): Buffer {
  // SOI + APP1(Exif, little-endian TIFF, one IFD entry: Orientation)
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // header, IFD at 8
    0x01, 0x00, // 1 entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, // tag 0x0112 SHORT x1
    0x00, 0x00, 0x00, 0x00 // next IFD
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = body.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]), body]);
  return Buffer.concat([jpegBytes.subarray(0, 2), app1, jpegBytes.subarray(2)]);
}

/** Scripted stand-in for the OcrEngine used by the workflow tests (not a real recognizer). */
class FakeEngine implements OcrEngine {
  public name = 'fake-engine';
  public calls = 0;
  public lastPng: Buffer | null = null;
  constructor(private available = true, private result?: OcrResult, private failWith?: Error) {}
  async isAvailable() {
    return this.available ? { available: true } : { available: false, reason: 'fake engine missing' };
  }
  async recognize(png: Buffer, options: any = {}): Promise<OcrResult> {
    this.calls++;
    this.lastPng = png;
    if (this.failWith) throw this.failWith;
    if (options.signal?.aborted) throw new DocumentError('CANCELLED', 'OCR was cancelled.');
    options.onProgress?.({ stage: 'recognizing', progress: 0.5 });
    return (
      this.result ??
      buildOcrResult(
        [{ text: 'HELLO WORLD', confidence: 90, bbox: { x0: 10, y0: 10, x1: 200, y1: 40 }, words: [
          { text: 'HELLO', confidence: 95, bbox: { x0: 10, y0: 10, x1: 90, y1: 40 } },
          { text: 'WORLD', confidence: 40, bbox: { x0: 100, y0: 10, x1: 200, y1: 40 } }
        ] }],
        { engine: 'fake-engine', language: 'eng', durationMs: 1 }
      )
    );
  }
}

interface FakeWorkerState {
  created: number;
  terminated: number;
  createArgs: any[];
  recognizeImpl: (image: any) => Promise<any>;
  createDelayMs: number;
}

function fakeTesseract(state: FakeWorkerState) {
  return {
    createWorker: async (lang: string, oem: number, opts: any) => {
      state.created++;
      state.createArgs.push({ lang, oem, opts });
      if (state.createDelayMs) await new Promise(r => setTimeout(r, state.createDelayMs));
      opts.logger?.({ status: 'loading language traineddata', progress: 0.25 });
      opts.logger?.({ status: 'recognizing text', progress: 0.5 });
      return {
        recognize: (image: any) => state.recognizeImpl(image),
        terminate: async () => {
          state.terminated++;
        }
      };
    }
  };
}

const FAKE_BLOCKS = {
  text: 'HELLO WORLD\n',
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              text: 'HELLO WORLD\n',
              confidence: 80,
              bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
              words: [
                { text: 'HELLO', confidence: 92, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } },
                { text: 'WORLD', confidence: 30, bbox: { x0: 5, y0: 2, x1: 7, y1: 4 } }
              ]
            }
          ]
        }
      ]
    }
  ]
};

export async function runDocumentTests(assert: AssertFn, assertEqual: AssertEqualFn, skip: SkipFn) {
  console.log('\nTest Group: Document Intelligence (synthetic fixtures; engine mocked unless stated)');

  // ------------------------------------------------------------------ image I/O
  const page = makeTextPage(['HELLO WORLD', 'INVOICE 2026'], 6, 40);
  const png = encodePng(page);
  assertEqual(detectFormat(png), 'png', 'PNG magic bytes detected');
  const decodedPng = decodeImage(png);
  assert(decodedPng.format === 'png' && decodedPng.image.width === page.width && decodedPng.image.height === page.height, 'PNG decodes to the original dimensions');
  assertEqual(hashPixels(decodedPng.image), hashPixels(page), 'PNG round trip is lossless');

  const jpg = encodeJpeg(page, 90);
  assertEqual(detectFormat(jpg), 'jpeg', 'JPEG magic bytes detected');
  const decodedJpg = decodeImage(jpg);
  assert(decodedJpg.format === 'jpeg' && decodedJpg.orientationApplied === 1, 'JPEG decodes with no orientation change');
  assert(meanAbsDiff(decodedJpg.image, page) < 8, 'JPEG decode is close to the source (lossy)');

  assertEqual(codeOf(() => decodeImage(Buffer.from('GIF89a......'))), 'UNSUPPORTED_FORMAT', 'GIF is rejected as unsupported');
  assertEqual(codeOf(() => decodeImage(Buffer.from('plain text file'))), 'UNSUPPORTED_FORMAT', 'Non-image data is rejected as unsupported');
  assertEqual(codeOf(() => decodeImage(Buffer.alloc(0))), 'CORRUPT_IMAGE', 'Empty input is rejected');
  assertEqual(codeOf(() => decodeImage(png.subarray(0, Math.floor(png.length / 2)))), 'CORRUPT_IMAGE', 'Truncated PNG is reported as corrupt, not thrown raw');
  assertEqual(codeOf(() => decodeImage(jpg.subarray(0, 40))), 'CORRUPT_IMAGE', 'Truncated JPEG is reported as corrupt');
  assertEqual(codeOf(() => decodeImage(Buffer.alloc(MAX_INPUT_BYTES + 1, 1))), 'IMAGE_TOO_LARGE', 'Oversized file is rejected before decoding');
  const hugeHeader = Buffer.from(png);
  hugeHeader.writeUInt32BE(20000, 16);
  hugeHeader.writeUInt32BE(20000, 20);
  assertEqual(codeOf(() => decodeImage(hugeHeader)), 'IMAGE_TOO_LARGE', 'PNG declaring a gigantic size is rejected before any pixel allocation');

  // EXIF orientation
  const marker = createImage(40, 20);
  fillRect(marker, 0, 0, 4, 4, [255, 0, 0]);
  const markerJpeg = encodeJpeg(marker, 100);
  assertEqual(readJpegOrientation(markerJpeg), 1, 'JPEG without EXIF reports orientation 1');
  const redAt = (img: RawImage, x: number, y: number) => {
    const o = (y * img.width + x) * 4;
    return img.data[o] > 180 && img.data[o + 1] < 90 && img.data[o + 2] < 90;
  };
  const o6 = decodeImage(withExifOrientation(markerJpeg, 6));
  assertEqual(readJpegOrientation(withExifOrientation(markerJpeg, 6)), 6, 'EXIF orientation 6 is read');
  assert(o6.image.width === 20 && o6.image.height === 40 && o6.orientationApplied === 6, 'Orientation 6 swaps dimensions (portrait phone photo)');
  assert(redAt(o6.image, 18, 1), 'Orientation 6 moves the top-left marker to the top-right (rotated 90 degrees clockwise)');
  const o3 = decodeImage(withExifOrientation(markerJpeg, 3));
  assert(o3.image.width === 40 && redAt(o3.image, 38, 18), 'Orientation 3 rotates by 180 degrees');
  const o8 = decodeImage(withExifOrientation(markerJpeg, 8));
  assert(o8.image.width === 20 && redAt(o8.image, 1, 38), 'Orientation 8 rotates 90 degrees counter-clockwise');
  assertEqual(readJpegOrientation(withExifOrientation(markerJpeg, 9)), 1, 'Out-of-range orientation values are ignored');

  // ------------------------------------------------------------------ preprocessing
  assertEqual(toGrayscale(createImage(2, 2, [255, 255, 255]))[0], 255, 'White maps to gray 255');
  assertEqual(toGrayscale(createImage(2, 2, [0, 0, 0]))[0], 0, 'Black maps to gray 0');
  const bimodal = new Uint8Array(1000).map((_, i) => (i < 500 ? 30 : 220));
  const th = otsuThreshold(bimodal);
  assert(th >= 30 && th < 220, 'Otsu threshold separates a bimodal histogram');

  const truth: Quad = [{ x: 120, y: 90 }, { x: 620, y: 140 }, { x: 590, y: 520 }, { x: 80, y: 470 }];
  const flat = makeTextPage(['HELLO WORLD', 'INVOICE 2026 TOTAL 450'], 6, 40);
  const photo = placePageOnBackground(flat, 720, 600, truth);
  const photoHash = hashPixels(photo);
  const det = detectDocumentCorners(photo);
  assert(det.corners !== null && (det.confidence ?? 0) > 0.8, 'A tilted page on a dark table is detected with high rectangularity');
  if (det.corners) {
    const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
    det.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - truth[i].x, c.y - truth[i].y);
      assert(d < 25, `Detected ${names[i]} corner is within 25 px of ground truth (${d.toFixed(1)} px)`);
    });
  }
  assertEqual(hashPixels(photo), photoHash, 'Detection does not modify its input');
  assertEqual(detectDocumentCorners(createImage(300, 300, [128, 128, 128])).reason, 'low-contrast', 'A uniform gray frame reports low contrast');
  assertEqual(detectDocumentCorners(createImage(300, 300, [255, 255, 255])).reason, 'low-contrast', 'A blank white frame reports low contrast');
  const tiny = createImage(400, 300, [20, 20, 20]);
  fillRect(tiny, 10, 10, 40, 40, [250, 250, 250]);
  assertEqual(detectDocumentCorners(tiny).reason, 'no-document-found', 'A small bright patch is not mistaken for a page');
  const fills = createImage(400, 300, [245, 245, 245]);
  fillRect(fills, 0, 0, 400, 3, [30, 30, 30]);
  assertEqual(detectDocumentCorners(fills).corners, null, 'A page filling the frame yields no crop corners');

  const warped = perspectiveWarp(photo, det.corners as Quad);
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  const expectedW = Math.max(dist(truth[0], truth[1]), dist(truth[3], truth[2]));
  const expectedH = Math.max(dist(truth[0], truth[3]), dist(truth[1], truth[2]));
  assert(Math.abs(warped.width - expectedW) / expectedW < 0.05 && Math.abs(warped.height - expectedH) / expectedH < 0.05, 'Warping the detected corners yields the page size implied by the true corners (within 5%)');
  const warpedSmall = perspectiveWarp(photo, truth);
  const resizedFlat = createImage(warpedSmall.width, warpedSmall.height);
  for (let y = 0; y < resizedFlat.height; y++) {
    for (let x = 0; x < resizedFlat.width; x++) {
      const sx = Math.min(flat.width - 1, Math.round((x * flat.width) / resizedFlat.width));
      const sy = Math.min(flat.height - 1, Math.round((y * flat.height) / resizedFlat.height));
      const s = (sy * flat.width + sx) * 4, d = (y * resizedFlat.width + x) * 4;
      resizedFlat.data[d] = flat.data[s]; resizedFlat.data[d + 1] = flat.data[s + 1]; resizedFlat.data[d + 2] = flat.data[s + 2];
    }
  }
  assert(meanAbsDiff(warpedSmall, resizedFlat) < 30, 'Warped photo resembles the flat source page (mean abs. difference < 30/255)');
  assertEqual(hashPixels(photo), photoHash, 'Perspective correction does not modify its input');
  assertEqual(codeOf(() => perspectiveWarp(photo, [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }])), 'INVALID_ARGUMENT', 'Collinear corners are rejected');
  assertEqual(codeOf(() => perspectiveWarp(photo, [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }])), 'INVALID_ARGUMENT', 'A tiny selection is rejected');

  assertEqual(JSON.stringify(orderCorners([{ x: 9, y: 9 }, { x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }])), JSON.stringify([{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }]), 'Corners are ordered TL, TR, BR, BL');
  assertEqual(codeOf(() => validateQuad([{ x: 0, y: 0 }], 100, 100)), 'INVALID_ARGUMENT', 'Fewer than four corners is invalid');
  assertEqual(codeOf(() => validateQuad([{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 100, 100)), 'INVALID_ARGUMENT', 'NaN corners are invalid');
  assertEqual(codeOf(() => validateQuad([{ x: -50, y: 0 }, { x: 99, y: 0 }, { x: 99, y: 99 }, { x: 0, y: 99 }], 100, 100)), 'INVALID_ARGUMENT', 'Corners far outside the image are invalid');
  assertEqual(codeOf(() => validateQuad(null, 100, 100)), 'INVALID_ARGUMENT', 'Missing corners are invalid');

  const labelled = createImage(6, 4);
  fillRect(labelled, 0, 0, 1, 1, [255, 0, 0]);
  const r1 = rotateQuarterTurns(labelled, 1);
  assert(r1.width === 4 && r1.height === 6, 'A quarter turn swaps the dimensions');
  assert(redAt(r1, 3, 0), 'A clockwise quarter turn moves the top-left pixel to the top-right');
  assertEqual(hashPixels(rotateQuarterTurns(rotateQuarterTurns(rotateQuarterTurns(rotateQuarterTurns(labelled, 1), 1), 1), 1)), hashPixels(labelled), 'Four quarter turns restore the image');
  assertEqual(hashPixels(rotateQuarterTurns(labelled, -1)), hashPixels(rotateQuarterTurns(labelled, 3)), 'Negative turns are normalized');
  assertEqual(hashPixels(rotateQuarterTurns(labelled, 4)), hashPixels(labelled), 'Zero net rotation returns an identical copy');
  assertEqual(codeOf(() => rotateDegrees(labelled, NaN)), 'INVALID_ARGUMENT', 'NaN rotation angle is rejected');
  const rot90 = rotateDegrees(createImage(30, 20, [0, 0, 0]), 90);
  assert(Math.abs(rot90.width - 20) <= 1 && Math.abs(rot90.height - 30) <= 1, 'Rotating by 90 degrees swaps the canvas size');

  const skewedText = rotateDegrees(makeTextPage(['HELLO WORLD', 'INVOICE 2026 TOTAL', 'THIRD LINE HERE'], 6, 40), 5);
  const skew = estimateSkewAngle(skewedText);
  assert(Math.abs(Math.abs(skew) - 5) <= 1.5, `Skew estimate for text rotated 5 degrees is about 5 degrees in magnitude (${skew.toFixed(1)})`);
  assert(Math.abs(estimateSkewAngle(makeTextPage(['HELLO WORLD', 'INVOICE 2026 TOTAL', 'THIRD LINE HERE'], 6, 40))) <= 1, 'Straight text reports (almost) no skew');
  assertEqual(estimateSkewAngle(createImage(200, 200)), 0, 'A blank page reports no skew');

  const dim = createImage(60, 60, [110, 110, 110]);
  fillRect(dim, 20, 20, 40, 40, [150, 150, 150]);
  const enhanced = enhanceForOcr(dim);
  const range = (img: RawImage) => { const g = toGrayscale(img); return Math.max(...g) - Math.min(...g); };
  assert(range(enhanced) > range(dim) * 3, 'Contrast enhancement widens a low-contrast tonal range');
  const dimHashBefore = hashPixels(dim);
  enhanceForOcr(dim);
  assertEqual(hashPixels(dim), dimHashBefore, 'Enhancement does not modify its input');

  // ------------------------------------------------------------------ OCR result handling
  const emptyResult = buildOcrResult([], { engine: 'x', language: 'eng', durationMs: 0 });
  assert(emptyResult.text === '' && emptyResult.meanConfidence === null && emptyResult.words.length === 0, 'An empty OCR result has no text and no confidence');
  const built = buildOcrResult(
    [
      { text: 'ALPHA BETA  ', confidence: 80, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [
        { text: 'ALPHA', confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
        { text: 'BETA', confidence: LOW_CONFIDENCE_THRESHOLD - 1, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
        { text: '   ', confidence: 99, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }
      ] }
    ],
    { engine: 'x', language: 'eng', durationMs: 5 }
  );
  assertEqual(built.words.length, 2, 'Whitespace-only words are dropped');
  assertEqual(built.lowConfidenceWords, 1, 'Words below the threshold are counted for review');
  assertEqual(built.meanConfidence, Math.round(((90 + LOW_CONFIDENCE_THRESHOLD - 1) / 2) * 10) / 10, 'Mean confidence is the mean of word confidences');
  assertEqual(built.text, 'ALPHA BETA', 'Trailing whitespace is trimmed from the text');

  // ------------------------------------------------------------------ engine wrapper with a fake tesseract.js
  const langDir = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-ocr-lang-'));
  fs.writeFileSync(path.join(langDir, 'eng.traineddata.gz'), 'not real language data');
  const state = (impl?: (image: any) => Promise<any>, createDelayMs = 0): FakeWorkerState => ({
    created: 0, terminated: 0, createArgs: [], createDelayMs,
    recognizeImpl: impl ?? (async () => ({ data: FAKE_BLOCKS }))
  });
  try {
    const ok = state();
    const engine = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => fakeTesseract(ok) });
    assert((await engine.isAvailable()).available, 'Engine reports available when the module and language data exist');
    const progress: number[] = [];
    const result = await engine.recognize(png, { onProgress: p => progress.push(p.progress) });
    assertEqual(result.words.length, 2, 'Words are read from the engine block structure');
    assertEqual(result.text, 'HELLO WORLD', 'Full text is taken from the engine output');
    assertEqual(result.lowConfidenceWords, 1, 'Low-confidence words from the engine are counted');
    assert(result.meanConfidence === 61, 'Mean confidence is computed from word confidences');
    assert(progress.length >= 3 && progress[progress.length - 1] === 1, 'Progress is reported and ends at 100%');
    assertEqual(ok.created, 1, 'One worker is created per recognition');
    assertEqual(ok.terminated, 1, 'The worker is always terminated after recognition');
    const opts = ok.createArgs[0].opts;
    assert(opts.langPath === langDir && !/^https?:/i.test(opts.langPath), 'Language data is loaded from a local directory, not a URL');
    assertEqual(opts.cacheMethod, 'none', 'No language-data cache files are written');

    const badLang = await codeOfAsync(() => engine.recognize(png, { language: 'xx' }));
    assertEqual(badLang, 'INVALID_ARGUMENT', 'An unsupported language is rejected clearly');

    const missingModule = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => { throw new Error('Cannot find module'); } });
    const miss = await missingModule.isAvailable();
    assert(!miss.available && /not installed/.test(miss.reason || ''), 'A missing OCR library is reported with an actionable reason');
    assertEqual(await codeOfAsync(() => missingModule.recognize(png)), 'OCR_UNAVAILABLE', 'Recognition without the library fails with OCR_UNAVAILABLE');
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-ocr-empty-'));
    const noData = new TesseractOcrEngine({ langPath: emptyDir, useBundledData: false, loadTesseract: () => fakeTesseract(state()) });
    const noDataAvail = await noData.isAvailable();
    assert(!noDataAvail.available && /language data/.test(noDataAvail.reason || ''), 'Missing language data is reported with an actionable reason');
    assertEqual(await codeOfAsync(() => noData.recognize(png)), 'OCR_UNAVAILABLE', 'Recognition without language data fails with OCR_UNAVAILABLE');
    fs.rmSync(emptyDir, { recursive: true, force: true });

    const failing = state(async () => { throw new Error('wasm exploded'); });
    const failEngine = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => fakeTesseract(failing) });
    assertEqual(await codeOfAsync(() => failEngine.recognize(png)), 'OCR_FAILED', 'An engine error is wrapped as OCR_FAILED');
    assertEqual(failing.terminated, 1, 'The worker is terminated after an engine failure');

    const hanging = state(() => new Promise(() => {}));
    const cancelEngine = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => fakeTesseract(hanging) });
    const ac = new AbortController();
    const pending = codeOfAsync(() => cancelEngine.recognize(png, { signal: ac.signal }));
    await new Promise(r => setTimeout(r, 40));
    ac.abort();
    assertEqual(await pending, 'CANCELLED', 'Aborting during recognition rejects with CANCELLED');
    assertEqual(hanging.terminated, 1, 'Cancellation terminates the worker thread');

    const pre = new AbortController();
    pre.abort();
    const preState = state();
    const preEngine = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => fakeTesseract(preState) });
    assertEqual(await codeOfAsync(() => preEngine.recognize(png, { signal: pre.signal })), 'CANCELLED', 'An already-aborted signal cancels immediately');
    assertEqual(preState.created, 0, 'No worker is started for an already-cancelled request');

    const slowStart = state(undefined, 150);
    const startEngine = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => fakeTesseract(slowStart) });
    const ac2 = new AbortController();
    const pending2 = codeOfAsync(() => startEngine.recognize(png, { signal: ac2.signal }));
    await new Promise(r => setTimeout(r, 30));
    ac2.abort();
    assertEqual(await pending2, 'CANCELLED', 'Cancelling while the worker is still starting is honoured');
    await new Promise(r => setTimeout(r, 250));
    assertEqual(slowStart.terminated, slowStart.created, 'A worker that finishes starting after cancellation is terminated (no leak)');

    const timeoutState = state(() => new Promise(() => {}));
    const timeoutEngine = new TesseractOcrEngine({ langPath: langDir, loadTesseract: () => fakeTesseract(timeoutState) });
    assertEqual(await codeOfAsync(() => timeoutEngine.recognize(png, { timeoutMs: 60 })), 'TIMEOUT', 'A stuck recognition times out');
    assertEqual(timeoutState.terminated, 1, 'A timed-out worker is terminated');
  } finally {
    fs.rmSync(langDir, { recursive: true, force: true });
  }

  // ------------------------------------------------------------------ searchable PDF
  const pdfImage = makeTextPage(['HELLO WORLD'], 4, 20);
  const words = [
    { text: 'HELLO', confidence: 95, bbox: { x0: 20, y0: 20, x1: 140, y1: 48 } },
    { text: 'WORLD', confidence: 90, bbox: { x0: 160, y0: 20, x1: 280, y1: 48 } },
    { text: 'a(b)c\\d', confidence: 80, bbox: { x0: 20, y0: 60, x1: 100, y1: 80 } },
    { text: 'café', confidence: 80, bbox: { x0: 110, y0: 60, x1: 180, y1: 80 } },
    { text: '漢字', confidence: 80, bbox: { x0: 190, y0: 60, x1: 250, y1: 80 } }
  ];
  const pdfOcr = buildOcrResult([{ text: 'x', confidence: 80, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words }], { engine: 'fake', language: 'eng', durationMs: 1 });
  const pdf = buildSearchablePdf(pdfImage, pdfOcr, { title: 'Test (doc)' });
  const pdfText = pdf.toString('latin1');
  assert(pdfText.startsWith('%PDF-1.4') && pdfText.trimEnd().endsWith('%%EOF'), 'PDF has a header and an end-of-file marker');
  const startxref = parseInt(/startxref\n(\d+)\n%%EOF/.exec(pdfText)?.[1] || '-1', 10);
  assertEqual(pdfText.substr(startxref, 4), 'xref', 'startxref points at the xref table');
  const entries = [...pdfText.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => parseInt(m[1], 10));
  assertEqual(entries.length, 7, 'xref lists all seven objects');
  assert(entries.every((off, i) => pdfText.substr(off, `${i + 1} 0 obj`.length) === `${i + 1} 0 obj`), 'Every xref offset points at its object');
  assert(/\/Subtype \/Image/.test(pdfText) && /\/Filter \/DCTDecode/.test(pdfText), 'The page image is embedded as a JPEG XObject');
  const jpegStart = pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  assert(jpegStart > 0 && pdf.indexOf(Buffer.from([0xff, 0xd9]), jpegStart) > jpegStart, 'The embedded image bytes are a complete JPEG');
  assert(/\n3 Tr\n/.test(pdfText), 'Text is drawn in invisible render mode (searchable, not visible)');
  const layer = extractTextLayer(pdf);
  assertEqual(layer.slice(0, 2).join(' '), 'HELLO WORLD', 'The text layer contains the recognized words');
  assertEqual(layer[2], 'a(b)c\\d', 'Parentheses and backslashes are escaped and round-trip');
  assertEqual(layer[3], 'café', 'Latin-1 characters survive in the text layer');
  assertEqual(layer[4], '??', 'Characters outside Latin-1 degrade to "?" (documented limitation)');
  assertEqual(escapePdfString('(x)'), '\\(x\\)', 'PDF string escaping handles parentheses');
  assert(/\/MediaBox \[0 0 [\d.]+ [\d.]+\]/.test(pdfText), 'The page has a media box sized from the image and DPI');
  assertEqual(codeOf(() => buildSearchablePdf({ width: 0, height: 0, data: new Uint8Array(0) }, pdfOcr)), 'INVALID_ARGUMENT', 'PDF export rejects an empty image');
  const emptyLayer = extractTextLayer(buildSearchablePdf(pdfImage, buildOcrResult([], { engine: 'x', language: 'eng', durationMs: 0 })));
  assertEqual(emptyLayer.length, 0, 'A PDF built from an empty OCR result has no text layer entries');

  // ------------------------------------------------------------------ workflow: non-destructive, errors, cancellation
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-doc-out-'));
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'androscrn-doc-src-'));
  try {
    const srcFile = path.join(srcDir, 'photo.jpg');
    const photoJpeg = encodeJpeg(photo, 92);
    fs.writeFileSync(srcFile, photoJpeg);
    const srcHashBefore = crypto.createHash('sha256').update(fs.readFileSync(srcFile)).digest('hex');
    const srcMtime = fs.statSync(srcFile).mtimeMs;

    const engine = new FakeEngine();
    const wf = new DocumentWorkflow(engine);
    const session = wf.importFile(srcFile);
    assertEqual(session.sourceName, 'photo.jpg', 'Import records only the file name, not the full path');
    const pixelsBefore = hashPixels(session.original);

    const analysis = wf.analyze(session);
    assert(analysis.detection.corners !== null, 'Workflow analysis detects the page in a JPEG photo');
    assert(analysis.preview.dataUrl.startsWith('data:image/png;base64,') && analysis.preview.width <= 900, 'Analysis returns a bounded preview');

    const processed = wf.process(session, { rotationQuarterTurns: 1, enhance: true });
    assert(processed.image.width > 0 && session.processed === processed.image, 'Processing stores the processed image on the session');
    assertEqual(hashPixels(session.original), pixelsBefore, 'Processing never modifies the original pixels');

    const noCrop = wf.process(session, { corners: null });
    assertEqual(noCrop.image.width, session.original.width, 'Passing null corners keeps the full frame');
    const manual = wf.process(session, { corners: truth });
    assert(manual.image.width < session.original.width, 'Explicit corners crop and correct the page');
    assertEqual(codeOf(() => wf.process(session, { corners: [{ x: 0, y: 0 }] as any })), 'INVALID_ARGUMENT', 'Invalid manual corners are rejected');
    assertEqual(codeOf(() => wf.process(session, { rotationDegrees: 90 })), 'INVALID_ARGUMENT', 'Out-of-range fine rotation is rejected');
    assertEqual(codeOf(() => wf.process(session, { rotationQuarterTurns: NaN })), 'INVALID_ARGUMENT', 'Non-numeric quarter turns are rejected');

    const ocr = await wf.recognize(session, {});
    assertEqual(engine.calls, 1, 'Recognition calls the engine once');
    assert(engine.lastPng !== null && detectFormat(engine.lastPng) === 'png', 'The engine receives the processed image as PNG bytes');
    assertEqual(session.ocr, ocr, 'The OCR result is stored on the session');
    assertEqual(wf.getText(session), 'HELLO WORLD', 'Text defaults to the raw OCR output');
    wf.setText(session, 'HELLO WORLD (corrected)');
    assertEqual(wf.getText(session), 'HELLO WORLD (corrected)', 'The user can edit the text');
    assertEqual(session.ocr?.text, 'HELLO WORLD', 'Editing never overwrites the raw OCR result');
    assertEqual(codeOf(() => wf.setText(session, 42 as any)), 'INVALID_ARGUMENT', 'Non-string text is rejected');
    wf.process(session, { corners: null });
    assertEqual(session.ocr, undefined, 'Re-processing invalidates stale OCR results');
    await wf.recognize(session, {});

    const saved = wf.save(session, outDir);
    assert(fs.existsSync(saved.original) && fs.existsSync(saved.manifest) && saved.processed !== null && saved.text !== null, 'Save writes original, processed image, text and manifest');
    assert(saved.directory.startsWith(outDir), 'Everything is written under the chosen output folder');
    const manifest = JSON.parse(fs.readFileSync(saved.manifest, 'utf8'));
    assertEqual(manifest.original.sha256, srcHashBefore, 'Manifest records the hash of the untouched original');
    assertEqual(crypto.createHash('sha256').update(fs.readFileSync(saved.original)).digest('hex'), srcHashBefore, 'The saved original is byte-identical to the imported file');
    assertEqual(manifest.textEditedByUser, false, 'Manifest reports unedited text accurately');
    wf.setText(session, 'edited');
    wf.save(session, outDir);
    assertEqual(JSON.parse(fs.readFileSync(saved.manifest, 'utf8')).textEditedByUser, true, 'Manifest reports user-edited text');
    assertEqual(fs.readFileSync(saved.text as string, 'utf8'), 'edited', 'The edited text is what gets saved');

    const pdfPath = wf.exportSearchablePdf(session, outDir);
    assert(fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-', 'Searchable PDF is written to the output folder');
    assertEqual(extractTextLayer(fs.readFileSync(pdfPath)).join(' '), 'HELLO WORLD', 'The PDF text layer is the OCR words (edits are exported as text only)');

    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(srcFile)).digest('hex');
    assertEqual(afterHash, srcHashBefore, 'The source file on disk is unchanged after the whole workflow');
    assertEqual(fs.statSync(srcFile).mtimeMs, srcMtime, 'The source file was not even touched (modification time unchanged)');

    // Errors and edge cases
    const emptySession = wf.importBytes(encodePng(createImage(50, 50)), 'blank.png');
    assertEqual(codeOf(() => wf.exportSearchablePdf(emptySession, outDir)), 'INVALID_ARGUMENT', 'A searchable PDF is refused until OCR has produced text');
    assertEqual(codeOf(() => wf.importFile(path.join(srcDir, 'missing.png'))), 'NOT_FOUND', 'Importing a missing file reports NOT_FOUND');
    assertEqual(codeOf(() => wf.importFile(srcDir)), 'NOT_FOUND', 'Importing a directory is refused');
    const textFile = path.join(srcDir, 'notes.txt');
    fs.writeFileSync(textFile, 'hello');
    assertEqual(codeOf(() => wf.importFile(textFile)), 'UNSUPPORTED_FORMAT', 'Importing a text file reports an unsupported format');

    const unavailable = new DocumentWorkflow(new FakeEngine(false));
    const s2 = unavailable.importBytes(png, 'x.png');
    assertEqual(await codeOfAsync(() => unavailable.recognize(s2)), 'OCR_UNAVAILABLE', 'A missing OCR dependency produces OCR_UNAVAILABLE, not a crash');
    const failingWf = new DocumentWorkflow(new FakeEngine(true, undefined, new DocumentError('OCR_FAILED', 'boom')));
    const s3 = failingWf.importBytes(png, 'x.png');
    assertEqual(await codeOfAsync(() => failingWf.recognize(s3)), 'OCR_FAILED', 'Engine failures propagate as typed errors');
    assertEqual(s3.ocr, undefined, 'A failed recognition leaves no partial result on the session');
    const abort = new AbortController();
    abort.abort();
    assertEqual(await codeOfAsync(() => wf.recognize(session, { signal: abort.signal })), 'CANCELLED', 'A cancelled recognition propagates CANCELLED');

    // poor image: blank page still flows through without crashing and reports low contrast
    const blankAnalysis = wf.analyze(emptySession);
    assert(blankAnalysis.detection.corners === null && blankAnalysis.detection.reason === 'low-contrast', 'A blank/poor image is analysed without error and reports why no page was found');
    const processedBlank = wf.process(emptySession, { enhance: true });
    assert(processedBlank.image.width === 50, 'Processing a poor image succeeds (full frame)');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  }

  // ------------------------------------------------------------------ real engine smoke test (synthetic image only)
  const real = new TesseractOcrEngine();
  const availability = await real.isAvailable();
  if (!availability.available) {
    skip('Real tesseract.js engine smoke test', availability.reason || 'engine unavailable');
  } else {
    const synthetic = makeTextPage(['HELLO WORLD', 'INVOICE 2026 TOTAL 450'], 8, 50);
    const pct: number[] = [];
    const res = await real.recognize(encodePng(synthetic), { onProgress: p => pct.push(p.progress), timeoutMs: 120000 });
    assert(res.text.length > 0 && res.words.length > 0, 'REAL ENGINE (synthetic image): recognized some text and word boxes');
    assert(res.words.every(w => w.bbox.x1 >= w.bbox.x0 && w.bbox.y1 >= w.bbox.y0 && Number.isFinite(w.confidence)), 'REAL ENGINE (synthetic image): every word has a bounding box and a numeric confidence');
    assert(res.meanConfidence !== null && res.meanConfidence >= 0 && res.meanConfidence <= 100, 'REAL ENGINE (synthetic image): mean confidence is within 0-100');
    assert(res.text.toUpperCase().includes('HELLO'), 'REAL ENGINE (synthetic image): the large, clean word HELLO is recognized');
    assert(pct.length > 0 && Math.max(...pct) === 1, 'REAL ENGINE (synthetic image): progress reaches 100%');
    const realPdf = buildSearchablePdf(synthetic, res);
    assert(extractTextLayer(realPdf).length === res.words.length, 'REAL ENGINE (synthetic image): the PDF text layer holds one entry per recognized word');
  }
}
