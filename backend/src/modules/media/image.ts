import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import multer from 'multer';
import { sha256 } from '../../lib/crypto.js';
import { unprocessable } from '../../lib/errors.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Memory upload with hard limits; content is validated by signature, never by name/MIME. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, parts: 6 },
});

export type ProcessedImage = { buffer: Buffer; contentType: 'image/jpeg'; width: number; height: number; sha256: string; sizeBytes: number };

/**
 * 1. Detect the real type from magic bytes (rejects executables, SVG, HTML, polyglots with bad headers).
 * 2. Fully decode with libvips (rejects corrupt/malicious images, decompression bombs via pixel limit).
 * 3. Auto-orient, resize, re-encode to JPEG — re-encoding drops ALL metadata (EXIF GPS, device ids).
 */
export async function processImage(input: Buffer | undefined, opts: { maxDimension: number; quality?: number; minDimension?: number }): Promise<ProcessedImage> {
  if (!input || input.length === 0) throw unprocessable('No image was uploaded', 'IMAGE_REQUIRED');
  if (input.length > MAX_IMAGE_BYTES) throw unprocessable('Image is too large', 'FILE_TOO_LARGE');
  const type = await fileTypeFromBuffer(input).catch(() => undefined);
  if (!type || !ALLOWED.has(type.mime)) throw unprocessable('Only JPEG, PNG or WebP images are accepted', 'UNSUPPORTED_FILE_TYPE');
  let pipeline: sharp.Sharp;
  let meta: sharp.Metadata;
  try {
    pipeline = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' });
    meta = await pipeline.metadata();
  } catch {
    throw unprocessable('The image could not be read', 'INVALID_IMAGE');
  }
  if (!meta.width || !meta.height) throw unprocessable('The image could not be read', 'INVALID_IMAGE');
  if (opts.minDimension && Math.min(meta.width, meta.height) < opts.minDimension) {
    throw unprocessable('The image resolution is too low', 'IMAGE_TOO_SMALL');
  }
  try {
    const { data, info } = await pipeline
      .rotate()
      .resize({ width: opts.maxDimension, height: opts.maxDimension, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: opts.quality ?? 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height, sha256: sha256(data), sizeBytes: data.length };
  } catch {
    throw unprocessable('The image could not be processed', 'INVALID_IMAGE');
  }
}
