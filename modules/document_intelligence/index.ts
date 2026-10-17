import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  DocumentError,
  RawImage,
  ImageFormat,
  decodeImage,
  encodePng,
  resizeToFit,
  sha256,
  MAX_INPUT_BYTES
} from './image';
import {
  Quad,
  DetectionResult,
  detectDocumentCorners,
  perspectiveWarp,
  rotateQuarterTurns,
  rotateDegrees,
  enhanceForOcr,
  estimateSkewAngle,
  validateQuad
} from './preprocess';
import { OcrEngine, OcrResult, OcrProgress } from './ocr';
import { buildSearchablePdf } from './pdf';
import { alignEditedText, AlignmentResult } from './align';

export * from './image';
export * from './preprocess';
export * from './ocr';
export * from './pdf';
export * from './align';

export const PREVIEW_MAX_DIMENSION = 900;

export interface DocumentSession {
  id: string;
  sourceName: string;
  format: ImageFormat;
  /** SHA-256 of the original bytes exactly as imported. */
  originalSha256: string;
  originalBytes: Buffer;
  /** Upright (EXIF-corrected) original pixels. Never modified. */
  original: RawImage;
  detection?: DetectionResult;
  processed?: RawImage;
  ocr?: OcrResult;
  /** Text as edited by the user; the raw OCR output stays in `ocr`. */
  editedText?: string;
}

export interface Preview {
  dataUrl: string;
  width: number;
  height: number;
  /** Factor from original pixels to preview pixels. */
  scale: number;
}

export interface AnalysisResult {
  detection: DetectionResult;
  skewDegrees: number;
  preview: Preview;
  width: number;
  height: number;
}

export interface ProcessOptions {
  /** Corners in original-image pixels, `null` for the full frame, or omitted to use the detected corners (if any). */
  corners?: Quad | null;
  /** Clockwise quarter turns applied after cropping. */
  rotationQuarterTurns?: number;
  /** Additional fine rotation in degrees (-45..45). */
  rotationDegrees?: number;
  enhance?: boolean;
}

export interface SavedArtifacts {
  directory: string;
  original: string;
  processed: string | null;
  ocrJson: string | null;
  text: string | null;
  manifest: string;
}

export interface PdfExportResult {
  path: string;
  /** Which text the invisible layer contains. */
  textSource: 'ocr' | 'edited';
  /** Edited-text export only: words added (positions approximate), dropped and replaced (original positions). */
  insertedWords: number;
  removedWords: number;
  replacedWords: number;
}

export function makePreview(img: RawImage, maxDimension = PREVIEW_MAX_DIMENSION): Preview {
  const small = resizeToFit(img, maxDimension);
  return {
    dataUrl: `data:image/png;base64,${encodePng(small).toString('base64')}`,
    width: small.width,
    height: small.height,
    scale: small.width / img.width
  };
}

/**
 * Orchestrates import -> analyse -> process -> OCR -> review -> export. The original image bytes are held
 * read-only and are only ever copied, never rewritten.
 */
export class DocumentWorkflow {
  constructor(private engine: OcrEngine) {}

