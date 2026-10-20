export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** The image type from the file's first bytes, so nothing but an image is ever sent to the model. */
export function sniffImage(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | undefined {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  return undefined;
}

/**
 * A JPEG's width and height from its frame header (any SOF marker), without decoding it; null
 * when the bytes aren't a JPEG or end before the header.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    // SOF0 to SOF15, but not DHT (C4), JPG (C8) or DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return {
        height: (bytes[at + 5] << 8) | bytes[at + 6],
        width: (bytes[at + 7] << 8) | bytes[at + 8],
      };
    at += 2 + length;
  }
  return null;
}
