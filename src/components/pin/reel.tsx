'use client';

import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Download,
  LoaderCircle,
  Plus,
  RotateCcw,
  Star,
  X,
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { type Asset, type Mark, placesOf, verdictOf } from '@/lib/pin/model';
import {
  COUNTDOWN,
  clockText,
  createClock,
  type PointerSample,
  pointOn,
  type ReadBy,
  sampleAtTurn,
  type Shown,
  slotOf,
  type Take,
  type Wheel,
  wheelTurn,
} from '@/lib/pin/narration';
import { READING_SHOWN } from '@/lib/pin/notes-package';
import { createHold } from '@/lib/pin/push-to-talk';
import { opLabel, wordsByScreen, wordsLookWrong } from '@/lib/pin/transcript';
import { heard, isWhole, voiceNotes, voicePrefix, wordsIn } from '@/lib/pin/voice-notes';
import { type TimedWord, VOICE_LEGEND } from '@/lib/pin/voice-tags';
import { cn } from '@/lib/utils';
import { hit } from './dialog';
import {
  browserVoiceOn,
  MODEL_MB,
  prepareBrowserVoice,
  transcribeInBrowser,
} from './browser-voice';
import { TheEnd } from './landing-art';
import { MARK_COLOR } from './render';
import { ShimmerText, Skeleton } from './shimmer';

/*
 * The walkthrough (D131): the batch on a reel, after a View-Master. The screenshot being narrated
 * sits in the middle; the one before and the one after are tilted at the edges, lower down and
 * fading. Space is held to talk and let go to stop (D196); R records hands-free (the first time
 * in a visit after a five-second count, D143) and pauses; Backspace drops the recording to talk
 * again, with Undo; the arrows (or a scroll or swipe) turn the reel, F goes to the end, and ? or
 * the Keys and voice button opens the legend. While recording, the microphone and the
 * pointer's path over the screenshot are kept, in recording time, and Finish keeps them in
 * this browser as a take. Where speech-to-text is on (D136), the take's words are read after
 * Finish and made into notes where the pointer was, with the voice tags heard applied (D137);
 * the end card lists them by screen, and the middle screenshot shows its notes, numbered. The
 * package of the take is put together straight after, under the same bar, so Export only
 * downloads it (D144, D157, D163, D196).
 */

