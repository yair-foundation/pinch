'use client';

import {
  Check,
  ClipboardCopy,
  Cloud,
  Download,
  HardDrive,
  LoaderCircle,
  Lock,
  Pencil,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRINCIPLES } from '@/lib/pin/foundation';
import { batchNotes, readExport } from '@/lib/pin/import';
import { MAX_LEARN_NOTES, MAX_LEARN_RULES } from '@/lib/pin/learn';
import {
  answerRule,
  applyReading,
  type Batch,
  type BatchNote,
  byTopic,
  confirmRule,
  type Collection,
  cleanTag,
  collectionSlug,
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
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  rulesText,
  tagsOf,
  unlockRules,
  unreadNotes,
  upgradeCollection,
  waiting,
  withBatch,
  withRule,
} from '@/lib/pin/learnings';
import { sourceLabel, TOPICS, type Topic, topicLabel } from '@/lib/pin/model';
import { unzip } from '@/lib/pin/unzip';
import { type ZipEntry, zip } from '@/lib/pin/zip';
import { cn } from '@/lib/utils';
import type { CollectionsBackend } from './collections-backend';
import { Dialog, hit } from './dialog';
import { download } from './render';
import { TopicPicker } from './topic-picker';
import { TOPIC_TONES, tagHit } from './topic-style';

