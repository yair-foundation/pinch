import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Waiting, shown as light passing over what is coming (after affectUI's
 * Shimmer Loader): `ShimmerText` runs a band of light through a label, and
 * `Skeleton` draws a placeholder block. Every skeleton's light is pinned to
 * the viewport, so the blocks on screen share one sweep. Drawn in the page's
 * own muted and foreground colours, so it follows the theme. Still under
 * prefers-reduced-motion.
 */

const CSS = `
.pin-shm {
  display: block;
  background-color: var(--muted);
  background-image: linear-gradient(100deg, transparent 0%, transparent 30%, var(--pin-shm-glow) 50%, transparent 70%, transparent 100%);
  background-size: 150vw 100%;
  background-repeat: repeat-x;
  background-attachment: fixed;
  animation: pin-shm-sweep 2.2s linear infinite;
  --pin-shm-glow: rgb(255 255 255 / 0.85);
}
.dark .pin-shm { --pin-shm-glow: rgb(255 255 255 / 0.07); }
@keyframes pin-shm-sweep {
  from { background-position: -50vw 0; }
  to { background-position: 100vw 0; }
}
.pin-shm-text {
  display: inline-block;
  color: var(--muted-foreground);
  background-image: linear-gradient(90deg, var(--muted-foreground) 0%, var(--muted-foreground) 40%, var(--foreground) 50%, var(--muted-foreground) 60%, var(--muted-foreground) 100%);
  background-size: 300% 100%;
  background-position: 100% 0;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: pin-shm-text var(--pin-shm-dur, 2s) linear infinite;
}
@keyframes pin-shm-text {
  from { background-position: 100% 0; }
  to { background-position: 0% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .pin-shm { animation: none; background-image: none; }
  .pin-shm-text { animation: none; background-image: none; -webkit-text-fill-color: currentColor; }
}
`;

const Style = () => (
  <style href="pin-shimmer" precedence="default">
    {CSS}
  </style>
);

export function ShimmerText({
  children,
  duration = 2,
  className,
}: {
  children: ReactNode;
  /** Seconds for one pass of the light. */
  duration?: number;
  className?: string;
}) {
  return (
    <>
      <Style />
      <span
        className={cn('pin-shm-text', className)}
        style={{ '--pin-shm-dur': `${duration}s` } as CSSProperties}
      >
        {children}
      </span>
    </>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <>
      <Style />
      <span aria-hidden className={cn('pin-shm h-3 w-full rounded-md', className)} />
    </>
  );
}

/** A rule card still coming: its words, its topics and its source, as placeholders. */
export function RuleSkeleton({ wide = true }: { wide?: boolean }) {
  return (
    <div aria-hidden className="space-y-3 rounded-xl border border-border p-4">
      <Skeleton className={cn('h-3.5', wide ? 'w-11/12' : 'w-3/4')} />
      <Skeleton className={cn('h-3.5', wide ? 'w-2/3' : 'w-1/2')} />
      <div className="flex gap-1.5 pt-1">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-3 w-14" />
    </div>
  );
}
