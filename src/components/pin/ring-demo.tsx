import { type RefObject, useEffect, useRef } from 'react';
import {
  type CardRef,
  demoAt,
  IDLE_TALK,
  type Resolve,
  ringCue,
  showTime,
  type Targets,
  waveform,
} from '@/lib/pin/ring-demo';
import type { RingTarget } from '@/lib/pin/ring-pictures';
import { cn } from '@/lib/utils';
import type { RingControl } from './ring-gallery';

/*
 * The landing's demo over the ring (D135): a cursor gestures round something on the picture in
 * front and Pinch's mark settles on it, then it drags the next picture in front and does the same,
 * while a waveform shows someone talking. The script is pure, in `src/lib/pin/ring-demo.ts`, and
 * each picture's target is in `ring-pictures.ts`; this draws it in step with the ring's frames.
 * Decorative and hidden from readers; nothing moves under reduced motion. Grabbing the ring
 * stops it, and it starts over a few seconds after the visitor lets go.
 */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The author's cursor (an arrow with a white rim), and where its tip is, at 26px wide. */
const CURSOR_WIDTH = 26;
const CURSOR_SCALE = CURSOR_WIDTH / 82;
const TIP: [number, number] = [8.2 * CURSOR_SCALE, 10.6 * CURSOR_SCALE];
const CURSOR_PATH =
  'M32.6389 74.8863L8.18983 10.5709C7.61473 9.05806 9.00696 7.59711 10.4499 8.19924L71.7928 33.7977C73.1748 34.3746 73.3641 36.3478 72.1123 37.1274L49.7021 51.0827C49.4565 51.2356 49.252 51.4502 49.1065 51.7079L35.814 75.2193C35.0715 76.5328 33.1897 76.3353 32.6389 74.8863Z';

/** One path for each card's mark: a thin blue dashed line that marches, over a faint blue fill. */
const CARDS: CardRef[] = ['A', 'B'];
const MARK_BLUE = '#3b82f6';
const DASH = [5, 4];

export function RingDemo({
  ring,
  talking,
  targets,
}: {
  ring: RingControl | null;
  /** Written with how loudly someone is talking, for the waveform. */
  talking: RefObject<number>;
  /** What to mark on each picture, in the ring's order. */
  targets: RingTarget[];
}) {
  const cursor = useRef<HTMLDivElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    if (!ring || reduced()) return;
    const resolve: Resolve = (where, cue) => {
      if ('edge' in where) {
        const [w, h] = ring.size();
        return [where.edge[0] * w, where.edge[1] * h];
      }
      // The ring knows how far it has really turned, so only the card's place along it is needed.
      const along = (where.card === 'B' ? 1 : 0) - (cue.front === 'B' ? 1 : 0);
      return ring.point(where.u, where.v, along) ?? [0, 0];
    };
    const clear = () => {
      if (cursor.current) cursor.current.style.opacity = '0';
      for (const path of paths.current) path?.setAttribute('d', '');
    };

    let holding = false;
    let front: CardRef = 'A';
    // The pictures in front when a loop starts, and the next: what this loop marks.
    let marking: Targets = { A: targets[0], B: targets[1 % targets.length] };
    const off = ring.subscribe((t) => {
      // Before the first loop, while the visitor holds the ring and for a while after, this is -1,
      // which shows nothing and lets the ring go.
      const local = showTime(t, ring.touchedAt(), ring.dragging());
      const cue = ringCue(local);
      if (cue.hold && (!holding || cue.front !== front)) {
        ring.hold();
        if (!holding) marking = { A: targets[ring.picture(0)], B: targets[ring.picture(1)] };
        holding = true;
        front = cue.front;
      } else if (!cue.hold && holding) {
        ring.release();
        holding = false;
      }
      if (holding) ring.turn(cue.turn);

      const frame = demoAt(local, resolve, marking);
      talking.current = frame.talking;
      const el = cursor.current;
      if (el) {
        if (frame.cursor) {
          const [x, y] = frame.cursor;
          el.style.opacity = '1';
          el.style.transform = `translate(${x - TIP[0]}px, ${y - TIP[1]}px) scale(${1 - 0.14 * frame.pressed})`;
        } else el.style.opacity = '0';
      }
      // The dashes march round the outline.
      const march = String((-t * 14) % (DASH[0] + DASH[1]));
      CARDS.forEach((card, i) => {
        const mark = frame.marks.find((m) => m.card === card);
        const d = mark
          ? `${mark.points
              .map((w, k) => {
                const [x, y] = resolve(w, frame);
                return `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
              })
              .join('')}Z`
          : '';
        const path = paths.current[i];
        path?.setAttribute('d', d);
        path?.setAttribute('opacity', String(mark?.opacity ?? 0));
        path?.setAttribute('stroke-dashoffset', march);
      });
    });
    return () => {
      off();
      if (holding) ring.release();
      clear();
      talking.current = IDLE_TALK;
    };
  }, [ring, talking, targets]);

  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
        {CARDS.map((card, i) => (
          <path
            key={card}
            ref={(el) => {
              paths.current[i] = el;
            }}
            fill="rgb(59 130 246 / 0.08)"
            stroke={MARK_BLUE}
            strokeWidth={1.5}
            strokeDasharray={DASH.join(' ')}
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div
        ref={cursor}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 opacity-0 drop-shadow-[0_2px_3px_rgb(0_0_0/0.25)] will-change-transform"
        style={{ transformOrigin: `${TIP[0]}px ${TIP[1]}px` }}
      >
        <svg aria-hidden width={CURSOR_WIDTH} viewBox="0 0 82 85" className="block">
          <path
            d={CURSOR_PATH}
            fill="#222222"
            stroke="white"
            strokeWidth={16}
            strokeLinejoin="round"
            paintOrder="stroke"
          />
        </svg>
      </div>
    </>
  );
}

const BARS = Array.from({ length: 40 }, (_, i) => `bar-${i}`);

/** A waveform that loops as someone talks, louder with `level` (D135). Decorative. */
export function Waveform({ level, className }: { level: RefObject<number>; className?: string }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const paint = (t: number, loud: number) =>
      waveform(BARS.length, t, loud).forEach((h, i) => {
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleY(${h.toFixed(3)})`;
      });
    if (reduced()) {
      paint(0.7, 0.6);
      return;
    }
    const begun = performance.now();
    // Eased towards the level, so the voice rises and falls rather than switching.
    let loud = level.current ?? IDLE_TALK;
    let frame = 0;
    const tick = (now: number) => {
      loud += ((level.current ?? IDLE_TALK) - loud) * 0.06;
      paint((now - begun) / 1000, loud);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);
  return (
    <div aria-hidden className={cn('flex h-14 items-center gap-[3px]', className)}>
      {BARS.map((id, i) => (
        <span
          key={id}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className="h-full w-[3px] rounded-full bg-current"
          style={{ transform: 'scaleY(0.08)' }}
        />
      ))}
    </div>
  );
}
