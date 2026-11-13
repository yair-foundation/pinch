/*
 * Hold to talk (D196): the walkthrough hears the author while a key is held and stops hearing
 * them when it is let go, after Wispr Flow. Letting go doesn't pause the take at once. The last
 * word gets a moment to finish (`TAIL`), then the microphone is muted while the take's clock runs
 * on (`mute`), so the silence between two holds is in the recording as it was in the room: the
 * notes are cut at those silences (D162, D187, D192). Only once the key has been let go for longer
 * than any pause that still joins two sentences (`REST`) is the take paused (`pause`), and the
 * next hold starts after a gap that ends the thought, as a pause of that length always has.
 */

/** How long the microphone stays on after the key is let go, so the last word isn't clipped. */
export const TAIL = 250;
/** How long a muted take keeps its clock running: past the pause that ends a sentence whatever comes next (6 s). */
export const REST = 6500;

export type HoldState = 'off' | 'talking' | 'tail' | 'resting';

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};

const WINDOW_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * The key's life. `talk` is called when the author starts holding from rest or from off; `mute`
 * once the key has been let go for `TAIL`; `pause` once it has stayed let go for `REST` more.
 * A press during the tail carries on as if the key had never been let go.
 */
export function createHold(
  on: { talk: () => void; mute: () => void; pause: () => void },
  timers: Timers = WINDOW_TIMERS,
) {
  let state: HoldState = 'off';
  let timer: unknown = null;
  const stop = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return {
    get state() {
      return state;
    },
    /** Whether the key is down now. */
    get held() {
      return state === 'talking';
    },
    press() {
      if (state === 'talking') return;
      const was = state;
      stop();
      state = 'talking';
      if (was !== 'tail') on.talk();
    },
    /** The key let go, or the window lost it: a key let go out of sight never says so. */
    release() {
      if (state !== 'talking') return;
      state = 'tail';
      timer = timers.set(() => {
        state = 'resting';
        on.mute();
        timer = timers.set(() => {
          timer = null;
          state = 'off';
          on.pause();
        }, REST);
      }, TAIL);
    },
    /** Forget the key: the take was paused, finished or dropped some other way. */
    reset() {
      stop();
      state = 'off';
    },
  };
}

export type Hold = ReturnType<typeof createHold>;
