'use client';

import {
  Check,
  Download,
  FolderOpen,
  Library,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchNotes, readExport } from '@/lib/pin/import';
import { MAX_LEARN_NOTES } from '@/lib/pin/learn';
import {
  type Batch,
  type BatchNote,
  byTopic,
  type Collection,
  collectionSlug,
  type Learning,
  type LearningStatus,
  newCollection,
  noteOf,
  originOf,
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  SCOPES,
  unwritten,
  withBatch,
  withLearning,
  withoutBatch,
  withoutLearning,
} from '@/lib/pin/learnings';
import { sourceLabel } from '@/lib/pin/model';
import { unzip } from '@/lib/pin/unzip';
import { type ZipEntry, zip } from '@/lib/pin/zip';
import { cn } from '@/lib/utils';
import * as store from './collections-store';
import { Dialog, hit } from './dialog';
import { download } from './render';
import { TOPIC_TONES } from './topic-style';

/*
 * Collections (D75): named, kept in this browser, each holding batches (as
 * their Pinch exports) and one learning per note. A learning is the rule a
 * note teaches: drafted by the AI from the note's words when drafting is on,
 * or written by the author, who approves, edits or rejects it and marks it
 * personal taste or this project. Approved learnings export as a rules file
 * with the close-up each came from. Shown in place of the batch, from the
 * header's Collections button.
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
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const OPEN_KEY = 'pinch-collection';
/** A collection is written this long after its last change, so typing a rule isn't a write per key. */
const SAVE_PAUSE = 400;

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

