'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Asking,
  Bubble,
  MarkedPage,
  MOCK_SPOTS,
  PinchScene,
  Robot,
  StepAdd,
  StepHand,
  StepPoint,
  StepSay,
  TalkScene,
} from './landing-art';
import { DemoCursor, SpotMark, useGaze, useTake, Wave } from './landing-demo';
import { LANDING_FONTS } from './landing-fonts';
import './landing.css';

/*
 * The landing (D169): what Pinch is, in its own colours and with some humour, because talking to your
 * screen is the awkward part and a page can make it less so. One action, adding screenshots; the
 * window takes dropped files too. It scrolls with the header, which floats over its top.
 */

const IN_THE_FOLDER = [
  'Your words',
  'Where you pointed',
  'A close-up of each spot',
  'A check on every screen',
];

const STEPS = [
  {
    Art: StepAdd,
    title: 'Add what you like',
    text: 'Designs you wish you had made, or the screen your agent just built.',
  },
  {
    Art: StepSay,
    title: 'Say it out loud',
    text: 'Talk the way you would to a friend. Half sentences are fine.',
  },
  {
    Art: StepPoint,
    title: 'Point as you talk',
    text: 'Your mouse does the “over here.” Each thing you say lands on the spot you meant.',
  },
  {
    Art: StepHand,
    title: 'Hand it over',
    text: 'Drop the folder in your project. Your agent reads it first and checks each screen against it.',
  },
];

/** The screens on the package's reel, with what was said about each spot. */
const SCREENS = [
  {
    title: 'Sunday market',
    notes: [
      { text: 'Huge, and I love it. Keep this scale.' },
      { text: 'Too shy. Give it some weight.' },
      { text: 'This one has jokes. More, please.' },
    ],
  },
  {
    title: 'Night train',
    notes: [
      { text: 'Dark, and I can still read this. Rare.' },
      { text: 'Nothing to do, and does it well.' },
      { text: 'Lost down here. Make it glow.' },
    ],
  },
  {
    title: 'Tiny bank',
    notes: [
      { text: 'This big? Now I believe it.' },
      { text: 'Three of these is two too many.' },
      { text: 'This stays. Everything else can move.' },
    ],
  },
];
const ON_A_SCREEN = 3;

/** The reel's cards: twice round, so that one can cross from one side to the other while hidden. */
const REEL_CARDS = [...SCREENS, ...SCREENS].map((_, i) => i);

/** The neighbours fade towards the bottom, as the reel turns away into the dark, as in `reel.tsx`. */
const EDGE_FADE = 'linear-gradient(to bottom, #000 25%, transparent 92%)';

/** A card by its slot on the reel, as in `reel.tsx`: the middle, the edges, and hidden beyond them. */
function slotStyle(slot: number): React.CSSProperties {
  if (slot === 0) return { transform: 'translate(-50%, -50%)', zIndex: 2 };
  const side = slot < 0 ? -1 : 1;
  return Math.abs(slot) === 1
    ? {
        transform: `translate(calc(-50% + ${side * 45}cqw), calc(-50% + 22cqh)) rotate(${side * 15}deg) scale(0.55)`,
        zIndex: 1,
        maskImage: EDGE_FADE,
        WebkitMaskImage: EDGE_FADE,
      }
    : {
        transform: `translate(calc(-50% + ${side * 90}cqw), calc(-50% + 60cqh)) rotate(${side * 30}deg) scale(0.45)`,
        opacity: 0,
      };
}

/*
 * From the blind tests in docs/taste-harness.md (D174). Coming back: of a take's 8 notes, how many a
 * new screen repeated, built with the take and the check against it, or with nothing (0.28 and 5.9,
 * over 20 screens for five made-up designers). The review: a judge with the author's notes against
 * a generic one, on the author's own 28 blind picks. Changes: 5.3 against 12.7 a screen.
 */
const RESULTS = [
  ['Corrections that come back', '4%', '74%'],
  ['A review that picks what you’d pick', '70%', '32%'],
] as const;
/** Changes asked for a screen, without Pinch and with it: 12.7 and 5.3, so 7.4 fewer each. */
const FEWER_A_SCREEN = 12.7 - 5.3;
const SCREENS_SHOWN = [1, 10];

const ROWS = [
  ['Saying where you mean', 'You just point', '“Second card, no, the other one”'],
  ['What your agent keeps', 'Every note, in your project', 'What you remember to retype'],
  ['Before you see a screen', 'Checked against your notes', 'Checked against its own taste'],
];

/*
 * What someone new asks before trying it (D177), answered from the code: the models in
 * `browser-voice.ts` and `voice-models.ts` (English only), the package in `notes-package.ts`.
 */
