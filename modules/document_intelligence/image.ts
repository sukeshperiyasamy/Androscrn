import crypto from 'crypto';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

/**
 * Image I/O and basic geometry for the local document workflow. Pure JavaScript (pngjs + jpeg-js): no native
 * modules, no network, nothing is ever written back to the file the image was read from.
 */

export type DocumentErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'IMAGE_TOO_LARGE'
  | 'CORRUPT_IMAGE'
  | 'INVALID_ARGUMENT'
  | 'OCR_UNAVAILABLE'
  | 'OCR_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'NOT_FOUND';

export class DocumentError extends Error {
  constructor(public code: DocumentErrorCode, message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

export type ImageFormat = 'png' | 'jpeg';

export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;

export function detectFormat(buf: Uint8Array): ImageFormat | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

export function sha256(buf: Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Reads the EXIF orientation tag (1-8) from a JPEG, or 1 when absent or unreadable. */
export function readJpegOrientation(buf: Uint8Array): number {
  try {
    let offset = 2;
    while (offset + 4 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const len = (buf[offset + 2] << 8) | buf[offset + 3];
      if (marker === 0xe1 && len >= 8 && String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]) === 'Exif') {
        const tiff = offset + 10;
        const little = buf[tiff] === 0x49;
        const u16 = (o: number) => (little ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1]);
        const u32 = (o: number) => (little ? (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0 : ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0);
        const ifd = tiff + u32(tiff + 4);
        const count = u16(ifd);
        for (let i = 0; i < count && i < 64; i++) {
          const entry = ifd + 2 + i * 12;
          if (u16(entry) === 0x0112) {
            const value = u16(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
        return 1;
      }
      if (marker === 0xda) break; // start of scan
      offset += 2 + len;
    }
  } catch {
    // fall through
  }
  return 1;
}

/** Applies an EXIF orientation (1-8) so the returned image is upright. */
export function applyOrientation(img: RawImage, orientation: number): RawImage {
  if (orientation === 1) return img;
  const w = img.width;
  const h = img.height;
  const swap = orientation >= 5;
  const out: RawImage = { width: swap ? h : w, height: swap ? w : h, data: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = x;
      let ny = y;
      switch (orientation) {
        case 2: nx = w - 1 - x; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        case 8: nx = y; ny = w - 1 - x; break;
      }
      const s = (y * w + x) * 4;
      const d = (ny * out.width + nx) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

export interface DecodedImage {
  image: RawImage;
  format: ImageFormat;
  /** EXIF orientation that was applied (1 = none). */
  orientationApplied: number;
}

/**
 * Decodes PNG or JPEG bytes. Unsupported or corrupt inputs raise a DocumentError with a user-presentable
 * message; oversized inputs are rejected before any pixel buffer is allocated.
 */
export function decodeImage(buf: Uint8Array): DecodedImage {
  if (!buf || buf.length === 0) throw new DocumentError('CORRUPT_IMAGE', 'The file is empty.');
  if (buf.length > MAX_INPUT_BYTES) {
    throw new DocumentError('IMAGE_TOO_LARGE', `The file is larger than the ${MAX_INPUT_BYTES / (1024 * 1024)} MB limit.`);
  }
  const format = detectFormat(buf);
  if (!format) {
    throw new DocumentError('UNSUPPORTED_FORMAT', 'Unsupported image format. Use a PNG or JPEG image.');
  }
  try {
    if (format === 'png') {
      // Check the declared size from the IHDR chunk before allocating pixel memory.
      if (buf.length >= 24) {
        const declaredW = ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0;
        const declaredH = ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0;
        guardPixels(declaredW, declaredH);
      }
      const header = PNG.sync.read(Buffer.from(buf));
      guardPixels(header.width, header.height);
      return { image: { width: header.width, height: header.height, data: new Uint8Array(header.data) }, format, orientationApplied: 1 };
    }
    const raw = jpeg.decode(Buffer.from(buf), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 768, maxResolutionInMP: MAX_PIXELS / 1_000_000 });
    guardPixels(raw.width, raw.height);
    const orientation = readJpegOrientation(buf);
    const image = applyOrientation({ width: raw.width, height: raw.height, data: new Uint8Array(raw.data) }, orientation);
    return { image, format, orientationApplied: orientation };
  } catch (err: any) {
    if (err instanceof DocumentError) throw err;
    throw new DocumentError('CORRUPT_IMAGE', `The image could not be decoded (${format.toUpperCase()}): ${err?.message || 'corrupt data'}`);
  }
}

function guardPixels(width: number, height: number) {
  if (!(width > 0 && height > 0)) throw new DocumentError('CORRUPT_IMAGE', 'The image has no pixels.');
  if (width * height > MAX_PIXELS) {
    throw new DocumentError('IMAGE_TOO_LARGE', `The image is ${width}x${height}; the limit is ${MAX_PIXELS / 1_000_000} megapixels.`);
  }
}

export function encodePng(img: RawImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).copy(png.data);
  return PNG.sync.write(png);
}

export function encodeJpeg(img: RawImage, quality = 85): Buffer {
  return Buffer.from(jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data) }, quality).data);
}

/** Area-averaging downscale (never upscales). */
export function resizeToFit(img: RawImage, maxDimension: number): RawImage {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxDimension) return img;
  const scale = maxDimension / longest;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out: RawImage = { width: w, height: h, data: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * img.height) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * img.width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * img.width + sx) * 4;
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
        }
      }
      const d = (y * w + x) * 4;
      out.data[d] = r / n; out.data[d + 1] = g / n; out.data[d + 2] = b / n; out.data[d + 3] = 255;
    }
  }
  return out;
}

export function cloneImage(img: RawImage): RawImage {
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}
