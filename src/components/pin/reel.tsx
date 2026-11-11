'use client';

import { ArrowLeft, ArrowRight, CircleHelp, Download, Star, X } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { type Asset, type Mark, placesOf, verdictOf } from '@/lib/pin/model';
import {
  COUNTDOWN,
  clockText,
  createClock,
  type PointerSample,
  pointOn,
  type ReadBy,
  type Shown,
  slotOf,
  type Take,
  type Wheel,
  wheelTurn,
} from '@/lib/pin/narration';
import { READING_SHOWN } from '@/lib/pin/notes-package';
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
import { MARK_COLOR } from './render';

/*
 * The walkthrough (D131): the batch on a reel, after a View-Master. The screenshot being narrated
 * sits in the middle; the one before and the one after are tilted at the edges, lower down and
 * fading. R records (the first time in a visit after a five-second count, D143), Space pauses
 * and resumes at once, the arrows (or a scroll or swipe) turn the reel, F goes to the end, and ?
 * or the Keys and voice button opens the legend. While recording, the microphone and the
 * pointer's path over the screenshot are kept, in recording time, and Finish keeps them in
 * this browser as a take. Where speech-to-text is on (D136), the take's words are read after
 * Finish and made into notes where the pointer was, with the voice tags heard applied (D137);
 * the end card lists them by screen, and the middle screenshot shows its notes, numbered. From
 * the end card Export gives the package of this take (D144, D157, D163).
 */

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
 * keeping it in this browser, or kept.
 */
type Phase = 'paused' | 'opening' | 'counting' | 'live' | 'saving' | 'saved';

