'use client';

import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { CURSOR_PATH } from './landing-art';

/*
 * A take acted out on the landing (D169): a cursor marks one spot after another while a sound wave
 * shows someone talking about it. Purely decoration, hidden from assistive tech. It runs only while
 * on screen, and under reduced motion every mark just stands there with the wave flat.
 */

type Stage = 'travel' | 'draw' | 'talk' | 'rest' | 'turn';

const STAGE_MS: Record<Stage, number> = {
  travel: 900,
  draw: 700,
  talk: 2300,
  rest: 2200,
  turn: 1100,
};

export type Take = {
  /** The spot being marked, or the last one while the take rests. */
  spot: number;
  stage: Stage;
  /** Whether the mark on spot `i` is showing. */
  shown: (i: number) => boolean;
  talking: boolean;
  /** How many times the reel has turned, and whether it is turning now. */
  turns: number;
  turning: boolean;
  /** Under reduced motion: the take never plays. */
  still: boolean;
};

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const watchMotion = (changed: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};
const reducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;
// The page's HTML can't know the setting, so it is drawn as moving and corrected after hydration.
const motionInHtml = () => false;

/**
 * The take over `spots` spots, playing round while `root` is on screen. With `onEach`, the reel turns
 * after that many spots, on to the next screen, and it goes on turning instead of resting.
 */
export function useTake(spots: number, root: RefObject<HTMLElement | null>, onEach?: number): Take {
  const still = useSyncExternalStore(watchMotion, reducedMotion, motionInHtml);
  const [moving, setAt] = useState<{ spot: number; stage: Stage; turns: number }>({
    spot: 0,
    stage: 'travel',
    turns: 0,
  });
  const at = still ? { spot: (onEach ?? spots) - 1, stage: 'rest' as Stage, turns: 0 } : moving;
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
    if (!seen || still) return;
    const next = setTimeout(() => {
      setAt(({ spot, stage, turns }) => {
        if (stage === 'travel') return { spot, stage: 'draw', turns };
        if (stage === 'draw') return { spot, stage: 'talk', turns };
        if (stage === 'turn') return { spot, stage: 'travel', turns };
        if (stage === 'talk') {
          const after = (spot + 1) % spots;
          if (onEach && (spot + 1) % onEach === 0)
            return { spot: after, stage: 'turn', turns: turns + 1 };
          return spot + 1 < spots
            ? { spot: spot + 1, stage: 'travel', turns }
            : { spot, stage: 'rest', turns };
        }
        return { spot: 0, stage: 'travel', turns };
      });
    }, STAGE_MS[moving.stage]);
    return () => clearTimeout(next);
  }, [seen, still, moving, spots, onEach]);
  const marking = at.stage !== 'travel' && at.stage !== 'turn';
  return {
    ...at,
    shown: (i) => i < at.spot || (i === at.spot && marking),
    talking: at.stage === 'talk',
    turning: at.stage === 'turn',
    still,
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

const CURSOR_WIDTH = 30;

/** The author's cursor, placed in its parent by its tip. */
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
      width={CURSOR_WIDTH}
      viewBox="8.2 10.6 82 85"
    >
      <path
        d={CURSOR_PATH}
        fill="#17131f"
        stroke="#fff"
        strokeWidth={16}
        strokeLinejoin="round"
        paintOrder="stroke"
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
