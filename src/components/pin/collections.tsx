'use client';

import {
  ClipboardCopy,
  Cloud,
  Download,
  HardDrive,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { batchNotes, readExport } from '@/lib/pin/import';
import { MAX_LEARN_NOTES } from '@/lib/pin/learn';
import {
  type Batch,
  type BatchNote,
  byTopic,
  type Collection,
  collectionSlug,
  type Learning,
  mergeCollection,
  newCollection,
  noteOf,
  originOf,
  RULES_NAME,
  type RulePick,
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  rulesText,
  unwritten,
  withBatch,
  withLearning,
  withoutLearning,
} from '@/lib/pin/learnings';
import { sourceLabel, TOPICS, type Topic } from '@/lib/pin/model';
import { unzip } from '@/lib/pin/unzip';
import { type ZipEntry, zip } from '@/lib/pin/zip';
import { cn } from '@/lib/utils';
import type { CollectionsBackend } from './collections-backend';
import { Dialog, hit } from './dialog';
import { download } from './render';
import { TopicPicker } from './topic-picker';
import { TOPIC_TONES, tagHit } from './topic-style';

/*
 * The person's rules (D79, D80, D86): one collection, holding the notes added
 * from their images (kept as Pinch exports, for the close-ups) and one learning
 * per note. A learning is the rule a note teaches: drafted by the AI from the
 * note's words when drafting is on, or written by the author, who edits or
 * deletes the ones that miss, and can change what it is about. The rules
 * export as a file, all of them or the topics a task needs, or as text to
 * paste into a chat. Kept in this browser, or in the account when signed in
 * (D81). Shown in place of the images, from the header's Rules button.
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
/** A collection is written this long after its last change, so typing a rule isn't a write per key. */
const SAVE_PAUSE = 600;

/** Two batches with the same notes are the same batch added twice. */
const signature = (notes: BatchNote[]) =>
  JSON.stringify(notes.map((n) => [n.ref, n.image, n.works, n.doesNotWork]));

const button = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-50',
);
const primary = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50',
);
const iconButton = cn(
  hit,
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
);
const field =
  'w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-[#737373] dark:placeholder:text-[#7a7a7a] focus-visible:outline-2 focus-visible:outline-ring';

