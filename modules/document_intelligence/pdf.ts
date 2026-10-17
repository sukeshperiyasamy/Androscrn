import { RawImage, DocumentError, encodeJpeg } from './image';
import { OcrResult } from './ocr';

/**
 * Minimal, dependency-free searchable-PDF writer.
 *
 * Page = the processed image, drawn full-page, plus an invisible text layer (text rendering mode 3) with one text
 * object per recognized word positioned at the word's bounding box. Viewers can search, select and copy that text.
 *
 * Honest limits:
 *  - The text layer is the OCR output. Text the user edits afterwards is saved separately; it is not re-embedded.
 *  - Base-14 Helvetica with WinAnsi encoding is used, so characters outside Latin-1 are replaced with "?" in the
 *    invisible layer. (The bundled OCR language is English, which fits.)
 *  - Glyph widths are approximated, so selection highlights may be slightly wider or narrower than the word.
 */

const POINTS_PER_INCH = 72;
const DEFAULT_DPI = 150;

export interface PdfOptions {
  dpi?: number;
  jpegQuality?: number;
  title?: string;
}

/** Characters representable in WinAnsi (approximated by Latin-1); everything else becomes "?". */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code === 0x0a || code === 0x0d || code === 0x09) out += ' ';
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else out += '?';
  }
  return out;
}

export function escapePdfString(text: string): string {
  let out = '';
  for (const ch of toWinAnsi(text)) {
    const code = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return out;
}

/** Rough Helvetica advance width in 1/1000 em for horizontal fitting. */
function approxWidth1000(text: string): number {
  let w = 0;
  for (const ch of toWinAnsi(text)) {
    if (ch === ' ') w += 278;
    else if ('il.,:;\'|!'.includes(ch)) w += 250;
    else if ('fjrtI()[]{}-'.includes(ch)) w += 333;
    else if ('mwMW'.includes(ch)) w += 833;
    else if (ch >= 'A' && ch <= 'Z') w += 667;
    else if (ch >= '0' && ch <= '9') w += 556;
    else w += 520;
  }
  return Math.max(1, w);
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

export function buildSearchablePdf(image: RawImage, ocr: OcrResult, options: PdfOptions = {}): Buffer {
  if (!image || image.width < 1 || image.height < 1) throw new DocumentError('INVALID_ARGUMENT', 'No image to export.');
  if (!ocr || !Array.isArray(ocr.words)) throw new DocumentError('INVALID_ARGUMENT', 'No OCR result to embed.');

  const dpi = options.dpi ?? DEFAULT_DPI;
  const scale = POINTS_PER_INCH / dpi;
  const pageW = image.width * scale;
  const pageH = image.height * scale;

  // Content stream: image first, invisible text on top.
  const content: string[] = [`q ${num(pageW)} 0 0 ${num(pageH)} 0 0 cm /Im0 Do Q`, 'BT', '3 Tr'];
  let embedded = 0;
  for (const word of ocr.words) {
    const text = word.text.trim();
    if (!text) continue;
    const { x0, y0, x1, y1 } = word.bbox;
    const boxW = Math.max(1, (x1 - x0) * scale);
    const boxH = Math.max(1, (y1 - y0) * scale);
    const fontSize = Math.max(1, boxH * 0.85);
    const natural = (approxWidth1000(text) / 1000) * fontSize;
    const tz = Math.max(10, Math.min(400, (boxW / natural) * 100));
    const px = x0 * scale;
    const py = pageH - y1 * scale + boxH * 0.2;
    content.push(`/F1 ${num(fontSize)} Tf ${num(tz)} Tz 1 0 0 1 ${num(px)} ${num(py)} Tm (${escapePdfString(text)}) Tj`);
    embedded++;
  }
  content.push('ET');
  const contentStream = content.join('\n');

  const jpeg = encodeJpeg(image, options.jpegQuality ?? 85);

  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length;
  };

  const info = options.title ? `/Title (${escapePdfString(options.title)}) ` : '';
  add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); // 2
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>`); // 3
  add(Buffer.concat([
    Buffer.from(`<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n`, 'latin1'),
    Buffer.from(contentStream, 'latin1'),
    Buffer.from('\nendstream', 'latin1')
  ])); // 4
  add(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'),
    jpeg,
    Buffer.from('\nendstream', 'latin1')
  ])); // 5
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 6
  add(`<< ${info}/Producer (AndroScrn) /Creator (AndroScrn Document Intelligence) /Keywords (words:${embedded}) >>`); // 7

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1')];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  objects.forEach((obj, i) => {
    offsets.push(pos);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(head, obj, tail);
    pos += head.length + obj.length + tail.length;
  });
  const xrefStart = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

/** Test/diagnostic helper: extracts the strings drawn in the invisible text layer of a PDF built by this module. */
export function extractTextLayer(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const out: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\) Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1].replace(/\\([()\\])/g, '$1').replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  return out;
}
