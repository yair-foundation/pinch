'use client';

import {
  Archive,
  ClipboardCopy,
  Cloud,
  Download,
  FolderOpen,
  HardDrive,
  Library,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { batchNotes, readExport } from '@/lib/pin/import';
import { MAX_LEARN_NOTES } from '@/lib/pin/learn';
import {
  type Batch,
  type BatchNote,
  batchFileName,
  byTopic,
  COLLECTION_FILE,
  type Collection,
  collectionManifest,
  collectionSlug,
  type Learning,
  newCollection,
  noteOf,
  originOf,
  type RulePick,
  readCollection,
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  rulesText,
  unwritten,
  withBatch,
  withLearning,
  withoutBatch,
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
 * Collections (D79, D80): named, each holding batches (as their Pinch exports)
 * and one learning per note. A learning is the rule a note teaches: drafted by
 * the AI from the note's words when drafting is on, or written by the author,
 * who edits or deletes the ones that miss, and can change what it is about.
 * The rules export as a file, all of them or the topics a task needs, or as text to paste into a chat.
 * A collection also downloads as one file, to keep or to open elsewhere. Kept
 * in this browser, or in the account when signed in (D81). Shown in place of
 * the batch, from the header's Collections button.
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
const OPEN_KEY = 'pinch-collection';
/** A collection is written this long after its last change, so typing a rule isn't a write per key. */
const SAVE_PAUSE = 600;
const isZip = (f: File) => /zip/.test(f.type) || /\.zip$/i.test(f.name);

const local = {
  get: (key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
};

/** Two batches with the same notes are the same batch added twice. */
const signature = (notes: BatchNote[]) =>
  JSON.stringify(notes.map((n) => [n.ref, n.image, n.works, n.doesNotWork]));

/** The folder a collection file's contents sit in, found by its `collection.json`. */
const collectionRoot = (files: Map<string, Uint8Array>) => {
  const key = [...files.keys()]
    .filter((k) => k === COLLECTION_FILE || k.endsWith(`/${COLLECTION_FILE}`))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  return key === undefined ? undefined : key.slice(0, -COLLECTION_FILE.length);
};

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

type Confirm =
  | { kind: 'batch'; collection: Collection; batch: Batch }
  | { kind: 'collection'; collection: Collection };

export function CollectionsView({
  inert,
  backend,
  moveFrom,
  openNotes,
  batchZip,
  onOpenBatch,
  onStatus,
}: {
  inert: boolean;
  /** Where the collections are kept. */
  backend: CollectionsBackend;
  /** Collections kept elsewhere that can move here: this browser's, once signed in. */
  moveFrom?: CollectionsBackend;
  /** Notes in the batch that is open, which "Add open batch" would keep. */
  openNotes: number;
  /** The open batch as its export, or null when it has no notes. */
  batchZip: () => Promise<{ blob: Blob; name: string } | null>;
  /** Open a kept batch in the batch view. */
  onOpenBatch: (file: File) => void;
  onStatus: (notice: Notice) => void;
}) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const listRef = useRef<Collection[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [learnAvailable, setLearnAvailable] = useState(false);
  const [drafting, setDrafting] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [exporting, setExporting] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [movable, setMovable] = useState<Collection[]>([]);
  const opener = useRef<HTMLElement | null>(null);
  const exportInput = useRef<HTMLInputElement>(null);
  const collectionInput = useRef<HTMLInputElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    backend
      .list()
      .then((list) => {
        listRef.current = list;
        setCollections(list);
        const remembered = local.get(OPEN_KEY);
        setOpenId(list.find((c) => c.id === remembered)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => {
        setCollections([]);
        onStatus({ tone: 'error', text: 'Your collections didn’t load. Reload to try again.' });
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
              ? 'The collection didn’t save to your account. Check the connection; your change is kept here until it does.'
              : 'This browser didn’t save the collection. Export the rules you want to keep.',
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

  const open = collections?.find((c) => c.id === openId) ?? null;
  useEffect(() => {
    if (openId) local.set(OPEN_KEY, openId);
  }, [openId]);

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

  const adopt = useCallback((c: Collection) => {
    listRef.current = [c, ...listRef.current];
    setCollections(listRef.current);
    setOpenId(c.id);
  }, []);

  const create = () => {
    const c = newCollection('Untitled collection', newId(), nowIso());
    adopt(c);
    setFresh(c.id);
    save(c.id);
  };

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
              : 'Browser storage is full. Remove a batch, then try again.',
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
        text: `Added ${name} to ${current.name}: ${count(notes.length, 'note')}, each with a rule to write. ${
          learnAvailable
            ? 'Draft them with AI, or write them.'
            : 'Write the rule each note teaches.'
        }`,
      });
    },
    [backend, change, learnAvailable, onStatus],
  );

  /** A collection file opened here: a new collection beside the others, with fresh ids. */
  const openCollectionFile = useCallback(
    async (fileName: string, found: Map<string, Uint8Array>, root: string) => {
      let read: ReturnType<typeof readCollection>;
      try {
        read = readCollection(
          JSON.parse(new TextDecoder().decode(found.get(root + COLLECTION_FILE))),
          newId,
          nowIso(),
        );
      } catch (e) {
        onStatus({ tone: 'error', text: `Couldn't open ${fileName}. ${(e as Error).message}` });
        return;
      }
      const { collection, batchIds } = read;
      onStatus({ tone: 'info', text: `Opening ${collection.name}…`, sticky: true });
      const kept: Batch[] = [];
      for (const b of collection.batches) {
        const old = [...batchIds].find(([, id]) => id === b.id)?.[0] as string;
        const bytes = found.get(root + batchFileName(old));
        if (!bytes) continue;
        try {
          await backend.putBatch(b.id, new Blob([bytes as BlobPart], { type: 'application/zip' }));
          kept.push(b);
        } catch {
          break;
        }
      }
      const keptIds = new Set(kept.map((b) => b.id));
      const c: Collection = {
        ...collection,
        name: listRef.current.some((x) => x.name === collection.name)
          ? `${collection.name} (copy)`
          : collection.name,
        batches: kept,
        learnings: collection.learnings.filter((l) => keptIds.has(l.batchId)),
      };
      adopt(c);
      save(c.id);
      const lost = collection.batches.length - kept.length;
      onStatus({
        tone: lost ? 'error' : 'info',
        text: `Opened ${c.name}: ${count(kept.length, 'batch', 'batches')}, ${count(
          c.learnings.filter((l) => l.text.trim()).length,
          'rule',
        )}.${lost ? ` ${count(lost, 'batch', 'batches')} couldn’t be kept.` : ''}`,
      });
    },
    [adopt, backend, onStatus, save],
  );

  /** A zip from the file picker or a drop: a collection file, or a batch's export. */
  const openZip = useCallback(
    async (file: File) => {
      let found: Map<string, Uint8Array>;
      try {
        found = await unzip(await file.arrayBuffer());
      } catch (e) {
        onStatus({ tone: 'error', text: `Couldn't open ${file.name}. ${(e as Error).message}` });
        return;
      }
      const root = collectionRoot(found);
      if (root !== undefined) return openCollectionFile(file.name, found, root);
      const target = listRef.current.find((c) => c.id === openId);
      if (!target) {
        onStatus({ tone: 'error', text: 'Make a collection first, then add exports to it.' });
        return;
      }
      return addExport(target, file, file.name, found);
    },
    [addExport, onStatus, openCollectionFile, openId],
  );

  const addOpenBatch = async (c: Collection) => {
    setBusy('add');
    try {
      const made = await batchZip();
      if (made) await addExport(c, made.blob, made.name);
      else onStatus({ tone: 'error', text: 'The open batch has no notes yet.' });
    } catch (e) {
      onStatus({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // A zip dropped on the view joins the collections, not the batch.
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const zips = [...(e.dataTransfer?.files ?? [])].filter(isZip);
      if (!zips.length) {
        onStatus({
          tone: 'error',
          text: 'Drop a Pinch export or a collection file (.zip). Images go in a batch.',
        });
        return;
      }
      (async () => {
        for (const f of zips) await openZip(f);
      })();
    };
    window.addEventListener('drop', onDrop, { capture: true });
    return () => window.removeEventListener('drop', onDrop, { capture: true });
  }, [openZip, onStatus]);

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

  /** The whole collection as one file: to keep, or to open in another browser. */
  const downloadCollection = async (c: Collection) => {
    setBusy('file');
    try {
      const root = `pinch-collection-${collectionSlug(c.name)}/`;
      const entries: ZipEntry[] = [
        {
          name: root + COLLECTION_FILE,
          data: new TextEncoder().encode(`${JSON.stringify(collectionManifest(c), null, 2)}\n`),
        },
      ];
      for (const b of c.batches) {
        const blob = await backend.getBatch(b.id).catch(() => undefined);
        if (blob)
          entries.push({
            name: root + batchFileName(b.id),
            data: new Uint8Array(await blob.arrayBuffer()),
          });
      }
      download(
        new Blob(zip(entries) as BlobPart[], { type: 'application/zip' }),
        `${root.slice(0, -1)}.zip`,
      );
      onStatus({
        tone: 'info',
        text: `Downloaded ${c.name} as one file. Import it in Collections to open it again, here or in another browser.`,
      });
    } finally {
      setBusy(null);
    }
  };

  /** This browser's collections into the account, then out of this browser. */
  const moveHere = async () => {
    if (!moveFrom || !movable.length) return;
    setBusy('move');
    let moved = 0;
    try {
      for (const c of movable) {
        onStatus({ tone: 'info', text: `Moving ${c.name}…`, sticky: true });
        for (const b of c.batches) {
          const blob = await moveFrom.getBatch(b.id);
          if (blob) await backend.putBatch(b.id, blob);
        }
        await backend.save(c);
        await moveFrom.remove(c);
        if (!listRef.current.some((x) => x.id === c.id)) adopt(c);
        moved++;
      }
      setMovable([]);
      onStatus({ tone: 'info', text: `Moved ${count(moved, 'collection')} to your account.` });
    } catch (e) {
      onStatus({
        tone: 'error',
        text: `Moved ${count(moved, 'collection')}, then stopped. ${(e as Error).message}`,
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

  const openStored = async (b: Batch) => {
    const blob = await backend.getBatch(b.id).catch(() => undefined);
    if (!blob) {
      onStatus({ tone: 'error', text: `${b.name} couldn’t be read.` });
      return;
    }
    onOpenBatch(new File([blob], `${b.name}.zip`, { type: 'application/zip' }));
  };

  const downloadStored = async (b: Batch) => {
    const blob = await backend.getBatch(b.id).catch(() => undefined);
    if (blob) download(blob, `${b.name}.zip`);
    else onStatus({ tone: 'error', text: `${b.name} couldn’t be read.` });
  };

  const confirmed = async () => {
    if (!confirm) return;
    const c = confirm.collection;
    if (confirm.kind === 'batch') {
      const b = confirm.batch;
      change(c.id, (x) => withoutBatch(x, b.id, nowIso()), true);
      files.current.delete(b.id);
      await backend.deleteBatch(b.id).catch(() => undefined);
      onStatus({ tone: 'info', text: `Removed ${b.name} and its rules.` });
    } else {
      clearTimeout(timers.current.get(c.id));
      timers.current.delete(c.id);
      listRef.current = listRef.current.filter((x) => x.id !== c.id);
      setCollections(listRef.current);
      setOpenId(listRef.current[0]?.id ?? null);
      await backend.remove(c).catch(() => undefined);
      onStatus({ tone: 'info', text: `Deleted ${c.name}.` });
    }
    setConfirm(null);
  };

  const ask = (next: Confirm) => {
    opener.current = document.activeElement as HTMLElement | null;
    setConfirm(next);
  };

  if (!collections) return <div className="flex-1" />;
  const Where = backend.kind === 'account' ? Cloud : HardDrive;

  return (
    <>
      <div inert={inert || confirm !== null || exporting} className="flex min-h-0 flex-1">
        <nav
          aria-label="Collections"
          className="flex w-60 shrink-0 flex-col border-r border-border max-[900px]:w-48"
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-3">
            <h2 className="m-0 flex-1 text-[13px] font-medium text-muted-foreground">
              Collections
            </h2>
            <button
              type="button"
              aria-label="Import a collection file"
              title="Import a collection file"
              onClick={() => collectionInput.current?.click()}
              className={iconButton}
            >
              <Upload className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="New collection"
              title="New collection"
              onClick={create}
              className={iconButton}
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
          <ol className="m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto p-2">
            {collections.map((c) => {
              const written = c.learnings.filter((l) => l.text.trim()).length;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === openId ? 'page' : undefined}
                    onClick={() => setOpenId(c.id)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                      c.id === openId && 'bg-muted',
                    )}
                  >
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {count(written, 'rule')} · {count(c.batches.length, 'batch', 'batches')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {movable.length > 0 && (
            <div className="shrink-0 space-y-2 border-t border-border p-3 text-[13px] text-muted-foreground">
              <p>
                {count(movable.length, 'collection')} {movable.length === 1 ? 'is' : 'are'} only in
                this browser.
              </p>
              <button
                type="button"
                onClick={moveHere}
                disabled={busy !== null}
                className={cn(button, 'w-full justify-center')}
              >
                <Cloud className="size-4" aria-hidden />
                {busy === 'move' ? 'Moving…' : 'Move to your account'}
              </button>
            </div>
          )}
          <p className="flex shrink-0 items-center gap-1.5 border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground">
            <Where className="size-3.5" aria-hidden />
            {backend.kind === 'account' ? 'Kept in your account' : 'Kept in this browser'}
          </p>
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {!open ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
              <Library className="size-6 text-muted-foreground" aria-hidden />
              <h2 className="m-0 text-[1.4rem] leading-snug font-normal tracking-tight">
                Keep what your notes teach
              </h2>
              <p className="m-0 text-sm text-muted-foreground">
                A collection holds your batches and the rule each note teaches. Keep the rules that
                are yours, then export them for your agent.
              </p>
              <button type="button" onClick={create} className={primary}>
                <Plus className="size-4" aria-hidden />
                New collection
              </button>
            </div>
          ) : (
            <CollectionPage
              key={open.id}
              collection={open}
              fresh={fresh === open.id}
              crops={crops}
              openNotes={openNotes}
              learnAvailable={learnAvailable}
              drafting={drafting}
              busy={busy}
              onRename={(name) => change(open.id, (x) => ({ ...x, name, updatedAt: nowIso() }))}
              onAddOpen={() => addOpenBatch(open)}
              onImport={() => exportInput.current?.click()}
              onDraft={() => draftAll(open)}
              onExport={() => {
                opener.current = document.activeElement as HTMLElement | null;
                setExporting(true);
              }}
              onDownload={() => downloadCollection(open)}
              onDelete={() => ask({ kind: 'collection', collection: open })}
              onLearning={(id, c) => change(open.id, (x) => withLearning(x, id, c, nowIso()))}
              onDeleteLearning={(l) => deleteLearning(open, l)}
              onOpenBatch={openStored}
              onDownloadBatch={downloadStored}
              onRemoveBatch={(b) => ask({ kind: 'batch', collection: open, batch: b })}
            />
          )}
          <input
            ref={exportInput}
            type="file"
            accept=".zip,application/zip"
            multiple
            hidden
            onChange={async (e) => {
              const chosen = [...(e.target.files ?? [])];
              e.target.value = '';
              for (const f of chosen) await openZip(f);
            }}
          />
          <input
            ref={collectionInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={async (e) => {
              const [f] = [...(e.target.files ?? [])];
              e.target.value = '';
              if (f) await openZip(f);
            }}
          />
        </main>
      </div>

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

      {confirm && (
        <Dialog
          id="confirm-title"
          title={
            confirm.kind === 'batch'
              ? `Remove ${confirm.batch.name}?`
              : `Delete ${confirm.collection.name}?`
          }
          opener={opener.current}
          onClose={() => setConfirm(null)}
        >
          <p className="m-0 text-muted-foreground">
            {confirm.kind === 'batch'
              ? `Its ${count(
                  confirm.collection.learnings.filter((l) => l.batchId === confirm.batch.id).length,
                  'rule',
                )} go with it. Download it first to keep the batch.`
              : `Its ${count(confirm.collection.batches.length, 'batch', 'batches')} and ${count(
                  confirm.collection.learnings.length,
                  'rule',
                )} are deleted${backend.kind === 'account' ? ' from your account' : ' from this browser'}. Download the collection first to keep it.`}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={confirmed}
              className={cn(
                hit,
                'flex min-h-9 items-center rounded-md bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors duration-150 motion-reduce:transition-none hover:bg-destructive/20',
              )}
            >
              {confirm.kind === 'batch' ? 'Remove' : 'Delete'}
            </button>
            <button
              type="button"
              data-autofocus
              onClick={() => setConfirm(null)}
              className={button}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function CollectionPage({
  collection: c,
  fresh,
  crops,
  openNotes,
  learnAvailable,
  drafting,
  busy,
  onRename,
  onAddOpen,
  onImport,
  onDraft,
  onExport,
  onDownload,
  onDelete,
  onLearning,
  onDeleteLearning,
  onOpenBatch,
  onDownloadBatch,
  onRemoveBatch,
}: {
  collection: Collection;
  fresh: boolean;
  crops: Record<string, string>;
  openNotes: number;
  learnAvailable: boolean;
  drafting: { done: number; total: number } | null;
  busy: string | null;
  onRename: (name: string) => void;
  onAddOpen: () => void;
  onImport: () => void;
  onDraft: () => void;
  onExport: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onLearning: (id: string, change: Partial<Learning>) => void;
  onDeleteLearning: (l: Learning) => void;
  onOpenBatch: (b: Batch) => void;
  onDownloadBatch: (b: Batch) => void;
  onRemoveBatch: (b: Batch) => void;
}) {
  const name = useRef<HTMLInputElement>(null);
  // A new collection opens with its name selected, ready to type over.
  useEffect(() => {
    if (fresh) name.current?.select();
  }, [fresh]);
  const toWrite = unwritten(c).length;
  const rules = c.learnings.filter((l) => l.text.trim()).length;
  const empty = c.learnings.length - rules;
  const groups = byTopic(c.learnings);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      <header className="space-y-3">
        <div className="flex items-start gap-1">
          <label htmlFor="collection-name" className="sr-only">
            Collection name
          </label>
          <input
            ref={name}
            id="collection-name"
            value={c.name}
            maxLength={80}
            onChange={(e) => onRename(e.target.value)}
            onBlur={(e) => {
              if (!e.target.value.trim()) onRename('Untitled collection');
            }}
            className="-mx-2 min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-[1.4rem] leading-snug font-normal tracking-tight outline-none hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          />
          <button
            type="button"
            aria-label="Download collection file"
            title="Download collection file"
            onClick={onDownload}
            disabled={busy !== null}
            className={cn(iconButton, 'mt-1')}
          >
            <Archive className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Delete collection"
            title="Delete collection"
            onClick={onDelete}
            className={cn(iconButton, 'mt-1')}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {count(c.batches.length, 'batch', 'batches')} · {count(rules, 'rule')}
          {empty ? ` · ${empty} to write` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAddOpen}
            disabled={!openNotes || busy !== null}
            title={openNotes ? undefined : 'The open batch has no notes yet'}
            className={button}
          >
            <Plus className="size-4" aria-hidden />
            {busy === 'add' ? 'Adding…' : 'Add open batch'}
          </button>
          <button type="button" onClick={onImport} className={button}>
            <Upload className="size-4" aria-hidden />
            Import export
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
          Add the batch you are working on, or import a Pinch export, to get a rule for each of its
          notes. You can also drop exports here.
        </p>
      ) : (
        <>
          {groups.map((g) => (
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
                        batch={found.batch}
                        crop={crops[`${l.batchId}/${l.note}`]}
                        onChange={(change) => onLearning(l.id, change)}
                        onDelete={() => onDeleteLearning(l)}
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          <section aria-labelledby="batches-heading" className="space-y-2 pt-2">
            <h3 id="batches-heading" className="text-sm font-medium">
              Batches
            </h3>
            <ul className="m-0 list-none divide-y divide-border rounded-xl border border-border p-0">
              {c.batches.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{b.name}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {count(b.images, 'image')} · {count(b.notes.length, 'note')} · added{' '}
                      {new Date(b.addedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Open ${b.name} as the batch`}
                    title="Open as the batch"
                    onClick={() => onOpenBatch(b)}
                    className={iconButton}
                  >
                    <FolderOpen className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Download ${b.name}`}
                    title="Download"
                    onClick={() => onDownloadBatch(b)}
                    className={iconButton}
                  >
                    <Download className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${b.name}`}
                    title="Remove"
                    onClick={() => onRemoveBatch(b)}
                    className={iconButton}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
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
  batch,
  crop,
  onChange,
  onDelete,
}: {
  learning: Learning;
  note: BatchNote;
  batch: Batch;
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
          <span className="block truncate" title={batch.name}>
            {batch.name}
          </span>
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