export function CollectionsView({
  inert,
  backend,
  moveFrom,
  openNotes,
  batchZip,
  onStatus,
}: {
  inert: boolean;
  /** Where the collections are kept. */
  backend: CollectionsBackend;
  /** Collections kept elsewhere that can move here: this browser's, once signed in. */
  moveFrom?: CollectionsBackend;
  /** Notes on the open images, which "Add notes" would keep. */
  openNotes: number;
  /** The open images as an export, or null when they have no notes. */
  batchZip: () => Promise<{ blob: Blob; name: string } | null>;
  onStatus: (notice: Notice) => void;
}) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const listRef = useRef<Collection[]>([]);
  const [learnAvailable, setLearnAvailable] = useState(false);
  const [drafting, setDrafting] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [movable, setMovable] = useState<Collection[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    backend
      .list()
      .then((list) => {
        // One collection each (D86): several made before are merged into the oldest, and one
        // is made, unsaved until something is added, when there is none.
        const [first, ...rest] = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (!first) {
          listRef.current = [newCollection(RULES_NAME, newId(), nowIso())];
          setCollections(listRef.current);
          return;
        }
        let one = first;
        for (const c of rest) one = mergeCollection(one, c, nowIso());
        if (rest.length) one = { ...one, name: RULES_NAME };
        listRef.current = [one];
        setCollections(listRef.current);
        // The merged ones go once the one holding everything is saved; emptied first, so that
        // deleting them leaves the batches they shared with it.
        if (rest.length)
          backend
            .save(one)
            .then(() =>
              Promise.all(
                rest.map(async (c) => {
                  const emptied = { ...c, batches: [], learnings: [] };
                  await backend.save(emptied);
                  await backend.remove(emptied);
                }),
              ),
            )
            .catch(() => undefined);
      })
      .catch(() => {
        setCollections([]);
        onStatus({ tone: 'error', text: 'Your rules didn’t load. Reload to try again.' });
      });
    moveFrom
      ?.list()
      .then(setMovable)
      .catch(() => undefined);
    fetch('/api/pin/learn')
      .then((r) => r.json())
      .then((r) => setLearnAvailable(Boolean(r.available)))
      .catch(() => setLearnAvailable(false));
  }, [backend, moveFrom, onStatus]);

  const save = useCallback(
    (id: string) => {
      const c = listRef.current.find((x) => x.id === id);
      if (!c) return;
      backend.save(c).catch(() =>
        onStatus({
          tone: 'error',
          text:
            backend.kind === 'account'
              ? 'Your rules didn’t save to your account. Check the connection; your change is kept here until it does.'
              : 'This browser didn’t save your rules. Export the ones you want to keep.',
        }),
      );
    },
    [backend, onStatus],
  );

  /** Every change to a collection goes through here; it is written a moment later, or at once. */
  const change = useCallback(
    (id: string, fn: (c: Collection) => Collection, now = false) => {
      listRef.current = listRef.current.map((c) => (c.id === id ? fn(c) : c));
      setCollections(listRef.current);
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(
          () => {
            timers.current.delete(id);
            save(id);
          },
          now ? 0 : SAVE_PAUSE,
        ),
      );
    },
    [save],
  );

  // Leaving the view writes what is still waiting.
  useEffect(() => {
    const waiting = timers.current;
    return () => {
      for (const [id, timer] of waiting) {
        clearTimeout(timer);
        save(id);
      }
      waiting.clear();
    };
  }, [save]);

  const open = collections?.[0] ?? null;

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
  const batchIds = open?.batches.map((b) => b.id).join(',') ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: the close-ups follow the open collection's batches
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const made: Record<string, string> = {};
    (async () => {
      for (const b of open.batches) {
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

  /** A batch's export into the collection: its zip kept, an empty learning for each note. */
  const addExport = useCallback(
    async (c: Collection, blob: Blob, fileName: string, found?: Map<string, Uint8Array>) => {
      let exp: ReturnType<typeof readExport>;
      try {
        found ??= await unzip(await blob.arrayBuffer());
        exp = readExport(found);
      } catch (e) {
        onStatus({ tone: 'error', text: `Couldn't add ${fileName}. ${(e as Error).message}` });
        return;
      }
      const notes = batchNotes(exp);
      if (!notes.length) {
        onStatus({ tone: 'error', text: `${fileName} has no notes to learn from.` });
        return;
      }
      const current = listRef.current.find((x) => x.id === c.id) ?? c;
      if (current.batches.some((b) => signature(b.notes) === signature(notes))) {
        onStatus({ tone: 'error', text: `Those notes are already in ${current.name}.` });
        return;
      }
      const id = newId();
      const base = exp.root.replace(/\/$/, '') || fileName.replace(/\.zip$/i, '');
      const same = current.batches.filter((b) => b.name === base || b.name.startsWith(`${base} (`));
      const name = same.length ? `${base} (${same.length + 1})` : base;
      onStatus({
        tone: 'info',
        text: backend.kind === 'account' ? `Uploading ${name}…` : `Adding ${name}…`,
        sticky: true,
      });
      try {
        await backend.putBatch(id, blob);
      } catch (e) {
        onStatus({
          tone: 'error',
          text:
            backend.kind === 'account'
              ? `${name} didn’t upload. ${(e as Error).message}`
              : 'Browser storage is full. Delete a collection, then try again.',
        });
        return;
      }
      files.current.set(id, Promise.resolve(found));
      const batch: Batch = {
        id,
        name,
        addedAt: nowIso(),
        exportedAt: exp.exportedAt,
        root: exp.root,
        images: exp.assets.length,
        notes,
      };
      change(c.id, (x) => withBatch(x, batch, nowIso(), newId), true);
      onStatus({
        tone: 'info',
        text: `${notes.length === 1 ? 'Added 1 note, with a rule to write.' : `Added ${notes.length} notes, each with a rule to write.`} ${
          learnAvailable
            ? 'Draft them with AI, or write them.'
            : 'Write the rule each note teaches.'
        }`,
      });
    },
    [backend, change, learnAvailable, onStatus],
  );

  const addOpenBatch = async (c: Collection) => {
    setBusy('add');
    try {
      const made = await batchZip();
      if (made) await addExport(c, made.blob, made.name);
      else onStatus({ tone: 'error', text: 'The open images have no notes yet.' });
    } catch (e) {
      onStatus({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // Files dropped here would land in the images behind this view; they go there from Back.
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onStatus({ tone: 'error', text: 'Go Back to add images, then Add notes here.' });
    };
    window.addEventListener('drop', onDrop, { capture: true });
    return () => window.removeEventListener('drop', onDrop, { capture: true });
  }, [onStatus]);

  /** Draft a rule for every note without one, a few notes per request. */
  const draftAll = async (c: Collection) => {
    const todo = unwritten(c);
    if (!todo.length) return;
    setDrafting({ done: 0, total: todo.length });
    let drafted = 0;
    let stopped: string | null = null;
    for (let i = 0; i < todo.length; i += MAX_LEARN_NOTES) {
      const chunk = todo.slice(i, i + MAX_LEARN_NOTES);
      const notes = chunk.flatMap((l) => {
        const found = noteOf(c, l);
        if (!found) return [];
        const n = found.note;
        return [
          {
            id: l.id,
            works: n.works,
            doesNotWork: n.doesNotWork,
            ...(n.label ? { label: n.label } : {}),
            topics: l.topics,
            source: n.source,
          },
        ];
      });
      try {
        const res = await fetch('/api/pin/learn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          stopped = body.error ?? 'No draft this time.';
          if (res.status === 503) setLearnAvailable(false);
          break;
        }
        const { rules } = (await res.json()) as { rules: Record<string, string> };
        drafted += Object.values(rules).filter(Boolean).length;
        change(c.id, (x) => ({
          ...x,
          updatedAt: nowIso(),
          learnings: x.learnings.map((l) =>
            l.id in rules && !l.text.trim() ? { ...l, text: rules[l.id], drafted: rules[l.id] } : l,
          ),
        }));
      } catch {
        stopped = 'No draft this time. Check the connection and try again.';
        break;
      }
      setDrafting({ done: Math.min(i + chunk.length, todo.length), total: todo.length });
    }
    setDrafting(null);
    onStatus(
      stopped
        ? {
            tone: 'error',
            text: `${drafted ? `Drafted ${count(drafted, 'rule')}, then stopped. ` : ''}${stopped}`,
          }
        : {
            tone: 'info',
            text: `Drafted ${count(drafted, 'rule')}. Read them: edit the ones that miss, delete the ones that aren’t yours.`,
          },
    );
  };

  /** The rules the pick takes, as a zip: design-rules.md, rules.json and the close-ups. */
  const exportRules = async (c: Collection, pick: RulePick) => {
    const rules = rulesOf(c, pick);
    if (!rules.length) return;
    setBusy('export');
    try {
      const stamp = nowIso();
      const root = `pinch-rules-${collectionSlug(c.name)}-${stamp.slice(0, 10)}/`;
      const encode = (s: string) => new TextEncoder().encode(s);
      const entries: ZipEntry[] = [
        { name: `${root}design-rules.md`, data: encode(rulesMarkdown(c, rules, stamp)) },
        {
          name: `${root}rules.json`,
          data: encode(`${JSON.stringify(rulesManifest(c, rules, stamp), null, 2)}\n`),
        },
      ];
      for (const r of rules) {
        const bytes = (await filesOf(r.batch.id))?.get(r.batch.root + r.note.crop);
        if (bytes) entries.push({ name: root + r.evidence, data: bytes });
      }
      download(
        new Blob(zip(entries) as BlobPart[], { type: 'application/zip' }),
        `${root.slice(0, -1)}.zip`,
      );
      const untouched = rules.filter((r) => originOf(r.learning) === 'ai').length;
      onStatus({
        tone: 'info',
        text: `Exported ${count(rules.length, 'rule')}${
          untouched === 1
            ? ', one of them an AI draft you didn’t edit'
            : untouched
              ? `, ${untouched} of them AI drafts you didn’t edit`
              : ''
        }. Put design-rules.md where your agent reads its instructions, with the evidence folder beside it.`,
      });
      setExporting(false);
    } finally {
      setBusy(null);
    }
  };

  const copyRules = async (c: Collection, pick: RulePick) => {
    const rules = rulesOf(c, pick);
    try {
      await navigator.clipboard.writeText(rulesText(c, rules));
      onStatus({
        tone: 'info',
        text: `Copied ${count(rules.length, 'rule')} as text. Paste them into your agent’s chat for this task.`,
      });
      setExporting(false);
    } catch {
      onStatus({ tone: 'error', text: "The browser didn't allow copying." });
    }
  };

  /** This browser's rules into the account's, then out of this browser. */
  const moveHere = async () => {
    const into = listRef.current[0];
    if (!moveFrom || !movable.length || !into) return;
    setBusy('move');
    onStatus({ tone: 'info', text: 'Moving your rules…', sticky: true });
    let moved = 0;
    try {
      for (const c of movable) {
        for (const b of c.batches) {
          const blob = await moveFrom.getBatch(b.id);
          if (blob) await backend.putBatch(b.id, blob);
        }
        listRef.current = [mergeCollection(listRef.current[0] ?? into, c, nowIso())];
        setCollections(listRef.current);
        await backend.save(listRef.current[0]);
        await moveFrom.remove(c);
        moved += c.learnings.filter((l) => l.text.trim()).length;
      }
      setMovable([]);
      onStatus({ tone: 'info', text: `Moved ${count(moved, 'rule')} to your account.` });
    } catch (e) {
      onStatus({
        tone: 'error',
        text: `Moved ${count(moved, 'rule')}, then stopped. ${(e as Error).message}`,
      });
      moveFrom
        .list()
        .then(setMovable)
        .catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const deleteLearning = (c: Collection, l: Learning) => {
    const at = c.learnings.findIndex((x) => x.id === l.id);
    change(c.id, (x) => withoutLearning(x, l.id, nowIso()), true);
    onStatus({
      tone: 'info',
      text: `Deleted the rule from note ${l.note}.`,
      action: {
        label: 'Undo',
        run: () =>
          change(
            c.id,
            (x) => ({
              ...x,
              learnings: [...x.learnings.slice(0, at), l, ...x.learnings.slice(at)],
            }),
            true,
          ),
      },
    });
  };

  if (!collections) return <div className="flex-1" />;
  const Where = backend.kind === 'account' ? Cloud : HardDrive;

  return (
    <>
      <main inert={inert || exporting} className="min-h-0 flex-1 overflow-y-auto">
        {open ? (
          <CollectionPage
            collection={open}
            crops={crops}
            openNotes={openNotes}
            learnAvailable={learnAvailable}
            drafting={drafting}
            busy={busy}
            kept={
              <span className="flex items-center gap-1.5">
                <Where className="size-3.5" aria-hidden />
                {backend.kind === 'account' ? 'Kept in your account' : 'Kept in this browser'}
              </span>
            }
            move={
              movable.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-[13px] text-muted-foreground">
                  <p className="m-0 flex-1">Some of your rules are only in this browser.</p>
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
              )
            }
            onAddOpen={() => addOpenBatch(open)}
            onDraft={() => draftAll(open)}
            onExport={() => {
              opener.current = document.activeElement as HTMLElement | null;
              setExporting(true);
            }}
            onLearning={(id, c) => change(open.id, (x) => withLearning(x, id, c, nowIso()))}
            onDeleteLearning={(l) => deleteLearning(open, l)}
          />
        ) : null}
      </main>

      {exporting && open && (
        <ExportDialog
          collection={open}
          opener={opener.current}
          busy={busy === 'export'}
          onClose={() => setExporting(false)}
          onDownload={(pick) => exportRules(open, pick)}
          onCopy={(pick) => copyRules(open, pick)}
        />
      )}
    </>
  );
}

function CollectionPage({
  collection: c,
  crops,
  openNotes,
  learnAvailable,
  drafting,
  busy,
  kept,
  move,
  onAddOpen,
  onDraft,
  onExport,
  onLearning,
  onDeleteLearning,
}: {
  collection: Collection;
  crops: Record<string, string>;
  openNotes: number;
  learnAvailable: boolean;
  drafting: { done: number; total: number } | null;
  busy: string | null;
  /** Where the rules are kept, said under the title. */
  kept: React.ReactNode;
  /** The offer to move this browser's rules into the account, when there are some. */
  move: React.ReactNode;
  onAddOpen: () => void;
  onDraft: () => void;
  onExport: () => void;
  onLearning: (id: string, change: Partial<Learning>) => void;
  onDeleteLearning: (l: Learning) => void;
}) {
  const toWrite = unwritten(c).length;
  const rules = c.learnings.filter((l) => l.text.trim()).length;
  const empty = c.learnings.length - rules;
  const groups = byTopic(c.learnings);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      <header className="space-y-3">
        <h2 className="m-0 text-[1.4rem] leading-snug font-normal tracking-tight">Your rules</h2>
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
          <span>
            {count(rules, 'rule')}
            {empty ? ` · ${empty} to write` : ''} ·
          </span>
          {kept}
        </p>
        {move}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddOpen}
            disabled={!openNotes || busy !== null}
            title={openNotes ? undefined : 'The open images have no notes yet'}
            className={button}
          >
            <Plus className="size-4" aria-hidden />
            {busy === 'add' ? 'Adding…' : 'Add notes'}
          </button>
          {learnAvailable && (toWrite > 0 || drafting) && (
            <button
              type="button"
              onClick={onDraft}
              disabled={drafting !== null}
              title="Sends each note's words, never the images, to Anthropic to draft a rule."
              className={button}
            >
              <Sparkles className="size-4" aria-hidden />
              {drafting
                ? `Drafting ${drafting.done} of ${drafting.total}…`
                : `Draft ${count(toWrite, 'rule')}`}
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            disabled={!rules || busy !== null}
            className={cn(primary, 'ml-auto')}
          >
            <Download className="size-4" aria-hidden />
            Export rules
          </button>
        </div>
      </header>

      {c.batches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          Add the notes on your open images to get a rule for each one.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.label} aria-labelledby={`group-${g.label}`} className="space-y-3">
            <h3 id={`group-${g.label}`} className="flex items-center gap-2 text-sm font-medium">
              <span
                className={cn(
                  'flex h-7 items-center rounded-md px-2 text-[13px] leading-none',
                  g.topic
                    ? cn(TOPIC_TONES[g.topic].fill, TOPIC_TONES[g.topic].ink)
                    : 'border border-border text-muted-foreground',
                )}
              >
                {g.label}
              </span>
              <span className="font-mono text-[13px] font-normal text-muted-foreground">
                {g.learnings.length}
              </span>
            </h3>
            <ol className="m-0 list-none space-y-3 p-0">
              {g.learnings.map((l) => {
                const found = noteOf(c, l);
                if (!found) return null;
                return (
                  <li key={l.id}>
                    <LearningCard
                      learning={l}
                      note={found.note}
                      crop={crops[`${l.batchId}/${l.note}`]}
                      onChange={(change) => onLearning(l.id, change)}
                      onDelete={() => onDeleteLearning(l)}
                    />
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * One rule: the note's close-up and words as evidence, the rule (editable), what it is
 * about, and delete. Keeping a rule is agreeing with it (D80).
 */
function LearningCard({
  learning: l,
  note,
  crop,
  onChange,
  onDelete,
}: {
  learning: Learning;
  note: BatchNote;
  crop?: string;
  onChange: (change: Partial<Learning>) => void;
  onDelete: () => void;
}) {
  const id = `rule-${l.id}`;
  const origin = originOf(l);
  return (
    <article
      aria-label={`Rule from note ${note.ref}`}
      className="grid grid-cols-[10rem_1fr] gap-4 rounded-xl border border-border p-4 max-[900px]:grid-cols-1"
    >
      <div className="space-y-2">
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
              className="max-h-32 w-full object-contain"
            />
          </a>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-[13px] text-muted-foreground">
            No close-up
          </div>
        )}
        <p className="m-0 text-[13px] leading-snug text-muted-foreground">
          <span className="font-mono">{note.ref}</span> · {note.image}
          {note.source ? ` · ${sourceLabel(note.source)}` : ''}
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        <div className="space-y-1 text-[13px] text-muted-foreground">
          {note.works && (
            <p className="flex gap-1.5">
              <ThumbsUp aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="sr-only">What works: </span>
                {note.works}
              </span>
            </p>
          )}
          {note.doesNotWork && (
            <p className="flex gap-1.5">
              <ThumbsDown aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="sr-only">What doesn't: </span>
                {note.doesNotWork}
              </span>
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor={id}
            className="mb-1 flex min-h-7 items-center gap-2 text-[13px] font-medium text-muted-foreground"
          >
            Rule
            {origin !== 'author' && (
              <span className="font-normal">
                {origin === 'ai' ? '· AI draft' : '· AI draft, edited'}
              </span>
            )}
          </label>
          <textarea
            id={id}
            rows={2}
            maxLength={300}
            value={l.text}
            placeholder={
              l.drafted === ''
                ? 'No rule found in this note. Write one, or delete it.'
                : 'Write the rule this note teaches'
            }
            onChange={(e) => onChange({ text: e.target.value })}
            className={field}
          />
        </div>
        <TopicPicker
          legend="This rule is about"
          topics={l.topics}
          onChange={(topics) => onChange({ topics })}
        />
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Delete rule"
            title="Delete rule"
            onClick={onDelete}
            className={cn(iconButton, 'ml-auto')}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * What goes out: the topics a task needs (all of them at first), as a zip with the
 * close-ups or as text for a chat.
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
  const all = useMemo(() => c.learnings.filter((l) => l.text.trim()), [c.learnings]);
  // Only the topics some rule is about, and "Not tagged" when a rule has none.
  const present = useMemo(() => {
    const topics: (Topic | null)[] = TOPICS.map((t) => t.kind).filter((k) =>
      all.some((l) => l.topics.includes(k)),
    );
    if (all.some((l) => !l.topics.length)) topics.push(null);
    return topics;
  }, [all]);
  const [topics, setTopics] = useState<(Topic | null)[]>(present);
  const pick: RulePick = { topics };
  const n = rulesOf(c, pick).length;
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return (
    <Dialog id="export-title" title="Export rules" opener={opener} onClose={onClose}>
      <div className="space-y-4 text-[13px]">
        <fieldset className="min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 leading-7 font-medium text-muted-foreground">About</legend>
          <div className="flex flex-wrap gap-2">
            {present.map((t) => {
              const on = topics.includes(t);
              const label = t ? (TOPICS.find((x) => x.kind === t)?.label ?? t) : 'Not tagged';
              return (
                <button
                  key={t ?? 'none'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTopics((x) => toggle(x, t))}
                  className={cn(
                    tagHit,
                    'flex h-7 items-center rounded-md border px-2 text-[13px] leading-none whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none',
                    on
                      ? t
                        ? cn('border-transparent', TOPIC_TONES[t].fill, TOPIC_TONES[t].ink)
                        : 'border-foreground bg-muted text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
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
