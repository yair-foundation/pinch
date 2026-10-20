'use client';

import { TOPICS, type Topic, toggleTopic } from '@/lib/pin/model';
import { cn } from '@/lib/utils';
import { TOPIC_TONES, tagHit } from './topic-style';

/**
 * What a note (or a rule) is about: six toggle tags, any number on, none needed. Off, a tag is outlined; on,
 * it is filled with its tint. While a grey suggestion shows and the note has no
 * topics yet, the suggestion's topics have a dashed border: taking the suggestion turns them on.
 */
export function TopicPicker({
  legend = 'This note is about',
  topics,
  suggested,
  onChange,
}: {
  legend?: React.ReactNode;
  topics?: Topic[];
  suggested?: Topic[];
  onChange: (topics: Topic[]) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0 text-[13px] text-muted-foreground">
      <legend className="mb-2.5 p-0 text-[13px] leading-7 font-medium">{legend}</legend>
      {/* Each tag as wide as its label, 8px apart both ways. */}
      <div className="flex flex-wrap gap-2">
        {TOPICS.map((t) => {
          const on = Boolean(topics?.includes(t.kind));
          const hinted = !on && Boolean(suggested?.includes(t.kind));
          const tone = TOPIC_TONES[t.kind];
          return (
            <button
              key={t.kind}
              type="button"
              aria-pressed={on}
              title={hinted ? `${t.hint}. Suggested: Tab takes it with the text` : t.hint}
              onClick={() => onChange(toggleTopic(topics, t.kind))}
              className={cn(
                tagHit,
                'flex h-7 items-center rounded-md border px-2 text-[13px] leading-none whitespace-nowrap transition-colors duration-150 outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/50',
                on
                  ? cn('border-transparent', tone.fill, tone.ink)
                  : hinted
                    ? 'border-dashed border-foreground/50 text-foreground hover:bg-muted'
                    : 'border-border hover:bg-muted hover:text-foreground',
              )}
            >
              {t.label}
              {hinted && <span className="sr-only">, suggested</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
