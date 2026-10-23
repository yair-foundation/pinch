/*
 * Writes of one document, one at a time and in order (D113). A collection in the account is
 * saved whole on every change, and saves sent side by side can land in any order, so an older
 * one could finish last and undo the newest. Here a write waits for the one before it; while it
 * waits, a newer write for the same key takes its place, so only the newest waiting one is sent.
 * Each caller's promise settles when a write at least as new as theirs is done, or failed.
 */

type Waiting<T> = {
  value: T;
  done: Promise<void>;
};

export type SaveQueue<T> = {
  /** Writes `value` under `key` after every write asked for before it. */
  write(key: string, value: T): Promise<void>;
  /** Settles when every write asked for under `key` so far has finished, failed or not. */
  idle(key: string): Promise<void>;
};

export function saveQueue<T>(send: (key: string, value: T) => Promise<void>): SaveQueue<T> {
  // Per key: the last write sent or waiting, and the one waiting to be sent, if any.
  const lanes = new Map<string, { last: Promise<void>; waiting?: Waiting<T> }>();
  const quiet = (p: Promise<void>) => p.catch(() => undefined);

  return {
    write(key, value) {
      const lane = lanes.get(key);
      if (lane?.waiting) {
        lane.waiting.value = value;
        return lane.waiting.done;
      }
      const before = lane?.last ?? Promise.resolve();
      const waiting = { value } as Waiting<T>;
      waiting.done = quiet(before).then(() => {
        const now = lanes.get(key);
        if (now?.waiting === waiting) now.waiting = undefined;
        return send(key, waiting.value);
      });
      lanes.set(key, { last: waiting.done, waiting });
      void quiet(waiting.done).then(() => {
        if (lanes.get(key)?.last === waiting.done) lanes.delete(key);
      });
      return waiting.done;
    },
    idle(key) {
      return quiet(lanes.get(key)?.last ?? Promise.resolve());
    },
  };
}