/*
 * Your rules (D79, D86, D87, D88): the person's one taste library, shown in
 * place of the images from the header. Coming here adds the open images' new
 * notes; the AI reads every note it hasn't read against the rules already
 * there, on its own, a few dozen notes at a time, and each reading
 * strengthens rules, writes new ones or flags a conflict. Rules are guidance
 * as soon as they are written; the pencil edits one. Each rule opens to the
 * notes it draws on, with their close-ups. Rules can be sliced by topic and
 * by the author's own tags, and export as a rules file or as text. Before
 * Pinch is bought, the first rules show in full and the rest as
 * placeholders, and nothing exports. Kept in this browser, or in the account
 * once bought (D81), where this browser's move on their own.
 */

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
  'w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-[#737373] dark:placeholder:text-[#7a7a7a] focus-visible:outline-2 focus-visible:outline-ring';
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
  paid,
  price,
  onPay,
  onBack,
  onStatus,
}: {
  inert: boolean;
  /** Where the rules are kept. */
  backend: CollectionsBackend;
  /** Rules kept elsewhere that can move here: this browser's, once bought and signed in. */
  moveFrom?: CollectionsBackend;
  /** The open images' notes, by `noteFingerprint`, to tell whether any are new here. */
  openPrints: string[];
  /** The open images as an export, or null when they have no notes. */
  batchZip: () => Promise<{ blob: Blob; name: string } | null>;
  /** Whether every rule shows and the rules export: Pinch is bought, or not for sale here. */
  paid: boolean;
  price: string;
  /** Ask the visitor to get Pinch, for what they just tried. */
  onPay: (why: 'rules' | 'export') => void;
  onBack: () => void;
  onStatus: (notice: Notice) => void;
}) {
  const [c, setC] = useState<Collection | null>(null);
  const ref = useRef<Collection | null>(null);
  const [learnAvailable, setLearnAvailable] = useState<boolean | null>(null);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
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
      // Bought and signed in: this browser's rules move into the account on their own (D87), so
      // the notes and rules found before buying are there on every device.
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

  // Bought: the rules found before are read again, to be written in full.
  useEffect(() => {
    if (paid && c?.rules.some((r) => r.locked)) change((x) => unlockRules(x, nowIso()), true);
  }, [paid, c, change]);

  /** Read every note the AI hasn't, a few dozen at a time, each reading against the rules so far. */
  const readAll = useCallback(async () => {
    let made = 0;
    let strengthened = 0;
    let conflicts = 0;
    let hidden = 0;
    let asked = 0;
    const total = ref.current ? unreadNotes(ref.current).length : 0;
    if (!total) return;
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
        const sent = todo.map(({ batch, note }, i) => {
          notes.set(`n${i + 1}`, { batchId: batch.id, note: note.ref });
          return {
            id: `n${i + 1}`,
            works: note.works,
            doesNotWork: note.doesNotWork,
            ...(note.label ? { label: note.label } : {}),
            topics: note.topics,
            source: note.source,
          };
        });
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
            shown: ref.current.rules.filter((r) => !r.locked && r.text.trim()).length,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 503) setLearnAvailable(false);
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
        made += reading.propose.filter((p) => !p.locked).length;
        hidden += reading.propose.filter((p) => p.locked).length;
        conflicts += reading.propose.filter((p) => p.conflictsWith).length;
        asked += reading.propose.filter((p) => !p.locked && waiting(p)).length;
        change((x) => applyReading(x, reading, notes, nowIso(), newId), true);
        done += todo.length;
        setReading({ done: Math.min(done, total), total });
      }
      const said = [
        made ? count(made, 'new rule') : '',
        strengthened ? `${count(strengthened, 'rule')} strengthened` : '',
        conflicts ? `${count(conflicts, 'conflict')} with your rules` : '',
        asked ? `${asked} waiting for you` : '',
        hidden ? `${hidden} more found` : '',
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
    }
  }, [change, onStatus]);

  // The AI reads new notes on its own; after a failure it waits for Try again.
  const unread = c ? unreadNotes(c).length : 0;
  useEffect(() => {
    if (learnAvailable && unread > 0 && !reading && !readError && busy !== 'add') readAll();
  }, [learnAvailable, unread, reading, readError, busy, readAll]);

  /** The approved rules the pick takes, as a zip: design-rules.md, rules.json and the close-ups. */
  const exportRules = async (pick: RulePick) => {
    const now = ref.current;
    if (!now) return;
    const rules = rulesOf(now, pick);
    if (!rules.length) return;
    setBusy('export');
    try {
      const stamp = nowIso();
      const root = `pinch-rules-${collectionSlug(now.name)}-${stamp.slice(0, 10)}/`;
      const encode = (s: string) => new TextEncoder().encode(s);
      const entries: ZipEntry[] = [
        { name: `${root}design-rules.md`, data: encode(rulesMarkdown(now, rules, stamp)) },
        {
          name: `${root}rules.json`,
          data: encode(`${JSON.stringify(rulesManifest(now, rules, stamp), null, 2)}\n`),
        },
      ];
      for (const r of rules)
        for (const n of r.notes) {
          const bytes = (await filesOf(n.batch.id))?.get(n.batch.root + n.note.crop);
          if (bytes) entries.push({ name: root + n.file, data: bytes });
        }
      download(
        new Blob(zip(entries) as BlobPart[], { type: 'application/zip' }),
        `${root.slice(0, -1)}.zip`,
      );
      onStatus({
        tone: 'info',
        text: `Exported ${count(rules.length, 'rule')}. Put design-rules.md where your agent reads its instructions, with the evidence folder beside it.`,
      });
      setExporting(false);
    } finally {
      setBusy(null);
    }
  };

  const copyRules = async (pick: RulePick) => {
    const now = ref.current;
    if (!now) return;
    const rules = rulesOf(now, pick);
    try {
      await navigator.clipboard.writeText(rulesText(now, rules));
      onStatus({
        tone: 'info',
        text: `Copied ${count(rules.length, 'rule')} as text. Paste them into your agent’s chat for this task.`,
      });
      setExporting(false);
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

  if (!c) return <main className="flex-1" />;
  const Where = backend.kind === 'account' ? Cloud : HardDrive;
  const live = c.rules.filter((r) => !r.locked && r.status !== 'dismissed');
  const shown = live.filter((r) => picked(r, pickOf(slice)));
  const locked = c.rules.filter((r) => r.locked);
  const waits = live.filter(waiting).length;
  const noteCount = c.batches.reduce((n, b) => n + b.notes.length, 0);
  const imageCount = new Set(c.batches.flatMap((b) => b.notes.map((n) => `${b.id}/${n.image}`)))
    .size;
  const textOf = (id: string) => c.rules.find((r) => r.id === id)?.text ?? '';
  const card = (r: Rule) => (
    <li key={r.id}>
      <RuleCard
        rule={r}
        collection={c}
        crops={crops}
        allTags={tagsOf(c.rules)}
        pullsAgainst={r.conflict ? textOf(r.conflict.ruleId) : ''}
        isNew={r.createdAt >= since.current}
        onChange={(x, now) => change((c) => withRule(c, r.id, x, nowIso()), now)}
        onAnswer={(i) => change((c) => answerRule(c, r.id, i, nowIso()), true)}
        onConfirm={() => change((c) => confirmRule(c, r.id, nowIso()), true)}
        onRemove={() => {
          // Removed, a rule is kept as dismissed: out of sight and exports, never written again.
          change((c) => withRule(c, r.id, { status: 'dismissed' }, nowIso()), true);
          onStatus({
            tone: 'info',
            text: 'Rule removed. Pinch won’t write it again.',
            action: {
              label: 'Undo',
              run: () => change((c) => withRule(c, r.id, { status: 'approved' }, nowIso()), true),
            },
          });
        }}
      />
    </li>
  );

  return (
    <>
      <main inert={inert || exporting} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-[1.4rem] leading-snug font-normal tracking-tight">
                  Your rules
                </h2>
                <p className="text-sm text-muted-foreground">
                  {noteCount
                    ? `What Pinch understands about your taste, from ${count(noteCount, 'note')} on ${count(imageCount, 'image')}.`
                    : 'What Pinch understands about your taste, from the notes you write on images.'}
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                  <span>{count(live.length, 'rule')} ·</span>
                  {waits > 0 && <span>{waits} waiting for you ·</span>}
                  <span className="flex items-center gap-1.5">
                    <Where className="size-3.5" aria-hidden />
                    {backend.kind === 'account' ? 'Kept in your account' : 'Kept in this browser'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!paid) return onPay('export');
                  opener.current = document.activeElement as HTMLElement | null;
                  setExporting(true);
                }}
                disabled={paid && (!live.length || busy !== null)}
                title={paid && !live.length ? 'No rules to export yet' : undefined}
                className={primary}
              >
                {paid ? (
                  <Download className="size-4" aria-hidden />
                ) : (
                  <Lock className="size-4" aria-hidden />
                )}
                Export rules
              </button>
            </div>

            <div aria-live="polite" className="empty:hidden">
              {(reading || busy === 'add') && (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <LoaderCircle
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  {reading
                    ? `Reading ${count(reading.total, 'new note')} for patterns…${reading.done ? ` ${reading.done} done.` : ''}`
                    : 'Adding your new notes…'}
                </p>
              )}
            </div>
            {readError && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-[13px]"
              >
                <p className="flex-1 text-muted-foreground">
                  {readError} {count(unread, 'note')} still to read.
                </p>
                <button type="button" onClick={() => setReadError(null)} className={button}>
                  <RotateCcw className="size-4" aria-hidden />
                  Try again
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

          {locked.length > 0 && (
            <section
              aria-labelledby="more-heading"
              className="space-y-3 rounded-xl border border-border bg-muted/50 px-5 py-4"
            >
              <h3 id="more-heading" className="text-sm font-medium">
                Pinch found {count(locked.length, 'more rule')} in your notes
              </h3>
              <p className="text-[13px] text-muted-foreground">
                Get Pinch to see every rule and give them to your agent. {price} once.
              </p>
              <ol className="list-none space-y-2 p-0">
                {locked.slice(0, 3).map((r) => (
                  <li key={r.id}>
                    <LockedCard rule={r} collection={c} />
                  </li>
                ))}
              </ol>
              <button type="button" onClick={() => onPay('rules')} className={primary}>
                <Lock className="size-4" aria-hidden />
                See all your rules
              </button>
            </section>
          )}

          {live.length > 0 && <SliceBar collection={c} slice={slice} onSlice={setSlice} />}

          {!c.batches.length && !c.rules.length ? (
            <div className="space-y-3 rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
              <p>
                Mark what works and what doesn’t on your images. Pinch reads your notes here, finds
                the patterns and turns them into rules.
              </p>
              <button type="button" onClick={onBack} className={cn(button, 'mx-auto')}>
                Back to your images
              </button>
            </div>
          ) : null}

          {byTopic(shown).map((g) => (
            <section key={g.label} aria-labelledby={`group-${g.label}`} className="space-y-3">
              <h3 id={`group-${g.label}`} className="flex items-center gap-2 text-sm font-medium">
                {/* A plain heading, not a tag: the filters above are the tags. */}
                {g.label}
                <span className="font-mono text-[13px] font-normal text-muted-foreground">
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

      {exporting && (
        <ExportDialog
          collection={c}
          opener={opener.current}
          busy={busy === 'export'}
          onClose={() => setExporting(false)}
          onDownload={exportRules}
          onCopy={copyRules}
        />
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

/** A rule found before Pinch was bought: what it is about and what it draws on, not its words. */
function LockedCard({ rule: r, collection: c }: { rule: Rule; collection: Collection }) {
  const notes = evidenceOf(c, r).length;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span aria-hidden className="block h-2.5 w-4/5 rounded bg-muted-foreground/20" />
        <span className="block text-[13px] text-muted-foreground">
          A rule
          {r.topics.length ? ` about ${r.topics.map(topicLabel).join(', ')}` : ''}, from{' '}
          {count(notes, 'note')}
        </span>
      </div>
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
  allTags,
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
  allTags: string[];
  pullsAgainst: string;
  /** Written while the page is open. */
  isNew: boolean;
  /** A change to the rule; written at once with `now`, else a moment after typing stops. */
  onChange: (change: Partial<Rule>, now?: boolean) => void;
  /** The author picks one of the answers to the rule's question (D90). */
  onAnswer: (option: number) => void;
  /** The author confirms Pinch's reading of a rule (D91). */
  onConfirm: () => void;
  /** The author removes an outdated rule. */
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const started = useRef('');
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState('');
  const notes = evidenceOf(c, r);
  const images = imagesOf(c, r);
  const id = `rule-${r.id}`;
  const origin = originOf(r);
  const why = (r.principles ?? []).flatMap((p) => PRINCIPLES.find((x) => x.id === p) ?? []);
  const addTag = () => {
    const t = cleanTag(tag);
    if (t && !r.tags.includes(t)) onChange({ tags: [...r.tags, t] }, true);
    setTag('');
  };
  const edit = () => {
    started.current = r.text;
    setEditing(true);
  };
  const done = () => {
    addTag();
    // An emptied rule goes back to Pinch's words. A rewritten one is the author's own: no longer
    // Pinch's reading, nor waiting on its question (D90). Either way, what was typed is written now.
    const back = !r.text.trim() && r.drafted ? { text: r.drafted } : {};
    const rewritten = (back.text ?? r.text).trim() !== started.current.trim();
    const ours = rewritten && (r.question || r.basis === 'interpreted');
    onChange(ours ? ownWords(back) : back, true);
    setEditing(false);
  };

  return (
    <article
      aria-labelledby={`${id}-text`}
      className="relative space-y-3 rounded-xl border border-border p-4"
    >
      <button
        type="button"
        aria-label={editing ? 'Done editing' : 'Edit rule'}
        title={editing ? 'Done' : 'Edit'}
        aria-pressed={editing}
        onClick={() => (editing ? done() : edit())}
        className={cn(
          hit,
          'absolute top-3 right-3 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
          editing && 'bg-muted text-foreground',
        )}
      >
        {editing ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Pencil className="size-4" aria-hidden />
        )}
      </button>
      {(isNew || r.conflict || r.fresh || origin === 'ai-edited') && (
        <div className="flex flex-wrap items-center gap-2 pr-10 text-[13px] text-muted-foreground">
          {isNew && <span className={cn(chip, 'border-border text-foreground')}>New</span>}
          {r.conflict && (
            <span className={cn(chip, 'border-amber-600/40 text-amber-800 dark:text-amber-300')}>
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

      {editing ? (
        <div className="space-y-3 pr-10">
          <p id={`${id}-text`} className="sr-only">
            {r.text}
          </p>
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
          <div className="space-y-1">
            <label
              htmlFor={`${id}-where`}
              className="text-[13px] font-medium text-muted-foreground"
            >
              Where it holds
            </label>
            <input
              id={`${id}-where`}
              value={r.context}
              maxLength={80}
              placeholder="Everywhere"
              onChange={(e) => onChange({ context: e.target.value })}
              className={field}
            />
          </div>
          <TopicPicker
            legend="This rule is about"
            topics={r.topics}
            onChange={(topics) => onChange({ topics }, true)}
          />
          <div className="space-y-1">
            <label htmlFor={`${id}-tag`} className="text-[13px] font-medium text-muted-foreground">
              Your tags
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {r.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange({ tags: r.tags.filter((x) => x !== t) }, true)}
                  aria-label={`Remove tag ${t}`}
                  className={cn(tagHit, chip, 'border-border text-foreground hover:bg-muted')}
                >
                  #{t}
                  <X className="size-3" aria-hidden />
                </button>
              ))}
              <input
                id={`${id}-tag`}
                value={tag}
                list={`${id}-tags`}
                maxLength={30}
                placeholder="A project, a client"
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                className={cn(field, 'h-8 w-44 py-1 text-[13px]')}
              />
              <datalist id={`${id}-tags`}>
                {allTags
                  .filter((t) => !r.tags.includes(t))
                  .map((t) => (
                    <option key={t} value={t} />
                  ))}
              </datalist>
            </div>
            <p className="text-[13px] text-muted-foreground">
              A tag keeps a rule to that project or client. A rule with no tag is your own taste,
              for every project.
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className={cn(
              small,
              'text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300',
            )}
          >
            <Trash2 className="size-4" aria-hidden />
            Remove rule
          </button>
        </div>
      ) : (
        <div className="space-y-1.5 pr-10">
          <p
            id={`${id}-text`}
            className={cn(
              'text-[15px] leading-snug',
              waiting(r) ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {r.text}
          </p>
          {r.context.trim() && (
            <p className="text-[13px] text-muted-foreground">Where: {r.context.trim()}</p>
          )}
          {r.basis === 'interpreted' && r.reading && !r.question && (
            <p className="text-[13px] text-muted-foreground">Pinch’s reading: {r.reading}</p>
          )}
          {(r.topics.length > 0 || r.tags.length > 0) && (
            <ul className="flex list-none flex-wrap gap-1.5 p-0 pt-1">
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
      )}

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
            Both are kept. If each holds in its own place, say where with the pencil.
          </p>
        </div>
      )}

      <div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-notes`}
          onClick={() => {
            setOpen(!open);
            if (!open && r.fresh) onChange({ fresh: 0 }, true);
          }}
          className={small}
        >
          From {count(notes.length, 'note')} on {count(images, 'image')}
          <span aria-hidden>{open ? '−' : '+'}</span>
        </button>
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
      <div className="min-w-0 space-y-1 text-[13px] text-muted-foreground">
        <p className="truncate">
          <span className="font-mono">{note.ref}</span> · {note.image}
          {note.source ? ` · ${sourceLabel(note.source)}` : ''}
        </p>
        {note.works && (
          <p className="flex gap-1.5 text-foreground">
            <ThumbsUp aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="sr-only">What works: </span>
            {note.works}
          </p>
        )}
        {note.doesNotWork && (
          <p className="flex gap-1.5 text-foreground">
            <ThumbsDown aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="sr-only">What doesn't: </span>
            {note.doesNotWork}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * What goes out: the approved rules about the topics and tags a task needs (all of them at
 * first), as a zip with the close-ups or as text for a chat.
 */
function ExportDialog({
  collection: c,
  opener,
  busy,
  onClose,
  onDownload,
  onCopy,
}: {
  collection: Collection;
  opener: HTMLElement | null;
  busy: boolean;
  onClose: () => void;
  onDownload: (pick: RulePick) => void;
  onCopy: (pick: RulePick) => void;
}) {
  const all = useMemo(() => rulesOf(c).map((r) => r.rule), [c]);
  // Only the topics and tags some approved rule has, and "none" when a rule has none.
  const presentTopics = useMemo(() => {
    const topics: (Topic | null)[] = TOPICS.map((t) => t.kind).filter((k) =>
      all.some((r) => r.topics.includes(k)),
    );
    if (all.some((r) => !r.topics.length)) topics.push(null);
    return topics;
  }, [all]);
  const presentTags = useMemo(() => {
    const tags: (string | null)[] = tagsOf(all);
    if (tags.length && all.some((r) => !r.tags.length)) tags.push(null);
    return tags;
  }, [all]);
  const [topics, setTopics] = useState<(Topic | null)[]>(presentTopics);
  const [tags, setTags] = useState<(string | null)[]>(presentTags);
  const pick: RulePick = { topics, ...(presentTags.length ? { tags } : {}) };
  const n = rulesOf(c, pick).length;
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const chipOf = (on: boolean, topic?: Topic | null) =>
    cn(
      tagHit,
      chip,
      on
        ? topic
          ? cn('border-transparent', TOPIC_TONES[topic].fill, TOPIC_TONES[topic].ink)
          : 'border-foreground bg-muted text-foreground'
        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
    );
  return (
    <Dialog id="export-title" title="Export rules" opener={opener} onClose={onClose}>
      <div className="space-y-4 text-[13px]">
        <p className="text-muted-foreground">
          Your rules, with the notes and close-ups they come from. Pick what this task needs.
          Your agent can also fetch them itself, always current: connect it in Account.
        </p>
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 leading-7 font-medium text-muted-foreground">About</legend>
          <div className="flex flex-wrap gap-2">
            {presentTopics.map((t) => (
              <button
                key={t ?? 'none'}
                type="button"
                aria-pressed={topics.includes(t)}
                onClick={() => setTopics((x) => toggle(x, t))}
                className={chipOf(topics.includes(t), t)}
              >
                {t ? topicLabel(t) : 'Not tagged'}
              </button>
            ))}
          </div>
        </fieldset>
        {presentTags.length > 0 && (
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-1 p-0 leading-7 font-medium text-muted-foreground">
              Your tags
            </legend>
            <div className="flex flex-wrap gap-2">
              {presentTags.map((t) => (
                <button
                  key={t ?? 'none'}
                  type="button"
                  aria-pressed={tags.includes(t)}
                  onClick={() => setTags((x) => toggle(x, t))}
                  className={chipOf(tags.includes(t))}
                >
                  {t ? `#${t}` : 'No tag'}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <p className="text-sm" aria-live="polite">
          {count(n, 'rule')} for this export.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => onCopy(pick)} disabled={!n} className={button}>
          <ClipboardCopy className="size-4" aria-hidden />
          Copy as text
        </button>
        <button
          type="button"
          data-autofocus
          onClick={() => onDownload(pick)}
          disabled={!n || busy}
          className={primary}
        >
          <Download className="size-4" aria-hidden />
          {busy ? 'Exporting…' : 'Download zip'}
        </button>
      </div>
    </Dialog>
  );
}
