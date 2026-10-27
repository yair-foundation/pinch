import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/*
 * What the Blob store would keep, kept on this machine instead (D138): with PINCH_LOCAL_DATA set
 * to a folder, and never on Vercel, each key is a file under it, so an account, its rules and its
 * batches outlast a restart of `next dev`. Without it, a plain Map in this process's memory, as
 * before. The same interface either way, so the code that uses it doesn't know which.
 */

type Codec<T> = { encode: (value: T) => Buffer | string; decode: (bytes: Buffer) => T };

export const jsonCodec: Codec<unknown> = {
  encode: (v) => JSON.stringify(v),
  decode: (b) => JSON.parse(b.toString('utf8')),
};
export const bytesCodec: Codec<Uint8Array> = {
  encode: (v) => Buffer.from(v),
  decode: (b) => new Uint8Array(b),
};

/** The folder local data is kept in, or null when it is kept in memory. */
export const localDataDir = () =>
  process.env.PINCH_LOCAL_DATA && !process.env.VERCEL
    ? resolve(process.env.PINCH_LOCAL_DATA)
    : null;

export type KeyStore<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  keys(): string[];
  entries(): [string, T][];
};

/** A store of values by key, in `name` under the local data folder, or in memory without one. */
export function keyStore<T>(name: string, codec: Codec<T>): KeyStore<T> {
  const memory = new Map<string, T>();
  const root = () => {
    const dir = localDataDir();
    return dir ? join(dir, name) : null;
  };
  /** A key's file, kept inside the store's folder whatever the key says. */
  const fileOf = (dir: string, key: string) => {
    const file = resolve(dir, key);
    if (!file.startsWith(dir + sep)) throw new Error('A key outside the store.');
    return file;
  };
  return {
    get(key) {
      const dir = root();
      if (!dir) return memory.get(key);
      try {
        return codec.decode(readFileSync(fileOf(dir, key)));
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      const dir = root();
      if (!dir) {
        memory.set(key, value);
        return;
      }
      const file = fileOf(dir, key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, codec.encode(value));
    },
    delete(key) {
      const dir = root();
      if (!dir) {
        memory.delete(key);
        return;
      }
      rmSync(fileOf(dir, key), { force: true });
    },
    keys() {
      const dir = root();
      if (!dir) return [...memory.keys()];
      try {
        return readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
      } catch {
        return [];
      }
    },
    entries() {
      return this.keys().flatMap((k): [string, T][] => {
        const v = this.get(k);
        return v === undefined ? [] : [[k, v]];
      });
    },
  };
}
