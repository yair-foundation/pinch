'use client';

import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Bubble,
  MarkedPage,
  PinchScene,
  Robot,
  StepAdd,
  StepHand,
  StepPoint,
  StepSay,
  TalkScene,
} from './landing-art';
import './landing.css';

/*
 * The landing (D169): what Pinch is, in its own colours and with some humour, because talking to your
 * screen is the awkward part and a page can make it less so. One action, adding screenshots; the
 * window takes dropped files too. It scrolls with the header, which floats over its top.
 */

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz', 'wdth'],
  variable: '--font-landing-display',
});
const body = Figtree({ subsets: ['latin'], variable: '--font-landing-body' });

const IN_THE_FOLDER = [
  'Your words',
  'Where you pointed',
  'A close-up of each spot',
  'Ready to hand over',
];

const STEPS = [
  {
    Art: StepAdd,
    title: 'Add what you like',
    text: 'Drop in screenshots of designs you wish you had made. Your own work counts too.',
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
    text: 'Pinch packs it into one folder. Give it to your design agent and get back to work.',
  },
];

const SAMPLE = [
  {
    text: 'That title is huge and I love it. Keep the scale.',
    where: 'Top left, on “Fresh on Sunday.”',
    dot: 'var(--ink)',
  },
  {
    text: 'The button is too shy. Give it some weight.',
    where: 'Middle left, on “See the stalls”',
    dot: '#3b9f87',
  },
  {
    text: 'This lemon has jokes. More of this, please.',
    where: 'Middle right',
    dot: 'var(--butter)',
  },
];

/** Notes on the shots, for the toggle: 65 is what ten screenshots came to in the author's first take. */
const SHOTS = [
  { label: '1 shot', notes: 6 },
  { label: '10 shots', notes: 65 },
];

const ROWS = [
  ['Saying where you mean', 'You just point', '“Second card, no, the other one”'],
  ['What your agent gets', 'Your words, on the exact spot', 'A transcript and good luck'],
  ['What it costs', '$0, no account', 'Whatever you pay for it'],
];

const LINK = 'underline underline-offset-4 hover:text-(--ink)';

