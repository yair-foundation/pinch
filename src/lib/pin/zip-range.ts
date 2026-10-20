import { inflate } from './unzip';

/*
 * Some entries of a zip, read by byte ranges (D94): the end record from the
 * archive's tail, then its central directory, then each wanted entry's local
 * header and data. A batch's zip in the account is tens of megabytes; an
 * agent asking for one rule's close-ups needs a few hundred kilobytes of it.
 * `read` returns bytes `start` to `end` (exclusive), from a store that takes
 * HTTP ranges or from memory. Stored and deflated entries, no ZIP64: Pinch's
 * zips stay far below 4 GB.
 */

export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** The end record is 22 bytes, after which a comment of up to 64 KB may follow. */
export const TAIL_BYTES = 22 + 0xffff;

const viewOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The wanted entries found in the archive, by their path inside it; missing ones are left out. */
export async function readZipEntries(
  read: ReadRange,
  size: number,
  wanted: Iterable<string>,
): Promise<Map<string, Uint8Array>> {
  const names = new Set(wanted);
  const found = new Map<string, Uint8Array>();
  if (!names.size || size < 22) return found;
  const tailStart = Math.max(0, size - TAIL_BYTES);
  const tail = await read(tailStart, size);
  const tv = viewOf(tail);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('It isn’t a zip file.');
  const count = tv.getUint16(end + 10, true);
  const dirSize = tv.getUint32(end + 12, true);
  const dirAt = tv.getUint32(end + 16, true);
  if (dirAt + dirSize > size) throw new Error('The zip is damaged.');
  // The directory is often inside the tail already.
  const dir =
    dirAt >= tailStart
      ? tail.subarray(dirAt - tailStart, dirAt - tailStart + dirSize)
      : await read(dirAt, dirAt + dirSize);
  const dv = viewOf(dir);
  const decoder = new TextDecoder();
  const entries: { name: string; method: number; compressed: number; local: number }[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > dir.length || dv.getUint32(at, true) !== CENTRAL)
      throw new Error('The zip is damaged.');
    const method = dv.getUint16(at + 10, true);
    const compressed = dv.getUint32(at + 20, true);
    const nameLength = dv.getUint16(at + 28, true);
    const extraLength = dv.getUint16(at + 30, true);
    const commentLength = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = decoder.decode(dir.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (names.has(name) && (method === 0 || method === 8))
      entries.push({ name, method, compressed, local });
  }
  await Promise.all(
    entries.map(async (e) => {
      const head = await read(e.local, e.local + 30);
      const hv = viewOf(head);
      if (head.length < 30 || hv.getUint32(0, true) !== LOCAL)
        throw new Error('The zip is damaged.');
      const start = e.local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      if (start + e.compressed > size) throw new Error('The zip is damaged.');
      const raw = await read(start, start + e.compressed);
      found.set(e.name, e.method === 0 ? raw : await inflate(raw));
    }),
  );
  return found;
}
