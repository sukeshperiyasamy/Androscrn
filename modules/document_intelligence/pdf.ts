import { RawImage, DocumentError, encodeJpeg } from './image';
import { OcrResult, OcrWord } from './ocr';

/**
 * Robust searchable-PDF writer with full Unicode support (Type 0 composite font + ToUnicode CMap).
 *
 * Page = the processed image, drawn full-page, plus an invisible text layer (text rendering mode 3) with one text
 * run per text line, positioned at the line's bounding box and fitted to its width. Words are separated by real
 * spaces, so searching and copying work across words. Viewers can search, select and copy that text.
 *
 * Unicode strategy:
 *  - Type 0 Composite font (/Identity-H) with dynamic ToUnicode CMap and CIDFontType2 descriptor.
 *  - Supports full BMP Unicode (accented Latin, typographic quotes, dashes, ellipsis, currency symbols, CJK, etc.)
 *    without replacing characters with '?'.
 *  - Text runs are encoded as 2-byte hex strings `<...>` mapped via `/ToUnicode` so viewers extract exact characters
 *    without character loss or escape corruption.
 *  - Text layout maintains line bounding boxes and baseline positioning with proportional horizontal scaling.
 */

const POINTS_PER_INCH = 72;
const DEFAULT_DPI = 150;

export interface PdfOptions {
  /** Words to draw in the invisible text layer instead of `ocr.words` (e.g. the aligned, user-edited text). */
  words?: OcrWord[];
  dpi?: number;
  jpegQuality?: number;
  title?: string;
}

/** Legacy helper: characters representable in WinAnsi (approximated by Latin-1); everything else becomes "?". */
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

/** Advance width in 1/1000 em for horizontal line fitting across scripts. */
export function approxCharWidth1000(ch: string): number {
  const code = ch.codePointAt(0) ?? 32;
  if (ch === ' ') return 278;
  if ('il.,:;\'|!'.includes(ch)) return 250;
  if ('fjrtI()[]{}-'.includes(ch)) return 333;
  if ('mwMW'.includes(ch)) return 833;
  if (ch === '—' || ch === '…') return 1000;
  if (ch === '–') return 500;
  if (ch === '“' || ch === '”' || ch === '‘' || ch === '’') return 400;
  // CJK, Katakana, Hiragana, Hangul
  if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3040 && code <= 0x30ff) || (code >= 0xac00 && code <= 0xd7af)) return 1000;
  if (ch >= 'A' && ch <= 'Z') return 667;
  if (ch >= '0' && ch <= '9') return 556;
  return 520;
}

