import { RawImage } from '../../../modules/document_intelligence/image';

/**
 * Deterministic synthetic fixtures for the document-intelligence tests. Nothing here is a real photograph:
 * the "documents" are generated bitmaps, so results say nothing about real-world OCR accuracy.
 */

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};

export function createImage(width: number, height: number, fill: [number, number, number] = [255, 255, 255]): RawImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function fillRect(img: RawImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
}

/** Draws block-letter text (upper-case letters, digits, spaces) with its top-left corner at (x, y). */
export function drawBlockText(img: RawImage, text: string, x: number, y: number, scale: number, rgb: [number, number, number] = [0, 0, 0]) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] || GLYPHS[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          fillRect(img, cx + col * scale, y + row * scale, cx + (col + 1) * scale, y + (row + 1) * scale, rgb);
        }
      }
    }
    cx += 6 * scale;
  }
}

/** A white page with several lines of block text on a plain background. */
export function makeTextPage(lines: string[], scale = 6, margin = 40): RawImage {
  const lineHeight = 10 * scale;
  const maxChars = Math.max(...lines.map(l => l.length));
  const width = margin * 2 + maxChars * 6 * scale;
  const height = margin * 2 + lines.length * lineHeight;
  const img = createImage(width, height);
  lines.forEach((line, i) => drawBlockText(img, line, margin, margin + i * lineHeight, scale));
  return img;
}

/** Bilinear sample used to place a flat page inside a larger photo with rotation/perspective. */
function sampleBilinear(img: RawImage, x: number, y: number): [number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number, c: number) => {
    const cx = Math.min(img.width - 1, Math.max(0, xx));
    const cy = Math.min(img.height - 1, Math.max(0, yy));
    return img.data[(cy * img.width + cx) * 4 + c];
  };
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
    const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
    out.push(top * (1 - fy) + bottom * fy);
  }
  return out as [number, number, number];
}

/**
 * Places `page` on a dark background so its corners land on `quad` (TL, TR, BR, BL) using an inverse bilinear
 * mapping (exact for parallelograms, a good approximation for mild perspective). Returns the photo.
 */
export function placePageOnBackground(
  page: RawImage,
  photoWidth: number,
  photoHeight: number,
  quad: Array<{ x: number; y: number }>,
  background: [number, number, number] = [35, 35, 40]
): RawImage {
  const photo = createImage(photoWidth, photoHeight, background);
  const [tl, tr, br, bl] = quad;
  for (let y = 0; y < photoHeight; y++) {
    for (let x = 0; x < photoWidth; x++) {
      // Solve bilinear (u, v) by Newton iteration
      let u = 0.5;
      let v = 0.5;
      for (let iter = 0; iter < 12; iter++) {
        const px = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + u * v * br.x + (1 - u) * v * bl.x;
        const py = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + u * v * br.y + (1 - u) * v * bl.y;
        const dxu = -(1 - v) * tl.x + (1 - v) * tr.x + v * br.x - v * bl.x;
        const dyu = -(1 - v) * tl.y + (1 - v) * tr.y + v * br.y - v * bl.y;
        const dxv = -(1 - u) * tl.x - u * tr.x + u * br.x + (1 - u) * bl.x;
        const dyv = -(1 - u) * tl.y - u * tr.y + u * br.y + (1 - u) * bl.y;
        const det = dxu * dyv - dxv * dyu;
        if (Math.abs(det) < 1e-9) break;
        const ex = x - px;
        const ey = y - py;
        u += (ex * dyv - ey * dxv) / det;
        v += (ey * dxu - ex * dyu) / det;
      }
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        const [r, g, b] = sampleBilinear(page, u * (page.width - 1), v * (page.height - 1));
        const o = (y * photoWidth + x) * 4;
        photo.data[o] = r;
        photo.data[o + 1] = g;
        photo.data[o + 2] = b;
      }
    }
  }
  return photo;
}

export function meanAbsDiff(a: RawImage, b: RawImage): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / (a.width * a.height);
}