const QUESTIONS = [
  {
    q: 'Where do my screenshots go?',
    a: 'Nowhere. They stay in your browser, and so does your voice: a model downloaded once (up to 570 MB) turns it into words right there, and a small one reads the text on your screenshots.',
  },
  {
    q: 'Does it cost anything?',
    a: 'Free for now, with no account and no API key: Pinch runs no paid AI. The check runs on your own coding agent, one extra step a screen on a small, quick model, counted like the rest of its work.',
  },
  {
    q: 'Which agents does it work with?',
    a: 'Any coding agent that reads files, like Claude Code, Cursor or Codex. The check is built for Claude Code. The others read the same notes, and whether they run the check is untested.',
  },
  {
    q: 'Does it work with my design system?',
    a: 'Yes, and it never sees it. Your design system stays in your project; your notes tell your agent to keep its values and say how and where to use them.',
  },
  {
    q: 'What do I do with the folder?',
    a: 'Unzip it into your project, next to the ones from earlier takes: they all count. Its notes.md tells your agent to read everything first, and to run the check before it shows you a screen.',
  },
  {
    q: 'What does the check do?',
    a: 'Once your agent draws a screen, a second agent compares it with your notes and lists what goes against them, by your words, not its own taste. Your agent fixes those before you see it.',
  },
  {
    q: 'Why talk instead of type?',
    a: 'Talking leaves your hand free to point, so each sentence lands on the spot you meant. It’s quicker, too. It understands English only.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'No. Pinch needs a mouse to point with, so it’s for computers. Your phone gets a missing-mouse poster instead.',
  },
  {
    q: 'I saved notes here before. Where are they?',
    a: 'Still yours. Open the menu at the top right and choose Export my saved notes. If you kept them in an account, sign in there first.',
  },
];

const LINK = 'underline underline-offset-4 hover:text-(--ink)';

/** What the designer says as the cursor marks the title, the price and the button. */
/** The page's title, one line to a spot of the take (D172). Each line's last words get the first mark. */
const TITLES = [
  ['Point at it.', 'Say why.'],
  ['Teach AI', 'your taste.'],
  ['Say it', 'once.'],
] as const;

const SAYS = [
  ['THAT ONE.', 'KEEP IT BIG.'],
  ['AND THIS.', 'LOVE IT BIG.'],
  ['THIS TOO.', 'MORE OF THAT.'],
] as const;

const SPOT_ROOM = 12;
/** The cat's pupils: at rest on the mouse at its feet, and how far they can turn in its eyes. */
const CAT_REST = { x: 5, y: 2 };
const CAT_REACH = { x: 5, y: 2 };
type Rect = { x: number; y: number; w: number; h: number };

/** The spots above the fold, in `root`, followed as the window changes and the fonts arrive. */
function useRects(
  root: React.RefObject<HTMLElement | null>,
  targets: React.RefObject<HTMLElement | null>[],
) {
  const [rects, setRects] = useState<Rect[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs stay the same ones
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const from = el.getBoundingClientRect();
      setRects(
        targets.flatMap((t) => {
          const r = t.current?.getBoundingClientRect();
          return r
            ? [
                {
                  x: r.left - from.left - SPOT_ROOM,
                  y: r.top - from.top - SPOT_ROOM,
                  w: r.width + 2 * SPOT_ROOM,
                  h: r.height + 2 * SPOT_ROOM,
                },
              ]
            : [];
        }),
      );
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    document.fonts?.ready.then(measure);
    return () => watch.disconnect();
  }, [root]);
  return rects;
}

