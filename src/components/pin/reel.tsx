'use client';

import { ArrowLeft, ArrowRight, CircleHelp, Download, X } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { Asset } from '@/lib/pin/model';
import {
  COUNTDOWN,
  clockText,
  createClock,
  type PointerSample,
  pointOn,
  type Shown,
  slotOf,
  type Take,
  takeFile,
  takeFileName,
  type Wheel,
  wheelTurn,
} from '@/lib/pin/narration';
import { opLabel, spoken, wordsByScreen } from '@/lib/pin/transcript';
import { parseVoiceTags, type TimedWord, VOICE_LEGEND } from '@/lib/pin/voice-tags';
import { cn } from '@/lib/utils';
import { hit } from './dialog';

/*
 * The walkthrough (D131): the batch on a reel, after a View-Master. The screenshot being narrated
 * sits in the middle; the one before and the one after are tilted at the edges, lower down and
 * fading. R records after a five-second count, Space pauses and resumes, the arrows (or a scroll
 * or swipe) turn the reel, F goes to the end, and ? or the Keys and voice button opens the legend. While recording, the microphone
 * and the pointer's path over the screenshot are kept, in recording time, and Finish keeps them in
 * this browser as a take. Where speech-to-text is on (D136), the take's words are read after
 * Finish and shown by screen, with the voice tags heard; they aren't turned into notes yet.
 */

/** What was said over one screen: its voice tags and the words left for notes. */
type Heard = { name: string; ops: string[]; rest: string }[];

/** The take's words by screen, as the end card shows them. */
function heardOf(take: Take, words: TimedWord[], known: string[]): Heard {
  return wordsByScreen(take.shown, words, take.screens.length)
    .map((said, k) => {
      const { ops, rest } = parseVoiceTags(said, known);
      return { name: take.screens[k].name, ops: ops.map(opLabel), rest: spoken(rest) };
    })
    .filter((s) => s.ops.length || s.rest);
}

