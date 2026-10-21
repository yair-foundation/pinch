'use client';

import {
  Check,
  ChevronDown,
  FileText,
  Cloud,
  Pencil,
  PlugZap,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PRINCIPLES } from '@/lib/pin/foundation';
import { batchNotes, readExport } from '@/lib/pin/import';
import { MAX_LEARN_NOTES, MAX_LEARN_RULES, MAX_TITLES } from '@/lib/pin/learn';
import {
  answerRule,
  applyReading,
  type Batch,
  type BatchNote,
  byTopic,
  confirmRule,
  type Collection,
  evidenceOf,
  imagesOf,
  knownNotes,
  mergeCollection,
  type NoteRef,
  newCollection,
  newNotes,
  originOf,
  ownWords,
  picked,
  RULES_NAME,
  type Reading,
  type Rule,
  type RulePick,
  rulesOf,
  rulesText,
  tagsOf,
  unlockRules,
  unreadNotes,
  upgradeCollection,
  waiting,
  withBatch,
  withRule,
  withTitles,
} from '@/lib/pin/learnings';
import { sourceLabel, TOPICS, type Topic, topicLabel } from '@/lib/pin/model';
import { unzip } from '@/lib/pin/unzip';
import { cn } from '@/lib/utils';
import type { CollectionsBackend } from './collections-backend';
import { ConnectDialog } from './connect-agent';
import { Dialog, hit } from './dialog';
import { closeUpForReading } from './render';
import { RuleSkeleton, ShimmerText } from './shimmer';
import { TopicPicker } from './topic-picker';
import { TOPIC_TONES, tagHit } from './topic-style';

/*
 * Your rules (D79, D86, D87, D88): the person's one taste library, shown in
 * place of the images from the header. Coming here adds the open images' new
 * notes; Update rules has the AI read every note it hasn't read against the
 * rules already there, a few dozen notes at a time, and each reading
 * strengthens rules, writes new ones or flags a conflict. Once Pinch is paid,
 * an update takes credits, its price on the button before it runs (D98). Rules are guidance
 * as soon as they are written; the pencil edits one. Each rule opens to the
 * notes it draws on, with their close-ups. Rules can be sliced by topic and
 * by the author's own tags. They reach the agent by Connect agent (D93):
 * over MCP, or copied as a prompt. Kept in this browser, or in the account
 * once signed in (D81, D98), where this browser's move on their own.
 */

/** Set once the author has read what an update sends to the AI (D98). */
const CLOSE_UPS_KEY = 'pinch-close-ups';

export type Notice = {
  tone: 'info' | 'error';
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
} | null;

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
const nowIso = () => new Date().toISOString();
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The collection is written this long after its last change, so typing a rule isn't a write per key. */
const SAVE_PAUSE = 600;

const button = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-50',
);
const small = cn(
  hit,
  'flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground disabled:opacity-50',
);
const primary = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50',
);
const field =
  'w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 placeholder:text-[#737373] focus:border-foreground/25 motion-reduce:transition-none dark:placeholder:text-[#7a7a7a]';
const chip =
  'flex h-7 items-center gap-1 rounded-md border px-2 text-[13px] leading-none whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none';

/** What the page slices rules by: a topic, one of the author's tags, a principle, or nothing. */
type Slice = { topic: Topic | null } | { tag: string | null } | { principle: string } | null;
const sliceKey = (s: Slice) =>
  !s
    ? 'all'
    : 'topic' in s
      ? `topic:${s.topic ?? ''}`
      : 'tag' in s
        ? `tag:${s.tag ?? ''}`
        : `principle:${s.principle}`;
const pickOf = (s: Slice): RulePick =>
  !s
    ? {}
    : 'topic' in s
      ? { topics: [s.topic] }
      : 'tag' in s
        ? { tags: [s.tag] }
        : { principles: [s.principle] };