/** A card on the reel, by its slot: the middle, the edges, and hidden beyond them. */
const SLOT: Record<number, CSSProperties> = {
  0: { transform: 'translate(-50%, -50%)' },
  [-1]: {
    transform: 'translate(calc(-50% - 45cqw), calc(-50% + 22cqh)) rotate(-15deg) scale(0.55)',
  },
  1: { transform: 'translate(calc(-50% + 45cqw), calc(-50% + 22cqh)) rotate(15deg) scale(0.55)' },
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
  const [clock, setClock] = useState('0:00');
  const [saved, setSaved] = useState<{ take: Take; audio: Blob } | null>(null);
  // Speech-to-text: whether it's on here, and reading a take's words.
  // Where a take's words are read: Pinch's server on this machine (D136), or this browser (D140).
  const [engine, setEngine] = useState<'server' | 'browser' | null>(null);
  const voiceOn = engine !== null;
  const [reading, setReading] = useState<'idle' | 'working' | 'failed'>('idle');
  // How much of the browser's voice model has come in, while it downloads the first time.
  const [model, setModel] = useState<number | null>(null);

  const reel = useRef<HTMLDivElement>(null);
  // Each card's screenshot by its place in the batch; the middle one is the one on show. One ref
  // passed from card to card as the reel turns could be left on the card that just left.
  const imgs = useRef<(HTMLImageElement | null)[]>([]);
  const middle = () => imgs.current[atRef.current] ?? null;
  const level = useRef<HTMLSpanElement>(null);
  // The take in progress: the microphone, the recorder, its clock and what it has kept so far.
  const take = useRef<{
    id: string;
    stream: MediaStream;
    audio: AudioContext;
    recorder: MediaRecorder;
    chunks: Blob[];
    clock: ReturnType<typeof createClock>;
    shown: Shown[];
    pointer: PointerSample[];
    off: boolean;
  } | null>(null);
  // A stopped take the browser couldn't keep yet: Finish tries again, and nothing records over it.
  const unsaved = useRef<{ take: Take; audio: Blob } | null>(null);
  // The take the end card is about, so a reading of an earlier one doesn't land on it.
  const shownTake = useRef<string | null>(null);
  const countTimer = useRef(0);
  const wheel = useRef<Wheel>({ built: 0, at: -Infinity });
  const atRef = useRef(at);
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
    },
    [assets.length, onIndex],
  );

  /** Ask for the microphone once, and start a take on it. */
  const open = async () => {
    if (take.current) return true;
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
    const mimeType =
      ['audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    // The level under the state, so the author sees the microphone hears them.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      if (audio.state === 'closed') return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      if (level.current) level.current.style.width = `${Math.min(100, (peak / 64) * 100)}%`;
      requestAnimationFrame(loop);
    };
    loop();
    take.current = {
      id: crypto.randomUUID(),
      stream,
      audio,
      recorder,
      chunks,
      clock: createClock(),
      shown: [],
      pointer: [],
      off: false,
    };
    return true;
  };

  const goLive = () => {
    const t = take.current;
    if (!t) return;
    if (t.clock.time() === 0)
      t.shown.push({ t: 0, screen: atRef.current < assets.length ? atRef.current : null });
    t.clock.start();
    if (t.recorder.state === 'inactive') t.recorder.start(1000);
    else t.recorder.resume();
    go('live');
  };

  /** What the end card shows: a kept take, or none. */
  const show = (done: { take: Take; audio: Blob } | null) => {
    shownTake.current = done?.take.id ?? null;
    setSaved(done);
  };

  const record = async () => {
    const from = phaseNow.current;
    if ((from !== 'paused' && from !== 'saved') || unsaved.current) return;
    go('opening');
    if (!(await open())) {
      if (mounted.current) go(from);
      return;
    }
    if (from === 'saved') {
      show(null);
      setReading('idle');
    }
    // Only the first recording of a visit waits for the count (D143): a resume starts at once.
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
    if (phaseNow.current === 'counting') {
      clearInterval(countTimer.current);
      go('paused');
      return;
    }
    const t = take.current;
    if (phaseNow.current !== 'live' || !t) return;
    t.clock.pause();
    t.recorder.pause();
    t.shown.push({
      t: t.clock.time(),
      screen: atRef.current < assets.length ? atRef.current : null,
      paused: true,
    });
    go('paused');
  };

  /** Stop the take in progress, let the microphone go, and put together what it kept. */
  const stop = useCallback(async () => {
    const t = take.current;
    if (!t) return null;
    take.current = null;
    clearInterval(countTimer.current);
    t.clock.pause();
    const durationMs = t.clock.time();
    if (t.recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        t.recorder.onstop = () => resolve();
        t.recorder.stop();
      });
    }
    for (const track of t.stream.getTracks()) track.stop();
    t.audio.close().catch(() => undefined);
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
  }, [assets]);

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
      return transcribeInBrowser(audio, (p) => {
        if (mounted.current) setModel(p < 100 ? p : null);
      });
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
    setReading('working');
    try {
      const { words, readBy } = await wordsOf(done.audio);
      if (mounted.current) setModel(null);
      const take = { ...done.take, words, ...(readBy && { readBy }) };
      await onSave(take, done.audio);
      onTake(take);
      if (!onShow()) return;
      show({ take, audio: done.audio });
      setReading('idle');
    } catch {
      if (mounted.current) setModel(null);
      if (onShow()) setReading('failed');
    }
  };

  /** The kept take's notes taken out, and a new recording in its place (D159). */
  const talkAgain = () => {
    if (saved) onTake({ ...saved.take, words: [] });
    void record();
  };

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
  const keptMs = saved?.take.durationMs ?? 0;
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(clockText(take.current?.clock.time() ?? keptMs));
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
    return () => {
      mounted.current = false;
      keepRef.current().catch(() => undefined);
    };
  }, []);

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
      // A focused button takes its own Enter and Space.
      if ((key === 'Enter' || key === ' ') && e.target instanceof HTMLButtonElement) return;
      const act: Record<string, () => void> = {
        r: () => void record(),
        ' ': () => (phase === 'paused' || phase === 'saved' ? void record() : pause()),
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
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The ring under the pointer on the screenshot while recording (D184), moved without a render.
  const ring = useRef<HTMLSpanElement>(null);
  /*
   * The pointer over the middle screenshot, while recording, heard on the window (D184): the
   * author's first gesture take lost the pointer for 26 to 42 seconds on three screens while
   * they moved over the slide, with the reel's own handler. On the window nothing drawn over the
   * reel can keep a move from the take, and the ring shows the author what the take sees. In
   * development a line a second says what the recorder saw, to chase a pointer that goes missing.
   */
  useEffect(() => {
    if (phase !== 'live') {
      if (ring.current) ring.current.style.opacity = '0';
      return;
    }
    let moves = 0;
    let on = false;
    const onMove = (e: PointerEvent) => {
      const t = take.current;
      const img = imgs.current[atRef.current];
      if (!t || !img) return;
      moves++;
      const p = pointOn(img.getBoundingClientRect(), e.clientX, e.clientY);
      on = p !== null;
      if (ring.current) {
        ring.current.style.opacity = p ? '1' : '0';
        if (p) {
          ring.current.style.left = `${p[0] * 100}%`;
          ring.current.style.top = `${p[1] * 100}%`;
        }
      }
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
    live: 'Recording',
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
      <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-5 py-3 text-[13px] text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            phase === 'live' ? 'bg-red-600' : 'bg-muted-foreground/60',
          )}
        />
        <span aria-live="polite" className="text-foreground">
          {state}
        </span>
        <span aria-hidden className="h-1 w-20 overflow-hidden rounded-full bg-muted">
          <span ref={level} className="block h-full w-0 bg-foreground" />
        </span>
        <span className="font-mono tabular-nums">{clock}</span>
        {model !== null && <span className="tabular-nums">Voice model {Math.floor(model)}%</span>}
        <span className="ml-auto">{at < assets.length ? `${at + 1} of ${assets.length}` : ''}</span>
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
                />
                {slot === 0 && <VoiceMarks marks={voiceNotes(a)} />}
                {slot === 0 && (
                  <span
                    ref={ring}
                    aria-hidden
                    className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white opacity-0 ring-1 ring-black/50"
                  />
                )}
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
                {clockText(saved.take.durationMs)} over {saved.take.screens.length}{' '}
                {saved.take.screens.length === 1 ? 'screen' : 'screens'}.
                {!voiceOn && ' Notes from it come next.'}
              </p>
              {reading === 'working' && (
                <p aria-live="polite" className="m-0 text-sm text-muted-foreground tabular-nums">
                  {model === null
                    ? 'Reading the words…'
                    : `Getting the voice model, once (up to ${MODEL_MB} MB): ${Math.floor(model)}%`}
                </p>
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
                                      <span className="text-muted-foreground"> · Whole screen</span>
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
              {saved.take.words && wordsLookWrong(saved.take.words) && (
                <p role="alert" className="m-0 text-sm text-destructive">
                  These words look wrong.{' '}
                  <button
                    type="button"
                    onClick={talkAgain}
                    className="underline underline-offset-2"
                  >
                    Talk again
                  </button>
                </p>
              )}
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => turn(0)} className={BUTTON}>
                  Back to the first
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
                  Press <Kbd>R</Kbd> to record first.
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
        ((phase === 'paused' && !unsaved.current) || micError) && (
          <p
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-12 z-10 m-0 text-center text-sm text-muted-foreground"
          >
            {micError ? (
              'Allow the microphone for this site, then press R.'
            ) : (
              <>
                Press <Kbd>R</Kbd> to {recorded() ? 'resume' : 'record'}
              </>
            )}
          </p>
        )
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-5 px-4 py-3 text-[13px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>Space</Kbd> Pause
        </span>
        <span className="flex items-center gap-1.5">
          <Left />
          <Right /> Turn
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>F</Kbd> Finish
        </span>
        <button
          type="button"
          aria-expanded={legendOpen}
          aria-controls="reel-legend"
          // A click keeps the focus where it was, so Space still pauses.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setLegendOpen((o) => !o)}
          className={cn(
            BUTTON,
            'absolute right-5 min-h-8 px-2.5 text-[13px]',
            legendOpen && 'bg-muted',
          )}
        >
          <CircleHelp className="size-4" aria-hidden />
          Keys and voice
        </button>
      </div>

      {legendOpen && (
        <section
          id="reel-legend"
          aria-labelledby="reel-legend-title"
          className="absolute right-5 bottom-16 z-30 w-[min(44rem,calc(100%-2.5rem))] rounded-xl border border-border bg-background p-5 text-[13px] shadow-lg dark:shadow-none"
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
                    [<Kbd key="r">R</Kbd>, 'Record, or resume'],
                    [<Kbd key="s">Space</Kbd>, 'Pause, or resume'],
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
