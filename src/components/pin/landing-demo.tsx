'use client';

import { type RefObject, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/*
 * A take acted out on the landing (D169): a cursor marks one spot after another while a sound wave
 * shows someone talking about it. Purely decoration, hidden from assistive tech. It runs only while
 * on screen, and under reduced motion every mark just stands there with the wave flat.
 */

type Stage = 'travel' | 'draw' | 'talk' | 'rest';

const STAGE_MS: Record<Stage, number> = { travel: 900, draw: 700, talk: 2300, rest: 2200 };

export type Take = {
  /** The spot being marked, or the last one while the take rests. */
  spot: number;
  stage: Stage;
  /** Whether the mark on spot `i` is showing. */
  shown: (i: number) => boolean;
  talking: boolean;
};

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The take over `spots` spots, playing round while `root` is on screen. */
export function useTake(spots: number, root: RefObject<HTMLElement | null>): Take {
  const [still] = useState(reducedMotion);
  const [at, setAt] = useState<{ spot: number; stage: Stage }>(
    still ? { spot: spots - 1, stage: 'rest' } : { spot: 0, stage: 'travel' },
  );
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || still) return;
    // Started by hand if it's on screen already: the observer waits for a frame to be drawn.
    const box = el.getBoundingClientRect();
    setSeen(box.top < window.innerHeight * 0.7 && box.bottom > window.innerHeight * 0.3);
    const watch = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.3 });
    watch.observe(el);
    return () => watch.disconnect();
  }, [root, still]);
  useEffect(() => {
    if (!seen) return;
    const next = setTimeout(() => {
      setAt(({ spot, stage }) => {
        if (stage === 'travel') return { spot, stage: 'draw' };
        if (stage === 'draw') return { spot, stage: 'talk' };
        if (stage === 'talk')
          return spot + 1 < spots ? { spot: spot + 1, stage: 'travel' } : { spot, stage: 'rest' };
        return { spot: 0, stage: 'travel' };
      });
    }, STAGE_MS[at.stage]);
    return () => clearTimeout(next);
  }, [seen, at, spots]);
  return {
    ...at,
    shown: (i) => i < at.spot || (i === at.spot && at.stage !== 'travel'),
    talking: at.stage === 'talk',
  };
}

/** A sound wave: bars that move while someone talks, and lie nearly flat when they stop. */
const BARS = [0.35, 0.7, 0.5, 1, 0.6, 0.85, 0.4, 0.95, 0.55, 0.75, 0.3, 0.9, 0.5, 0.65, 0.35];

export function Wave({ on, className }: { on: boolean; className?: string }) {
  return (
    <span aria-hidden data-on={on} className={cn('wave', className)}>
      {BARS.map((peak, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: the bars never change order
          key={i}
          style={{ '--peak': peak, animationDelay: `${i * -0.11}s` } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

/** The pointer, placed in its parent by its tip. */
export function DemoCursor({
  left,
  top,
  className,
}: {
  left: string;
  top: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      className={cn('demo-cursor', className)}
      style={{ left, top }}
      width="30"
      height="34"
      viewBox="0 0 30 34"
    >
      <path
        d="M3 3V27L9.500 21.500L13.500 31L18.500 29L14.500 19.500H23Z"
        fill="#17131f"
        stroke="#fff"
        strokeWidth="2.500"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A marked spot drawn over the page, with its number on its top right corner. */
export function SpotMark({
  rect,
  number,
  on,
}: {
  rect: { x: number; y: number; w: number; h: number };
  number: number;
  on: boolean;
}) {
  return (
    <>
      <span
        aria-hidden
        data-on={on}
        className="spot"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      />
      <span
        aria-hidden
        data-on={on}
        className="spot-number"
        style={{ left: rect.x + rect.w, top: rect.y }}
      >
        {number}
      </span>
    </>
  );
}
