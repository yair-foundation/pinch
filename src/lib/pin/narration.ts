/*
 * The walkthrough's recording (D131), without the browser: where each card sits on the reel, the
 * clock that runs only while recording (so every time lines up with the audio), how a scroll or
 * swipe turns the reel, where the pointer is on the screenshot, and the take that is kept.
 */

import type { TimedWord } from './voice-tags';

/** How long the count before recording starts or resumes runs, in seconds. */
export const COUNTDOWN = 5;

/** A card's place on the reel: 0 is the screenshot on show, -1 and 1 the edges, beyond is hidden. */
export const slotOf = (card: number, at: number) => Math.max(-2, Math.min(2, card - at));

/**
 * The recording's clock. It runs only between `start` and `pause`, so a time read from it is a
 * time in the audio, whatever the pauses. `now` is injectable for tests.
 */
export function createClock(now: () => number = () => performance.now()) {
  let kept = 0;
  let since: number | null = null;
  return {
    start() {
      since ??= now();
    },
    pause() {
      if (since === null) return;
      kept += now() - since;
      since = null;
    },
    get running() {
      return since !== null;
    },
    /** Milliseconds recorded so far, whole. */
    time() {
      return Math.round(kept + (since === null ? 0 : now() - since));
    },
  };
}

/** A scroll or swipe that has built up towards a turn, and when the reel last turned. */
export type Wheel = { built: number; at: number };

/** How far a scroll must build before the reel turns, and how long it rests after a turn. */
const WHEEL_STEP = 80;
const WHEEL_REST = 700;

/**
 * One wheel event against the build-up: the dominant axis counts, so a scroll down and a swipe
 * left both turn the reel on. Returns the new build-up and the turn, 1, -1 or 0.
 */
export function wheelTurn(
  wheel: Wheel,
  delta: { deltaX: number; deltaY: number },
  at: number,
): { wheel: Wheel; turn: -1 | 0 | 1 } {
  if (at - wheel.at < WHEEL_REST) return { wheel, turn: 0 };
  const built =
    wheel.built + (Math.abs(delta.deltaX) > Math.abs(delta.deltaY) ? delta.deltaX : delta.deltaY);
  if (Math.abs(built) <= WHEEL_STEP) return { wheel: { ...wheel, built }, turn: 0 };
  return { wheel: { built: 0, at }, turn: built > 0 ? 1 : -1 };
}

/** Where a point is on a screenshot, as fractions of it (0–1, four places), or null when off it. */
export function pointOn(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): [number, number] | null {
  if (!rect.width || !rect.height) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

/**
 * Where the pointer is on a screen the reel has just turned to, if it hasn't moved since (D210).
 * The take keeps the pointer as it moves, each sample on the screen it was over, so a pointer held
 * still through a turn had no place on the new screen until it moved, and "this" said before then
 * fell to the whole screen. `at` is where the still pointer is on the new screenshot, read once it
 * has turned into place. The sample to keep, timed at the turn, or null: when a move since the turn
 * already says where the pointer is, or when it was off the screenshot and still is.
 */
export function sampleAtTurn(
  pointer: readonly PointerSample[],
  turnedAt: number,
  screen: number,
  at: [number, number] | null,
): PointerSample | null {
  const last = pointer.at(-1);
  if (last && last[0] > turnedAt) return null;
  if (!at && (!last || last[2] === null)) return null;
  return [turnedAt, screen, at?.[0] ?? null, at?.[1] ?? null];
}

/** The clock as m:ss. */
export const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** When a screen came into view (null: the end card), or was clicked, or the recording paused. */
export type Shown = { t: number; screen: number | null; click?: [number, number]; paused?: true };

/** The pointer at a time on a screen, as fractions of it, or null when it left the screenshot. */
export type PointerSample = [t: number, screen: number, x: number | null, y: number | null];

/**
 * One recorded walkthrough of a batch: the screens in reel order, when each was shown, and the
 * pointer's path, all in recording time. The audio is kept beside it as a Blob.
 */
export type Take = {
  id: string;
  version: 1;
  recordedAt: string;
  durationMs: number;
  mimeType: string;
  screens: { id: string; name: string; width: number; height: number }[];
  shown: Shown[];
  pointer: PointerSample[];
  /** What was said, once speech-to-text has read it (D136). */
  words?: TimedWord[];
  /** How the words were read (D188), for a take to say which reader its words came from. */
  readBy?: ReadBy;
};

/**
 * Where a take's words were read, with which voice model, and whether the take was cut at its
 * pauses first (D187) or read whole.
 */
export type ReadBy = { engine: 'browser' | 'server'; model: string; cut: boolean };
