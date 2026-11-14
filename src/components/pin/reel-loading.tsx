'use client';

import { LoadingReel } from './landing-art';

/*
 * Loading the reel (D204): once screens are chosen in the file picker and while they go in, a
 * modal with the View-Master taking one screenshot after another, and a line on how far it has come.
 */

/** Where the loading is: the screens going in, or all of them in. */
export type ReelLoad =
  | { phase: 'loading'; done: number; total: number; pdf?: boolean }
  | { phase: 'done' };

/** The line under the title, by phase. */
function lineOf(load: ReelLoad): string {
  if (load.phase === 'done') return 'Reel’s in. Lever down.';
  if (load.pdf) return `Reading page ${load.done} of ${load.total}`;
  return `Slide ${Math.min(load.done + 1, load.total)} of ${load.total} going in`;
}

export function ReelLoading({ load }: { load: ReelLoad }) {
  const pct =
    load.phase === 'loading' && load.total
      ? Math.round((load.done / load.total) * 100)
      : load.phase === 'done'
        ? 100
        : null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-background/80 backdrop-blur-sm">
      <div
        role="status"
        aria-live="polite"
        className="grid w-[min(22rem,calc(100%-2rem))] justify-items-center gap-3 rounded-2xl border border-border bg-background px-6 pt-6 pb-7 text-center shadow-lg dark:shadow-none"
      >
        <LoadingReel className="h-auto w-56 text-muted-foreground" />
        <h2 className="m-0 text-[17px] font-medium text-foreground">Loading the reel</h2>
        <p className="m-0 text-sm text-muted-foreground tabular-nums">{lineOf(load)}</p>
        {pct !== null && (
          <span aria-hidden className="block h-1 w-40 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
      </div>
    </div>
  );
}