/** A wait the end card shows: what is happening, and how far it has come when that is known. */
function Progress({ label, done }: { label: string; done: number | null }) {
  const pct = done === null ? null : Math.floor(Math.min(1, Math.max(0, done)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className="grid w-[min(20rem,calc(var(--w)-2rem))] gap-2 text-sm"
    >
      <span aria-live="polite" className="sr-only">
        {label}
      </span>
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <LoaderCircle
            aria-hidden
            className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:hidden"
          />
          <ShimmerText className="truncate">{label}</ShimmerText>
        </span>
        {pct !== null && <span className="text-muted-foreground tabular-nums">{pct}%</span>}
      </span>
      {pct === null ? (
        <Skeleton className="h-1 rounded-full" />
      ) : (
        <span className="block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * The ring that shows where the take sees the pointer (D184), as the pointer itself (D209). A
 * ring the page drew after each move ran a frame or two behind the system's arrow, which is drawn
 * straight to the screen, and on a trackpad the gap showed; drawn as the cursor, it has none. A
 * white ring in a dark edge, at 1x and 2x so it is sharp on a Retina screen, its hotspot in the
 * middle. Made once, in the browser.
 */
let ringCursorCss: string | null = null;
function ringCursor(): string {
  if (ringCursorCss) return ringCursorCss;
  const at = (scale: number) => {
    const size = 24 * scale;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (!g) return '';
    const mid = size / 2;
    g.lineWidth = 4 * scale;
    g.strokeStyle = 'rgb(0 0 0 / 0.55)';
    g.beginPath();
    g.arc(mid, mid, 8 * scale, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2 * scale;
    g.strokeStyle = '#fff';
    g.stroke();
    return c.toDataURL('image/png');
  };
  const one = at(1);
  const two = at(2);
  ringCursorCss = one
    ? `image-set(url("${one}") 1x, url("${two}") 2x) 12 12, url("${one}") 12 12, crosshair`
    : 'crosshair';
  return ringCursorCss;
}

/** How long a turn of the reel takes to settle, its cards' 500 ms and a frame (D210). */
const TURN_SETTLE = 520;

/** How long a take is talked before its hint goes (D206): long enough to have begun. */
const HINT_MS = 8000;

/**
 * How many bars the waveform has (D206). They stand still and rise and fall, after Wispr Flow:
 * each is a band of the voice, the lowest in the middle and the same out to either side, eased to
 * its height on every frame.
 */
const BARS = 21;
/** The voice's range, in Hz, spread over the bars from the middle out. */
const VOICE_LOW = 90;
const VOICE_HIGH = 4000;
/** The input's loudness as a bar's height, 0 to 1: speech fills it, a quiet room barely shows. */
const barOf = (rms: number) => Math.min(1, Math.sqrt(rms) * 2.4);

/** What was said over one screen: its voice tags, and the notes the take made, numbered. */
type Heard = { id: string; name: string; ops: string[]; notes: { mark: Mark; n: number }[] }[];

/** The take by screen, as the end card shows it: what it heard and the notes now in the batch. */
function heardOf(take: Take, assets: Asset[], known: string[]): Heard {
  const prefix = voicePrefix(take.id);
  return wordsByScreen(take.shown, wordsIn(take), take.screens.length)
    .map((said, k) => {
      const { id, name } = take.screens[k];
      const a = assets.find((x) => x.id === id);
      const all = a ? voiceNotes(a).map((mark, i) => ({ mark, n: i + 1 })) : [];
      const notes = all.filter((x) => x.mark.id.startsWith(prefix));
      // The tags as the take applied them: "Delete this" with no note to drop is a note (D188).
      const { ops } = heard(said, known, all.length > notes.length);
      return { id, name, ops: ops.map(opLabel), notes };
    })
    .filter((s) => s.ops.length || s.notes.length);
}

const VERDICT_TEXT = {
  good: 'text-green-700 dark:text-green-400',
  bad: 'text-red-700 dark:text-red-400',
  both: 'text-amber-700 dark:text-amber-400',
};
/** A note's verdict on the end card: a note on one thing can hold both sides (D147). */
const VERDICT_WORD = { good: 'Works', bad: 'Doesn’t work', both: 'Mixed' };

/** The notes said on a screen, drawn over it where they were pointed, numbered (D137). */
function VoiceMarks({ marks }: { marks: Mark[] }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {marks.flatMap((m, i) => {
        if (isWhole(m.shape)) return [];
        const color = MARK_COLOR;
        // Its number on each spot it points at (D190).
        return placesOf(m).map((s, p) => {
          const badge = (
            <span
              className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono text-[11px] font-medium text-white shadow-sm"
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, background: color }}
            >
              {i + 1}
            </span>
          );
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a note's spots never change order
            <span key={`${m.id}-${p}`} className="contents">
              {s.kind === 'area' && (
                <span
                  className="absolute rounded-md border-2"
                  style={{
                    left: `${s.x * 100}%`,
                    top: `${s.y * 100}%`,
                    width: `${s.w * 100}%`,
                    height: `${s.h * 100}%`,
                    borderColor: color,
                  }}
                />
              )}
              {s.kind === 'arrow' && (
                <svg
                  aria-hidden
                  className="absolute inset-0 size-full overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <line
                    x1={s.x * 100}
                    y1={s.y * 100}
                    x2={s.x2 * 100}
                    y2={s.y2 * 100}
                    stroke={color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={s.x2 * 100} cy={s.y2 * 100} r={0.8} fill={color} />
                </svg>
              )}
              {badge}
            </span>
          );
        });
      })}
    </span>
  );
}

/**
 * Where the take is: paused (or not begun), asking for the microphone, counting in, recording,
 * keeping it in this browser, or kept. A take whose talk key was let go is still live, muted, for
 * a few seconds before it pauses (D196).
 */
type Phase = 'paused' | 'opening' | 'counting' | 'live' | 'saving' | 'saved';

/** A take being recorded: its recorder, its clock, and what it has kept so far. */
type LiveTake = {
  id: string;
  recorder: MediaRecorder;
  chunks: Blob[];
  clock: ReturnType<typeof createClock>;
  shown: Shown[];
  pointer: PointerSample[];
  off: boolean;
  /** Take time spent muted, the talk key up (D196), and since when it is muted now. */
  mutedMs: number;
  mutedAt: number | null;
};

/**
 * How long the author talked in a take: its time without the stretches the talk key was up (D199).
 * The take keeps those, so the notes are cut where the author stopped; the clock doesn't show
 * them, or it would jump on by them when the take pauses.
 */
const talkedIn = (t: LiveTake) => {
  const now = t.clock.time();
  return Math.max(0, now - t.mutedMs - (t.mutedAt === null ? 0 : now - t.mutedAt));
};

/**
 * How far an edge card sits from the middle: 45% of the reel's width, or clear of the middle card
 * where the reel is too narrow for that (D201). The middle card is as wide as the height allows
 * on a wide window, and as 64% of the width on a narrower one, where the tilted edge cards ran
 * over it; there they go out by its half-width and theirs, tilted (0.84 of its width).
 */
const EDGE = 'max(45cqw, var(--w) * 0.84)';

/** A card on the reel, by its slot: the middle, the edges, and hidden beyond them. */
const SLOT: Record<number, CSSProperties> = {
  0: { transform: 'translate(-50%, -50%)' },
  [-1]: {
    transform: `translate(calc(-50% - ${EDGE}), calc(-50% + 22cqh)) rotate(-15deg) scale(0.55)`,
  },
  1: {
    transform: `translate(calc(-50% + ${EDGE}), calc(-50% + 22cqh)) rotate(15deg) scale(0.55)`,
  },
  [-2]: {
    transform: 'translate(calc(-50% - 90cqw), calc(-50% + 60cqh)) rotate(-30deg) scale(0.45)',
    opacity: 0,
    pointerEvents: 'none',
  },
  2: {
    transform: 'translate(calc(-50% + 90cqw), calc(-50% + 60cqh)) rotate(30deg) scale(0.45)',
    opacity: 0,
    pointerEvents: 'none',
  },
};
/** The edges fade towards the bottom, as the reel turns away into the dark. */
const EDGE_FADE = 'linear-gradient(to bottom, #000 25%, transparent 92%)';

const CARD =
  'absolute top-[47%] left-1/2 grid h-[calc(var(--w)*0.75)] w-(--w) place-items-center transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none';
const BUTTON = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
);
const PRIMARY = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors duration-150 motion-reduce:transition-none hover:bg-foreground/85',
);

function Kbd({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <kbd
      aria-label={label}
      className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground"
    >
      {children}
    </kbd>
  );
}

/**
 * A key at the reel's foot (D202): large, its name shown on hover, and lit while it is held, so
 * the author sees the reel take it. Space stays lit for as long as they talk.
 */
function BarKey({
  name,
  on,
  wide,
  children,
}: {
  name: string;
  on: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="group relative flex" {...tipGroup}>
      <kbd
        className={cn(
          'inline-flex h-10 min-w-10 items-center justify-center rounded-lg border font-mono text-[15px] transition-colors duration-100 motion-reduce:transition-none',
          wide ? 'px-5' : 'px-3',
          on
            ? 'border-foreground bg-foreground text-background'
            : 'border-border bg-muted text-foreground',
        )}
      >
        {children}
      </kbd>
      <span role="tooltip" className={cn(TIP, 'bottom-full mb-2')}>
        {name}
      </span>
    </span>
  );
}

/**
 * The reel’s tooltips (D202): white in dark and black in light, shown on
 * hover of the `group` they sit in.
 */
const TIP =
  'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-md bg-black px-2 py-1 text-[12px] font-medium whitespace-nowrap text-white opacity-0 dark:bg-white dark:text-black transition-opacity duration-150 group-hover:opacity-100 group-data-[off]:opacity-0! motion-reduce:transition-none';

/**
 * A tooltip's group, which hides it once its button is clicked, until the pointer leaves (D206):
 * by then the picker or the legend it named is open, and the name is in the way.
 */
const tipGroup = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.dataset.off = '';
  },
  onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
    delete e.currentTarget.dataset.off;
  },
};

/** The keys at the reel's foot, by what is pressed: the arrows and their stand-ins light the same. */
const BAR_KEY: Record<string, string> = {
  ' ': 'space',
  r: 'r',
  f: 'f',
  ArrowLeft: 'left',
  ArrowUp: 'left',
  PageUp: 'left',
  ArrowRight: 'right',
  ArrowDown: 'right',
  PageDown: 'right',
};

const Left = () => (
  <Kbd label="Left arrow">
    <ArrowLeft className="size-3.5" aria-hidden />
  </Kbd>
);
const Right = () => (
  <Kbd label="Right arrow">
    <ArrowRight className="size-3.5" aria-hidden />
  </Kbd>
);

/** How pointing while talking places a note (D131). */
const POINTING: [how: string, what: string][] = [
  ['Rest the pointer, say “this”', 'A note on that spot'],
  ['Circle something', 'A note on that area'],
  ['Rest on two spots, say “move” or “align”', 'An arrow between them'],
  ['Point off the screenshot', 'A note on the whole screen'],
];

/**
 * Whether this visit has had its count (D143), kept for the tab so a reload doesn't bring it back.
 * A count stopped with Esc doesn't count.
 */