const TABS: { status: LearningStatus; label: string }[] = [
  { status: 'draft', label: 'To review' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Rejected' },
];

type Confirm =
  | { kind: 'batch'; collection: Collection; batch: Batch }
  | { kind: 'collection'; collection: Collection };

export function CollectionsView({
  inert,
  openNotes,
  batchZip,
  onOpenBatch,
  onStatus,
}: {
  inert: boolean;
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
  const [tab, setTab] = useState<LearningStatus>('draft');
  // Approved learnings left out of the next export, by id. Per visit.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [learnAvailable, setLearnAvailable] = useState(false);
  const [drafting, setDrafting] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    store
      .listCollections()
      .then((list) => {
        listRef.current = list;
        setCollections(list);
        const remembered = local.get(OPEN_KEY);
        setOpenId(list.find((c) => c.id === remembered)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => setCollections([]));
    fetch('/api/pin/learn')
      .then((r) => r.json())
      .then((r) => setLearnAvailable(Boolean(r.available)))
      .catch(() => setLearnAvailable(false));
  }, []);

  const save = useCallback(
    (id: string) => {
      const c = listRef.current.find((x) => x.id === id);
      if (!c) return;
      store
        .saveCollection(c)
        .catch(() =>
          onStatus({
            tone: 'error',
            text: 'This browser didn’t save the collection. Export the rules you want to keep.',
          }),
        );
    },
    [onStatus],
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
    setExcluded(new Set());
  }, [openId]);

  // Each batch's export, read once while the view is open: its close-ups are the evidence.
  const files = useRef(new Map<string, Promise<Map<string, Uint8Array> | null>>());
  const filesOf = useCallback((batchId: string) => {
    let found = files.current.get(batchId);
    if (!found) {
      found = store
        .getBatch(batchId)
        .then(async (blob) => (blob ? unzip(await blob.arrayBuffer()) : null))
        .catch(() => null);
      files.current.set(batchId, found);
    }
    return found;
  }, []);
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
      }
      if (!cancelled) setCrops(made);
    })();
    return () => {
      cancelled = true;
      for (const url of Object.values(made)) URL.revokeObjectURL(url);
      setCrops({});
    };
  }, [batchIds, filesOf]);

  const create = () => {
    const c = newCollection('Untitled collection', newId(), nowIso());
    listRef.current = [c, ...listRef.current];
    setCollections(listRef.current);
    setOpenId(c.id);
    setTab('draft');
    setFresh(c.id);
    save(c.id);
  };

  /** A batch's export into the collection: its zip kept, a draft learning for each note. */
  const addZip = useCallback(
    async (c: Collection, blob: Blob, fileName: string) => {
      let found: Map<string, Uint8Array>;
      let exp: ReturnType<typeof readExport>;
      try {
        found = await unzip(await blob.arrayBuffer());
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
      try {
        await store.putBatch(id, blob);
      } catch {
        onStatus({
          tone: 'error',
          text: 'Browser storage is full. Remove a batch, then try again.',
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
      setTab('draft');
      onStatus({
        tone: 'info',
        text: `Added ${name} to ${current.name}: ${count(notes.length, 'note')} to review. ${
          learnAvailable
            ? 'Draft with AI to fill in a rule for each, or write them.'
            : 'Write the rule each note teaches.'
        }`,
      });
    },
    [change, learnAvailable, onStatus],
  );

  const addOpenBatch = async (c: Collection) => {
    setBusy('add');
    try {
      const made = await batchZip();
      if (made) await addZip(c, made.blob, made.name);
      else onStatus({ tone: 'error', text: 'The open batch has no notes yet.' });
    } catch (e) {
      onStatus({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  // A Pinch export dropped on the view joins the open collection, not the batch.
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const zips = [...(e.dataTransfer?.files ?? [])].filter(
        (f) => /zip/.test(f.type) || /\.zip$/i.test(f.name),
      );
      if (!open) {
        onStatus({ tone: 'error', text: 'Make a collection first, then drop its exports on it.' });
        return;
      }
      if (!zips.length) {
        onStatus({ tone: 'error', text: 'Drop a Pinch export (.zip). Images go in a batch.' });
        return;
      }
      (async () => {
        for (const f of zips) await addZip(open, f, f.name);
      })();
    };
    window.addEventListener('drop', onDrop, { capture: true });
    return () => window.removeEventListener('drop', onDrop, { capture: true });
  }, [open, addZip, onStatus]);

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
            topics: n.topics,
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
            text: `Drafted ${count(drafted, 'rule')}. Read each one, edit it if it misses, then approve or reject it.`,
          },
    );
  };

  const exportRules = async (c: Collection) => {
    const chosen = new Set(
      c.learnings.filter((l) => l.status === 'approved' && !excluded.has(l.id)).map((l) => l.id),
    );
    const rules = rulesOf(c, chosen);
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
      onStatus({
        tone: 'info',
        text: `Exported ${count(rules.length, 'rule')}. Put design-rules.md where your agent reads its instructions, with the evidence folder beside it.`,
      });
    } finally {
      setBusy(null);
    }
  };

  const deleteLearning = (c: Collection, l: Learning) => {
    const at = c.learnings.findIndex((x) => x.id === l.id);
    change(c.id, (x) => withoutLearning(x, l.id, nowIso()), true);
    onStatus({
      tone: 'info',
      text: `Deleted the learning from note ${l.note}.`,
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
    const blob = await store.getBatch(b.id).catch(() => undefined);
    if (!blob) {
      onStatus({ tone: 'error', text: `${b.name} is missing from this browser.` });
      return;
    }
    onOpenBatch(new File([blob], `${b.name}.zip`, { type: 'application/zip' }));
  };

  const downloadStored = async (b: Batch) => {
    const blob = await store.getBatch(b.id).catch(() => undefined);
    if (blob) download(blob, `${b.name}.zip`);
    else onStatus({ tone: 'error', text: `${b.name} is missing from this browser.` });
  };

  const confirmed = async () => {
    if (!confirm) return;
    const c = confirm.collection;
    if (confirm.kind === 'batch') {
      const b = confirm.batch;
      change(c.id, (x) => withoutBatch(x, b.id, nowIso()), true);
      files.current.delete(b.id);
      await store.deleteBatch(b.id).catch(() => undefined);
      onStatus({ tone: 'info', text: `Removed ${b.name} and its learnings.` });
    } else {
      clearTimeout(timers.current.get(c.id));
      timers.current.delete(c.id);
      listRef.current = listRef.current.filter((x) => x.id !== c.id);
      setCollections(listRef.current);
      setOpenId(listRef.current[0]?.id ?? null);
      await store.deleteCollection(c).catch(() => undefined);
      onStatus({ tone: 'info', text: `Deleted ${c.name}.` });
    }
    setConfirm(null);
  };

  const ask = (next: Confirm) => {
    opener.current = document.activeElement as HTMLElement | null;
    setConfirm(next);
  };

  if (!collections) return <div className="flex-1" />;

  return (
    <div inert={inert || confirm !== null} className="flex min-h-0 flex-1">
      <nav
        aria-label="Collections"
        className="flex w-60 shrink-0 flex-col border-r border-border max-[900px]:w-48"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="m-0 flex-1 text-[13px] font-medium text-muted-foreground">Collections</h2>
          <button type="button" aria-label="New collection" onClick={create} className={iconButton}>
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        <ol className="m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto p-2">
          {collections.map((c) => {
            const approved = c.learnings.filter((l) => l.status === 'approved').length;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === openId ? 'page' : undefined}
                  onClick={() => {
                    setOpenId(c.id);
                    setTab('draft');
                  }}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                    c.id === openId && 'bg-muted',
                  )}
                >
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {count(c.learnings.length, 'learning')} · {approved} approved
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!open ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
            <Library className="size-6 text-muted-foreground" aria-hidden />
            <h2 className="m-0 text-[1.4rem] leading-snug font-normal tracking-tight">
              Keep what your notes teach
            </h2>
            <p className="m-0 text-sm text-muted-foreground">
              A collection holds your batches and the rules drawn from their notes. Approve the
              rules that are yours, then export them for your agent.
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
            tab={tab}
            onTab={setTab}
            crops={crops}
            excluded={excluded}
            onExclude={(id, out) =>
              setExcluded((s) => {
                const next = new Set(s);
                if (out) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            openNotes={openNotes}
            learnAvailable={learnAvailable}
            drafting={drafting}
            busy={busy}
            onRename={(name) => change(open.id, (x) => ({ ...x, name, updatedAt: nowIso() }))}
            onAddOpen={() => addOpenBatch(open)}
            onImport={() => fileInput.current?.click()}
            onDraft={() => draftAll(open)}
            onExport={() => exportRules(open)}
            onDelete={() => ask({ kind: 'collection', collection: open })}
            onLearning={(id, c) => change(open.id, (x) => withLearning(x, id, c, nowIso()))}
            onDeleteLearning={(l) => deleteLearning(open, l)}
            onOpenBatch={openStored}
            onDownloadBatch={downloadStored}
            onRemoveBatch={(b) => ask({ kind: 'batch', collection: open, batch: b })}
          />
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          multiple
          hidden
          onChange={async (e) => {
            const chosen = [...(e.target.files ?? [])];
            e.target.value = '';
            if (open) for (const f of chosen) await addZip(open, f, f.name);
          }}
        />
      </main>

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
                  'learning',
                )} go with it, approved ones too. Download it first to keep the batch.`
              : `Its ${count(confirm.collection.batches.length, 'batch')} and ${count(
                  confirm.collection.learnings.length,
                  'learning',
                )} are deleted from this browser. Export the rules first to keep them.`}
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
    </div>
  );
}

function CollectionPage({
  collection: c,
  fresh,
  tab,
  onTab,
  crops,
  excluded,
  onExclude,
  openNotes,
  learnAvailable,
  drafting,
  busy,
  onRename,
  onAddOpen,
  onImport,
  onDraft,
  onExport,
  onDelete,
  onLearning,
  onDeleteLearning,
  onOpenBatch,
  onDownloadBatch,
  onRemoveBatch,
}: {
  collection: Collection;
  fresh: boolean;
  tab: LearningStatus;
  onTab: (t: LearningStatus) => void;
  crops: Record<string, string>;
  excluded: Set<string>;
  onExclude: (id: string, out: boolean) => void;
  openNotes: number;
  learnAvailable: boolean;
  drafting: { done: number; total: number } | null;
  busy: string | null;
  onRename: (name: string) => void;
  onAddOpen: () => void;
  onImport: () => void;
  onDraft: () => void;
  onExport: () => void;
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
  const of = (s: LearningStatus) => c.learnings.filter((l) => l.status === s);
  const toWrite = unwritten(c).length;
  const toExport = of('approved').filter((l) => !excluded.has(l.id) && l.text.trim()).length;
  const shown = byTopic(of(tab));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      <header className="space-y-3">
        <div className="flex items-start gap-2">
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
            aria-label="Delete collection"
            title="Delete collection"
            onClick={onDelete}
            className={cn(iconButton, 'mt-1')}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {count(c.batches.length, 'batch')} · {count(c.learnings.length, 'learning')} ·{' '}
          {of('approved').length} approved
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
            disabled={!toExport || busy !== null}
            className={cn(primary, 'ml-auto')}
          >
            <Download className="size-4" aria-hidden />
            {busy === 'export' ? 'Exporting…' : `Export ${count(toExport, 'rule')}`}
          </button>
        </div>
      </header>

      {c.batches.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          Add the batch you are working on, or import a Pinch export, to get a learning for each of
          its notes. You can also drop exports here.
        </p>
      ) : (
        <>
          <fieldset className="flex min-w-0 gap-1 border-0 border-b border-border p-0">
            <legend className="sr-only">Show</legend>
            {TABS.map((t) => (
              <button
                key={t.status}
                type="button"
                aria-pressed={tab === t.status}
                onClick={() => onTab(t.status)}
                className={cn(
                  hit,
                  '-mb-px flex min-h-9 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:text-foreground',
                  tab === t.status
                    ? 'border-foreground font-medium text-foreground'
                    : 'border-transparent text-muted-foreground',
                )}
              >
                {t.label}
                <span className="font-mono text-[13px] text-muted-foreground">
                  {of(t.status).length}
                </span>
              </button>
            ))}
          </fieldset>

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tab === 'draft'
                ? 'Nothing left to review.'
                : tab === 'approved'
                  ? 'No approved learnings yet. Approve the ones that are yours in To review.'
                  : 'No rejected learnings.'}
            </p>
          ) : (
            shown.map((g) => (
              <section key={g.label} aria-labelledby={`group-${g.label}`} className="space-y-3">
                <h3
                  id={`group-${g.label}`}
                  className="flex items-center gap-2 text-sm font-medium"
                >
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
                          inExport={!excluded.has(l.id)}
                          onExport={(on) => onExclude(l.id, !on)}
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
 * One learning: the note's close-up and words as evidence, the rule (editable), its scope, and
 * approve or reject. An approved one can be left out of the next export.
 */
function LearningCard({
  learning: l,
  note,
  batch,
  crop,
  inExport,
  onExport,
  onChange,
  onDelete,
}: {
  learning: Learning;
  note: BatchNote;
  batch: Batch;
  crop?: string;
  inExport: boolean;
  onExport: (on: boolean) => void;
  onChange: (change: Partial<Learning>) => void;
  onDelete: () => void;
}) {
  const id = `rule-${l.id}`;
  const origin = originOf(l);
  const written = Boolean(l.text.trim());
  const toggle = (status: LearningStatus) =>
    onChange({ status: l.status === status ? 'draft' : status });
  return (
    <article
      aria-label={`Learning from note ${note.ref}`}
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
                ? 'No rule found in this note. Write one, or reject it.'
                : 'Write the rule this note teaches'
            }
            onChange={(e) => onChange({ text: e.target.value })}
            className={field}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="m-0 flex min-w-0 gap-1 rounded-lg border border-border p-0.5">
            <legend className="sr-only">Scope</legend>
            {SCOPES.map((s) => (
              <button
                key={s.kind}
                type="button"
                aria-pressed={l.scope === s.kind}
                onClick={() => onChange({ scope: s.kind })}
                className={cn(
                  'flex min-h-8 items-center rounded-md px-2.5 text-[13px] transition-colors duration-150 motion-reduce:transition-none',
                  l.scope === s.kind
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </fieldset>
          {l.status === 'approved' && (
            <label className="flex min-h-8 items-center gap-2 px-1 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={inExport}
                onChange={(e) => onExport(e.target.checked)}
                className="size-4 accent-foreground"
              />
              In export
            </label>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label="Delete learning"
              title="Delete learning"
              onClick={onDelete}
              className={iconButton}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={l.status === 'rejected'}
              onClick={() => toggle('rejected')}
              className={cn(
                button,
                'min-h-8',
                l.status === 'rejected' && 'border-foreground bg-muted font-medium',
              )}
            >
              <ThumbsDown className="size-4" aria-hidden />
              {l.status === 'rejected' ? 'Rejected' : 'Reject'}
            </button>
            <button
              type="button"
              aria-pressed={l.status === 'approved'}
              disabled={!written && l.status !== 'approved'}
              title={written ? undefined : 'Write the rule first'}
              onClick={() => toggle('approved')}
              className={cn(
                l.status === 'approved'
                  ? cn(button, 'min-h-8 border-foreground bg-muted font-medium')
                  : cn(primary, 'min-h-8'),
              )}
            >
              <Check className="size-4" aria-hidden />
              {l.status === 'approved' ? 'Approved' : 'Approve'}
            </button>
          </span>
        </div>
      </div>
    </article>
  );
}
