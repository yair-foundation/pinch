/*
 * Reads a zip back: Pinch's own exports, whose entries are stored, and the
 * same folder zipped again by the system, whose entries are deflated and
 * come back through the browser's DecompressionStream. It reads the central
 * directory, so each entry is found by name. Folders, the `__MACOSX/` copies
 * macOS adds and entries in any other format are skipped.
 */

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** A deflated entry's bytes, inflated (also used by `zip-range.ts`). */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in the archive, by its path ("pinch-2026-10-20/notes.json"). */
export async function unzip(input: ArrayBuffer | Uint8Array): Promise<Map<string, Uint8Array>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is 22 bytes, followed by a comment of up to 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('It isn’t a zip file.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL)
      throw new Error('The zip is damaged.');
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || (method !== 0 && method !== 8))
      continue;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL)
      throw new Error('The zip is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) throw new Error('The zip is damaged.');
    const raw = bytes.subarray(start, start + compressed);
    files.set(name, method === 0 ? raw : await inflate(raw));
  }
  return files;
}