export function CollectionsView({
  inert,
  backend,
  moveFrom,
  openPrints,
  batchZip,
  account,
  credits,
  offer,
  onPay,
  onCredits,
  onBack,
  onStatus,
}: {
  inert: boolean;
  /** Where the rules are kept. */
  backend: CollectionsBackend;
  /** Rules kept elsewhere that can move here: this browser's, once signed in. */
  moveFrom?: CollectionsBackend;
  /** The open images' notes, by `noteFingerprint`, to tell whether any are new here. */
  openPrints: string[];
  /** The open images as an export, or null when they have no notes. */
  batchZip: () => Promise<{ blob: Blob; name: string } | null>;
  /** Signed in, can sign in, or neither: what connecting an agent needs first. */
  account: 'in' | 'out' | 'none';
  /** Credits left, and whether this browser's moved into an account; null when none are counted. */
  credits: { balance: number; closed: boolean } | null;
  /** What an update costs: credits for the update and for each note (D98). */
  offer: { update: number; note: number };
  /** Ask for credits: this update needs more, or they are in the account. */
  onPay: () => void;
  /** An update took credits: read them again. */
  onCredits: () => void;
  onBack: () => void;
  onStatus: (notice: Notice) => void;
}) {
  const [c, setC] = useState<Collection | null>(null);
  const ref = useRef<Collection | null>(null);
  const [learnAvailable, setLearnAvailable] = useState<boolean | null>(null);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // The rule the author asked to remove, waiting on "are you sure".
  const [removing, setRemoving] = useState<string | null>(null);
  // Before the first update in this browser, what goes to the AI is said (D98).
  const [asking, setAsking] = useState(false);
  const [movable, setMovable] = useState<Collection[]>([]);
  const [slice, setSlice] = useState<Slice>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Rules written while the page is open are marked new.
  const since = useRef(nowIso());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    const now = ref.current;
    if (!now) return;
    backend.save(now).catch(() =>
      onStatus({
        tone: 'error',
        text:
          backend.kind === 'account'
            ? 'Your rules didn’t save to your account. Check the connection; your change is kept here until it does.'
            : 'This browser didn’t save your rules. Export the ones you want to keep.',
      }),
    );
  }, [backend, onStatus]);

  /** Every change goes through here; it is written a moment later, or at once. */
  const change = useCallback(
    (fn: (c: Collection) => Collection, now = false) => {
      if (!ref.current) return;
      ref.current = fn(ref.current);
      setC(ref.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => {
          timer.current = null;
          save();
        },
        now ? 0 : SAVE_PAUSE,
      );
    },
    [save],
  );

  // Leaving the view, or the page, writes what is still waiting.
  useEffect(() => {
    const flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      save();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [save]);

  /** One collection of this browser's moved into the account's: its new notes' zips, then it. */
  const moveIn = useCallback(
    async (into: Collection, x: Collection, from: CollectionsBackend) => {
      const merged = mergeCollection(into, x, nowIso());
      const have = new Set(into.batches.map((b) => b.id));
      for (const b of merged.batches) {
        if (have.has(b.id)) continue;
        const blob = await from.getBatch(b.id);
        if (blob) await backend.putBatch(b.id, blob);
      }
      await backend.save(merged);
      await from.remove(x);
      return merged;
    },
    [backend],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: Collection[];
      try {
        list = await backend.list();
      } catch {
        ref.current = newCollection(RULES_NAME, newId(), nowIso());
        setC(ref.current);
        onStatus({ tone: 'error', text: 'Your rules didn’t load. Reload to try again.' });
        return;
      }
      // One collection each (D86): several made before are merged into the oldest, and one is
      // made, unsaved until something is added, when there is none. Older records are brought
      // up to date (D87).
      const [first, ...rest] = list
        .map((x) => upgradeCollection(x, newId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let one = first ?? newCollection(RULES_NAME, newId(), nowIso());
      for (const x of rest) one = mergeCollection(one, x, nowIso());
      if (rest.length) one = { ...one, name: RULES_NAME };
      let dirty = rest.length > 0 || list.some((x) => x.learnings || !x.rules);
      // Signed in: this browser's rules move into the account on their own (D87, D98), so the
      // notes and rules found before are there on every device.
      const waiting = moveFrom
        ? (await moveFrom.list().catch(() => [] as Collection[]))
            .map((x) => upgradeCollection(x, newId))
            .filter((x) => x.batches.length || x.rules.length)
        : [];
      if (moveFrom && waiting.length) {
        onStatus({ tone: 'info', text: 'Moving your rules into your account…', sticky: true });
        let moved = 0;
        try {
          for (const x of waiting) {
            one = await moveIn(one, x, moveFrom);
            moved++;
          }
          dirty = false;
          onStatus({
            tone: 'info',
            text: 'Your rules are in your account now, on every device you sign in on.',
          });
        } catch (e) {
          setMovable(waiting.slice(moved));
          onStatus({
            tone: 'error',
            text: `Your rules didn’t all move to your account. ${(e as Error).message}`,
          });
        }
      }
      if (cancelled) return;
      ref.current = one;
      setC(one);
      if (!dirty) return;
      // The merged ones go once the one holding everything is saved; emptied first, so that
      // deleting them leaves the batches they shared with it.
      backend
        .save(one)
        .then(() =>
          Promise.all(
            rest.map(async (x) => {
              const emptied = { ...x, batches: [], rules: [], read: [] };
              await backend.save(emptied);
              await backend.remove(emptied);
            }),
          ),
        )
        .catch(() => undefined);
    })();
    fetch('/api/pin/learn')
      .then((r) => r.json())
      .then((r) => setLearnAvailable(Boolean(r.available)))
      .catch(() => setLearnAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [backend, moveFrom, moveIn, onStatus]);

  // Each batch's export, read once while the view is open: its close-ups are the evidence.
  const files = useRef(new Map<string, Promise<Map<string, Uint8Array> | null>>());
  const filesOf = useCallback(
    (batchId: string) => {
      let found = files.current.get(batchId);
      if (!found) {
        found = backend
          .getBatch(batchId)
          .then(async (blob) => (blob ? unzip(await blob.arrayBuffer()) : null))
          .catch(() => null);
        files.current.set(batchId, found);
      }
      return found;
    },
    [backend],
  );
  const [crops, setCrops] = useState<Record<string, string>>({});
  const batchIds = c?.batches.map((b) => b.id).join(',') ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the close-ups follow the batches
  useEffect(() => {
    const now = ref.current;
    if (!now) return;
    let cancelled = false;
    const made: Record<string, string> = {};
    (async () => {
      for (const b of now.batches) {
        const found = await filesOf(b.id);
        if (cancelled) return;
        for (const n of b.notes) {
          const bytes = found?.get(b.root + n.crop);
          if (bytes)
            made[`${b.id}/${n.ref}`] = URL.createObjectURL(
              new Blob([bytes as BlobPart], { type: 'image/jpeg' }),
            );
        }
        setCrops({ ...made });
      }
    })();
    return () => {
      cancelled = true;
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
      setCrops({});
    };
  }, [batchIds, filesOf]);

  /** The open images' notes that are new here, kept as an export; read by the AI next. */
  const addOpen = useCallback(async () => {
    if (!ref.current) return;
    setBusy('add');
    try {
      const made = await batchZip();
      if (!made) return;
      const found = await unzip(await made.blob.arrayBuffer());
      const exp = readExport(found);
      const fresh = newNotes(ref.current, batchNotes(exp));
      if (!fresh.length) return;
      const id = newId();
      try {
        await backend.putBatch(id, made.blob);
      } catch (e) {
        onStatus({
          tone: 'error',
          text:
            backend.kind === 'account'
              ? `Your notes didn’t upload. ${(e as Error).message}`
              : 'Browser storage is full, so your new notes weren’t kept.',
        });
        return;
      }
      files.current.set(id, Promise.resolve(found));
      const batch: Batch = {
        id,
        name: exp.root.replace(/\/$/, '') || made.name.replace(/\.zip$/i, ''),
        addedAt: nowIso(),
        exportedAt: exp.exportedAt,
        root: exp.root,
        images: exp.assets.length,
        notes: fresh,
      };
      change((x) => withBatch(x, batch, nowIso()), true);
    } catch (e) {
      onStatus({ tone: 'error', text: `Your new notes weren’t added. ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }, [backend, batchZip, change, onStatus]);

  // Coming here brings the open images' new notes along, once.
  const added = useRef(false);
  useEffect(() => {
    if (!c || added.current) return;
    added.current = true;
    const known = knownNotes(c);
    if (openPrints.some((p) => !known.has(p))) addOpen();
  }, [c, openPrints, addOpen]);

  // Rules a visitor's preview found before credits (D87, D98) never showed their words: their
  // notes wait to be read again, in full, with the next update.
  useEffect(() => {
    if (c?.rules.some((r) => r.locked)) change((x) => unlockRules(x, nowIso()), true);
  }, [c, change]);

  /**
   * Update rules: read every note the AI hasn't, a few dozen at a time, each reading against the
   * rules so far. One update however many calls it takes, priced for all its notes (D98).
   */
  const readAll = useCallback(async () => {
    let made = 0;
    let strengthened = 0;
    let conflicts = 0;
    let asked = 0;
    const total = ref.current ? unreadNotes(ref.current).length : 0;
    if (!total) return;
    const update = crypto.randomUUID();
    setReadError(null);
    setReading({ done: 0, total });
    let done = 0;
    try {
      while (ref.current) {
        const todo = unreadNotes(ref.current).slice(0, MAX_LEARN_NOTES);
        if (!todo.length) break;
        const library = ref.current.rules
          .filter((r) => !r.locked && r.text.trim())
          .slice(-MAX_LEARN_RULES);
        const notes = new Map<string, NoteRef>();
        // Each note goes with its kept close-up, made small (D98); one that can't be read goes
        // with its words alone.
        const sent = await Promise.all(
          todo.map(async ({ batch, note }, i) => {
            notes.set(`n${i + 1}`, { batchId: batch.id, note: note.ref });
            const jpeg = (await filesOf(batch.id))?.get(batch.root + note.crop);
            const crop = jpeg ? await closeUpForReading(jpeg).catch(() => undefined) : undefined;
            return {
              id: `n${i + 1}`,
              works: note.works,
              doesNotWork: note.doesNotWork,
              ...(note.label ? { label: note.label } : {}),
              topics: note.topics,
              source: note.source,
              ...(crop ? { crop } : {}),
            };
          }),
        );
        const ruleIds = library.map((r) => r.id);
        const res = await fetch('/api/pin/learn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notes: sent,
            rules: library.map((r, i) => ({
              id: `r${i + 1}`,
              text: r.text,
              context: r.context,
              topics: r.topics,
              status: r.status,
              ...(r.basis === 'interpreted' ? { basis: r.basis } : {}),
              ...(r.question ? { question: r.question.ask } : {}),
            })),
            update: { id: update, notes: total },
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 503) setLearnAvailable(false);
          if (res.status === 402) onPay();
          throw new Error(body.error ?? 'No rules this time. Try again.');
        }
        const answer = (await res.json()) as Reading;
        const real = (id: string) => ruleIds[Number(id.slice(1)) - 1] ?? '';
        const reading: Reading = {
          strengthen: answer.strengthen.map((s) => ({ ...s, rule: real(s.rule) })),
          propose: answer.propose.map((p) => ({
            ...p,
            ...(p.conflictsWith ? { conflictsWith: real(p.conflictsWith) } : {}),
          })),
        };
        strengthened += new Set(reading.strengthen.map((s) => s.rule)).size;
        made += reading.propose.length;
        conflicts += reading.propose.filter((p) => p.conflictsWith).length;
        asked += reading.propose.filter(waiting).length;
        change((x) => applyReading(x, reading, notes, nowIso(), newId), true);
        done += todo.length;
        setReading({ done: Math.min(done, total), total });
      }
      const said = [
        made ? count(made, 'new rule') : '',
        strengthened ? `${count(strengthened, 'rule')} strengthened` : '',
        conflicts ? `${count(conflicts, 'conflict')} with your rules` : '',
        asked ? `${asked} waiting for you` : '',
      ].filter(Boolean);
      onStatus({
        tone: 'info',
        text: said.length
          ? `Pinch read ${count(total, 'note')}: ${said.join(', ')}.`
          : `Pinch read ${count(total, 'note')}; none taught a new rule.`,
      });
    } catch (e) {
      setReadError((e as Error).message || 'No rules this time. Try again.');
    } finally {
      setReading(null);
      // What the update didn't read comes back now, not after an hour.
      await fetch('/api/pin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finish: update }),
      }).catch(() => undefined);
      onCredits();
    }
  }, [change, onStatus, onPay, onCredits, filesOf]);

  // Rules without a title (older ones, rewritten ones) are named by the AI once the reading is
  // done (D95). Each rule is asked about once per visit, so a failure doesn't loop.
  const titled = useRef(new Set<string>());
  const untitled =
    c && learnAvailable && !reading
      ? c.rules
          .filter(
            (r) =>
              !r.title &&
              !r.locked &&
              r.status !== 'dismissed' &&
              r.text.trim() &&
              !titled.current.has(`${r.id}:${r.text}`),
          )
          .slice(0, MAX_TITLES)
      : [];
  const untitledKey = untitled.map((r) => r.id).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once per set of untitled rules
  useEffect(() => {
    if (!untitled.length) return;
    for (const r of untitled) titled.current.add(`${r.id}:${r.text}`);
    fetch('/api/pin/learn/titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: untitled.map((r) => ({ id: r.id, text: r.text })) }),
    })
      .then((res) => (res.ok ? res.json() : { titles: [] }))
      .then((res: { titles?: { id: string; title: string }[] }) => {
        if (res.titles?.length) change((x) => withTitles(x, res.titles ?? [], nowIso()), true);
      })
      .catch(() => undefined);
  }, [untitledKey]);

  // New and changed notes wait for Update rules, its price shown before it runs (D98).
  const unread = c ? unreadNotes(c).length : 0;
  const price = unread ? offer.update + offer.note * unread : 0;
  const short = credits !== null && (credits.closed || price > credits.balance);
  const update = () => {
    if (short) return onPay();
    let told = false;
    try {
      told = localStorage.getItem(CLOSE_UPS_KEY) === 'ok';
    } catch {
      // Storage blocked: ask each time.
    }
    if (told) return readAll();
    opener.current = document.activeElement as HTMLElement | null;
    setAsking(true);
  };

  /** Every rule the agent gets, as a prompt for one chat. */
  const copyRules = async () => {
    const now = ref.current;
    if (!now) return;
    const rules = rulesOf(now);
    try {
      await navigator.clipboard.writeText(rulesText(now, rules));
      onStatus({
        tone: 'info',
        text: `Copied ${count(rules.length, 'rule')}. Paste them into your agent’s chat for this task.`,
      });
      setConnecting(false);
    } catch {
      onStatus({ tone: 'error', text: "The browser didn't allow copying." });
    }
  };

  /** A move that stopped, tried again: this browser's rules into the account's. */
  const moveHere = async () => {
    if (!moveFrom || !movable.length || !ref.current) return;
    setBusy('move');
    onStatus({ tone: 'info', text: 'Moving your rules…', sticky: true });
    let moved = 0;
    try {
      for (const x of movable) {
        const merged = await moveIn(ref.current, x, moveFrom);
        change(() => merged, true);
        moved++;
      }
      setMovable([]);
      onStatus({ tone: 'info', text: 'Moved your rules to your account.' });
    } catch (e) {
      setMovable(movable.slice(moved));
      onStatus({ tone: 'error', text: `Your rules didn’t all move. ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  if (!c)
    return (
      <main className="min-h-0 flex-1 overflow-hidden" aria-busy="true">
        <div className="mx-auto max-w-3xl space-y-7 px-6 py-8">
          <div className="space-y-2">
            <h2 className="text-2xl leading-tight font-medium tracking-tight">Your rules</h2>
            <p className="text-[13px]">
              <ShimmerText>Loading your rules…</ShimmerText>
            </p>
          </div>
          <div className="space-y-3">
            <RuleSkeleton />
            <RuleSkeleton wide={false} />
            <RuleSkeleton />
          </div>
        </div>
      </main>
    );
  const live = c.rules.filter((r) => !r.locked && r.status !== 'dismissed');
  const shown = live.filter((r) => picked(r, pickOf(slice)));
  const waits = live.filter(waiting).length;
  const textOf = (id: string) => c.rules.find((r) => r.id === id)?.text ?? '';
  // Removed, a rule is kept as dismissed: out of sight and the agent's reach, never written again.
  const remove = (id: string) => {
    setRemoving(null);
    change((c) => withRule(c, id, { status: 'dismissed' }, nowIso()), true);
    onStatus({
      tone: 'info',
      text: 'Rule removed. Pinch won’t write it again.',
      action: {
        label: 'Undo',
        run: () => change((c) => withRule(c, id, { status: 'approved' }, nowIso()), true),
      },
    });
  };
  const card = (r: Rule) => (
    <li key={r.id}>
      <RuleCard
        rule={r}
        collection={c}
        crops={crops}
        pullsAgainst={r.conflict ? textOf(r.conflict.ruleId) : ''}
        isNew={r.createdAt >= since.current}
        onChange={(x, now) => change((c) => withRule(c, r.id, x, nowIso()), now)}
        onAnswer={(i) => change((c) => answerRule(c, r.id, i, nowIso()), true)}
        onConfirm={() => change((c) => confirmRule(c, r.id, nowIso()), true)}
        onRemove={() => {
          opener.current = document.activeElement as HTMLElement | null;
          setRemoving(r.id);
        }}
      />
    </li>
  );

  return (
    <>
      <main
        inert={inert || connecting || removing !== null || asking}
        className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-7 px-6 py-8">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-2xl leading-tight font-medium tracking-tight">Your rules</h2>
                <p className="text-sm text-muted-foreground">
                  What Pinch understands about your taste.
                  {waits > 0 && ` ${waits} waiting for you.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  opener.current = document.activeElement as HTMLElement | null;
                  setConnecting(true);
                }}
                className={primary}
              >
                <PlugZap className="size-4" aria-hidden />
                Connect agent
              </button>
            </div>

            <div aria-live="polite" className="empty:hidden">
              {(reading || busy === 'add') && (
                <p className="text-[13px]">
                  <ShimmerText>
                    {reading
                      ? `Reading ${count(reading.total, 'new note')} for patterns…${reading.done ? ` ${reading.done} done.` : ''}`
                      : 'Adding your new notes…'}
                  </ShimmerText>
                </p>
              )}
            </div>
            {unread > 0 && learnAvailable !== false && !reading && busy !== 'add' && (
              <div
                role={readError ? 'alert' : undefined}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-[13px]"
              >
                <p className="flex-1 text-muted-foreground">
                  {readError ? `${readError} ` : ''}
                  {count(unread, 'new note')} to read into your rules.
                  {credits &&
                    (credits.closed
                      ? ' Your credits are in your account: sign in to use them.'
                      : ` ${count(credits.balance, 'credit')} left.`)}
                </p>
                <button
                  type="button"
                  onClick={update}
                  className={primary}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Update rules · {count(unread, 'note')}
                  {credits ? ` · ${price} credits` : ''}
                </button>
              </div>
            )}
            {learnAvailable === false && unread > 0 && (
              <p className="rounded-xl border border-border px-4 py-3 text-[13px] text-muted-foreground">
                Pinch writes rules with AI, which is off right now. Your {count(unread, 'note')}{' '}
                {unread === 1 ? 'waits' : 'wait'} and will be read once it is back.
              </p>
            )}
            {movable.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-[13px] text-muted-foreground">
                <p className="flex-1">Some of your rules are only in this browser.</p>
                <button
                  type="button"
                  onClick={moveHere}
                  disabled={busy !== null}
                  className={button}
                >
                  <Cloud className="size-4" aria-hidden />
                  {busy === 'move' ? 'Moving…' : 'Move to your account'}
                </button>
              </div>
            )}
          </header>

          {live.length > 0 && <SliceBar collection={c} slice={slice} onSlice={setSlice} />}

          {(reading || busy === 'add') && !live.length && (
            <ol className="list-none space-y-3 p-0" aria-hidden>
              <li>
                <RuleSkeleton />
              </li>
              <li>
                <RuleSkeleton wide={false} />
              </li>
            </ol>
          )}

          {!c.batches.length && !c.rules.length && busy !== 'add' ? (
            <div className="space-y-3 rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
              <p>
                Mark what to learn and what to avoid on your images. Pinch reads your notes here,
                finds the patterns and turns them into rules.
              </p>
              <button type="button" onClick={onBack} className={cn(button, 'mx-auto')}>
                Back to your images
              </button>
            </div>
          ) : null}

          {byTopic(shown).map((g) => (
            <section key={g.label} aria-labelledby={`group-${g.label}`} className="space-y-2.5">
              <h3
                id={`group-${g.label}`}
                className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
              >
                {/* A plain heading, not a tag: the filters above are the tags. */}
                {g.label}
                <span className="font-mono font-normal text-muted-foreground/70">
                  {g.rules.length}
                </span>
              </h3>
              <ol className="list-none space-y-3 p-0">{g.rules.map(card)}</ol>
            </section>
          ))}

          {slice && !shown.length && (
            <p className="text-center text-sm text-muted-foreground">No rules here yet.</p>
          )}
        </div>
      </main>

      {connecting && (
        <ConnectDialog
          account={account}
          rules={rulesOf(c).length}
          opener={opener.current}
          onClose={() => setConnecting(false)}
          onCopy={copyRules}
        />
      )}
      {removing !== null && (
        <Dialog
          id="remove-title"
          title="Remove this rule?"
          opener={opener.current}
          onClose={() => setRemoving(null)}
        >
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            “{textOf(removing).replace(/[.\s]+$/, '')}”. Your agent stops getting it, and Pinch
            won’t write it again.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              data-autofocus
              onClick={() => setRemoving(null)}
              className={button}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => remove(removing)}
              className={cn(
                hit,
                'flex min-h-9 items-center gap-2 rounded-md bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors duration-150 motion-reduce:transition-none hover:bg-destructive/20',
              )}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </button>
          </div>
        </Dialog>
      )}
      {asking && (
        <Dialog
          id="close-ups-title"
          title="Before Pinch reads your notes"
          opener={opener.current}
          onClose={() => setAsking(false)}
        >
          <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
            Pinch sends each note’s words and the close-up of its mark to Anthropic, the AI that
            reads them into rules. Pinch keeps neither on the way; close-ups are kept only in
            your account, once you sign in.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setAsking(false)} className={button}>
              Not now
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => {
                try {
                  localStorage.setItem(CLOSE_UPS_KEY, 'ok');
                } catch {
                  // Storage blocked: asked again next time.
                }
                setAsking(false);
                readAll();
              }}
              className={primary}
            >
              Read my notes
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Slicing the rules: by topic, by the author's own tags, or all of them. */
function SliceBar({
  collection: c,
  slice,
  onSlice,
}: {
  collection: Collection;
  slice: Slice;
  onSlice: (s: Slice) => void;
}) {
  const live = c.rules.filter((r) => !r.locked && r.status !== 'dismissed');
  const tags = tagsOf(live);
  const options: { slice: Slice; label: string; n: number; topic?: Topic }[] = [
    { slice: null, label: 'All', n: live.length },
    ...TOPICS.map((t) => ({
      slice: { topic: t.kind } as Slice,
      label: t.label,
      n: live.filter((r) => r.topics.includes(t.kind)).length,
      topic: t.kind,
    })).filter((o) => o.n),
    ...tags.map((t) => ({
      slice: { tag: t } as Slice,
      label: `#${t}`,
      n: live.filter((r) => r.tags.includes(t)).length,
    })),
    ...(tags.length
      ? [
          {
            slice: { tag: null } as Slice,
            label: 'General',
            n: live.filter((r) => !r.tags.length).length,
          },
        ]
      : []),
  ];
  const areas = PRINCIPLES.map((p) => ({
    slice: { principle: p.id } as Slice,
    label: p.area,
    n: live.filter((r) => r.principles?.includes(p.id)).length,
  })).filter((o) => o.n);
  const chipOf = (o: { slice: Slice; label: string; n: number; topic?: Topic }) => {
    const on = sliceKey(o.slice) === sliceKey(slice);
    return (
      <button
        key={sliceKey(o.slice)}
        type="button"
        aria-pressed={on}
        onClick={() => onSlice(on ? null : o.slice)}
        className={cn(
          tagHit,
          chip,
          on
            ? o.topic
              ? cn('border-transparent', TOPIC_TONES[o.topic].fill, TOPIC_TONES[o.topic].ink)
              : 'border-foreground bg-muted text-foreground'
            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {o.label}
        <span className="font-mono opacity-70">{o.n}</span>
      </button>
    );
  };
  return (
    <div className="space-y-2">
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="sr-only">Show rules about</legend>
        <div className="flex flex-wrap gap-2">{options.map(chipOf)}</div>
      </fieldset>
      {areas.length > 0 && (
        <fieldset className="min-w-0 border-0 p-0">
          <legend
            className="float-left flex h-7 items-center pr-2 text-[13px] text-muted-foreground"
          >
            By principle
          </legend>
          <div className="flex flex-wrap gap-2">{areas.map(chipOf)}</div>
        </fieldset>
      )}
    </div>
  );
}

/**
 * One rule: its words, where it holds, what it is about, the author's tags, a conflict when it
 * has one, and the notes it draws on, which open with their close-ups. The pencil edits it
 * (D88); there is nothing to approve or dismiss.
 */
function RuleCard({
  rule: r,
  collection: c,
  crops,
  pullsAgainst,
  isNew,
  onChange,
  onAnswer,
  onConfirm,
  onRemove,
}: {
  rule: Rule;
  collection: Collection;
  crops: Record<string, string>;
  pullsAgainst: string;
  /** Written while the page is open. */
  isNew: boolean;
  /** A change to the rule; written at once with `now`, else a moment after typing stops. */
  onChange: (change: Partial<Rule>, now?: boolean) => void;
  /** The author picks one of the answers to the rule's question (D90). */
  onAnswer: (option: number) => void;
  /** The author confirms Pinch's reading of a rule (D91). */
  onConfirm: () => void;
  /** The author asks to remove an outdated rule; the page asks "are you sure" first. */
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const started = useRef('');
  const [open, setOpen] = useState(false);
  const notes = evidenceOf(c, r);
  const images = imagesOf(c, r);
  const id = `rule-${r.id}`;
  const origin = originOf(r);
  const why = (r.principles ?? []).flatMap((p) => PRINCIPLES.find((x) => x.id === p) ?? []);
  const edit = () => {
    started.current = r.text;
    setEditing(true);
  };
  const done = () => {
    // An emptied rule goes back to Pinch's words. A rewritten one is the author's own: no longer
    // Pinch's reading, nor waiting on its question (D90). Either way, what was typed is written now.
    const back = !r.text.trim() && r.drafted ? { text: r.drafted } : {};
    const rewritten = (back.text ?? r.text).trim() !== started.current.trim();
    const ours = rewritten && (r.question || r.basis === 'interpreted');
    // A rewritten rule loses its title, which named the old words; Pinch names it again (D95).
    const named = rewritten ? { ...back, title: undefined } : back;
    onChange(ours ? ownWords(named) : named, true);
    setEditing(false);
  };

  return (
    <article
      aria-labelledby={`${id}-text`}
      className="space-y-3 rounded-xl border border-border p-4"
    >
      {/* The rule's name and words beside the pencil; everything under them spans the card. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {(isNew || r.conflict || r.fresh || origin === 'ai-edited') && (
            <div className="flex flex-wrap items-center gap-2 pb-1 text-[13px] text-muted-foreground">
              {isNew && <span className={cn(chip, 'border-border text-foreground')}>New</span>}
              {r.conflict && (
                <span
                  className={cn(chip, 'border-amber-600/40 text-amber-800 dark:text-amber-300')}
                >
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Conflict
                </span>
              )}
              {r.fresh ? (
                <span className={cn(chip, 'border-border text-foreground')}>
                  +{count(r.fresh, 'new note')}
                </span>
              ) : null}
              {origin === 'ai-edited' && <span>Edited by you</span>}
            </div>
          )}
          {r.title && (
            <h4 className="text-[15px] leading-snug font-medium text-foreground">{r.title}</h4>
          )}
          {editing ? (
            <p id={`${id}-text`} className="sr-only">
              {r.text}
            </p>
          ) : (
            // The rule's words, behind a document icon in a small box, its first line beside it.
            <div className="flex gap-2.5">
              <span className={r.title ? 'mt-0.5' : undefined}>
                <SmallIcon>
                  <FileText />
                </SmallIcon>
              </span>
              <p
                id={`${id}-text`}
                className={cn(
                  'min-w-0',
                  r.title
                    ? 'text-sm leading-relaxed text-muted-foreground'
                    : 'text-[15px] leading-snug',
                  !r.title && (waiting(r) ? 'text-muted-foreground' : 'text-foreground'),
                )}
              >
                {r.text}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label={editing ? 'Done editing' : 'Edit rule'}
          title={editing ? 'Done' : 'Edit'}
          aria-pressed={editing}
          onClick={() => (editing ? done() : edit())}
          className={cn(
            hit,
            '-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
            editing && 'bg-muted text-foreground',
          )}
        >
          {editing ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Pencil className="size-4" aria-hidden />
          )}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={`${id}-edit`} className="text-[13px] font-medium text-muted-foreground">
              Rule
            </label>
            <textarea
              id={`${id}-edit`}
              // biome-ignore lint/a11y/noAutofocus: opening the editor is asking to type in it
              autoFocus
              value={r.text}
              rows={2}
              maxLength={300}
              onChange={(e) => onChange({ text: e.target.value })}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || e.key === 'Escape') {
                  e.preventDefault();
                  done();
                }
              }}
              className={cn(field, 'resize-y')}
            />
          </div>
          <TopicPicker
            legend="This rule is about"
            topics={r.topics}
            onChange={(topics) => onChange({ topics }, true)}
          />
        </div>
      ) : (
        (r.basis === 'interpreted' && r.reading && !r.question) ||
        r.topics.length > 0 ||
        r.tags.length > 0
      ) ? (
        <div className="space-y-2">
          {r.basis === 'interpreted' && r.reading && !r.question && (
            <p className="text-[13px] text-muted-foreground">Pinch’s reading: {r.reading}</p>
          )}
          {(r.topics.length > 0 || r.tags.length > 0) && (
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {r.topics.map((t) => (
                <li
                  key={t}
                  className={cn(
                    chip,
                    'border-transparent',
                    TOPIC_TONES[t].fill,
                    TOPIC_TONES[t].ink,
                  )}
                >
                  {topicLabel(t)}
                </li>
              ))}
              {r.tags.map((t) => (
                <li key={t} className={cn(chip, 'border-border text-foreground')}>
                  #{t}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {r.question && !editing && (
        <fieldset className="min-w-0 space-y-2.5 rounded-lg border border-border bg-muted/50 px-3 py-3 text-[13px]">
          <legend className="float-left w-full text-sm font-medium text-foreground">
            {r.question.ask}
          </legend>
          <div className="clear-left flex flex-wrap gap-2">
            {r.question.options.map((o, i) => (
              <button
                key={o.answer}
                type="button"
                title={o.rule}
                onClick={() => onAnswer(i)}
                className={cn(button, 'bg-background')}
              >
                {o.answer}
              </button>
            ))}
            <button type="button" onClick={edit} className={small}>
              Something else
            </button>
          </div>
          <p className="text-muted-foreground">Your agent gets this rule once you answer.</p>
        </fieldset>
      )}

      {r.basis === 'interpreted' && !r.question && !editing && (
        <fieldset className="min-w-0 space-y-2.5 rounded-lg border border-border bg-muted/50 px-3 py-3 text-[13px]">
          <legend className="float-left w-full text-sm font-medium text-foreground">
            Is this what you meant?
          </legend>
          <div className="clear-left flex flex-wrap gap-2">
            <button type="button" onClick={onConfirm} className={cn(button, 'bg-background')}>
              Yes
            </button>
            <button type="button" onClick={edit} className={small}>
              Something else
            </button>
          </div>
          <p className="text-muted-foreground">Your agent gets this rule once you confirm it.</p>
        </fieldset>
      )}

      {r.conflict && (
        <div className="rounded-lg border border-amber-600/30 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          <p className="m-0">
            Pulls against your rule “{pullsAgainst.replace(/[.\s]+$/, '') || 'a rule you removed'}”.
            {r.conflict.why ? ` ${r.conflict.why}` : ''}
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-200/90">
            Both are kept. Edit or remove one with the pencil.
          </p>
        </div>
      )}

      {/* Set apart from the rule and its tags by a divider, edge to edge across the card. */}
      <div className="-mx-4 border-t border-border px-4 pt-3">
        {/* The notes a rule draws on, and, while editing, removing it: one row. */}
        <div className="-mx-2 -mb-1 flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-notes`}
            title={`${count(notes.length, 'note')} on ${count(images, 'image')}`}
            onClick={() => {
              setOpen(!open);
              if (!open && r.fresh) onChange({ fresh: 0 }, true);
            }}
            className={small}
          >
            Source
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
                open && 'rotate-180',
              )}
            />
          </button>
          {editing && (
            <button
              type="button"
              onClick={onRemove}
              className={cn(
                small,
                'ml-auto text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300',
              )}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </button>
          )}
        </div>
        {open && (
          <div id={`${id}-notes`} className="mt-2 space-y-2">
            {why.length > 0 && (
              <div className="space-y-1 text-[13px] text-muted-foreground">
                <p>Pinch read your notes with these design principles; your notes make it your rule.</p>
                <ul className="list-none space-y-1 p-0">
                  {why.map((p) => (
                    <li key={p.id}>
                      <span className="font-medium text-foreground">{p.name}</span>: {p.holds}.
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="list-none space-y-2 p-0">
              {notes.map(({ batch, note }) => (
                <li key={`${batch.id}/${note.ref}`}>
                  <Evidence note={note} crop={crops[`${batch.id}/${note.ref}`]} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </article>
  );
}

/** An icon in a small rounded box, as the note panel shows its fields' icons. */
function SmallIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.07] [&>svg]:size-3"
    >
      {children}
    </span>
  );
}

/** One note a rule draws on: its close-up, where it is, and what the author wrote. */
function Evidence({ note, crop }: { note: BatchNote; crop?: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 rounded-lg bg-muted/50 p-2">
      {crop ? (
        <a
          href={crop}
          target="_blank"
          rel="noopener"
          className="block overflow-hidden rounded-md border border-border bg-muted"
        >
          {/* biome-ignore lint/performance/noImgElement: a close-up from the batch's zip, as a blob URL */}
          <img
            src={crop}
            alt={`Close-up of note ${note.ref} on ${note.image}`}
            className="max-h-20 w-full object-contain"
          />
        </a>
      ) : (
        <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border text-[13px] text-muted-foreground">
          No close-up
        </div>
      )}
      <div className="min-w-0 text-[13px] text-muted-foreground">
        <p className="truncate">
          <span className="font-mono">{note.ref}</span> · {note.image}
          {note.source ? ` · ${sourceLabel(note.source)}` : ''}
        </p>
        {/* What it says, each side behind its thumb in a small box, with room under the title line. */}
        <div className="mt-2.5 space-y-2">
          {note.works && (
            <p className="flex gap-2 whitespace-pre-line text-foreground">
              <SmallIcon>
                <ThumbsUp />
              </SmallIcon>
              <span className="sr-only">To learn: </span>
              <span className="min-w-0 pt-px">{note.works}</span>
            </p>
          )}
          {note.doesNotWork && (
            <p className="flex gap-2 whitespace-pre-line text-foreground">
              <SmallIcon>
                <ThumbsDown />
              </SmallIcon>
              <span className="sr-only">To avoid: </span>
              <span className="min-w-0 pt-px">{note.doesNotWork}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
