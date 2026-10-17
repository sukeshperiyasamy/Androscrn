import { RawImage, DocumentError, resizeToFit, cloneImage } from './image';

/**
 * Pure-TypeScript image preprocessing for document photos: grayscale, Otsu thresholding, document boundary
 * detection, perspective correction, rotation, deskew estimation and OCR-oriented contrast enhancement.
 *
 * All functions return new images; inputs are never mutated, so originals stay intact.
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface DetectionResult {
  /** Detected page corners in the coordinates of the analysed image, or null when no page was found. */
  corners: Quad | null;
  /** 0..1 - how rectangular the detected region is (component area / quadrilateral area). Null when not detected. */
  confidence: number | null;
  /** Why detection failed or was skipped. */
  reason?: 'no-document-found' | 'document-fills-frame' | 'low-contrast' | 'not-quadrilateral';
}

const DETECT_MAX_DIM = 640;

export function toGrayscale(img: RawImage): Uint8Array {
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    gray[i] = Math.round(0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]);
  }
  return gray;
}

export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

function boxBlur(gray: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += gray[yy * w + xx]; n++; }
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 2) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Orders four points as top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(points: Point[]): Quad {
  if (points.length !== 4) throw new DocumentError('INVALID_ARGUMENT', 'Exactly four corners are required.');
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));
  const tl = bySum[0];
  const br = bySum[3];
  const bl = byDiff[0];
  const tr = byDiff[3];
  return [tl, tr, br, bl];
}

/**
 * Finds the largest bright, roughly rectangular region (a sheet of paper on a darker surface).
 * Returns corners scaled back to the coordinates of `img`. This heuristic needs reasonable contrast between page
 * and background; it can fail on white-on-white scans, strong shadows or cluttered backgrounds.
 */
export function detectDocumentCorners(img: RawImage): DetectionResult {
  const small = resizeToFit(img, DETECT_MAX_DIM);
  const scale = img.width / small.width;
  const w = small.width, h = small.height;
  const gray = boxBlur(toGrayscale(small), w, h);
  const threshold = otsuThreshold(gray);

  let bright = 0, dark = 0, brightSum = 0, darkSum = 0;
  for (const v of gray) { if (v > threshold) { bright++; brightSum += v; } else { dark++; darkSum += v; } }
  if (bright === 0 || dark === 0 || brightSum / bright - darkSum / dark < 40) {
    return { corners: null, confidence: null, reason: 'low-contrast' };
  }

  // Largest 4-connected bright component
  const labels = new Int32Array(w * h);
  let best = { label: 0, size: 0 };
  let next = 1;
  const stack: number[] = [];
  const sizes: number[] = [0];
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] <= threshold || labels[i] !== 0) continue;
    let size = 0;
    stack.push(i);
    labels[i] = next;
    while (stack.length) {
      const p = stack.pop() as number;
      size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && gray[p - 1] > threshold && !labels[p - 1]) { labels[p - 1] = next; stack.push(p - 1); }
      if (x < w - 1 && gray[p + 1] > threshold && !labels[p + 1]) { labels[p + 1] = next; stack.push(p + 1); }
      if (y > 0 && gray[p - w] > threshold && !labels[p - w]) { labels[p - w] = next; stack.push(p - w); }
      if (y < h - 1 && gray[p + w] > threshold && !labels[p + w]) { labels[p + w] = next; stack.push(p + w); }
    }
    sizes.push(size);
    if (size > best.size) best = { label: next, size };
    next++;
  }

  const frameArea = w * h;
  if (best.size < frameArea * 0.12) return { corners: null, confidence: null, reason: 'no-document-found' };
  if (best.size > frameArea * 0.97) return { corners: null, confidence: null, reason: 'document-fills-frame' };

  // Boundary pixels of the component -> convex hull -> four extreme points
  const boundary: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (labels[p] !== best.label) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || labels[p - 1] !== best.label || labels[p + 1] !== best.label || labels[p - w] !== best.label || labels[p + w] !== best.label) {
        boundary.push({ x, y });
      }
    }
  }
  const hull = convexHull(boundary);
  if (hull.length < 4) return { corners: null, confidence: null, reason: 'not-quadrilateral' };

  const extreme = (score: (p: Point) => number, dir: 1 | -1) =>
    hull.reduce((a, b) => (dir * score(b) > dir * score(a) ? b : a));
  const quad: Quad = [
    extreme(p => p.x + p.y, -1),
    extreme(p => p.x - p.y, 1),
    extreme(p => p.x + p.y, 1),
    extreme(p => p.x - p.y, -1)
  ];
  const quadArea = polygonArea(quad);
  if (quadArea < 1) return { corners: null, confidence: null, reason: 'not-quadrilateral' };
  const confidence = Math.min(1, best.size / quadArea);
  // A real page fills most of its bounding quadrilateral (text holes lower this a little).
  if (confidence < 0.7) return { corners: null, confidence, reason: 'not-quadrilateral' };

  const scaled = quad.map(p => ({ x: p.x * scale, y: p.y * scale })) as Quad;
  return { corners: scaled, confidence };
}