type Phase = 'paused' | 'counting' | 'live' | 'saved';

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
  ['Point off the screenshot', 'A note on the whole screen'],
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function Reel({
  assets,
  urls,
  index,
  inert,
  onIndex,
  onSave,
}: {
  assets: Asset[];
  urls: Record<string, string>;
  /** The screenshot on show; the end card sits one past the last. */
  index: number;
  inert: boolean;
  onIndex: (i: number) => void;
  /** Keep a finished take and its audio in this browser. */
  onSave: (take: Take, audio: Blob) => Promise<void>;
}) {
  const [atEnd, setAtEnd] = useState(false);
  const at = atEnd ? assets.length : Math.min(index, assets.length - 1);
  const [phase, setPhase] = useState<Phase>('paused');
  const [count, setCount] = useState(COUNTDOWN);
  const [micError, setMicError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [clock, setClock] = useState('0:00');
  const [saved, setSaved] = useState<{ take: Take; audio: Blob } | null>(null);
  // Speech-to-text: whether it's on here, and reading a take's words.
  const [voiceOn, setVoiceOn] = useState(false);
  const [reading, setReading] = useState<'idle' | 'working' | 'failed'>('idle');

  const reel = useRef<HTMLDivElement>(null);
  const middle = useRef<HTMLImageElement>(null);
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
      setMicError(true);
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
    setPhase('live');
  };

  const record = async () => {
    if (phase !== 'paused' && phase !== 'saved') return;
    if (phase === 'saved') setSaved(null);
    if (!(await open())) return;
    setPhase('counting');
    setCount(COUNTDOWN);
    let n = COUNTDOWN;
    countTimer.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) return setCount(n);
      clearInterval(countTimer.current);
      goLive();
    }, 1000);
  };

  const pause = () => {
    if (phase === 'counting') {
      clearInterval(countTimer.current);
      setPhase('paused');
      return;
    }
    const t = take.current;
    if (phase !== 'live' || !t) return;
    t.clock.pause();
    t.recorder.pause();
    t.shown.push({
      t: t.clock.time(),
      screen: atRef.current < assets.length ? atRef.current : null,
      paused: true,
    });
    setPhase('paused');
  };

  /** Stop the take and keep it: from Finish, or when the reel closes mid-take. */
  const keep = useCallback(async () => {
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
    await onSave(kept, audio);
    return { take: kept, audio };
  }, [assets, onSave]);

  /** Read a kept take's words on this machine, and keep them with it. */
  const read = async (done: { take: Take; audio: Blob }) => {
    setReading('working');
    try {
      const res = await fetch('/api/pin/voice', {
        method: 'POST',
        headers: { 'Content-Type': done.audio.type || 'audio/webm' },
        body: done.audio,
      });
      if (!res.ok) throw new Error();
      const { words } = (await res.json()) as { words: TimedWord[] };
      const take = { ...done.take, words };
      await onSave(take, done.audio);
      if (!mounted.current) return;
      setSaved({ take, audio: done.audio });
      setReading('idle');
    } catch {
      if (mounted.current) setReading('failed');
    }
  };

  const finish = async () => {
    if (!recorded()) return;
    setSaveError(false);
    try {
      const done = await keep();
      if (!mounted.current) return;
      setSaved(done);
      setPhase('saved');
      if (done && voiceOn) void read(done);
    } catch {
      if (mounted.current) {
        setSaveError(true);
        setPhase('paused');
      }
    }
  };

  const download = async () => {
    if (!saved) return;
    const audio = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(saved.audio);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([takeFile(saved.take, audio)], { type: 'application/json' }),
    );
    a.download = takeFileName(saved.take);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // The clock in the corner, read from the take's own clock, or the kept take's length.
  const keptMs = saved?.take.durationMs ?? 0;
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(clockText(take.current?.clock.time() ?? keptMs));
    }, 250);
    return () => clearInterval(id);
  }, [keptMs]);

  useEffect(() => {
    fetch('/api/pin/voice')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { available?: boolean } | null) => setVoiceOn(Boolean(d?.available)))
      .catch(() => undefined);
  }, []);

  const heard = saved?.take.words
    ? heardOf(
        saved.take,
        saved.take.words,
        assets.flatMap((a) => (a.screenTag ? [a.screenTag] : [])),
      )
    : null;

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

  // The pointer over the middle screenshot, while recording.
  const onPointerMove = (e: React.PointerEvent) => {
    const t = take.current;
    if (phase !== 'live' || !t || !middle.current) return;
    const p = pointOn(middle.current.getBoundingClientRect(), e.clientX, e.clientY);
    if (!p && t.off) return;
    t.off = !p;
    t.pointer.push([t.clock.time(), atRef.current, p?.[0] ?? null, p?.[1] ?? null]);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const t = take.current;
    if (phase !== 'live' || !t || !middle.current || e.target !== middle.current) return;
    const p = pointOn(middle.current.getBoundingClientRect(), e.clientX, e.clientY);
    if (p) t.shown.push({ t: t.clock.time(), screen: atRef.current, click: p });
  };

  const state = {
    paused: recorded() ? 'Paused' : 'Ready',
    counting: 'Starting',
    live: 'Recording',
    saved: 'Saved',
  }[phase];

  return (
    <section
      ref={reel}
      aria-label="Walkthrough"
      inert={inert}
      onPointerMove={onPointerMove}
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
              // biome-ignore lint/performance/noImgElement: a screenshot from the browser's storage, as a blob URL
              <img
                ref={slot === 0 ? middle : undefined}
                src={urls[a.id]}
                alt={slot === 0 ? a.name : ''}
                width={a.width}
                height={a.height}
                draggable={false}
                className="block max-h-[calc(var(--w)*0.75)] max-w-(--w) rounded-[14px] bg-muted object-contain"
              />
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
              <p className="m-0 text-[15px] font-medium text-foreground">Saved in this browser</p>
              <p className="m-0 text-sm text-muted-foreground">
                {clockText(saved.take.durationMs)} over {saved.take.screens.length}{' '}
                {saved.take.screens.length === 1 ? 'screen' : 'screens'}. Notes from it come next.
              </p>
              {reading === 'working' && (
                <p aria-live="polite" className="m-0 text-sm text-muted-foreground">
                  Reading the words…
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
                    className="m-0 grid max-h-[calc(var(--w)*0.4)] w-[min(36rem,calc(var(--w)-2rem))] list-none gap-3 overflow-y-auto overscroll-contain rounded-lg border border-border p-3 text-left text-sm select-text"
                  >
                    {heard.map((s) => (
                      <li key={s.name} className="grid gap-1">
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
                        {s.rest && <span className="text-muted-foreground">{s.rest}</span>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="m-0 text-sm text-muted-foreground">No words heard.</p>
                ))}
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={download} className={BUTTON}>
                  <Download className="size-4" aria-hidden />
                  Download recording
                </button>
                <button type="button" onClick={() => turn(0)} className={BUTTON}>
                  Back to the first
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="m-0 text-[15px] font-medium text-foreground">
                That was the last screen
              </p>
              {recorded() ? (
                <button type="button" onClick={finish} className={PRIMARY}>
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
        (phase === 'paused' || micError) && (
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
                    [<Kbd key="r">R</Kbd>, 'Record, or resume, after a five-second count'],
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
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                  Soon
                </span>
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
