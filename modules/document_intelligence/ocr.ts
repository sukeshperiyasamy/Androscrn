import fs from 'fs';
import path from 'path';
import { DocumentError } from './image';

/**
 * Local OCR. The default engine is tesseract.js (WebAssembly) running in a worker thread, so recognition never
 * blocks the Electron main process or UI. Language data and the WASM core are loaded from files on disk; nothing
 * is downloaded and no image leaves the machine.
 */

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  /** 0-100 as reported by the engine. */
  confidence: number;
  bbox: Bbox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: Bbox;
  words: OcrWord[];
}

export interface OcrResult {
  text: string;
  /** Mean word confidence 0-100, or null when the engine reported none. */
  meanConfidence: number | null;
  words: OcrWord[];
  lines: OcrLine[];
  /** Words below LOW_CONFIDENCE_THRESHOLD - candidates for the user to review. */
  lowConfidenceWords: number;
  engine: string;
  language: string;
  durationMs: number;
}

export interface OcrProgress {
  stage: string;
  /** 0..1 */
  progress: number;
}

export interface RecognizeOptions {
  language?: string;
  signal?: AbortSignal;
  onProgress?: (p: OcrProgress) => void;
  timeoutMs?: number;
}

export interface EngineAvailability {
  available: boolean;
  reason?: string;
}

export interface OcrEngine {
  readonly name: string;
  isAvailable(): Promise<EngineAvailability>;
  recognize(png: Buffer, options?: RecognizeOptions): Promise<OcrResult>;
}

export const LOW_CONFIDENCE_THRESHOLD = 60;
export const DEFAULT_OCR_TIMEOUT_MS = 180_000;
export const SUPPORTED_LANGUAGES = ['eng'] as const;

/** Builds an OcrResult from word-level engine output. Pure and engine-independent. */
export function buildOcrResult(
  lines: OcrLine[],
  meta: { engine: string; language: string; durationMs: number; fullText?: string }
): OcrResult {
  const words = lines.flatMap(l => l.words).filter(w => w.text.trim().length > 0);
  const confidences = words.map(w => w.confidence).filter(c => Number.isFinite(c));
  const mean = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
  return {
    text: (meta.fullText ?? lines.map(l => l.text).join('\n')).replace(/\s+$/g, ''),
    meanConfidence: mean === null ? null : Math.round(mean * 10) / 10,
    words,
    lines,
    lowConfidenceWords: words.filter(w => w.confidence < LOW_CONFIDENCE_THRESHOLD).length,
    engine: meta.engine,
    language: meta.language,
    durationMs: meta.durationMs
  };
}

function resolveLanguageDir(explicit?: string, useBundled = true): string | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (useBundled && process.env.ANDROSCRN_OCR_DATA_DIR) candidates.push(process.env.ANDROSCRN_OCR_DATA_DIR);
  if (useBundled) try {
    const pkg = require.resolve('@tesseract.js-data/eng/package.json');
    candidates.push(path.join(path.dirname(pkg), '4.0.0_best_int'));
  } catch {
    // package not installed
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'eng.traineddata.gz')) || fs.existsSync(path.join(c, 'eng.traineddata'))) return c;
  }
  return null;
}

export interface TesseractEngineOptions {
  /** Directory containing `<lang>.traineddata(.gz)`. Defaults to the bundled English data. */
  langPath?: string;
  /** When false, only `langPath` is considered (no environment override or bundled package). Used by tests. */
  useBundledData?: boolean;
  /** Injectable module loader (tests substitute a fake tesseract.js). */
  loadTesseract?: () => any;
}

export class TesseractOcrEngine implements OcrEngine {
  public readonly name = 'tesseract.js';
  private options: TesseractEngineOptions;

  constructor(options: TesseractEngineOptions = {}) {
    this.options = options;
  }

  private load(): any {
    return (this.options.loadTesseract ?? (() => require('tesseract.js')))();
  }

  public async isAvailable(): Promise<EngineAvailability> {
    try {
      this.load();
    } catch {
      return { available: false, reason: 'The OCR engine (tesseract.js) is not installed. Reinstall AndroScrn or run `npm install`.' };
    }
    if (!resolveLanguageDir(this.options.langPath, this.options.useBundledData !== false)) {
      return { available: false, reason: 'OCR language data (eng.traineddata) was not found. Reinstall AndroScrn or set ANDROSCRN_OCR_DATA_DIR.' };
    }
    return { available: true };
  }

  public async recognize(png: Buffer, options: RecognizeOptions = {}): Promise<OcrResult> {
    const language = options.language ?? 'eng';
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) {
      throw new DocumentError('INVALID_ARGUMENT', `Unsupported OCR language "${language}". Available: ${SUPPORTED_LANGUAGES.join(', ')}.`);
    }
    const availability = await this.isAvailable();
    if (!availability.available) throw new DocumentError('OCR_UNAVAILABLE', availability.reason as string);
    if (options.signal?.aborted) throw new DocumentError('CANCELLED', 'OCR was cancelled.');

    const tesseract = this.load();
    const langPath = resolveLanguageDir(this.options.langPath, this.options.useBundledData !== false) as string;
    const started = Date.now();
    const report = (stage: string, progress: number) => options.onProgress?.({ stage, progress: Math.max(0, Math.min(1, progress)) });

    let worker: any = null;
    let disposed = false;
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    const cleanup = async () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener('abort', onAbort);
      if (worker) {
        const w = worker;
        worker = null;
        try {
          await w.terminate();
        } catch {
          // terminating an already-dead worker is harmless
        }
      }
    };

    const guard = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DocumentError('CANCELLED', 'OCR was cancelled.'));
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(
        () => reject(new DocumentError('TIMEOUT', 'OCR took too long and was stopped.')),
        options.timeoutMs ?? DEFAULT_OCR_TIMEOUT_MS
      );
    });
    guard.catch(() => undefined); // avoid unhandled rejection if the work settles first

    const work = (async () => {
      report('Loading OCR engine', 0);
      const created = await tesseract.createWorker(language, 1, {
        langPath,
        gzip: fs.existsSync(path.join(langPath, `${language}.traineddata.gz`)),
        cacheMethod: 'none',
        logger: (m: any) => {
          if (m && typeof m.progress === 'number') report(String(m.status || 'Working'), m.progress);
        }
      });
      if (disposed) {
        // Cancelled/timed out while the worker was still starting: do not leak it.
        try { await created.terminate(); } catch { /* already gone */ }
        throw new DocumentError('CANCELLED', 'OCR was cancelled.');
      }
      worker = created;
      const { data } = await worker.recognize(png, {}, { blocks: true, text: true });
      const lines: OcrLine[] = [];
      for (const block of data.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const line of paragraph.lines || []) {
            const words: OcrWord[] = (line.words || []).map((w: any) => ({
              text: String(w.text ?? ''),
              confidence: Number(w.confidence),
              bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }
            }));
            lines.push({
              text: String(line.text ?? '').replace(/\n$/, ''),
              confidence: Number(line.confidence),
              bbox: { x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1 },
              words
            });
          }
        }
      }
      report('Done', 1);
      return buildOcrResult(lines, {
        engine: this.name,
        language,
        durationMs: Date.now() - started,
        fullText: typeof data.text === 'string' ? data.text : undefined
      });
    })();

    try {
      return await Promise.race([work, guard]);
    } catch (err: any) {
      if (err instanceof DocumentError) throw err;
      throw new DocumentError('OCR_FAILED', `OCR failed: ${err?.message || 'unknown error'}`);
    } finally {
      work.catch(() => undefined);
      await cleanup();
    }
  }
}
