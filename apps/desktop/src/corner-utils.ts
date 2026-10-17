export interface Point {
  x: number;
  y: number;
}

export type Quad = [Point, Point, Point, Point];

export const CORNER_NAMES = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'] as const;

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

export function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    a += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(a) / 2;
}

export function orderCorners(points: Point[]): Quad {
  if (points.length !== 4) throw new Error('Exactly four corners are required.');
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));
  const tl = bySum[0];
  const br = bySum[3];
  const bl = byDiff[0];
  const tr = byDiff[3];
  return [tl, tr, br, bl];
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

export interface QuadValidation {
  valid: boolean;
  reason?: string;
}

export function validateCornerGeometry(corners: Quad | Point[] | null | undefined, width: number, height: number): QuadValidation {
  if (!corners || !Array.isArray(corners) || corners.length !== 4) {
    return { valid: false, reason: 'Exactly four corners are required.' };
  }
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return { valid: false, reason: `Corner ${CORNER_NAMES[i]} coordinates must be finite numbers.` };
    }
    if (p.x < -1 || p.x > width + 1 || p.y < -1 || p.y > height + 1) {
      return { valid: false, reason: `Corner ${CORNER_NAMES[i]} must stay within the image boundary.` };
    }
  }
  if (isSelfIntersecting(corners)) {
    return { valid: false, reason: 'Corners cross over each other (self-intersecting quadrilateral).' };
  }
  if (!isConvexQuad(corners)) {
    return { valid: false, reason: 'Corners must form a non-collapsed convex quadrilateral.' };
  }
  const area = polygonArea(corners);
  if (area < width * height * 0.01) {
    return { valid: false, reason: 'Selected page area is too small (less than 1% of the image).' };
  }
  return { valid: true };
}