/** Solves an 8x8 system by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    if (Math.abs(a[pivot][i]) < 1e-12) throw new DocumentError('INVALID_ARGUMENT', 'The selected corners do not form a valid quadrilateral.');
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= a[i][c] * x[c];
    x[i] = s / a[i][i];
  }
  return x;
}

export const MAX_OUTPUT_DIMENSION = 4000;

/**
 * Perspective-corrects the quadrilateral `corners` (TL, TR, BR, BL in image coordinates) into an upright
 * rectangle using a homography with bilinear sampling.
 */
export function perspectiveWarp(img: RawImage, corners: Quad): RawImage {
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = corners;
  let outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  let outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  if (!(outW >= 8 && outH >= 8)) throw new DocumentError('INVALID_ARGUMENT', 'The selected area is too small.');
  const limit = Math.max(outW, outH);
  if (limit > MAX_OUTPUT_DIMENSION) {
    const s = MAX_OUTPUT_DIMENSION / limit;
    outW = Math.round(outW * s);
    outH = Math.round(outH * s);
  }

  // Homography mapping destination rectangle -> source quad
  const dst: Point[] = [{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i];
    const { x: u, y: v } = corners[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = solveLinear(A, B);

  const out: RawImage = { width: outW, height: outH, data: new Uint8Array(outW * outH * 4) };
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const d = h6 * x + h7 * y + 1;
      const sx = (h0 * x + h1 * y + h2) / d;
      const sy = (h3 * x + h4 * y + h5) / d;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const at = (xx: number, yy: number) => img.data[(Math.min(img.height - 1, Math.max(0, yy)) * img.width + Math.min(img.width - 1, Math.max(0, xx))) * 4 + c];
        const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
        const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
        out.data[o + c] = top * (1 - fy) + bottom * fy;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** Rotates by multiples of 90 degrees clockwise. */
export function rotateQuarterTurns(img: RawImage, quarterTurns: number): RawImage {
  const turns = ((Math.round(quarterTurns) % 4) + 4) % 4;
  if (turns === 0) return cloneImage(img);
  const w = img.width, h = img.height;
  const swap = turns % 2 === 1;
  const out: RawImage = { width: swap ? h : w, height: swap ? w : h, data: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number, ny: number;
      if (turns === 1) { nx = h - 1 - y; ny = x; }
      else if (turns === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const s = (y * w + x) * 4, d = (ny * out.width + nx) * 4;
      out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1]; out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** Rotates by an arbitrary angle (degrees, clockwise) on an enlarged white canvas using bilinear sampling. */
export function rotateDegrees(img: RawImage, degrees: number): RawImage {
  if (!Number.isFinite(degrees)) throw new DocumentError('INVALID_ARGUMENT', 'Rotation angle must be a finite number.');
  const a = (degrees * Math.PI) / 180;
  if (Math.abs(degrees) < 1e-6) return cloneImage(img);
  const cos = Math.cos(a), sin = Math.sin(a);
  const w = img.width, h = img.height;
  const outW = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const outH = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const out: RawImage = { width: outW, height: outH, data: new Uint8Array(outW * outH * 4).fill(255) };
  const cx = w / 2, cy = h / 2, ocx = outW / 2, ocy = outH / 2;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const dx = x - ocx, dy = y - ocy;
      const sx = dx * cos + dy * sin + cx;
      const sy = -dx * sin + dy * cos + cy;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const p = (xx: number, yy: number) => img.data[(yy * w + xx) * 4 + c];
        out.data[o + c] = (p(x0, y0) * (1 - fx) + p(x1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x1, y1) * fx) * fy;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Estimates the skew of text lines in degrees (positive = text slopes clockwise) by maximising the variance of the
 * row-projection profile of dark pixels. Searches -15..+15 degrees. Returns 0 when there is not enough ink.
 */
export function estimateSkewAngle(img: RawImage): number {
  const small = resizeToFit(img, 500);
  const w = small.width, h = small.height;
  const gray = toGrayscale(small);
  const threshold = otsuThreshold(gray);
  const dark: Point[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] <= threshold * 0.9) dark.push({ x, y });
  if (dark.length < 50 || dark.length > w * h * 0.6) return 0;

  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const bins = new Map<number, number>();
    for (const p of dark) {
      const yy = Math.round(p.y * cos - p.x * sin);
      bins.set(yy, (bins.get(yy) || 0) + 1);
    }
    let s = 0;
    for (const v of bins.values()) s += v * v;
    return s;
  };
  let best = 0, bestScore = score(0);
  for (let deg = -15; deg <= 15; deg += 0.5) {
    const s = score(deg);
    if (s > bestScore * 1.0001) { bestScore = s; best = deg; }
  }
  return best;
}

/**
 * Grayscale + percentile contrast stretch, which helps OCR on dim or washed-out photos. Returns an RGBA image
 * (gray replicated) so downstream code has a single image type.
 */
export function enhanceForOcr(img: RawImage): RawImage {
  const gray = toGrayscale(img);
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const clip = Math.max(1, Math.floor(gray.length * 0.01));
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > clip) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > clip) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  const out: RawImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((gray[i] - lo) * 255) / range)));
    out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
  }
  return out;
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const crossProd = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const c1 = crossProd(a, b, c);
  const c2 = crossProd(a, b, d);
  const c3 = crossProd(c, d, a);
  const c4 = crossProd(c, d, b);
  return ((c1 > 1e-5 && c2 < -1e-5) || (c1 < -1e-5 && c2 > 1e-5)) && ((c3 > 1e-5 && c4 < -1e-5) || (c3 < -1e-5 && c4 > 1e-5));
}