export function Landing({
  dragging,
  inert,
  onChoose,
}: {
  dragging: boolean;
  inert: boolean;
  onChoose: () => void;
}) {
  const [screens, setScreens] = useState(1);
  const fewer = Math.round(FEWER_A_SCREEN * SCREENS_SHOWN[screens]);
  const hero = useRef<HTMLElement>(null);
  const catEyes = useRef<SVGGElement>(null);
  const catLook = useRef<SVGGElement>(null);
  useGaze(catLook, catEyes, CAT_REST, CAT_REACH);
  const titleEnds = [
    useRef<HTMLSpanElement>(null),
    useRef<HTMLSpanElement>(null),
    useRef<HTMLSpanElement>(null),
  ];
  const price = useRef<HTMLSpanElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const measured = useRects(hero, [...titleEnds, price, start]);
  const heroTake = useTake(SAYS.length, hero);
  // The title changes as the cursor leaves a spot, and the first mark moves onto the new words.
  const title = heroTake.still ? 0 : heroTake.spot;
  const rects = measured.length ? [measured[title], ...measured.slice(TITLES.length)] : [];
  const story = useRef<HTMLDivElement>(null);
  const storyTake = useTake(SCREENS.length * ON_A_SCREEN, story, ON_A_SCREEN);
  const here = rects[heroTake.spot];
  const screen = storyTake.turns % SCREENS.length;
  const onScreen = storyTake.spot % ON_A_SCREEN;
  const mock = MOCK_SPOTS[screen][onScreen];
  const shownHere = (i: number) => storyTake.shown(storyTake.spot - onScreen + i);
  // The cursor comes to a spot's corner, and drags across it as the mark is drawn.
  const across = (stage: string) => stage !== 'travel';
  return (
    <div
      data-landing
      inert={inert}
      className={cn(
        'pinch-landing shrink-0',
        LANDING_FONTS,
        // Files over the window: the whole page takes them.
        dragging && 'outline-4 -outline-offset-4 outline-(--violet)',
      )}
    >
      <section
        ref={hero}
        aria-label="Start"
        className="relative overflow-hidden bg-(--lilac) pt-24"
      >
        <div className="relative z-10 px-6 text-center">
          <h1
            aria-label={TITLES[0].join(' ')}
            className="title title-rotor m-0 text-[clamp(56px,9.6vw,138px)]"
          >
            {TITLES.map(([opening, end], i) => (
              <span
                key={end}
                aria-hidden
                data-state={
                  i === title
                    ? 'on'
                    : (i - title + TITLES.length) % TITLES.length === 1
                      ? 'next'
                      : 'past'
                }
                className="title-line text-balance"
              >
                {opening}{' '}
                <span ref={titleEnds[i]} className="inline-block">
                  {end}
                </span>
              </span>
            ))}
          </h1>
          <p className="mx-auto mt-7 mb-0 max-w-[640px] text-[22px] leading-[1.45] text-balance">
            Talk through screenshots while you point. Your design agent keeps every note, and checks
            its work against them before you see it.
          </p>
        </div>
        <Wave on={heroTake.talking} className="mt-6 flex justify-center xl:hidden" />
        <PinchScene className="absolute bottom-0 left-0 hidden xl:block" />
        <TalkScene
          className="absolute right-0 bottom-0 hidden xl:block"
          say={SAYS[heroTake.spot]}
          gaze={{ eyes: catEyes, look: catLook }}
        />
        <Wave
          on={heroTake.talking}
          className="absolute right-[150px] bottom-[196px] z-10 hidden xl:inline-flex"
        />
        {rects.map((rect, i) => (
          <SpotMark key={SAYS[i][0]} rect={rect} number={i + 1} on={heroTake.shown(i)} />
        ))}
        {here && (
          <DemoCursor
            left={`${here.x + (across(heroTake.stage) ? here.w : 0)}px`}
            top={`${here.y + (across(heroTake.stage) ? here.h : 0)}px`}
          />
        )}
        <div className="relative z-10 mx-auto mt-12 w-full max-w-[720px] rounded-t-[40px] bg-(--violet) px-[6px]">
          <p className="m-0 py-[11px] text-center text-[17px] font-semibold text-white">
            Free for now
          </p>
          <div className="grid grid-cols-1 gap-12 rounded-t-[32px] bg-white px-6 pt-11 pb-12 sm:px-12 md:grid-cols-[1.02fr_1fr]">
            <div>
              <h2 className="subtitle m-0 text-[30px] leading-none">Pinch</h2>
              <p className="figure mt-6 mb-0 text-[116px]">
                <span ref={price} className="inline-block">
                  $0
                </span>
              </p>
              <p className="mt-3 mb-0 text-[17px] text-(--soft)">free, no account</p>
              <button
                ref={start}
                type="button"
                onClick={onChoose}
                className="press mt-8 block w-full cursor-pointer rounded-2xl border-2 border-b-[6px] border-(--ink) bg-(--butter) py-[15px] text-center text-[18px] font-semibold text-(--ink)"
              >
                Add screenshots
              </button>
              <p
                className="mt-3 mb-0 min-h-5 text-center text-[15px] text-(--soft)"
                aria-live="polite"
              >
                {dragging && 'Drop to add them.'}
              </p>
            </div>
            <div className="md:border-l md:border-(--line) md:pl-12">
              <h3 className="m-0 pt-1 text-[18px] font-semibold">In the folder</h3>
              <ul className="m-0 mt-7 list-none space-y-[26px] p-0 text-[17px] leading-snug">
                {IN_THE_FOLDER.map((item) => (
                  <li key={item} className="flex gap-3">
                    <svg
                      className="mt-px size-[22px] shrink-0"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <rect
                        className="t"
                        x="2"
                        y="2"
                        width="20"
                        height="20"
                        rx="5"
                        strokeWidth="2"
                      />
                      <path className="t" d="M7 12.500l3.500 3.500L17 8.500" strokeWidth="2" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
      <div className="relative z-10 border-t-[3px] border-(--ink) bg-white pt-[9px]">
        <div className="h-10 border-t-[3px] border-(--ink) bg-(--butter)" />
      </div>

      <section
        aria-label="How it works"
        className="mx-auto grid max-w-[1248px] grid-cols-1 gap-12 px-6 pt-14 pb-[72px] md:grid-cols-2 lg:grid-cols-4"
      >
        {STEPS.map(({ Art, title, text }) => (
          <article key={title}>
            <Art />
            <h2 className="subtitle mt-5 mb-0 text-[28px] leading-tight">{title}</h2>
            <p className="mt-2 mb-0 text-[18px] leading-[1.5] text-(--soft)">{text}</p>
          </article>
        ))}
      </section>

      <section className="mx-4 rounded-[40px] bg-(--lilac)">
        <div className="mx-auto grid max-w-[1208px] grid-cols-1 gap-16 px-6 py-16 lg:grid-cols-[360px_1fr]">
          <div>
            <h2 className="title m-0 text-[clamp(44px,5vw,64px)]">
              Your agent gets the whole story.
            </h2>
            <p className="mt-6 mb-0 text-[20px] leading-[1.45]">
              Not a mood board and a shrug. Everything you said, tied to the spot you said it about,
              and a check that holds your agent to it.
            </p>
            <pre className="mt-8 mb-0 overflow-hidden rounded-2xl bg-(--ink) px-6 py-5 font-mono text-[14px] leading-[2] text-white">
              <code>
                <span className="text-(--butter)">pinch-notes/</span>
                {'\n  notes.md       '}
                <span className="text-white/60"># every note</span>
                {'\n  pinch-check.md '}
                <span className="text-white/60"># checks the work</span>
                {'\n  images/        '}
                <span className="text-white/60"># your screenshots</span>
                {'\n  marked/        '}
                <span className="text-white/60"># with numbers on</span>
                {'\n  crops/         '}
                <span className="text-white/60"># a close-up each</span>
              </code>
            </pre>
          </div>
          <div className="relative min-w-0 sm:pt-[104px]">
            <Bubble className="absolute top-0 right-[196px] z-0 hidden sm:block" />
            <Robot
              className="absolute top-[8px] right-[44px] z-0 hidden overflow-visible sm:block"
              turns={storyTake.turns}
              pulling={storyTake.turning}
            />
            <div className="relative z-10 rounded-[32px] bg-(--violet) px-[6px] pb-[6px]">
              <div className="flex items-center justify-between py-[10px] pr-8 pl-8">
                <p className="m-0 text-[15px] font-semibold text-white">Your package</p>
                <Wave on={storyTake.talking} className="story-wave inline-flex" />
              </div>
              <div className="grid grid-cols-1 gap-8 rounded-[26px] bg-white p-7 md:grid-cols-[296px_1fr]">
                <div ref={story} className="package-reel self-start">
                  {REEL_CARDS.map((card) => {
                    // Where this card is from the one in the middle, -2 to 3; 3 waits hidden.
                    const away =
                      (card - (storyTake.turns % REEL_CARDS.length) + REEL_CARDS.length) %
                      REEL_CARDS.length;
                    const slot = away > 3 ? away - REEL_CARDS.length : Math.min(away, 2);
                    return (
                      <div key={card} className="reel-card" style={slotStyle(slot)}>
                        <MarkedPage
                          className="block w-full rounded-xl"
                          screen={card % SCREENS.length}
                          shown={slot === 0 ? shownHere : () => slot < 0}
                        />
                      </div>
                    );
                  })}
                  <DemoCursor
                    left={`${50 + ((mock.x + (across(storyTake.stage) ? mock.w : 0)) / 320 - 0.5) * 72}%`}
                    top={`${50 + ((mock.y + (across(storyTake.stage) ? mock.h : 0)) / 300 - 0.5) * 67.5}%`}
                  />
                </div>
                <div key={screen} className="note-set min-h-[296px]">
                  <h3 className="subtitle m-0 text-[26px] leading-tight">
                    {SCREENS[screen].title}
                  </h3>
                  <ol className="m-0 mt-4 list-none space-y-3 p-0">
                    {SCREENS[screen].notes.map((note, i) => (
                      <li key={note.text} className="note flex gap-2.5" data-on={shownHere(i)}>
                        <span className="note-number">{i + 1}</span>
                        <p className="note-bubble m-0">{note.text}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-[40px] bg-(--mist)">
        <div className="mx-auto max-w-[1088px] px-6 pt-[72px] pb-20">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div>
              <h2 className="title m-0 text-[clamp(52px,6vw,76px)]">Stop repeating yourself.</h2>
              <p className="mt-4 mb-0 max-w-[520px] text-[20px] leading-[1.45] text-(--soft)">
                Your agent forgets every correction. With Pinch it keeps them, and checks each
                screen against them before you see it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <fieldset className="m-0 flex rounded-full border-2 border-(--ink) bg-white p-[6px]">
                <legend className="sr-only">How many screens</legend>
                {SCREENS_SHOWN.map((n, i) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={i === screens}
                    onClick={() => setScreens(i)}
                    className={cn(
                      'cursor-pointer rounded-full px-6 py-[11px] text-[18px] font-medium transition-colors duration-150 motion-reduce:transition-none',
                      i === screens ? 'bg-(--ink) text-white' : 'bg-transparent text-(--ink)',
                    )}
                  >
                    {n === 1 ? '1 screen' : `${n} screens`}
                  </button>
                ))}
              </fieldset>
              <p
                className="tag relative m-0 rounded-xl border-2 border-(--ink) bg-(--butter) px-4 py-[10px] text-[18px] font-semibold"
                aria-live="polite"
              >
                {fewer} fewer changes to ask for
              </p>
            </div>
          </div>
          <div className="mt-10 rounded-[32px] border border-(--line) bg-white px-5 py-9 sm:px-10">
            <table className="w-full border-collapse text-left text-[18px]">
              <thead>
                <tr>
                  <td className="w-[36%]" />
                  <th scope="col" className="w-[32%] pb-4 font-semibold">
                    With Pinch
                  </th>
                  <th scope="col" className="w-[32%] pb-4 font-semibold">
                    Without
                  </th>
                </tr>
              </thead>
              <tbody>
                {RESULTS.map(([row, pinch, without]) => (
                  <tr key={row}>
                    <th scope="row" className="py-3 font-normal text-(--soft)">
                      {row}
                    </th>
                    <td className="figure py-3 text-[clamp(30px,5vw,68px)] tabular-nums">
                      {pinch}
                    </td>
                    <td className="figure py-3 text-[clamp(30px,5vw,68px)] text-(--soft) tabular-nums">
                      {without}
                    </td>
                  </tr>
                ))}
                {ROWS.map(([row, pinch, without]) => (
                  <tr key={row}>
                    <th scope="row" className="py-4 font-normal text-(--soft)">
                      {row}
                    </th>
                    <td className="py-4">{pinch}</td>
                    <td className="py-4 text-(--soft)">{without}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-5 mb-0 px-2 text-[15px] text-(--soft)">
            From blind tests: 20 screens built for five made-up designers, and one designer’s own 28
            picks for the review.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="faq-title"
        id="faq"
        className="mx-4 mt-4 rounded-[40px] bg-(--lilac)"
      >
        <div className="mx-auto grid max-w-[1208px] grid-cols-1 gap-12 px-6 py-16 lg:grid-cols-[360px_1fr] lg:gap-16">
          <div>
            <h2 id="faq-title" className="title m-0 text-[clamp(44px,5vw,64px)]">
              Fair questions.
            </h2>
            <Asking className="mt-12 hidden lg:block" />
          </div>
          <div className="min-w-0 space-y-3">
            {QUESTIONS.map(({ q, a }) => (
              <details key={q} className="faq rounded-[20px] border-2 border-(--ink) bg-white">
                <summary className="flex items-center justify-between gap-6 px-6 py-[18px] text-[19px] leading-snug font-semibold">
                  {q}
                  <span className="faq-sign" aria-hidden="true" />
                </summary>
                <p className="faq-answer m-0 max-w-[620px] px-6 pb-6 text-[18px] leading-[1.5] text-(--soft)">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-9 text-[16px] text-(--soft) sm:px-[72px]">
        <p className="m-0">Free, no account. Nothing leaves your browser.</p>
        <p className="m-0">
          <a href="/terms" className={LINK}>
            Terms
          </a>{' '}
          · Created by{' '}
          <a href="https://yair-works.vercel.app" target="_blank" rel="noopener" className={LINK}>
            Yair Cohen
          </a>
        </p>
      </footer>
    </div>
  );
}