  public importBytes(bytes: Uint8Array, sourceName = 'image'): DocumentSession {
    const buf = Buffer.from(bytes);
    const decoded = decodeImage(buf);
    return {
      id: `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
      sourceName: path.basename(sourceName),
      format: decoded.format,
      originalSha256: sha256(buf),
      originalBytes: buf,
      original: decoded.image
    };
  }

  public importFile(filePath: string): DocumentSession {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new DocumentError('NOT_FOUND', 'The selected file could not be found.');
    }
    if (!stat.isFile()) throw new DocumentError('NOT_FOUND', 'The selected path is not a file.');
    if (stat.size > MAX_INPUT_BYTES) {
      throw new DocumentError('IMAGE_TOO_LARGE', `The file is larger than the ${MAX_INPUT_BYTES / (1024 * 1024)} MB limit.`);
    }
    return this.importBytes(fs.readFileSync(filePath), filePath);
  }

  public analyze(session: DocumentSession): AnalysisResult {
    const detection = detectDocumentCorners(session.original);
    session.detection = detection;
    return {
      detection,
      skewDegrees: estimateSkewAngle(session.original),
      preview: makePreview(session.original),
      width: session.original.width,
      height: session.original.height
    };
  }

  public process(session: DocumentSession, options: ProcessOptions = {}): { image: RawImage; preview: Preview } {
    let working: RawImage = session.original;

    let corners: Quad | null;
    if (options.corners === undefined) {
      corners = (session.detection ?? (session.detection = detectDocumentCorners(session.original))).corners;
    } else if (options.corners === null) {
      corners = null;
    } else {
      corners = validateQuad(options.corners, session.original.width, session.original.height);
    }
    if (corners) working = perspectiveWarp(working, corners);

    const turns = options.rotationQuarterTurns ?? 0;
    if (!Number.isFinite(turns)) throw new DocumentError('INVALID_ARGUMENT', 'Rotation must be a number of quarter turns.');
    if (turns % 4 !== 0) working = rotateQuarterTurns(working, turns);

    const degrees = options.rotationDegrees ?? 0;
    if (!Number.isFinite(degrees) || Math.abs(degrees) > 45) {
      throw new DocumentError('INVALID_ARGUMENT', 'Fine rotation must be between -45 and 45 degrees.');
    }
    if (degrees !== 0) working = rotateDegrees(working, degrees);

    if (options.enhance) working = enhanceForOcr(working);

    session.processed = working;
    session.ocr = undefined; // results of an earlier image no longer apply
    return { image: working, preview: makePreview(working) };
  }

  /** The image OCR and export operate on: the processed image if one exists, otherwise the original. */
  public workingImage(session: DocumentSession): RawImage {
    return session.processed ?? session.original;
  }

  public async recognize(
    session: DocumentSession,
    options: { language?: string; signal?: AbortSignal; onProgress?: (p: OcrProgress) => void; timeoutMs?: number } = {}
  ): Promise<OcrResult> {
    const availability = await this.engine.isAvailable();
    if (!availability.available) throw new DocumentError('OCR_UNAVAILABLE', availability.reason || 'OCR is not available.');
    const result = await this.engine.recognize(encodePng(this.workingImage(session)), options);
    session.ocr = result;
    session.editedText = undefined;
    return result;
  }

  public setText(session: DocumentSession, text: string): void {
    if (typeof text !== 'string') throw new DocumentError('INVALID_ARGUMENT', 'Text must be a string.');
    if (text.length > 2_000_000) throw new DocumentError('INVALID_ARGUMENT', 'The text is too long.');
    session.editedText = text;
  }

  public getText(session: DocumentSession): string {
    return session.editedText ?? session.ocr?.text ?? '';
  }

  /**
   * Writes a self-contained folder: an untouched copy of the original, the processed image, the raw OCR result,
   * the (possibly edited) text and a manifest with hashes. Nothing outside `<baseDir>/<session id>/` is touched.
   */
  public save(session: DocumentSession, baseDir: string): SavedArtifacts {
    const directory = path.join(baseDir, session.id);
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch {
      throw new DocumentError('WRITE_FAILED', 'The output folder could not be created. Check that the location is writable.');
    }

    const ext = session.format === 'png' ? 'png' : 'jpg';
    const originalPath = path.join(directory, `original.${ext}`);
    fs.writeFileSync(originalPath, session.originalBytes);

    let processedPath: string | null = null;
    let processedHash: string | null = null;
    if (session.processed) {
      const png = encodePng(session.processed);
      processedPath = path.join(directory, 'processed.png');
      fs.writeFileSync(processedPath, png);
      processedHash = sha256(png);
    }

    let ocrPath: string | null = null;
    if (session.ocr) {
      ocrPath = path.join(directory, 'ocr.json');
      fs.writeFileSync(ocrPath, JSON.stringify(session.ocr, null, 2), 'utf8');
    }

    let textPath: string | null = null;
    const text = this.getText(session);
    if (session.ocr || session.editedText !== undefined) {
      textPath = path.join(directory, 'text.txt');
      fs.writeFileSync(textPath, text, 'utf8');
    }

    const manifestPath = path.join(directory, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          id: session.id,
          sourceName: session.sourceName,
          createdAt: new Date().toISOString(),
          original: { file: path.basename(originalPath), sha256: session.originalSha256, width: session.original.width, height: session.original.height },
          processed: processedPath ? { file: 'processed.png', sha256: processedHash, width: session.processed!.width, height: session.processed!.height } : null,
          ocr: session.ocr
            ? { engine: session.ocr.engine, language: session.ocr.language, meanConfidence: session.ocr.meanConfidence, words: session.ocr.words.length, lowConfidenceWords: session.ocr.lowConfidenceWords }
            : null,
          textEditedByUser: session.editedText !== undefined && session.editedText !== session.ocr?.text
        },
        null,
        2
      ),
      'utf8'
    );

    return { directory, original: originalPath, processed: processedPath, ocrJson: ocrPath, text: textPath, manifest: manifestPath };
  }

  /**
   * Builds and writes a searchable PDF. Requires OCR output to position text on the page. If the user edited the
   * text, the invisible layer carries the *edited* words: unchanged and replaced words sit at their original
   * positions, inserted words are placed next to their neighbour (approximate), deleted words are dropped.
   */
  public exportSearchablePdf(session: DocumentSession, baseDir: string): PdfExportResult {
    if (!session.ocr || session.ocr.words.length === 0) {
      throw new DocumentError('INVALID_ARGUMENT', 'Run OCR first: a searchable PDF needs recognized text to embed.');
    }
    const edited = session.editedText !== undefined && session.editedText !== session.ocr.text;
    const alignment: AlignmentResult | null = edited ? alignEditedText(session.ocr.words, session.editedText as string) : null;
    const directory = path.join(baseDir, session.id);
    const pdf = buildSearchablePdf(this.workingImage(session), session.ocr, { title: session.sourceName, words: alignment?.words });
    const target = path.join(directory, 'searchable.pdf');
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(target, pdf);
    } catch {
      throw new DocumentError('WRITE_FAILED', 'The PDF could not be written. Check that the location is writable and has free space.');
    }
    return { path: target, textSource: edited ? 'edited' : 'ocr', insertedWords: alignment?.inserted ?? 0, removedWords: alignment?.removed ?? 0, replacedWords: alignment?.replaced ?? 0 };
  }
}
