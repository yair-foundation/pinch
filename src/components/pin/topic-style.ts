import type { Topic } from '@/lib/pin/model';

/*
 * How topic tags look, wherever they show: the note's tags in the notes panel
 * and a collection's learnings, grouped by topic (D72, D74).
 */

/**
 * A topic tag's hit area: as wide as the tag and 36px tall, under the usual 44px so that rows
 * 8px apart, the same as the columns, tile without overlapping (D74).
 */
export const tagHit =
  'relative after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-9 after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]';

/**
 * One tint per topic: `ink` is the label and `fill` the tag when it is on. No red, which means
 * "doesn't work" and delete. Text is at least 5.4:1 on its fill in light (teal, orange and green
 * take the 800 shade for it) and 9.6:1 in dark.
 */
export const TOPIC_TONES: Record<Topic, { ink: string; fill: string }> = {
  visual: {
    ink: 'text-fuchsia-700 dark:text-fuchsia-300',
    fill: 'bg-fuchsia-100 dark:bg-fuchsia-400/15',
  },
  layout: { ink: 'text-blue-700 dark:text-blue-300', fill: 'bg-blue-100 dark:bg-blue-400/15' },
  copy: { ink: 'text-teal-800 dark:text-teal-300', fill: 'bg-teal-100 dark:bg-teal-400/15' },
  interaction: {
    ink: 'text-violet-700 dark:text-violet-300',
    fill: 'bg-violet-100 dark:bg-violet-400/15',
  },
  flow: {
    ink: 'text-orange-800 dark:text-orange-300',
    fill: 'bg-orange-100 dark:bg-orange-400/15',
  },
  accessibility: {
    ink: 'text-green-800 dark:text-green-300',
    fill: 'bg-green-100 dark:bg-green-400/15',
  },
};
