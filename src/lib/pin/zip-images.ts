/*
 * A zip of screenshots (D208): what isn't a Pinch export is read for the images and PDFs in it,
 * which then come in as if they had been chosen one by one. Pure: the zip's entries, by path,
 * as `unzip` gives them.
 */

/** The kinds of image a zip's entries are taken as, by their extension. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
};

/** A file found in a zip, to come in as a screenshot: its name, its type and its bytes. */
export type ZipImage = { path: string; name: string; type: string; bytes: Uint8Array };

/** Whether a zip is a Pinch export: one with a notes.json in it, at any depth. */
export const isPinchExport = (files: ReadonlyMap<string, Uint8Array>) =>
  [...files.keys()].some((k) => k === 'notes.json' || k.endsWith('/notes.json'));

/**
 * The images and PDFs in a zip, in the order their names sort, numbers counted as numbers
 * ("slide 2" before "slide 10"), folder by folder. Hidden files are left out: the "._" copies
 * macOS adds, ".DS_Store", and anything in a folder whose name begins with a dot.
 */
export function imagesInZip(files: ReadonlyMap<string, Uint8Array>): ZipImage[] {
  const out: ZipImage[] = [];
  for (const [path, bytes] of files) {
    const parts = path.split('/');
    if (parts.some((p) => p.startsWith('.'))) continue;
    const name = parts[parts.length - 1];
    const type = IMAGE_TYPES[name.split('.').pop()?.toLowerCase() ?? ''];
    if (!type || !bytes.length) continue;
    out.push({ path, name, type, bytes });
  }
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return out.sort((a, b) => order.compare(a.path, b.path));
}
