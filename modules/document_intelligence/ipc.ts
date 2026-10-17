import { DocumentError, DocumentErrorCode } from './image';
import { Quad } from './preprocess';

/**
 * Payload validation and serialization helpers for the document IPC channels. Kept free of Electron so the
 * rules can be unit-tested; the main process calls these before touching any session.
 */

export type Parsed<T> = ({ ok: true } & T) | { ok: false; message: string };

const ID_RE = /^[0-9]{14}-[a-f0-9]{6}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function parseSessionRequest(payload: unknown): Parsed<{ id: string }> {
  const p = payload as { id?: unknown } | null;
  if (!p || typeof p !== 'object' || !isValidSessionId(p.id)) return { ok: false, message: 'Invalid document session.' };
  return { ok: true, id: p.id };
}

export interface ParsedProcess {
  id: string;
  /** undefined = use detected corners, null = full frame, array = manual corners. */
  corners: Quad | null | undefined;
  rotationQuarterTurns: number;
  rotationDegrees: number;
  enhance: boolean;
}

export function parseProcessRequest(payload: unknown): Parsed<{ value: ParsedProcess }> {
  const base = parseSessionRequest(payload);
  if (!base.ok) return { ok: false, message: (base as { message: string }).message };
  const p = payload as Record<string, unknown>;

  let corners: Quad | null | undefined;
  if (p.corners === undefined) corners = undefined;
  else if (p.corners === null) corners = null;
  else if (
    Array.isArray(p.corners) &&
    p.corners.length === 4 &&
    p.corners.every(c => c && typeof (c as any).x === 'number' && typeof (c as any).y === 'number' && Number.isFinite((c as any).x) && Number.isFinite((c as any).y))
  ) {
    corners = (p.corners as Array<{ x: number; y: number }>).map(c => ({ x: c.x, y: c.y })) as Quad;
  } else {
    return { ok: false, message: 'Corners must be four numeric points.' };
  }

  const turns = p.rotationQuarterTurns === undefined ? 0 : p.rotationQuarterTurns;
  if (typeof turns !== 'number' || !Number.isInteger(turns) || Math.abs(turns) > 8) {
    return { ok: false, message: 'Rotation must be a whole number of quarter turns.' };
  }
  const degrees = p.rotationDegrees === undefined ? 0 : p.rotationDegrees;
  if (typeof degrees !== 'number' || !Number.isFinite(degrees) || Math.abs(degrees) > 45) {
    return { ok: false, message: 'Fine rotation must be between -45 and 45 degrees.' };
  }
  const enhance = p.enhance === undefined ? false : p.enhance;
  if (typeof enhance !== 'boolean') return { ok: false, message: 'Enhance must be true or false.' };

  return { ok: true, value: { id: (base as { id: string }).id, corners, rotationQuarterTurns: turns, rotationDegrees: degrees, enhance } };
}

export function parseTextRequest(payload: unknown): Parsed<{ id: string; text: string }> {
  const base = parseSessionRequest(payload);
  if (!base.ok) return { ok: false, message: (base as { message: string }).message };
  const text = (payload as { text?: unknown }).text;
  if (typeof text !== 'string' || text.length > 2_000_000) return { ok: false, message: 'Text must be a string of at most 2,000,000 characters.' };
  return { ok: true, id: (base as { id: string }).id, text };
}

/** Only a bare PNG/JPEG file name inside the captures folder may be imported from there. */
export function parseCaptureName(payload: unknown): Parsed<{ fileName: string }> {
  const name = (payload as { fileName?: unknown } | null)?.fileName;
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return { ok: false, message: 'Invalid capture name.' };
  if (/[\\/:*?"<>|\u0000]/.test(name) || name.includes('..')) return { ok: false, message: 'Invalid capture name.' };
  if (!/\.(png|jpe?g)$/i.test(name)) return { ok: false, message: 'Only PNG and JPEG captures can be imported.' };
  return { ok: true, fileName: name };
}

export interface ErrorPayload {
  ok: false;
  code: DocumentErrorCode | 'UNKNOWN';
  message: string;
}

export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof DocumentError) return { ok: false, code: err.code, message: err.message };
  return { ok: false, code: 'UNKNOWN', message: 'Something went wrong while processing the document.' };
}