export function isSelfIntersecting(quad: Quad | Point[]): boolean {
  if (!Array.isArray(quad) || quad.length !== 4) return true;
  const [p0, p1, p2, p3] = quad;
  return segmentsIntersect(p0, p1, p2, p3) || segmentsIntersect(p1, p2, p3, p0);
}

export function isConvexQuad(points: Quad | Point[]): boolean {
  if (!Array.isArray(points) || points.length !== 4) return false;
  const [p0, p1, p2, p3] = points;
  for (const p of points) {
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  if (isSelfIntersecting(points)) return false;
  const crossProd = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const c0 = crossProd(p0, p1, p2);
  const c1 = crossProd(p1, p2, p3);
  const c2 = crossProd(p2, p3, p0);
  const c3 = crossProd(p3, p0, p1);
  const eps = 1e-4;
  const allPos = c0 > eps && c1 > eps && c2 > eps && c3 > eps;
  const allNeg = c0 < -eps && c1 < -eps && c2 < -eps && c3 < -eps;
  return allPos || allNeg;
}

export function rotateQuadQuarterTurns(corners: Quad, width: number, height: number, quarterTurns: number): Quad {
  const turns = ((Math.round(quarterTurns) % 4) + 4) % 4;
  if (turns === 0) return [ ...corners ] as Quad;
  const rotated = corners.map(p => {
    let nx = p.x, ny = p.y;
    if (turns === 1) { nx = height - 1 - p.y; ny = p.x; }
    else if (turns === 2) { nx = width - 1 - p.x; ny = height - 1 - p.y; }
    else if (turns === 3) { nx = p.y; ny = width - 1 - p.x; }
    return { x: nx, y: ny };
  });
  return orderCorners(rotated);
}

export function validateQuad(corners: unknown, width: number, height: number): Quad {
  if (!Array.isArray(corners) || corners.length !== 4) {
    throw new DocumentError('INVALID_ARGUMENT', 'Four corner points are required.');
  }
  const pts = corners.map(c => {
    const p = c as Point;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new DocumentError('INVALID_ARGUMENT', 'Corner points must be numeric.');
    if (p.x < -1 || p.y < -1 || p.x > width + 1 || p.y > height + 1) throw new DocumentError('INVALID_ARGUMENT', 'Corner points must lie inside the image.');
    return { x: Math.min(width - 1, Math.max(0, p.x)), y: Math.min(height - 1, Math.max(0, p.y)) };
  }) as Quad;

  if (isSelfIntersecting(pts)) {
    throw new DocumentError('INVALID_ARGUMENT', 'The corners form a self-intersecting quadrilateral.');
  }

  const ordered = orderCorners(pts);
  if (!isConvexQuad(ordered) || isSelfIntersecting(ordered)) {
    throw new DocumentError('INVALID_ARGUMENT', 'The selected corners do not form a valid convex quadrilateral.');
  }
  if (polygonArea(ordered) < width * height * 0.01) {
    throw new DocumentError('INVALID_ARGUMENT', 'The selected area is too small to be a document.');
  }
  return ordered;
}