const COUNTED_KEY = 'pinch-counted';
let countedHere = false;
const counted = () => {
  if (countedHere) return true;
  try {
    return sessionStorage.getItem(COUNTED_KEY) === '1';
  } catch {
    return false;
  }
};
const markCounted = () => {
  countedHere = true;
  try {
    sessionStorage.setItem(COUNTED_KEY, '1');
  } catch {
    // Storage blocked: remembered until the page closes.
  }
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function Reel({
  assets,
  urls,
  index,
  inert,
  onIndex,
  onSave,
  onTake,
  onFlip,
  onExport,
  onPrepare,
  packing,
  onDropped,
  onDropGone,
  onAdd,
}: {
  assets: Asset[];
  urls: Record<string, string>;
  /** The screenshot on show; the end card sits one past the last. */
  index: number;
  inert: boolean;
  onIndex: (i: number) => void;
  /** Keep a finished take and its audio in this browser. */
  onSave: (take: Take, audio: Blob) => Promise<void>;
  /** Make a read take's notes in the batch, and apply the voice tags heard (D137). */
  onTake: (take: Take) => void;
  /** Turn a note's verdict round: what works, or what doesn't. */
  onFlip: (assetId: string, markId: string) => void;
  /** Give the package of this take (D163). */
  onExport: () => void;
  /** Put the package of the batch together now, so Export only downloads it (D196). */
  onPrepare: () => void;
  /** How far the package has come while it is put together. */
  packing: { done: number; total: number } | null;
  /**
   * Start over dropped a recording (`talkedMs` long) or a kept take with its notes: say so, with
   * `undo` to bring it back (D200).
   */
  onDropped: (drop: { talkedMs: number; notes: boolean; undo: () => void }) => void;
  /** What Start over dropped can't come back any more: a new recording began, or it finished. */
  onDropGone: () => void;
  /** Choose more images to add to the batch (D201). */
  onAdd: () => void;
}) {
  const [atEnd, setAtEnd] = useState(false);
  const at = atEnd ? assets.length : Math.min(index, assets.length - 1);
  const [phase, setPhase] = useState<Phase>('paused');
  // The phase as of now, for keys and awaits that land before the next render.
  const phaseNow = useRef<Phase>('paused');
  const go = (p: Phase) => {
    phaseNow.current = p;
    setPhase(p);
  };
  const [count, setCount] = useState(COUNTDOWN);
  const [micError, setMicError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  // The keys at the reel's foot held down now, to light them (D202).
  const [pressed, setPressed] = useState<ReadonlySet<string>>(() => new Set());
  const lit = useRef(new Map<string, number>());
  /** Light a key, or let it go a moment later, so a quick tap still shows. */
  const light = (key: string, on: boolean) => {
    const k = BAR_KEY[key];
    if (!k) return;
    window.clearTimeout(lit.current.get(k));
    const set = (to: boolean) =>
      setPressed((was) => {
        if (was.has(k) === to) return was;
        const next = new Set(was);
        if (to) next.add(k);
        else next.delete(k);
        return next;
      });
    if (on) set(true);
    else lit.current.set(k, window.setTimeout(() => set(false), 120));
  };
  const [clock, setClock] = useState('0:00');
  const [saved, setSaved] = useState<{ take: Take; audio: Blob } | null>(null);
  // Speech-to-text: whether it's on here, and reading a take's words.
  // Where a take's words are read: Pinch's server on this machine (D136), or this browser (D140).
  const [engine, setEngine] = useState<'server' | 'browser' | null>(null);
  const voiceOn = engine !== null;
  const [reading, setReading] = useState<'idle' | 'working' | 'failed'>('idle');
  // How much of the browser's voice model has come in, while it downloads the first time.
  const [model, setModel] = useState<number | null>(null);
  // How far the reading of a take has come (0–1), where the browser says (D196).
  const [readDone, setReadDone] = useState<number | null>(null);
  // The talk key was let go: the take is live, its microphone muted, until it pauses (D196).
  const [muted, setMuted] = useState(false);

  const reel = useRef<HTMLDivElement>(null);
  // Each card's screenshot by its place in the batch; the middle one is the one on show. One ref
  // passed from card to card as the reel turns could be left on the card that just left.
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const middle = () => imgs.current[atRef.current] ?? null;
  // The waveform's bars, drawn from the microphone without a render.
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  // Whether the waveform shows what the microphone hears: only while it is recorded.
  const hearing = useRef(false);
  /*
   * The microphone, open from the first recording to Finish. Letting go of the talk key turns its
   * track off, which the take records as silence while it keeps time (D196); the recording never
   * goes through the page's audio, which a browser may hold back.
   */
  const mic = useRef<{ stream: MediaStream; audio: AudioContext } | null>(null);
  // The take in progress: the recorder, its clock and what it has kept so far.
  const take = useRef<LiveTake | null>(null);
  // What Start over dropped, while Undo can bring it back: the take in progress, or a kept one.
  const aside = useRef<
    | { kind: 'live'; take: LiveTake | null; unsaved: { take: Take; audio: Blob } | null }
    | { kind: 'saved'; done: { take: Take; audio: Blob } }
    | null
  >(null);
  // How long the author talked in each take kept here, by its id (D199).
  const talked = useRef(new Map<string, number>());
  const talkedOf = (kept: Take) => talked.current.get(kept.id) ?? kept.durationMs;
  // The page's toast about a drop goes once it can't be undone (D200).
  const dropGone = useRef(onDropGone);
  dropGone.current = onDropGone;
  // Kept takes dropped since: a reading that lands after doesn't bring their notes back.
  const droppedIds = useRef(new Set<string>());
  // The kept take whose words are being read now.
  const readingId = useRef<string | null>(null);
  // A stopped take the browser couldn't keep yet: Finish tries again, and nothing records over it.
  const unsaved = useRef<{ take: Take; audio: Blob } | null>(null);
  // The take the end card is about, so a reading of an earlier one doesn't land on it.
  const shownTake = useRef<string | null>(null);
  const countTimer = useRef(0);
  const wheel = useRef<Wheel>({ built: 0, at: -Infinity });
  const atRef = useRef(at);
  // Where the pointer is now, in the window, whether or not a take is recording (D210).
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  atRef.current = at;
  const mounted = useRef(true);

  /** Whether the take has any audio yet, so there is something to keep. */
  const recorded = () => (take.current?.clock.time() ?? 0) > 0;

  const turn = useCallback(
    (to: number) => {
      if (to < 0 || to > assets.length) return;
      if (to === assets.length) setAtEnd(true);
      else {
        setAtEnd(false);
        onIndex(to);
      }
      const t = take.current;
      if (t && t.clock.time() > 0)
        t.shown.push({ t: t.clock.time(), screen: to < assets.length ? to : null });
      // A pointer held still through the turn is placed on the new screen once it has turned
      // into place, timed at the turn, so "this" said before it moves lands where it points (D210).
      if (t && phaseNow.current === 'live' && to < assets.length) {
        const turnedAt = t.clock.time();
        window.setTimeout(() => {
          const img = imgs.current[to];
          const still = lastPointer.current;
          if (take.current !== t || atRef.current !== to || !img || !still) return;
          const at = pointOn(img.getBoundingClientRect(), still.x, still.y);
          const sample = sampleAtTurn(t.pointer, turnedAt, to, at);
          if (!sample) return;
          t.pointer.push(sample);
          t.off = !at;
        }, TURN_SETTLE);
      }
    },
    [assets.length, onIndex],
  );

  /** A new take on the open microphone, recording from its first sound. */
  const newTake = (m: NonNullable<typeof mic.current>): LiveTake => {
    const mimeType =
      ['audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(m.stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    return {
      id: crypto.randomUUID(),
      recorder,
      chunks,
      clock: createClock(),
      shown: [],
      pointer: [],
      off: false,
      mutedMs: 0,
      mutedAt: null,
    };
  };

  /** Ask for the microphone once, and start a take on it. */
  const open = async () => {
    if (take.current) return true;
    if (mic.current) {
      take.current = newTake(mic.current);
      return true;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      if (mounted.current) setMicError(true);
      return false;
    }
    // The reel closed while the browser asked: let the microphone go.
    if (!mounted.current) {
      for (const track of stream.getTracks()) track.stop();
      return false;
    }
    setMicError(false);
    // The waveform, so the author sees the microphone hears them while they talk.
    const audio = new AudioContext();
    audio.resume().catch(() => undefined);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -25;
    audio.createMediaStreamSource(stream).connect(analyser);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const wave = new Float32Array(analyser.fftSize);
    // The bands, from the middle bar out: spaced as the ear hears, closer at the low end.
    const half = Math.ceil(BARS / 2);
    const hz = audio.sampleRate / analyser.fftSize;
    const band = Array.from({ length: half + 1 }, (_, k) =>
      Math.round((VOICE_LOW * (VOICE_HIGH / VOICE_LOW) ** (k / half)) / hz),
    );
    const shown = new Float32Array(BARS);
    const loop = () => {
      if (audio.state === 'closed') return;
      requestAnimationFrame(loop);
      analyser.getByteFrequencyData(spectrum);
      analyser.getFloatTimeDomainData(wave);
      let sum = 0;
      for (const v of wave) sum += v * v;
      // How loud, overall: the bars stand only as tall as the voice is, and lie flat when muted.
      const loud = hearing.current ? barOf(Math.sqrt(sum / wave.length)) : 0;
      bars.current.forEach((bar, i) => {
        const k = Math.abs(i - (half - 1));
        let peak = 0;
        for (let b = band[k]; b <= Math.max(band[k], band[k + 1] - 1); b++)
          peak = Math.max(peak, spectrum[b] ?? 0);
        // Taller in the middle, tapering out, and each band its own height within that.
        const taper = 1 - 0.5 * (k / (half - 1)) ** 1.4;
        const target = loud * taper * (0.2 + 0.8 * (peak / 255) ** 1.8);
        // Up quickly, down softly.
        shown[i] += (target - shown[i]) * (target > shown[i] ? 0.45 : 0.18);
        if (bar) bar.style.transform = `scaleY(${0.12 + 0.88 * shown[i]})`;
      });
    };
    requestAnimationFrame(loop);
    mic.current = { stream, audio };
    take.current = newTake(mic.current);
    return true;
  };

  /** The microphone heard in the recording, or muted: silence, recorded in its place. */
  const listen = (on: boolean) => {
    const m = mic.current;
    const t = take.current;
    hearing.current = on;
    setMuted(!on && phaseNow.current === 'live');
    // The muted stretch, kept off the clock (D199).
    if (t && !on && t.mutedAt === null && phaseNow.current === 'live') t.mutedAt = t.clock.time();
    if (t && on && t.mutedAt !== null) {
      t.mutedMs += t.clock.time() - t.mutedAt;
      t.mutedAt = null;
    }
    if (!m) return;
    for (const track of m.stream.getAudioTracks()) track.enabled = on;
    if (on) m.audio.resume().catch(() => undefined);
  };

  /** Let the microphone go. */
  const release = useCallback(() => {
    const m = mic.current;
    mic.current = null;
    hearing.current = false;
    if (!m) return;
    for (const track of m.stream.getTracks()) track.stop();
    m.audio.close().catch(() => undefined);
  }, []);

  /** What Start over dropped is gone for good: a new recording began, or the take finished. */
  const forget = useCallback(() => {
    const a = aside.current;
    aside.current = null;
    if (a) dropGone.current();
    if (a?.kind === 'live' && a.take && a.take.recorder.state !== 'inactive') a.take.recorder.stop();
  }, []);

  const goLive = () => {
    const t = take.current;
    if (!t) return;
    if (t.clock.time() === 0)
      t.shown.push({ t: 0, screen: atRef.current < assets.length ? atRef.current : null });
    forget();
    t.clock.start();
    if (t.recorder.state === 'inactive') t.recorder.start(1000);
    else t.recorder.resume();
    go('live');
    listen(true);
  };

  /** What the end card shows: a kept take, or none. */
  const show = (done: { take: Take; audio: Blob } | null) => {
    shownTake.current = done?.take.id ?? null;
    setSaved(done);
  };

  /** Record from a pause or the end card: hands-free from R, or while the talk key is held. */
  const record = async (held = false) => {
    const from = phaseNow.current;
    if ((from !== 'paused' && from !== 'saved') || unsaved.current) return;
    go('opening');
    if (!(await open())) {
      if (mounted.current) go(from);
      return;
    }
    // The key was let go while the browser asked for the microphone: nothing to hear yet.
    if (held && !hold.current.held) return go(from);
    if (from === 'saved') {
      show(null);
      setReading('idle');
    }
    // Only the first recording of a visit waits for the count (D143), and never one held to
    // talk: holding the key says the author is ready (D196). A resume starts at once.
    if (held) markCounted();
    if (counted()) return goLive();
    go('counting');
    setCount(COUNTDOWN);
    let n = COUNTDOWN;
    countTimer.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) return setCount(n);
      clearInterval(countTimer.current);
      markCounted();
      goLive();
    }, 1000);
  };

  const pause = () => {
    hold.current.reset();
    if (phaseNow.current === 'counting') {
      clearInterval(countTimer.current);
      go('paused');
      return;
    }
    const t = take.current;
    if (phaseNow.current !== 'live' || !t) return;
    listen(false);
    t.clock.pause();
    t.recorder.pause();
    if (t.mutedAt !== null) {
      t.mutedMs += t.clock.time() - t.mutedAt;
      t.mutedAt = null;
    }
    t.shown.push({
      t: t.clock.time(),
      screen: atRef.current < assets.length ? atRef.current : null,
      paused: true,
    });
    go('paused');
    setMuted(false);
  };

  /*
   * The talk key (D196): held, the take records; let go, it is muted a moment later and paused a
   * few seconds after that. A press while counting in skips the count.
   */
  const onHold = useRef({ talk: () => {}, mute: () => {}, pause: () => {} });
  onHold.current = {
    talk: () => {
      const p = phaseNow.current;
      if (p === 'live') return listen(true);
      if (p === 'counting') {
        clearInterval(countTimer.current);
        markCounted();
        return goLive();
      }
      void record(true);
    },
    mute: () => {
      if (phaseNow.current === 'live') listen(false);
    },
    pause: () => {
      if (phaseNow.current === 'live') pause();
    },
  };
  const hold = useRef(
    createHold({
      talk: () => onHold.current.talk(),
      mute: () => onHold.current.mute(),
      pause: () => onHold.current.pause(),
    }),
  );

  /** Stop the take in progress, let the microphone go, and put together what it kept. */
  const stop = useCallback(async () => {
    const t = take.current;
    hold.current.reset();
    forget();
    if (!t) {
      release();
      return null;
    }
    take.current = null;
    clearInterval(countTimer.current);
    t.clock.pause();
    const durationMs = t.clock.time();
    talked.current.set(t.id, talkedIn(t));
    if (t.recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        t.recorder.onstop = () => resolve();
        t.recorder.stop();
      });
    }
    release();
    if (mounted.current) setMuted(false);
    if (!durationMs || !t.chunks.length) return null;
    const audio = new Blob(t.chunks, { type: t.recorder.mimeType });
    const kept: Take = {
      id: t.id,
      version: 1,
      recordedAt: new Date().toISOString(),
      durationMs,
      mimeType: t.recorder.mimeType,
      screens: assets.map((a) => ({ id: a.id, name: a.name, width: a.width, height: a.height })),
      shown: t.shown,
      pointer: t.pointer,
    };
    return { take: kept, audio };
  }, [assets, forget, release]);

  /**
   * Stop the take and keep it: from Finish, or when the reel closes mid-take. One the browser
   * couldn't keep stays in `unsaved` until a later try does.
   */
  const keep = useCallback(async () => {
    const done = unsaved.current ?? (await stop());
    if (!done) return null;
    unsaved.current = done;
    await onSave(done.take, done.audio);
    if (unsaved.current === done) unsaved.current = null;
    return done;
  }, [stop, onSave]);

  /** The words in a take: on Pinch's server where it has speech-to-text, else in this browser. */
  const wordsOf = async (audio: Blob): Promise<{ words: TimedWord[]; readBy?: ReadBy }> => {
    if (engine === 'browser')
      return transcribeInBrowser(
        audio,
        (p) => {
          if (mounted.current) setModel(p < 100 ? p : null);
        },
        (done) => {
          if (mounted.current) setReadDone(done);
        },
      );
    const res = await fetch('/api/pin/voice', {
      method: 'POST',
      headers: { 'Content-Type': audio.type || 'audio/webm' },
      body: audio,
    });
    if (!res.ok) throw new Error();
    return (await res.json()) as { words: TimedWord[]; readBy?: ReadBy };
  };

  /** Read a kept take's words, and keep them with it. */
  const read = async (done: { take: Take; audio: Blob }) => {
    // A new take since: its notes are still made, but the end card is the new one's.
    const onShow = () => mounted.current && shownTake.current === done.take.id;
    readingId.current = done.take.id;
    setReading('working');
    setReadDone(null);
    const over = () => {
      if (readingId.current === done.take.id) readingId.current = null;
      if (!mounted.current) return;
      setModel(null);
      setReadDone(null);
    };
    try {
      const { words, readBy } = await wordsOf(done.audio);
      over();
      const take = { ...done.take, words, ...(readBy && { readBy }) };
      await onSave(take, done.audio);
      // Dropped while it was read: Undo brings it back with its words.
      if (droppedIds.current.has(take.id)) {
        const a = aside.current;
        if (a?.kind === 'saved' && a.done.take.id === take.id)
          aside.current = { kind: 'saved', done: { take, audio: done.audio } };
        return;
      }
      onTake(take);
      // The package is put together under the same bar, so Export only downloads it (D196).
      onPrepare();
      if (!onShow()) return;
      show({ take, audio: done.audio });
      setReading('idle');
    } catch {
      over();
      if (onShow()) setReading('failed');
    }
  };

  /**
   * Start over (D159, D196, D199): the recording so far is dropped, or the kept take's notes taken out,
   * and the reel goes back to the first screen to record anew. Undo brings it back until the next
   * recording begins.
   */
  const talkAgain = () => {
    const p = phaseNow.current;
    if (p === 'opening' || p === 'saving') return;
    hold.current.reset();
    clearInterval(countTimer.current);
    forget();
    let dropped: { talkedMs: number; notes: boolean };
    if (p === 'saved') {
      if (!saved) return;
      droppedIds.current.add(saved.take.id);
      onTake({ ...saved.take, words: [] });
      aside.current = { kind: 'saved', done: saved };
      dropped = { talkedMs: talkedOf(saved.take), notes: true };
      show(null);
      setReading('idle');
    } else {
      const t = take.current;
      if (!(t && t.clock.time() > 0) && !unsaved.current) return go('paused');
      if (t) {
        if (p === 'live') listen(false);
        t.clock.pause();
        if (t.recorder.state === 'recording') t.recorder.pause();
      }
      aside.current = { kind: 'live', take: t, unsaved: unsaved.current };
      const was = unsaved.current?.take;
      dropped = { talkedMs: was ? talkedOf(was) : t ? talkedIn(t) : 0, notes: false };
      unsaved.current = null;
      take.current = mic.current ? newTake(mic.current) : null;
    }
    setSaveError(false);
    go('paused');
    setMuted(false);
    turn(0);
    // Said in the page's toast, with Undo (D200).
    onDropped({ ...dropped, undo: () => undoRef.current() });
  };

  /** What Start over dropped, back where it was. */
  const undoDrop = () => {
    const a = aside.current;
    if (!a) return;
    aside.current = null;
    if (a.kind === 'saved') {
      droppedIds.current.delete(a.done.take.id);
      if (a.done.take.words) onTake(a.done.take);
      show(a.done);
      setReading(
        a.done.take.words || !voiceOn
          ? 'idle'
          : readingId.current === a.done.take.id
            ? 'working'
            : 'failed',
      );
      go('saved');
      turn(assets.length);
      return;
    }
    // Nothing was recorded since, or the drop would be gone: the fresh take goes unused.
    const fresh = take.current;
    if (fresh && fresh.recorder.state !== 'inactive') fresh.recorder.stop();
    take.current = a.take;
    unsaved.current = a.unsaved;
    go('paused');
  };
  // The latest of each, for the toast's Undo and for `forget`, which outlive a render.
  const undoRef = useRef(undoDrop);
  undoRef.current = undoDrop;

  const finish = async () => {
    if (phaseNow.current === 'saving' || (!recorded() && !unsaved.current)) return;
    setSaveError(false);
    go('saving');
    try {
      const done = await keep();
      if (!mounted.current) return;
      show(done);
      go('saved');
      if (done && voiceOn) void read(done);
    } catch {
      if (mounted.current) {
        setSaveError(true);
        go('paused');
      }
    }
  };

  // The clock in the corner, read from the take's own clock, or the kept take's length.
  // The time talked, not the muted stretches the take keeps for its notes (D199).
  const keptMs = saved ? talkedOf(saved.take) : 0;
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = take.current;
      setClock(clockText(t ? talkedIn(t) : keptMs));
    }, 250);
    return () => clearInterval(id);
  }, [keptMs]);

  // The server's speech-to-text where it has it (D136); this browser's everywhere else (D140).
  useEffect(() => {
    const own = () => setEngine(browserVoiceOn() ? 'browser' : null);
    fetch('/api/pin/voice')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { available?: boolean } | null) => (d?.available ? setEngine('server') : own()))
      .catch(own);
  }, []);

  // The browser's voice model comes in from the moment there are images (D161), not at Finish.
  useEffect(() => {
    if (engine !== 'browser') return;
    return prepareBrowserVoice((p) => {
      if (mounted.current) setModel(p < 100 ? p : null);
    });
  }, [engine]);

  const heard = saved?.take.words
    ? heardOf(
        saved.take,
        assets,
        assets.flatMap((a) => (a.screenTag ? [a.screenTag] : [])),
      )
    : null;
  const made = heard?.reduce((n, s) => n + s.notes.length, 0) ?? 0;

  // Closing the reel mid-take (Your rules, Start over) keeps what was recorded.
  const keepRef = useRef(keep);
  keepRef.current = keep;
  useEffect(() => {
    mounted.current = true;
    const holding = hold.current;
    return () => {
      mounted.current = false;
      holding.reset();
      keepRef.current().catch(() => undefined);
    };
  }, []);

  // A click anywhere but the legend or its button closes it (D202).
  useEffect(() => {
    if (!legendOpen) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('#reel-legend, [aria-controls="reel-legend"]')) return;
      setLegendOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [legendOpen]);

  // A sideways swipe turns the reel instead of going back a page.
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorX;
    root.style.overscrollBehaviorX = 'none';
    return () => {
      root.style.overscrollBehaviorX = before;
    };
  }, []);

  // A scroll down or a swipe left turns the reel on, like the View-Master's lever.
  useEffect(() => {
    const el = reel.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // The words on the end card scroll on their own.
      if (e.target instanceof Element && e.target.closest('[data-reel-scroll]')) return;
      e.preventDefault();
      if (inert) return;
      const next = wheelTurn(wheel.current, e, performance.now());
      wheel.current = next.wheel;
      if (next.turn) turn(atRef.current + next.turn);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [inert, turn]);

  // The keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inert || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // Space is the talk key (D196), held: even over a button last clicked, which would take
      // it as a click. A button reached with Tab keeps its own Space, and its Enter.
      if (key === ' ') {
        const button = e.target instanceof HTMLButtonElement ? e.target : null;
        if (button?.matches(':focus-visible')) return;
        button?.blur();
        e.preventDefault();
        light(' ', true);
        if (!e.repeat) hold.current.press();
        return;
      }
      if (key === 'Enter' && e.target instanceof HTMLButtonElement) return;
      // A key held down acts once, but the arrows turn on.
      if (e.repeat && !key.startsWith('Arrow') && !key.startsWith('Page')) return;
      const act: Record<string, () => void> = {
        r: () => (phase === 'live' ? pause() : void record()),
        Backspace: talkAgain,
        Escape: () => (phase === 'counting' ? pause() : setLegendOpen(false)),
        ArrowRight: () => turn(at + 1),
        ArrowDown: () => turn(at + 1),
        PageDown: () => turn(at + 1),
        ArrowLeft: () => turn(at - 1),
        ArrowUp: () => turn(at - 1),
        PageUp: () => turn(at - 1),
        f: () => turn(assets.length),
        '?': () => setLegendOpen((o) => !o),
        Enter: () => {
          if (atEnd && phase !== 'saved') void finish();
        },
      };
      const run = act[key];
      if (!run) return;
      e.preventDefault();
      light(key, true);
      run();
    };
    // A key let go out of sight never says so: losing the window lets go of it too.
    const onUp = (e: KeyboardEvent) => {
      light(e.key.length === 1 ? e.key.toLowerCase() : e.key, false);
      if (e.key !== ' ' || !hold.current.held) return;
      e.preventDefault();
      hold.current.release();
    };
    const letGo = () => {
      hold.current.release();
      for (const key of Object.keys(BAR_KEY)) light(key, false);
    };
    const onHidden = () => {
      if (document.hidden) letGo();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', onHidden);
    };
  });

  /*
   * The pointer over the middle screenshot, while recording, heard on the window (D184): the
   * author's first gesture take lost the pointer for 26 to 42 seconds on three screens while
   * they moved over the slide, with the reel's own handler. On the window nothing drawn over the
   * reel can keep a move from the take, and the ring shows the author what the take sees. In
   * development a line a second says what the recorder saw, to chase a pointer that goes missing.
   */
  useEffect(() => {
    if (phase !== 'live') return;
    let moves = 0;
    let on = false;
    const onMove = (e: PointerEvent) => {
      const t = take.current;
      const img = imgs.current[atRef.current];
      if (!t || !img) return;
      moves++;
      // Nothing is written to the page here, so reading the box never forces a layout (D209).
      const p = pointOn(img.getBoundingClientRect(), e.clientX, e.clientY);
      on = p !== null;
      if (!p && t.off) return;
      t.off = !p;
      t.pointer.push([t.clock.time(), atRef.current, p?.[0] ?? null, p?.[1] ?? null]);
    };
    window.addEventListener('pointermove', onMove);
    const log =
      process.env.NODE_ENV === 'development'
        ? window.setInterval(() => {
            const r = imgs.current[atRef.current]?.getBoundingClientRect();
            const box = r ? [r.left, r.top, r.width, r.height].map(Math.round).join(' ') : 'none';
            console.log(
              `[pinch pointer] ${moves} moves, screen ${atRef.current}, box ${box}, ${on ? 'on' : 'off'} the slide`,
            );
            moves = 0;
          }, 1000)
        : 0;
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearInterval(log);
    };
  }, [phase]);
  const onPointerDown = (e: React.PointerEvent) => {
    const t = take.current;
    const img = middle();
    if (phase !== 'live' || !t || !img || e.target !== img) return;
    const p = pointOn(img.getBoundingClientRect(), e.clientX, e.clientY);
    if (p) t.shown.push({ t: t.clock.time(), screen: atRef.current, click: p });
  };

  const state = {
    paused: recorded() || unsaved.current ? 'Paused' : 'Ready',
    opening: 'Starting',
    counting: 'Starting',
    live: muted ? 'Paused' : 'Recording',
    saving: 'Saving',
    saved: 'Saved',
  }[phase];

  return (
    <section
      ref={reel}
      aria-label="Walkthrough"
      inert={inert}
      onPointerDown={onPointerDown}
      className="relative min-h-0 flex-1 overflow-hidden select-none"
      style={
        {
          containerType: 'size',
          '--w': 'min(64cqw, (100cqh - 128px) * 4 / 3)',
        } as CSSProperties
      }
    >
      {/*
       * How far through the batch, against the header's divider (D206): a 2 px strip that fills
       * to the screen on show, and full on the last card.
       */}
      <div
        role="progressbar"
        aria-label="Screens"
        aria-valuemin={1}
        aria-valuemax={Math.max(1, assets.length)}
        aria-valuenow={Math.min(at + 1, assets.length)}
        className="absolute inset-x-0 top-0 z-30 h-0.5"
      >
        <div
          className="h-full bg-foreground transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{
            width: `${assets.length ? (Math.min(at + 1, assets.length) / assets.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="absolute inset-x-0 top-0 z-20 flex h-12 items-center px-5 text-[13px] text-muted-foreground">
        {/* What is coming in, out of the way: the voice model, the package. */}
        <span className="flex items-center gap-3 tabular-nums">
          {/* Not at 0: a model kept from before reports 0 a moment as it opens (D199). */}
          {model !== null && model > 0 && <span>Voice model {Math.floor(model)}%</span>}
          {packing && !atEnd && (
            <span className="flex items-center gap-1.5">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:hidden" />
              Export {Math.floor((packing.done / Math.max(1, packing.total)) * 100)}%
            </span>
          )}
        </span>
        {/* The take and the screen on show, centred over the reel (D199). */}
        <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap">
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              phase === 'live' && !muted ? 'bg-red-600' : 'bg-muted-foreground/60',
            )}
          />
          <span aria-live="polite" className="text-foreground">
            {state}
          </span>
          <span className="font-mono tabular-nums">{clock}</span>
          {at < assets.length && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {at + 1} of {assets.length}
              </span>
            </>
          )}
        </span>
        {/* More images (D201), and the keys and voice (D202), top right. */}
        <span className="ml-auto flex items-center gap-2">
          <span className="group relative flex" {...tipGroup}>
            <button
              type="button"
              aria-label="Add images"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onAdd}
              className={cn(BUTTON, 'size-8 min-h-8 justify-center px-0 text-foreground')}
            >
              <Plus className="size-4" aria-hidden />
            </button>
            {/* Near the window's edge, it opens leftwards. */}
            <span
              aria-hidden
              className={cn(TIP, 'top-full right-0 left-auto mt-2 translate-x-0 text-left')}
            >
              Add images
            </span>
          </span>
          <span className="group relative flex" {...tipGroup}>
          <button
            type="button"
            aria-label="Keys and voice"
            aria-expanded={legendOpen}
            aria-controls="reel-legend"
            // A click keeps the focus where it was, so Space still talks.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setLegendOpen((o) => !o)}
            className={cn(
              BUTTON,
              'size-8 min-h-8 justify-center px-0 text-foreground',
              legendOpen && 'bg-muted',
            )}
          >
            <CircleHelp className="size-4" aria-hidden />
          </button>
            {!legendOpen && (
              // At the window's edge: it opens leftwards, from the button's right edge.
              <span aria-hidden className={cn(TIP, 'top-full right-0 left-auto mt-2 translate-x-0')}>
                Keys and voice
              </span>
            )}
          </span>
        </span>
      </div>

      {assets.map((a, k) => {
        const slot = slotOf(k, at);
        const edge = slot === -1 || slot === 1;
        return (
          <div
            key={a.id}
            aria-hidden={slot !== 0}
            className={CARD}
            style={{
              ...SLOT[slot],
              ...(edge ? { maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE } : {}),
            }}
          >
            {urls[a.id] ? (
              // The box is the picture's own shape, so a point on it is a point on the screenshot.
              <span className="relative block">
                {/* biome-ignore lint/performance/noImgElement: a screenshot from the browser's storage, as a blob URL */}
                <img
                  ref={(el) => {
                    imgs.current[k] = el;
                  }}
                  src={urls[a.id]}
                  alt={slot === 0 ? a.name : ''}
                  width={a.width}
                  height={a.height}
                  draggable={false}
                  className="block h-auto max-h-[calc(var(--w)*0.75)] w-auto max-w-(--w) rounded-[14px] bg-muted"
                  // While recording, the ring is the pointer itself, drawn by the system (D209).
                  style={slot === 0 && phase === 'live' ? { cursor: ringCursor() } : undefined}
                />
                {slot === 0 && <VoiceMarks marks={voiceNotes(a)} />}

              </span>
            ) : (
              <span className="block size-full rounded-[14px] bg-muted" />
            )}
            {edge && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={slot < 0 ? 'Previous screen' : 'Next screen'}
                onClick={() => turn(k)}
                className="absolute inset-0 cursor-pointer rounded-[14px]"
              />
            )}
          </div>
        );
      })}

      {/* Past the last screen: a card to finish on, so a stray scroll never ends the take. */}
      <div
        aria-hidden={!atEnd}
        className={CARD}
        style={
          atEnd
            ? SLOT[0]
            : { ...SLOT[slotOf(assets.length, at)], opacity: 0, pointerEvents: 'none' }
        }
      >
        <div className="grid justify-items-center gap-3 text-center">
          {phase === 'saved' && saved ? (
            <>
              <p className="m-0 text-[15px] font-medium text-foreground">
                {made ? `${made} ${made === 1 ? 'note' : 'notes'}` : 'Finished'}
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                {clockText(talkedOf(saved.take))} over {saved.take.screens.length}{' '}
                {saved.take.screens.length === 1 ? 'screen' : 'screens'}.
                {!voiceOn && ' Notes from it come next.'}
              </p>
              {/* One wait with one bar: the words read, then the package put together (D196). */}
              {reading === 'working' ? (
                <Progress
                  label={
                    model === null
                      ? 'Reading the words'
                      : `Getting the voice model, once (up to ${MODEL_MB} MB)`
                  }
                  done={model === null ? readDone : model / 100}
                />
              ) : (
                packing && (
                  <Progress
                    label="Preparing the export"
                    done={packing.total ? packing.done / packing.total : null}
                  />
                )
              )}
              {reading === 'failed' && (
                <p role="alert" className="m-0 text-sm text-destructive">
                  The words couldn’t be read.{' '}
                  <button
                    type="button"
                    onClick={() => void read(saved)}
                    className="underline underline-offset-2"
                  >
                    Try again
                  </button>
                </p>
              )}
              {heard &&
                (heard.length ? (
                  <ol
                    data-reel-scroll
                    aria-label="What you said"
                    className="m-0 grid max-h-[calc(var(--w)*0.4)] w-[min(36rem,calc(var(--w)-2rem))] list-none gap-3 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-3 text-left text-sm select-text"
                  >
                    {heard.map((s) => (
                      <li key={s.id} className="grid gap-1.5">
                        <span className="truncate font-medium text-foreground">{s.name}</span>
                        {s.ops.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {s.ops.map((op, k) => (
                              <span
                                // biome-ignore lint/suspicious/noArrayIndexKey: the same tag can be said twice
                                key={k}
                                className="rounded-full bg-muted px-2 py-0.5 text-[12px] text-foreground"
                              >
                                {op}
                              </span>
                            ))}
                          </span>
                        )}
                        {s.notes.length > 0 && (
                          <ol className="m-0 grid list-none gap-1.5 p-0">
                            {s.notes.map(({ mark, n }) => {
                              const said = verdictOf(mark);
                              const v = said === 'bad' || said === 'both' ? said : 'good';
                              const word = VERDICT_WORD[v];
                              return (
                                <li key={mark.id} className="flex items-baseline gap-2">
                                  <span className="w-4 shrink-0 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                                    {n}
                                  </span>
                                  {READING_SHOWN && (
                                    <button
                                      type="button"
                                      aria-label={`Note ${n}: ${word}. Switch`}
                                      onPointerDown={(e) => e.preventDefault()}
                                      onClick={() => onFlip(s.id, mark.id)}
                                      className={cn(
                                        'shrink-0 rounded-full border border-border px-2 py-0.5 text-[12px] font-medium transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                                        VERDICT_TEXT[v],
                                      )}
                                    >
                                      {word}
                                    </button>
                                  )}
                                  <span className="text-foreground">
                                    {[mark.good, mark.bad].filter((x) => x.trim()).join(' ')}
                                    {mark.best && mark.good && (
                                      <Star
                                        aria-label="Best example"
                                        className="ml-1 inline size-3.5 fill-current align-[-2px]"
                                      />
                                    )}
                                    {isWhole(mark.shape) && (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        · {mark.unpointed ? 'Not pointed at' : 'Whole screen'}
                                      </span>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="m-0 text-sm text-muted-foreground">No words heard.</p>
                ))}
              {saved.take.words &&
                wordsLookWrong(
                  saved.take.words,
                  saved.take.shown.filter((x) => !x.click && !x.paused).map((x) => x.t),
                ) && (
                  // Whisper repeating itself over a stretch of quiet (D159, D199).
                  <p role="alert" className="m-0 max-w-[min(36rem,calc(var(--w)-2rem))] text-sm text-destructive">
                    Some words repeat as if misheard. Check them, or{' '}
                    <button
                      type="button"
                      onClick={talkAgain}
                      className="underline underline-offset-2"
                    >
                      start over
                    </button>
                    .
                  </p>
                )}
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => turn(0)} className={BUTTON}>
                  Back
                </button>
                {made > 0 && (
                  <button type="button" onClick={onExport} className={PRIMARY}>
                    <Download className="size-4" aria-hidden />
                    Export
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* The end of the reel, in the landing's drawing language (D203). */}
              {/* Played each time the card comes into view (D203). */}
              <TheEnd
                key={atEnd ? 'shown' : 'hidden'}
                play={atEnd}
                className="block h-auto w-[min(220px,calc(var(--w)*0.36))] text-muted-foreground"
              />
              <p className="m-0 text-[15px] font-medium text-foreground">
                That was the last screen
              </p>
              {recorded() || unsaved.current || phase === 'saving' ? (
                <button
                  type="button"
                  onClick={finish}
                  disabled={phase === 'saving'}
                  className={cn(PRIMARY, 'disabled:opacity-50')}
                >
                  Finish
                </button>
              ) : (
                <p className="m-0 text-sm text-muted-foreground">
                  Hold <Kbd>Space</Kbd> to talk first.
                </p>
              )}
              {saveError && (
                <p role="alert" className="m-0 text-sm text-destructive">
                  The browser couldn’t keep the recording. Free some room, then finish again.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {phase === 'counting' ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/85 text-center">
          <div>
            <div
              key={count}
              aria-live="assertive"
              className="animate-in text-[min(40cqh,320px)] leading-none font-medium text-foreground tabular-nums duration-300 fade-in-50 zoom-in-110 motion-reduce:animate-none"
            >
              {count}
            </div>
            <p className="mt-3 mb-0 text-sm text-muted-foreground">
              <Kbd>Esc</Kbd> to stop
            </p>
          </div>
        </div>
      ) : (
        (!atEnd || micError) && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center text-sm text-muted-foreground"
          >
            {micError ? (
              <p className="m-0">Allow the microphone for this site, then hold Space.</p>
            ) : phase === 'live' && !muted ? (
              // While it records: what the microphone hears, after Wispr Flow (D196), and beside
              // it what to do as a take begins (D206), the two centred together.
              <span className="flex items-center gap-3">
                <span className="flex h-9 items-center gap-2.5 rounded-full border border-border bg-background px-3.5">
                  <span aria-hidden className="size-2 rounded-full bg-red-600" />
                  <span aria-hidden className="flex h-5 items-center gap-[3px]">
                    {Array.from({ length: BARS }, (_, i) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: the bars are a fixed row
                        key={i}
                        ref={(el) => {
                          bars.current[i] = el;
                        }}
                        className="block h-full w-[3px] origin-center rounded-full bg-foreground"
                        style={{ transform: 'scaleY(0.15)' }}
                      />
                    ))}
                  </span>
                  <span className="sr-only">Recording</span>
                </span>
                {/* The landing's headline, light passing over it. */}
                {take.current && talkedIn(take.current) < HINT_MS && (
                  <ShimmerText duration={2.2} className="text-[13px] font-medium whitespace-nowrap">
                    Point at it. Say why.
                  </ShimmerText>
                )}
              </span>
            ) : null}
          </div>
        )
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-3 px-4 py-3 text-[13px] text-muted-foreground">
        {/* The keys, named on hover and lit while held (D202). */}
        <BarKey name="Hold to talk" on={pressed.has('space')} wide>
          Space
        </BarKey>
        <BarKey name="Hands-free" on={pressed.has('r')}>
          R
        </BarKey>
        <BarKey name="Previous screen" on={pressed.has('left')}>
          <ArrowLeft className="size-5" aria-label="Left arrow" />
        </BarKey>
        <BarKey name="Next screen" on={pressed.has('right')}>
          <ArrowRight className="size-5" aria-label="Right arrow" />
        </BarKey>
        <BarKey name="Finish" on={pressed.has('f')}>
          F
        </BarKey>
        {/* Start over, in the corner across from the legend (D199); the toast says it, with Undo. */}
        {(recorded() || unsaved.current || phase === 'saved') &&
          phase !== 'saving' &&
          phase !== 'opening' && (
            <button
              type="button"
              aria-keyshortcuts="Backspace"
              onPointerDown={(e) => e.preventDefault()}
              onClick={talkAgain}
              className={cn(BUTTON, 'absolute left-5 min-h-8 px-2.5 text-[13px] text-foreground')}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Start over
            </button>
          )}
      </div>

      {legendOpen && (
        <section
          id="reel-legend"
          aria-labelledby="reel-legend-title"
          data-reel-scroll
          className="absolute top-12 right-5 z-30 max-h-[calc(100%-8.5rem)] w-[min(44rem,calc(100%-2.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-background p-5 text-[13px] shadow-lg dark:shadow-none"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="reel-legend-title" className="m-0 text-[15px] font-medium">
              Keys and voice
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setLegendOpen(false)}
              className={cn(
                hit,
                '-mr-2 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
              )}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="m-0 mb-2 text-[13px] font-medium text-muted-foreground">Keys</h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
                {(
                  [
                    [<Kbd key="s">Space</Kbd>, 'Hold to talk, let go to pause'],
                    [<Kbd key="r">R</Kbd>, 'Record hands-free, or pause'],
                    [<Kbd key="b">Backspace</Kbd>, 'Start over, from the first screen'],
                    [<Kbd key="e">Esc</Kbd>, 'Stop the count'],
                    [<Right key="n" />, 'Next screen, also a scroll or swipe'],
                    [<Left key="p" />, 'Previous screen'],
                    [<Kbd key="f">F</Kbd>, 'The end, to finish'],
                    [<Kbd key="q">?</Kbd>, 'Show or hide this'],
                  ] as const
                ).map(([key, what]) => (
                  <div key={what} className="contents">
                    <dt className="flex justify-start">{key}</dt>
                    <dd className="m-0">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3 className="m-0 mb-2 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                Voice
                {!voiceOn && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                    Soon
                  </span>
                )}
              </h3>
              {/* Each phrase over what it does, so a long one never squeezes its meaning. */}
              <dl className="m-0 grid gap-2">
                {POINTING.map(([how, what]) => (
                  <div key={how}>
                    <dt className="text-foreground">{how}</dt>
                    <dd className="m-0 text-muted-foreground">{what}</dd>
                  </div>
                ))}
              </dl>
              <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
                {VOICE_LEGEND.map((row) => (
                  <div key={row.kind}>
                    <dt className="text-foreground">{row.say.map((p) => `“${p}”`).join(' or ')}</dt>
                    <dd className="m-0 text-muted-foreground">{row.does}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