export function approxLineWidth1000(text: string): number {
  let w = 0;
  for (const ch of Array.from(text)) {
    w += approxCharWidth1000(ch);
  }
  return Math.max(1, w);
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

function assemblePdf(objects: Buffer[], infoObjIndex: number): Buffer {
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
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjIndex} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

export function buildSearchablePdf(image: RawImage, ocr: OcrResult, options: PdfOptions = {}): Buffer {
  if (!image || image.width < 1 || image.height < 1) throw new DocumentError('INVALID_ARGUMENT', 'No image to export.');
  if (!ocr || !Array.isArray(ocr.words)) throw new DocumentError('INVALID_ARGUMENT', 'No OCR result to embed.');

  const dpi = options.dpi ?? DEFAULT_DPI;
  const scale = POINTS_PER_INCH / dpi;
  const pageW = image.width * scale;
  const pageH = image.height * scale;

  const words = options.words ?? ocr.words;
  let totalLength = 0;
  for (const w of words) totalLength += w.text.length;
  if (totalLength > 2_000_000) throw new DocumentError('INVALID_ARGUMENT', 'The text is too long.');

  const lines: Array<{ words: OcrWord[]; x0: number; x1: number; y0: number; y1: number }> = [];
  for (const word of words) {
    if (!word.text.trim()) continue;
    const { x0, y0, x1, y1 } = word.bbox;
    const cy = (y0 + y1) / 2;
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(cy - (cur.y0 + cur.y1) / 2) <= 0.6 * Math.max(1, cur.y1 - cur.y0)) {
      cur.words.push(word);
      cur.x0 = Math.min(cur.x0, x0); cur.x1 = Math.max(cur.x1, x1);
      cur.y0 = Math.min(cur.y0, y0); cur.y1 = Math.max(cur.y1, y1);
    } else {
      lines.push({ words: [word], x0, x1, y0, y1 });
    }
  }

  const jpeg = encodeJpeg(image, options.jpegQuality ?? 85);
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length;
  };

  const info = options.title ? `/Title (${escapePdfString(options.title)}) ` : '';

  if (lines.length === 0) {
    // Empty text / image-only page
    const contentStream = `q ${num(pageW)} 0 0 ${num(pageH)} 0 0 cm /Im0 Do Q\nBT\n3 Tr\nET`;
    add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
    add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); // 2
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`); // 3
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
    add(`<< ${info}/Producer (AndroScrn) /Creator (AndroScrn Document Intelligence) /Keywords (words:0) >>`); // 6
    return assemblePdf(objects, 6);
  }

  // Collect unique characters to map to CIDs
  const charToCid = new Map<string, number>();
  const cidToHex: Array<{ cid: number; hex: string; width: number }> = [];
  let nextCid = 1;

  const getCid = (ch: string): number => {
    let cid = charToCid.get(ch);
    if (!cid) {
      cid = nextCid++;
      charToCid.set(ch, cid);
      const cp = ch.codePointAt(0) ?? 32;
      const w = approxCharWidth1000(ch);
      if (cp <= 0xffff) {
        cidToHex.push({ cid, hex: cp.toString(16).padStart(4, '0'), width: w });
      } else {
        const hi = ch.charCodeAt(0).toString(16).padStart(4, '0');
        const lo = ch.charCodeAt(1).toString(16).padStart(4, '0');
        cidToHex.push({ cid, hex: `${hi}${lo}`, width: w });
      }
    }
    return cid;
  };

  const spaceCid = getCid(' ');

  const content: string[] = [`q ${num(pageW)} 0 0 ${num(pageH)} 0 0 cm /Im0 Do Q`, 'BT', '3 Tr'];
  let embedded = 0;

  for (const line of lines) {
    const text = line.words.map(w => w.text.trim()).join(' ');
    const boxW = Math.max(1, (line.x1 - line.x0) * scale);
    const boxH = Math.max(1, (line.y1 - line.y0) * scale);
    const fontSize = Math.max(1, boxH * 0.85);
    const natural = (approxLineWidth1000(text) / 1000) * fontSize;
    const tz = Math.max(10, Math.min(400, (boxW / natural) * 100));
    const px = line.x0 * scale;
    const py = pageH - line.y1 * scale + boxH * 0.2;

    let hexRuns = '';
    for (const ch of Array.from(text)) {
      const cid = getCid(ch);
      hexRuns += cid.toString(16).padStart(4, '0');
    }
    // Trailing space separates lines in text extraction
    hexRuns += spaceCid.toString(16).padStart(4, '0');

    content.push(`/F1 ${num(fontSize)} Tf ${num(tz)} Tz 1 0 0 1 ${num(px)} ${num(py)} Tm <${hexRuns}> Tj`);
    embedded += line.words.length;
  }
  content.push('ET');
  const contentStream = content.join('\n');

  // Build ToUnicode CMap
  const cmapLines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Custom-ToUnicode def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange'
  ];

  for (let i = 0; i < cidToHex.length; i += 100) {
    const chunk = cidToHex.slice(i, i + 100);
    cmapLines.push(`${chunk.length} beginbfchar`);
    for (const item of chunk) {
      cmapLines.push(`<${item.cid.toString(16).padStart(4, '0')}> <${item.hex}>`);
    }
    cmapLines.push('endbfchar');
  }
  cmapLines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  const toUnicodeCMap = cmapLines.join('\n');

  const widthsEntries = cidToHex.map(c => `${c.cid} [ ${c.width} ]`).join(' ');

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
  // 6: Type0 Font
  add('<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>'); // 6
  // 7: CIDFontType2
  add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 600 /W [ ${widthsEntries} ] >>`); // 7
  // 8: ToUnicode stream
  add(Buffer.concat([
    Buffer.from(`<< /Length ${Buffer.byteLength(toUnicodeCMap, 'latin1')} >>\nstream\n`, 'latin1'),
    Buffer.from(toUnicodeCMap, 'latin1'),
    Buffer.from('\nendstream', 'latin1')
  ])); // 8
  // 9: FontDescriptor
  add('<< /Type /FontDescriptor /FontName /Helvetica /Flags 32 /FontBBox [-200 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>'); // 9
  // 10: Info
  add(`<< ${info}/Producer (AndroScrn) /Creator (AndroScrn Document Intelligence) /Keywords (words:${embedded}) >>`); // 10

  return assemblePdf(objects, 10);
}

/** Test/diagnostic helper: the words drawn in the invisible text layer of a PDF built by this module (lines split on spaces). */
export function extractTextLayer(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const out: string[] = [];

  // Parse ToUnicode CMap if present
  const cidMap = new Map<string, string>();
  const bfcharRe = /(\d+)\s+beginbfchar([\s\S]*?)endbfchar/g;
  let bfm: RegExpExecArray | null;
  while ((bfm = bfcharRe.exec(text))) {
    const lines = bfm[2].trim().split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/);
      if (m) {
        const cid = m[1].toLowerCase();
        const hex = m[2];
        let decoded = '';
        for (let i = 0; i < hex.length; i += 4) {
          decoded += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
        }
        cidMap.set(cid, decoded);
      }
    }
  }

  // Parse hex text runs <...> Tj
  const hexRe = /<([0-9a-fA-F]+)>\s*Tj/g;
  let hm: RegExpExecArray | null;
  let foundHex = false;
  while ((hm = hexRe.exec(text))) {
    foundHex = true;
    const hex = hm[1];
    let line = '';
    for (let i = 0; i < hex.length; i += 4) {
      const cid = hex.slice(i, i + 4).toLowerCase();
      line += cidMap.get(cid) || String.fromCharCode(parseInt(cid, 16));
    }
    out.push(line);
  }

  if (foundHex) {
    return out.flatMap(line => line.split(' ').filter(w => w.length > 0));
  }

  // Fallback: literal string runs (...) Tj
  const re = /\(((?:\\.|[^\\)])*)\) Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1].replace(/\\([()\\])/g, '$1').replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  }
  return out.flatMap(line => line.split(' ').filter(w => w.length > 0));
}