export function Landing({
  dragging,
  inert,
  onChoose,
}: {
  dragging: boolean;
  inert: boolean;
  onChoose: () => void;
}) {
  const [shots, setShots] = useState(1);
  const { notes } = SHOTS[shots];
  return (
    <div
      data-landing
      inert={inert}
      className={cn(
        'pinch-landing shrink-0',
        display.variable,
        body.variable,
        // Files over the window: the whole page takes them.
        dragging && 'outline-4 -outline-offset-4 outline-(--violet)',
      )}
    >
      <section aria-label="Start" className="relative overflow-hidden bg-(--lilac) pt-24">
        <div className="relative z-10 px-6 text-center">
          <h1 className="title m-0 text-[clamp(56px,9.6vw,138px)]">Point at it. Say why.</h1>
          <p className="mx-auto mt-7 mb-0 max-w-[640px] text-[22px] leading-[1.45] text-balance">
            Add screenshots of designs you like and talk about them while you point. Your design
            agent gets a package it can read.
          </p>
        </div>
        <PinchScene className="absolute bottom-0 left-0 hidden xl:block" />
        <TalkScene className="absolute right-0 bottom-0 hidden xl:block" />
        <div className="relative z-10 mx-auto mt-12 w-full max-w-[720px] rounded-t-[40px] bg-(--violet) px-[6px]">
          <p className="m-0 py-[11px] text-center text-[17px] font-semibold text-white">
            Free for now
          </p>
          <div className="grid grid-cols-1 gap-12 rounded-t-[32px] bg-white px-6 pt-11 pb-12 sm:px-12 md:grid-cols-[1.02fr_1fr]">
            <div>
              <h2 className="subtitle m-0 text-[30px] leading-none">Pinch</h2>
              <p className="figure mt-6 mb-0 text-[116px]">$0</p>
              <p className="mt-3 mb-0 text-[17px] text-(--soft)">free, no account</p>
              <button
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
              Not a mood board and a shrug. Everything you said, tied to the spot you said it about.
            </p>
            <pre className="mt-8 mb-0 overflow-hidden rounded-2xl bg-(--ink) px-6 py-5 font-mono text-[14px] leading-[2] text-white">
              <code>
                <span className="text-(--butter)">pinch-notes/</span>
                {'\n  notes.md  '}
                <span className="text-white/60"># every note, numbered</span>
                {'\n  images/   '}
                <span className="text-white/60"># your screenshots</span>
                {'\n  marked/   '}
                <span className="text-white/60"># with numbers on</span>
                {'\n  crops/    '}
                <span className="text-white/60"># a close-up each</span>
              </code>
            </pre>
          </div>
          <div className="relative min-w-0 sm:pt-[104px]">
            <Bubble className="absolute top-0 right-[196px] z-0 hidden sm:block" />
            <Robot className="absolute top-[8px] right-[44px] z-0 hidden sm:block" />
            <div className="relative z-10 rounded-[32px] bg-(--violet) px-[6px] pb-[6px]">
              <p className="m-0 py-[10px] pl-8 text-[15px] font-semibold text-white">
                Your package
              </p>
              <div className="grid grid-cols-1 gap-8 rounded-[26px] bg-white p-7 md:grid-cols-[296px_1fr]">
                <MarkedPage className="block w-full rounded-xl" />
                <div>
                  <h3 className="subtitle m-0 text-[26px] leading-tight">Sunday market</h3>
                  <ol className="m-0 mt-5 list-none space-y-5 p-0">
                    {SAMPLE.map((note, i) => (
                      <li key={note.where} className="flex gap-3">
                        <span className="subtitle w-5 shrink-0 text-[18px] leading-snug text-(--violet)">
                          {i + 1}
                        </span>
                        <div>
                          <p className="m-0 text-[18px] leading-snug font-medium">{note.text}</p>
                          <p className="mt-1 mb-0 flex items-center gap-2 text-[15px] leading-snug text-(--soft)">
                            <span
                              className="inline-block size-[10px] rounded-full border border-(--ink)"
                              style={{ background: note.dot }}
                            />
                            {note.where}
                          </p>
                        </div>
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
              <h2 className="title m-0 text-[clamp(52px,6vw,76px)]">Talk is cheap.</h2>
              <p className="mt-4 mb-0 max-w-[520px] text-[20px] leading-[1.45] text-(--soft)">
                You already talk to your computer. Dictation writes down what you say, but it can’t
                see what you mean.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <fieldset className="m-0 flex rounded-full border-2 border-(--ink) bg-white p-[6px]">
                <legend className="sr-only">How many screenshots</legend>
                {SHOTS.map((s, i) => (
                  <button
                    key={s.label}
                    type="button"
                    aria-pressed={i === shots}
                    onClick={() => setShots(i)}
                    className={cn(
                      'cursor-pointer rounded-full px-6 py-[11px] text-[18px] font-medium transition-colors duration-150 motion-reduce:transition-none',
                      i === shots ? 'bg-(--ink) text-white' : 'bg-transparent text-(--ink)',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </fieldset>
              <p
                className="tag relative m-0 rounded-xl border-2 border-(--ink) bg-(--butter) px-4 py-[10px] text-[18px] font-semibold"
                aria-live="polite"
              >
                {notes} fewer “which one?”
              </p>
            </div>
          </div>
          <div className="mt-10 rounded-[32px] border border-(--line) bg-white px-5 py-9 sm:px-10">
            <table className="w-full border-collapse text-left text-[18px]">
              <thead>
                <tr>
                  <td className="w-[36%]" />
                  <th scope="col" className="w-[32%] pb-4 font-semibold">
                    Pinch
                  </th>
                  <th scope="col" className="w-[32%] pb-4 font-semibold">
                    Dictating it
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" className="py-3 font-normal text-(--soft)">
                    Notes tied to a spot
                  </th>
                  <td className="figure py-3 text-[clamp(30px,5vw,68px)] tabular-nums">
                    {notes} of {notes}
                  </td>
                  <td className="figure py-3 text-[clamp(30px,5vw,68px)] text-(--soft) tabular-nums">
                    0 of {notes}
                  </td>
                </tr>
                {ROWS.map(([row, pinch, dictating]) => (
                  <tr key={row}>
                    <th scope="row" className="py-4 font-normal text-(--soft)">
                      {row}
                    </th>
                    <td className="py-4">{pinch}</td>
                    <td className="py-4 text-(--soft)">{dictating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
