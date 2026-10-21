'use client';

import { Check } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { TASTE } from '@/lib/pin/taste';
import { cn } from '@/lib/utils';
import { Dialog, hit } from './dialog';

/*
 * The taste check (D102): one question at a time, each option a small drawing of the look it
 * names, so a pick says exactly what the author means. Picking moves on; Back goes over a
 * question again; No preference skips one. At the end the picks become rules, once the author
 * says so.
 */

const small = cn(
  hit,
  'flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground disabled:opacity-50',
);
const primary = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50',
);

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function TasteCheck({
  answered,
  opener,
  onClose,
  onDone,
}: {
  /** The options picked before, by question, so taking it again starts from them. */
  answered: Record<string, string>;
  opener: HTMLElement | null;
  onClose: () => void;
  /** The picks, by question; a question with no preference is left out. */
  onDone: (answers: Record<string, string>) => void;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(answered);
  const q = TASTE[step];
  const picked = Object.keys(answers).length;
  const next = () => setStep((s) => s + 1);
  const pick = (option: string | null) => {
    setAnswers((a) => {
      const { [q.id]: _, ...rest } = a;
      return option ? { ...rest, [q.id]: option } : rest;
    });
    next();
  };

  return (
    <Dialog
      id="taste-title"
      title="Taste check"
      opener={opener}
      onClose={onClose}
      className="max-w-xl"
    >
      {q ? (
        <div key={q.id} className="space-y-4">
          <fieldset className="min-w-0 space-y-3 border-0 p-0">
            <legend className="float-left w-full space-y-1">
              <span className="block text-[13px] text-muted-foreground">
                {step + 1} of {TASTE.length}
              </span>
              <span className="block text-base font-medium text-foreground">{q.ask}</span>
            </legend>
            <div
              className={cn(
                'clear-left grid gap-3',
                q.options.length > 2 ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              {q.options.map((o, i) => {
                const on = answers[q.id] === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    data-autofocus={i === 0 ? true : undefined}
                    title={o.rule}
                    onClick={() => pick(o.id)}
                    className={cn(
                      'group space-y-2 rounded-lg border p-2 text-left transition-colors duration-150 motion-reduce:transition-none',
                      on
                        ? 'border-foreground bg-muted'
                        : 'border-border hover:border-foreground/30 hover:bg-muted/60',
                    )}
                  >
                    <Preview look={`${q.id}:${o.id}`} />
                    <span className="flex items-center gap-1.5 px-1 pb-0.5 text-sm">
                      {o.label}
                      {on && <Check className="size-3.5" aria-hidden />}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className={small}
            >
              Back
            </button>
            <button type="button" onClick={() => pick(null)} className={cn(small, 'ml-auto')}>
              No preference
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            {picked
              ? `You made ${count(picked, 'pick')}. Each becomes a rule in Your rules, and your agent gets them. Change or remove any with the pencil.`
              : 'You had no preference on any of them, so there is nothing to add.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setStep(TASTE.length - 1)} className={small}>
              Back
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => (picked ? onDone(answers) : onClose())}
              className={cn(primary, 'ml-auto')}
            >
              {picked ? `Add ${count(picked, 'rule')}` : 'Close'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** A grey line of text, drawn: `w` is its width. */
function Bar({ w, className, style }: { w: string; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn('block h-1.5 rounded-full bg-current opacity-25', className)}
      style={{ width: w, ...style }}
    />
  );
}

/** The fonts each kind of headline face is drawn in, the ones a computer most likely has first. */
const FACES: Record<string, string> = {
  humanist: '"Gill Sans", "Gill Sans MT", Seravek, Optima, Candara, "Segoe UI", sans-serif',
  geometric: 'Futura, "Century Gothic", "Avenir Next", Avenir, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
};

/** The look an option names, drawn small: a frame of a screen, never a real product. */
function Preview({ look }: { look: string }) {
  const frame =
    'relative flex h-24 w-full flex-col justify-center gap-1.5 overflow-hidden rounded-md border border-border px-3';
  const [question, option] = look.split(':');
  switch (look) {
    case 'dark:black':
    case 'dark:tinted': {
      const black = option === 'black';
      return (
        <span
          aria-hidden
          className={cn(frame, 'border-transparent')}
          style={{ background: black ? '#000' : '#17191f', color: black ? '#a3a3a3' : '#9aa3b4' }}
        >
          <Bar w="45%" className="opacity-60" />
          <span
            className="block space-y-1.5 rounded border p-2"
            style={{
              borderColor: black ? '#2b2b2b' : '#2b303b',
              background: black ? '#000' : '#1e2129',
            }}
          >
            <Bar w="70%" />
            <Bar w="50%" />
          </span>
        </span>
      );
    }
    case 'accent:one':
      return (
        <span aria-hidden className={cn(frame, 'bg-background text-foreground')}>
          <Bar w="55%" />
          <Bar w="80%" />
          <span className="mt-1 block h-4 w-14 rounded" style={{ background: '#e8590c' }} />
        </span>
      );
    case 'accent:several':
      return (
        <span aria-hidden className={cn(frame, 'flex-row items-stretch gap-1.5 bg-background p-2')}>
          {['#ff6b4a', '#3b5bdb', '#12b886'].map((c) => (
            <span
              key={c}
              className="flex flex-1 flex-col justify-end gap-1 rounded p-1.5 text-white"
              style={{ background: c }}
            >
              <Bar w="80%" className="opacity-70" />
              <Bar w="50%" className="opacity-70" />
            </span>
          ))}
        </span>
      );
    case 'depth:flat':
    case 'depth:soft': {
      const flat = option === 'flat';
      return (
        <span
          aria-hidden
          className={cn(frame, 'flex-row items-center gap-2 border-transparent')}
          style={{ background: '#f4f4f5', color: '#3f3f46' }}
        >
          {[0, 1].map((i) => (
            <span
              key={i}
              className="block flex-1 space-y-1.5 rounded-md bg-white p-2"
              style={
                flat
                  ? { border: '1px solid #e4e4e7' }
                  : { boxShadow: '0 1px 2px rgb(0 0 0 / 0.06), 0 6px 16px rgb(0 0 0 / 0.14)' }
              }
            >
              <Bar w="80%" />
              <Bar w="55%" />
            </span>
          ))}
        </span>
      );
    }
    case 'corners:round':
    case 'corners:square': {
      const round = option === 'round';
      return (
        <span aria-hidden className={cn(frame, 'bg-muted/40 text-foreground')}>
          <span
            className={cn(
              'block space-y-1.5 border border-border bg-background p-2',
              round ? 'rounded-xl' : 'rounded-none',
            )}
          >
            <Bar w="65%" />
            <span
              className={cn(
                'block h-3.5 w-12 bg-foreground',
                round ? 'rounded-full' : 'rounded-none',
              )}
            />
          </span>
        </span>
      );
    }
    case 'headlines:humanist':
    case 'headlines:geometric':
    case 'headlines:serif':
      return (
        <span aria-hidden className={cn(frame, 'gap-1 bg-background text-foreground')}>
          <span className="block text-lg leading-tight" style={{ fontFamily: FACES[option] }}>
            Plan the week
          </span>
          <Bar w="80%" />
          <Bar w="60%" />
        </span>
      );
    case 'labels:label':
    case 'labels:none':
      return (
        <span aria-hidden className={cn(frame, 'gap-1 bg-background text-foreground')}>
          {option === 'label' && (
            <span className="block text-[9px] font-medium tracking-widest text-muted-foreground uppercase">
              Features
            </span>
          )}
          <span className="block text-sm font-semibold">Plan together</span>
          <Bar w="80%" />
          <Bar w="55%" />
        </span>
      );
    case 'density:dense':
    case 'density:roomy': {
      const rows = option === 'dense' ? 7 : 3;
      return (
        <span
          aria-hidden
          className={cn(frame, 'justify-start gap-0 px-0 py-0 bg-background text-foreground')}
        >
          {Array.from({ length: rows }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing
              key={i}
              className={cn(
                'flex items-center gap-2 border-b border-border px-3',
                option === 'dense' ? 'h-[13px]' : 'h-8',
              )}
            >
              <Bar w="30%" />
              <Bar w="20%" className="ml-auto" />
            </span>
          ))}
        </span>
      );
    }
    case 'grouping:space':
      return (
        <span aria-hidden className={cn(frame, 'gap-0 bg-background text-foreground')}>
          <span className="block space-y-1.5">
            <Bar w="70%" />
            <Bar w="50%" />
          </span>
          <span className="mt-4 block space-y-1.5">
            <Bar w="65%" />
            <Bar w="45%" />
          </span>
        </span>
      );
    case 'grouping:lines':
      return (
        <span aria-hidden className={cn(frame, 'gap-1.5 bg-background text-foreground')}>
          {[0, 1].map((i) => (
            <span key={i} className="block space-y-1.5 rounded border border-border p-1.5">
              <Bar w="70%" />
              <Bar w="45%" />
            </span>
          ))}
        </span>
      );
    case 'figures:big':
      return (
        <span aria-hidden className={cn(frame, 'gap-0.5 bg-background text-foreground')}>
          <span className="block text-2xl leading-none font-bold tabular-nums">2,481</span>
          <span className="block text-[10px] text-muted-foreground">active teams</span>
          <Bar w="60%" className="mt-1.5" />
        </span>
      );
    case 'figures:text':
      return (
        <span aria-hidden className={cn(frame, 'gap-1.5 bg-background text-foreground')}>
          <span className="block text-[11px] tabular-nums">2,481 active teams</span>
          <Bar w="70%" />
          <Bar w="50%" />
        </span>
      );
    case 'motion:fade':
    case 'motion:still':
      // The fade-up plays again every few seconds; with reduced motion it is shown still.
      return (
        <span aria-hidden className={cn(frame, 'gap-1.5 bg-background text-foreground')}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn(
                'block h-4 rounded bg-muted',
                option === 'fade' && 'motion-safe:animate-[taste-rise_3.2s_ease-out_infinite]',
              )}
              style={option === 'fade' ? { animationDelay: `${i * 0.25}s` } : undefined}
            />
          ))}
        </span>
      );
    case 'imagery:product':
      return (
        <span
          aria-hidden
          className={cn(frame, 'flex-row items-center gap-2 bg-background text-foreground')}
        >
          <span className="block w-2/5 space-y-1.5">
            <Bar w="90%" />
            <Bar w="65%" />
          </span>
          <span className="flex h-16 flex-1 overflow-hidden rounded border border-border">
            <span className="block w-1/4 bg-muted" />
            <span className="block flex-1 space-y-1 p-1.5">
              <Bar w="80%" />
              <Bar w="60%" />
              <Bar w="70%" />
            </span>
          </span>
        </span>
      );
    case 'imagery:people':
      return (
        <span
          aria-hidden
          className={cn(frame, 'flex-row items-center gap-2 bg-background text-foreground')}
        >
          <span className="block w-2/5 space-y-1.5">
            <Bar w="90%" />
            <Bar w="65%" />
          </span>
          <span
            className="relative block h-16 flex-1 overflow-hidden rounded"
            style={{ background: 'linear-gradient(160deg, #f2c49b, #b9785a)' }}
          >
            <span
              className="absolute top-2.5 left-1/2 size-5 -translate-x-1/2 rounded-full"
              style={{ background: '#5b3a2e' }}
            />
            <span
              className="absolute -bottom-3 left-1/2 h-8 w-14 -translate-x-1/2 rounded-t-full"
              style={{ background: '#3d4a6b' }}
            />
          </span>
        </span>
      );
    case 'voice:plain':
    case 'voice:playful':
      return (
        <span aria-hidden className={cn(frame, 'gap-1 bg-background text-foreground')}>
          <span className="block text-xs font-medium">
            {option === 'plain' ? 'Payment failed' : 'Whoops!'}
          </span>
          <span className="block text-[11px] leading-snug text-muted-foreground">
            {option === 'plain'
              ? 'Check your card and try again.'
              : 'Your card took a little nap. Give it another go!'}
          </span>
        </span>
      );
    default:
      return <span aria-hidden className={frame} data-look={`${question}:${option}`} />;
  }
}
