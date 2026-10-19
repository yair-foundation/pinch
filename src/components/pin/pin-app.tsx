'use client';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  ImagePlus,
  Keyboard,
  Loader2,
  MapPin,
  MoveUpRight,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import Image from 'next/image';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ThemeToggle } from '@/components/site/theme-toggle';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { type LocateResult, toMarks } from '@/lib/pin/locate';
import {
  type Area,
  type Arrow,
  type Asset,
  areaFrom,
  arrowFrom,
  currentSuggestion,
  hasNotes,
  isTinyArea,
  isTinyArrow,
  type Mark,
  moveArrow,
  needsSuggestion,
  SOURCES,
  type Shape,
  sourceLabel,
  type Source,
  type SourceKind,
  type Suggestion,
  shapeKey,
  verdictOf,
} from '@/lib/pin/model';
import { changedEntries, fingerprint, logEntries, MAX_BATCH } from '@/lib/pin/notes-log';
import type { SuggestResult } from '@/lib/pin/suggest';
import { batchSummary, imageSummary } from '@/lib/pin/summary';
import { cn } from '@/lib/utils';
import { PinchWordmark } from './brand';
import { DropFolder } from './drop-folder';
import {
  bitmapOf,
  buildExport,
  contextForAi,
  cropForAi,
  download,
  imageForAi,
  markedImage,
  prepareImage,
  VERDICT_COLOR,
} from './render';
import * as store from './store';

/*
 * Pinch: add a batch of screenshots, click for a dot, drag for an area or
 * draw an arrow (the Arrow tool, or Shift-drag), say what works and what
 * doesn't, then export everything for an agent.
 * Images stay in this browser. "Find in image" sends one image and its note
 * to the AI; suggestions send the crop of an empty note; the text of written
 * notes is saved anonymously (`notes-log.ts`).
 */

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Images a session holds. The browser keeps them all, and the export draws a copy of each. */
const MAX_IMAGES = 100;
const FULL_MESSAGE = `Pinch holds up to ${MAX_IMAGES} images at a time. Export or remove some to add more.`;

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A toast; an information one can carry one action, such as Undo after something was removed. */
type Status = {
  tone: 'info' | 'error';
  text: string;
  action?: { label: string; run: () => void };
} | null;

/*
 * History: snapshots of the session before each change, so ⌘Z puts it back.
 * A change can coalesce into the step before it (typing, a drag), by key and
 * within a pause; a silent change (a suggestion arriving) is no step at all.
 * The latest state is kept here as well as in React, so several changes in
 * one event each see the one before.
 */
const HISTORY_CAP = 100;
type Coalesce = { key: string; within: number };
type Step = { before: Asset[]; key?: string; at: number };

class History {
  current: Asset[] = [];
  past: Step[] = [];
  future: Asset[][] = [];

  /** Start from a loaded session: nothing to undo. */
  reset(assets: Asset[]) {
    this.current = assets;
    this.past = [];
    this.future = [];
  }

  /** Apply a change. Returns whether it opened a new step (so a toast can offer Undo). */
  commit(next: Asset[], opts: { coalesce?: Coalesce; silent?: boolean } = {}): boolean {
    const before = this.current;
    this.current = next;
    if (opts.silent) return false;
    const now = Date.now();
    const last = this.past.at(-1);
    const merge =
      opts.coalesce && last?.key === opts.coalesce.key && now - last.at < opts.coalesce.within;
    if (merge) {
      last.at = now;
      // A change that undid itself (an empty note added, then dropped) leaves no step.
      if (JSON.stringify(next) === JSON.stringify(last.before)) this.past.pop();
      return false;
    }
    this.past.push({ before, key: opts.coalesce?.key, at: now });
    if (this.past.length > HISTORY_CAP) this.past.shift();
    this.future = [];
    return true;
  }

  /** Whether the last step is still open to this key: the field is being typed in. */
  isOpen(key: string, within: number) {
    const last = this.past.at(-1);
    return Boolean(last && last.key === key && Date.now() - last.at < within);
  }

  undo(): Asset[] | undefined {
    const step = this.past.pop();
    if (!step) return undefined;
    this.future.push(this.current);
    this.current = step.before;
    return this.current;
  }

  redo(): Asset[] | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push({ before: this.current, at: 0 });
    this.current = next;
    return this.current;
  }

  /** Every asset id some snapshot still holds, so its image must stay in the browser. */
  liveIds(): Set<string> {
    const ids = new Set<string>();
    for (const list of [this.current, ...this.past.map((s) => s.before), ...this.future])
      for (const a of list) ids.add(a.id);
    return ids;
  }
}

/** How long typing in one field keeps adding to the same step. */
const TYPING_PAUSE = 800;
/** A drag or a run of arrow presses on one note is one step. */
const DRAG_PAUSE = 250;

/** A key in a shortcut hint. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </kbd>
  );
}

/** A short-lived "working" state: a pill with a spinner, which reduced motion hides. */
function WorkingPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin motion-reduce:hidden" aria-hidden />
      {children}
    </span>
  );
}

/** Whether to show ⌘ or Ctrl in shortcut hints; read after mount so the server and client agree. */
function useIsMac() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);
  return mac;
}

/** Per-browser settings; storage may be unavailable, which only loses the convenience. */
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
const SUGGEST_KEY = 'pinch-suggestions';
const SENT_KEY = 'pinch-sent';
/** Images removed from the session but kept for Undo; deleted on the next visit if still listed. */
const ORPHANS_KEY = 'pinch-orphans';

/** Whether the clipboard takes images as well as text here. */
const canCopyImages = () =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/** The marked copies are JPEG; the clipboard wants PNG. */
async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await bitmapOf(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not draw the image.'))),
      'image/png',
    ),
  );
}

/** The next source when S is pressed: through the four kinds, then none. */
function nextSource(source: Source | undefined): Source | undefined {
  const at = source ? SOURCES.findIndex((s) => s.kind === source.kind) : -1;
  const next = SOURCES[at + 1];
  return next ? { kind: next.kind, by: source?.by ?? '', link: source?.link ?? '' } : undefined;
}

/**
 * Pinch needs a pointer and room: drawing on an image, side by side with its notes. Under 768px
 * wide it shows one message instead, in the style of yair-works.vercel.app's: a black screen,
 * the line centred in a frame marked by four small squares.
 */
function DesktopOnly() {
  const corner = 'absolute size-1 bg-white';
  return (
    <div
      role="status"
      className="fixed inset-0 z-[100] hidden bg-black text-center text-[13px] leading-[1.2] tracking-[-0.01em] text-white max-md:block"
    >
      <div className="absolute inset-x-3 top-1/2 flex h-28 -translate-y-1/2 items-center justify-center px-10">
        <span aria-hidden className={cn(corner, '-top-0.5 -left-0.5')} />
        <span aria-hidden className={cn(corner, '-top-0.5 -right-0.5')} />
        <span aria-hidden className={cn(corner, '-bottom-0.5 -left-0.5')} />
        <span aria-hidden className={cn(corner, '-right-0.5 -bottom-0.5')} />
        <p className="m-0">
          This experience was designed for desktop.
          <br />
          Please revisit from a larger screen.
        </p>
      </div>
    </div>
  );
}

export function PinApp() {
  return (
    <>
      <DesktopOnly />
      <div className="max-md:hidden">
        <Workspace />
      </div>
    </>
  );
}

function Workspace() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [locating, setLocating] = useState<Set<string>>(new Set());
  // Suggestions: available on the server, and on in this browser (the default).
  const [suggestAvailable, setSuggestAvailable] = useState(false);
  const [suggestPref, setSuggestPref] = useState(true);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const suggestStopped = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyMenu, setCopyMenu] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  // What a drag draws: a dot or area (Pin), or an arrow. Per visit; A toggles it, Esc leaves it.
  const [tool, setTool] = useState<Tool>('pin');
  const history = useRef<History>(null as unknown as History);
  history.current ??= new History();
  // The latest session, kept in step with history so handlers never read a stale render.
  const assetsRef = useRef(assets);
  const indexRef = useRef(index);
  indexRef.current = index;
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const suggestionsOn = suggestAvailable && suggestPref;
  const mac = useIsMac();

  /**
   * Images that left the session but may come back with Undo keep their Blob and URL. Once no
   * snapshot holds an image any more, it goes. The ids waiting are also noted per browser, so a
   * visit that ends mid-way cleans up next time.
   */
  const collect = useCallback(() => {
    const live = history.current.liveIds();
    const current = new Set(history.current.current.map((a) => a.id));
    const waiting: string[] = [];
    for (const id of Object.keys(urlsRef.current)) {
      if (live.has(id)) {
        if (!current.has(id)) waiting.push(id);
        continue;
      }
      URL.revokeObjectURL(urlsRef.current[id]);
      store.deleteImage(id).catch(() => undefined);
      setUrls((u) => {
        const { [id]: _, ...rest } = u;
        return rest;
      });
    }
    local.set(ORPHANS_KEY, JSON.stringify(waiting));
  }, []);

  /** Every change to the session goes through here, so it can be undone. */
  const commit = useCallback(
    (
      change: Asset[] | ((list: Asset[]) => Asset[]),
      opts: { coalesce?: Coalesce; silent?: boolean } = {},
    ) => {
      const h = history.current;
      const next = typeof change === 'function' ? change(h.current) : change;
      const stepped = h.commit(next, opts);
      assetsRef.current = next;
      setAssets(next);
      // A new step closes an Undo offer for the one before it.
      if (stepped) setStatus((s) => (s?.action ? null : s));
      if (!opts.silent) collect();
      return stepped;
    },
    [collect],
  );

  /** Put the session as a whole back: after Undo or Redo. */
  const restore = useCallback(
    (list: Asset[] | undefined) => {
      if (!list) return;
      assetsRef.current = list;
      setAssets(list);
      setIndex((i) => Math.max(0, Math.min(i, list.length - 1)));
      setSelected((s) => (s && list.some((a) => a.marks.some((m) => m.id === s)) ? s : null));
      setStatus((s) => (s?.action ? null : s));
      collect();
    },
    [collect],
  );
  const undo = useCallback(() => restore(history.current.undo()), [restore]);
  const redo = useCallback(() => restore(history.current.redo()), [restore]);

  // Load the saved session, and whether the AI step is on.
  useEffect(() => {
    (async () => {
      try {
        // Images a previous visit removed and never got to delete.
        try {
          const orphans = JSON.parse(local.get(ORPHANS_KEY) ?? '[]') as string[];
          const saved = new Set((await store.loadAssets()).map((a) => a.id));
          for (const id of orphans) if (!saved.has(id)) await store.deleteImage(id);
        } catch {}
        local.set(ORPHANS_KEY, '[]');
        const saved = await store.loadAssets();
        const next: Record<string, string> = {};
        for (const a of saved) {
          const blob = await store.getImage(a.id);
          if (blob) next[a.id] = URL.createObjectURL(blob);
        }
        const kept = saved.filter((a) => next[a.id]);
        history.current.reset(kept);
        assetsRef.current = kept;
        setAssets(kept);
        setUrls(next);
      } catch {
        setStatus({
          tone: 'error',
          text: "This browser won't keep a session; export before you close the tab.",
        });
      } finally {
        setLoaded(true);
      }
    })();
    fetch('/api/pin/locate')
      .then((r) => r.json())
      .then((r) => setAiOn(Boolean(r.available)))
      .catch(() => setAiOn(false));
    fetch('/api/pin/suggest')
      .then((r) => r.json())
      .then((r) => setSuggestAvailable(Boolean(r.available)))
      .catch(() => setSuggestAvailable(false));
    setSuggestPref(local.get(SUGGEST_KEY) !== 'off');
  }, []);

  // An information toast goes by itself, staying longer the more it says; an error stays until
  // dismissed. One with an Undo button stays a little longer.
  useEffect(() => {
    if (status?.tone !== 'info') return;
    const timer = setTimeout(
      () => setStatus(null),
      status.action ? 8000 : Math.max(5000, status.text.length * 60),
    );
    return () => clearTimeout(timer);
  }, [status]);

  // "Copied" on the button, then back to its name.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  // Save on every change. One write at a time; changes made meanwhile go in the next one, so
  // closing the tab right after an edit loses nothing.
  const saving = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const persist = useCallback(() => {
    if (saving.current) {
      dirty.current = true;
      return;
    }
    saving.current = store
      .saveAssets(assetsRef.current)
      .then(() => undefined)
      .catch(() =>
        setStatus({
          tone: 'error',
          text: "Couldn't save in this browser. Export to keep your notes.",
        }),
      )
      .finally(() => {
        saving.current = null;
        if (dirty.current) {
          dirty.current = false;
          persist();
        }
      });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: persist reads the ref; this runs on every change to assets
  useEffect(() => {
    if (loaded) persist();
  }, [assets, loaded, persist]);

  // The text of written notes is saved anonymously: a few seconds after typing stops, and when the
  // tab is hidden or closed. Each note is sent again only when its text changed.
  const sent = useRef<Record<string, string> | null>(null);
  const sendingNotes = useRef(false);
  const flushNotes = useCallback((leaving = false) => {
    if (!sent.current) {
      try {
        sent.current = JSON.parse(local.get(SENT_KEY) ?? '{}');
      } catch {
        sent.current = {};
      }
    }
    const done = sent.current ?? {};
    const entries = logEntries(assetsRef.current);
    const changed = changedEntries(entries, done);
    if (!changed.length || (sendingNotes.current && !leaving)) return;
    sendingNotes.current = true;
    const batches: (typeof changed)[] = [];
    for (let i = 0; i < changed.length; i += MAX_BATCH)
      batches.push(changed.slice(i, i + MAX_BATCH));
    Promise.all(
      batches.map((batch) =>
        fetch('/api/pin/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: batch }),
          keepalive: leaving,
        })
          .then((r) => {
            if (!r.ok) return;
            for (const e of batch) done[e.id] = fingerprint(e);
          })
          .catch(() => undefined),
      ),
    ).finally(() => {
      sendingNotes.current = false;
      // Keep only notes that still exist, so the record stays small.
      const live = new Set(logEntries(assetsRef.current).map((e) => e.id));
      for (const id of Object.keys(done)) if (!live.has(id)) delete done[id];
      local.set(SENT_KEY, JSON.stringify(done));
    });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts the wait on every change to assets
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(flushNotes, 6000);
    return () => clearTimeout(timer);
  }, [assets, loaded, flushNotes]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushNotes(true);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushNotes]);

  const asset = assets[index] as Asset | undefined;

  const update = useCallback(
    (id: string, change: (a: Asset) => Asset, opts?: { coalesce?: Coalesce; silent?: boolean }) =>
      commit((list) => list.map((a) => (a.id === id ? change(a) : a)), opts),
    [commit],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const all = files.filter((f) => f.type.startsWith('image/'));
      if (!all.length) return;
      // A session holds up to MAX_IMAGES; what doesn't fit is left out, and the message says so.
      const room = MAX_IMAGES - assetsRef.current.length;
      if (room <= 0) {
        setStatus({ tone: 'error', text: FULL_MESSAGE });
        return;
      }
      const images = all.slice(0, room);
      const leftOut = all.length - images.length;
      setStatus({ tone: 'info', text: `Adding ${count(images.length, 'image')}…` });
      const added: Asset[] = [];
      const addedUrls: Record<string, string> = {};
      // New images take the open image's source: a batch is usually from one place. Not its link.
      const open = assetsRef.current[indexRef.current]?.source;
      const source: Source | undefined = open
        ? { kind: open.kind, by: open.by, link: '' }
        : undefined;
      for (const file of images) {
        try {
          const { blob, type, width, height } = await prepareImage(file);
          const id = newId();
          await store.putImage(id, blob);
          addedUrls[id] = URL.createObjectURL(blob);
          added.push({
            id,
            name: file.name || 'Pasted image.png',
            type,
            width,
            height,
            note: '',
            marks: [],
            ...(source ? { source } : {}),
          });
        } catch {
          setStatus({ tone: 'error', text: `Couldn't read ${file.name}.` });
        }
      }
      setUrls((u) => ({ ...u, ...addedUrls }));
      urlsRef.current = { ...urlsRef.current, ...addedUrls };
      // A fresh batch opens on its first image; added to work in progress, the place is kept.
      const before = assetsRef.current;
      if (!before.some(hasNotes)) setIndex(before.length);
      commit((list) => [...list, ...added]);
      if (leftOut) {
        setStatus({
          tone: 'error',
          text: `Added ${count(added.length, 'image')}; ${count(leftOut, 'image')} left out. ${FULL_MESSAGE}`,
        });
        return;
      }
      setStatus({
        tone: 'info',
        text: before.length
          ? `Added ${count(added.length, 'image')}.`
          : `Added ${count(added.length, 'image')}. Click the image for a dot, drag across it for an area, or Shift-drag for an arrow, then say what works and what doesn’t.`,
      });
    },
    [commit],
  );

  // The site's shell opens a docs search on ⌘K; Pinch is its own site, so that key does nothing here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // Drop anywhere, or paste a screenshot. While files are dragged over the window the landing
  // card shows it; dragover keeps firing during a drag, so a short silence means it ended.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
      clearTimeout(quiet);
      quiet = setTimeout(() => setDragging(false), 200);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      clearTimeout(quiet);
      setDragging(false);
      addFiles([...(e.dataTransfer?.files ?? [])]);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) addFiles(files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      clearTimeout(quiet);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [addFiles]);

  /**
   * Leaving a note with nothing written drops it, like a cancelled draft. The drop joins the
   * step that added the note, so the two cancel out and Undo has nothing to put back.
   */
  const deselect = useCallback(() => {
    if (asset && selected) {
      const mark = asset.marks.find((m) => m.id === selected);
      if (mark && verdictOf(mark) === 'empty' && !mark.label.trim()) {
        update(asset.id, (a) => ({ ...a, marks: a.marks.filter((m) => m.id !== selected) }), {
          coalesce: { key: `mark:${selected}`, within: Number.POSITIVE_INFINITY },
        });
      }
    }
    setSelected(null);
  }, [asset, selected, update]);

  const go = useCallback(
    (to: number) => {
      if (!assets.length) return;
      deselect();
      setIndex(Math.min(assets.length - 1, Math.max(0, to)));
    },
    [assets.length, deselect],
  );

  const removeMark = useCallback(
    (id: string) => {
      if (!asset) return;
      update(asset.id, (a) => ({ ...a, marks: a.marks.filter((m) => m.id !== id) }));
      setSelected(null);
      setStatus({ tone: 'info', text: 'Note deleted.', action: { label: 'Undo', run: undo } });
    },
    [asset, update, undo],
  );

  const addMark = useCallback(
    (shape: Shape) => {
      if (!asset) return;
      const mark: Mark = { id: newId(), shape, label: '', good: '', bad: '', origin: 'user' };
      deselect();
      update(asset.id, (a) => ({ ...a, marks: [...a.marks, mark] }), {
        coalesce: { key: `mark:${mark.id}`, within: 0 },
      });
      setSelected(mark.id);
    },
    [asset, deselect, update],
  );

  /** A move or resize in progress joins one step; a text edit joins the typing before it. */
  const changeMark = (id: string, change: Partial<Mark>) => {
    if (!asset) return;
    const field = (['good', 'bad', 'label'] as const).find((f) => f in change);
    const coalesce: Coalesce | undefined =
      'shape' in change
        ? { key: `shape:${id}`, within: DRAG_PAUSE }
        : field
          ? { key: `text:${id}:${field}`, within: TYPING_PAUSE }
          : undefined;
    update(
      asset.id,
      (a) => ({ ...a, marks: a.marks.map((m) => (m.id === id ? { ...m, ...change } : m)) }),
      { coalesce },
    );
  };

  const setSource = useCallback(
    (source: Source | undefined) => {
      if (!asset) return;
      // Typing a maker or link is one step per pause, like a note's text.
      const typed =
        source && asset.source && source.kind === asset.source.kind
          ? source.by !== asset.source.by
            ? 'by'
            : 'link'
          : undefined;
      update(asset.id, (a) => ({ ...a, source }), {
        coalesce: typed ? { key: `source:${asset.id}:${typed}`, within: TYPING_PAUSE } : undefined,
      });
    },
    [asset, update],
  );
  const setSourceForAll = () => {
    const source = asset?.source;
    if (!source) return;
    commit((list) =>
      list.map((a) => ({
        ...a,
        source: { kind: source.kind, by: source.by, link: a.source?.link ?? '' },
      })),
    );
    setStatus({
      tone: 'info',
      text: `Set ${count(assets.length, 'image')} to ${sourceLabel(source.kind)}.`,
    });
  };

  // Keys: arrows or J/K move between images, 1–9 open a note, N adds one, A toggles the Arrow
  // tool, S cycles the source, Delete removes the open note, Escape closes it (then leaves the
  // Arrow tool), ⌘Z and ⇧⌘Z undo and redo, ? lists them all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (shortcuts) {
          setShortcuts(false);
          return;
        }
        if (isTyping(e.target)) (e.target as HTMLElement).blur();
        else if (!selected && tool === 'arrow') setTool('pin');
        deselect();
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || key === 'y')) {
        const isRedo = key === 'y' || e.shiftKey;
        // While a field is still being typed in, the browser's own undo keeps the keystrokes.
        if (isTyping(e.target) && !isRedo) {
          const el = e.target as HTMLElement;
          const field = el.id.match(/^(works|doesnt|label)-(.+)$/);
          const openKey = field
            ? `text:${field[2]}:${{ works: 'good', doesnt: 'bad', label: 'label' }[field[1]]}`
            : el.id === 'whole-note' && asset
              ? `note:${asset.id}`
              : null;
          if (openKey && history.current.isOpen(openKey, TYPING_PAUSE)) return;
        }
        e.preventDefault();
        if (isRedo) redo();
        else undo();
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcuts((s) => !s);
        return;
      }
      if (shortcuts) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        removeMark(selected);
        return;
      }
      if (asset && /^[1-9]$/.test(e.key)) {
        const mark = asset.marks[Number(e.key) - 1];
        if (!mark) return;
        e.preventDefault();
        if (mark.id !== selected) deselect();
        setSelected(mark.id);
        return;
      }
      if (asset && key === 'n') {
        e.preventDefault();
        addMark({ kind: 'dot', x: 0.5, y: 0.5 });
        return;
      }
      if (asset && key === 'a') {
        e.preventDefault();
        const next: Tool = tool === 'arrow' ? 'pin' : 'arrow';
        setTool(next);
        setStatus({
          tone: 'info',
          text:
            next === 'arrow'
              ? 'Arrow tool: drag from one spot to another. Esc or A goes back to Pin.'
              : 'Pin tool: click for a dot, drag for an area.',
        });
        return;
      }
      if (asset && key === 's') {
        e.preventDefault();
        const next = nextSource(asset.source);
        setSource(next);
        setStatus({
          tone: 'info',
          text: next ? `Source: ${sourceLabel(next.kind)}.` : 'Source cleared.',
        });
        return;
      }
      // Arrow keys on a focused mark move the mark instead.
      if ((e.target as HTMLElement)?.closest?.('[data-mark]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || key === 'j') go(index + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || key === 'k') go(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    go,
    index,
    selected,
    deselect,
    removeMark,
    addMark,
    setSource,
    asset,
    shortcuts,
    tool,
    undo,
    redo,
  ]);

  const toggleSuggestions = () => {
    const next = !suggestPref;
    setSuggestPref(next);
    local.set(SUGGEST_KEY, next ? 'on' : 'off');
  };

  // Suggest what works and what doesn't for the open note while it's empty, once it stops moving.
  const openMark = asset?.marks.find((m) => m.id === selected);
  const wanted =
    suggestionsOn && asset && openMark && needsSuggestion(openMark)
      ? `${asset.id}/${openMark.id}/${shapeKey(openMark.shape)}`
      : null;
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [assetId, markId, shape] = wanted.split('/');
      const target = assetsRef.current.find((a) => a.id === assetId);
      const mark = target?.marks.find((m) => m.id === markId);
      if (!target || !mark || suggestStopped.current) return;
      setSuggesting(markId);
      try {
        const blob = await store.getImage(assetId);
        if (!blob) return;
        const bitmap = await bitmapOf(blob);
        const number = target.marks.indexOf(mark) + 1;
        const [crop, context] = [
          await cropForAi(bitmap, mark, number),
          await contextForAi(bitmap, mark, number),
        ];
        bitmap.close();
        const form = new FormData();
        form.set('image', crop, 'crop.jpg');
        form.set('context', context, 'context.jpg');
        form.set('label', mark.label);
        form.set('shape', mark.shape.kind);
        if (target.source) form.set('source', target.source.kind);
        const res = await fetch('/api/pin/suggest', { method: 'POST', body: form });
        // Out of budget or switched off on the server: stop asking for this visit.
        if (res.status === 429 || res.status === 503) suggestStopped.current = true;
        if (!res.ok || cancelled) return;
        const result = (await res.json()) as SuggestResult;
        const suggestion: Suggestion = { ...result, shape };
        const withSuggestion = (a: Asset) => ({
          ...a,
          marks: a.marks.map((m) =>
            m.id === markId && shapeKey(m.shape) === shape ? { ...m, suggestion } : m,
          ),
        });
        // A suggestion arriving is not a step; it also goes into the snapshots, so an undone
        // and redone note doesn't ask again.
        update(assetId, withSuggestion, { silent: true });
        const h = history.current;
        const patch = (list: Asset[]) =>
          list.map((a) => (a.id === assetId ? withSuggestion(a) : a));
        for (const step of h.past) step.before = patch(step.before);
        h.future = h.future.map(patch);
      } catch {
        // No suggestion this time; the note works the same without one.
      } finally {
        setSuggesting((s) => (s === markId ? null : s));
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wanted, update]);

  const locate = async (target: Asset) => {
    const note = target.note.trim();
    if (!note) return;
    setLocating((s) => new Set(s).add(target.id));
    try {
      const blob = await store.getImage(target.id);
      if (!blob) throw new Error('The image is missing.');
      const small = await imageForAi(blob);
      const form = new FormData();
      form.set('image', small.blob, 'image.jpg');
      form.set('width', String(small.width));
      form.set('height', String(small.height));
      form.set('note', note);
      const res = await fetch('/api/pin/locate', { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(body?.error ?? "Couldn't place the notes. Try again in a moment.");
      const result = body as LocateResult;
      const placed = toMarks(result, small.width, small.height, newId);
      // A new run replaces the AI's unchecked marks from the last one; checked and own marks stay.
      // One step per image placed, so Undo takes the whole placement back.
      update(target.id, (a) => ({
        ...a,
        marks: [...a.marks.filter((m) => m.origin === 'user' || m.confirmed), ...placed],
        locatedNote: note,
        unplaced: result.unplaced,
      }));
      return placed.length;
    } finally {
      setLocating((s) => {
        const next = new Set(s);
        next.delete(target.id);
        return next;
      });
    }
  };

  const locateOne = async () => {
    if (!asset) return;
    try {
      const n = await locate(asset);
      setStatus({
        tone: 'info',
        text: `Placed ${count(n ?? 0, 'note')}. Check each one and move it if it's off.`,
      });
    } catch (e) {
      setStatus({ tone: 'error', text: (e as Error).message });
    }
  };

  const pending = assets.filter((a) => a.note.trim() && a.note.trim() !== a.locatedNote);
  const locateAll = async () => {
    let placed = 0;
    for (const [i, a] of pending.entries()) {
      setStatus({ tone: 'info', text: `Placing notes: image ${i + 1} of ${pending.length}…` });
      try {
        placed += (await locate(a)) ?? 0;
      } catch (e) {
        setStatus({ tone: 'error', text: (e as Error).message });
        return;
      }
    }
    setStatus({
      tone: 'info',
      text: `Placed ${count(placed, 'note')} on ${count(pending.length, 'image')}. Check them before you export.`,
    });
  };

  const tagged = assets.filter(hasNotes);
  const allMarks = tagged.flatMap((a) => a.marks.filter((m) => verdictOf(m) !== 'empty'));
  const unchecked = allMarks.filter((m) => m.origin === 'ai' && !m.confirmed).length;

  const exportZip = async () => {
    if (!tagged.length) {
      setStatus({ tone: 'error', text: 'Write a note on at least one image first.' });
      return;
    }
    deselect();
    try {
      const { blob, name } = await buildExport(assets, store.getImage, (done, total) =>
        setExporting(`Preparing ${Math.min(done + 1, total)} of ${total}…`),
      );
      download(blob, name);
      const skipped = assets.length - tagged.length;
      setStatus({
        tone: 'info',
        text: `Exported ${count(tagged.length, 'image')} and ${count(allMarks.length, 'note')}${skipped ? `; ${count(skipped, 'image')} without notes left out` : ''}. The zip holds README.md and notes.json, your images, a marked copy of each, and a close-up of every note. Give your agent the whole folder, starting with README.md.`,
      });
    } catch (e) {
      setStatus({ tone: 'error', text: (e as Error).message });
    } finally {
      setExporting(null);
    }
  };

  /** The whole batch as text, for a chat that takes no image or an agent that reads files. */
  const copyAllAsText = async () => {
    setCopyMenu(false);
    try {
      await navigator.clipboard.writeText(batchSummary(assets));
      setCopied(true);
      setStatus({
        tone: 'info',
        text: `Copied ${count(allMarks.length, 'note')} on ${count(tagged.length, 'image')} as text. The marked images are in the zip export.`,
      });
    } catch {
      setStatus({ tone: 'error', text: "The browser didn't allow copying." });
    }
  };

  /**
   * The open image with its notes drawn on, as PNG, and a short summary as text, in one
   * clipboard item: pasted into a chat, the agent gets both. A browser that takes only text
   * gets the summary, and the toast says so.
   */
  const copyForAgent = async () => {
    if (!asset) return;
    const target = asset;
    const text = imageSummary(target, index, assets.length);
    const notes = target.marks.filter((m) => verdictOf(m) !== 'empty').length;
    const image = async () => {
      const blob = await store.getImage(target.id);
      if (!blob) throw new Error('The image is missing.');
      if (!notes) return toPng(blob);
      const bitmap = await bitmapOf(blob);
      try {
        return await toPng(await markedImage(bitmap, target));
      } finally {
        bitmap.close();
      }
    };
    try {
      if (!canCopyImages()) throw new Error('text only');
      // Promises keep the write inside the click, which Safari asks for.
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': image(),
          'text/plain': Promise.resolve(new Blob([text], { type: 'text/plain' })),
        }),
      ]);
      setCopied(true);
      setStatus({
        tone: 'info',
        text: notes
          ? `Copied the image with ${count(notes, 'note')} drawn on, and the notes as text. Paste both into the agent.`
          : 'Copied the image and its name as text; it has no notes yet.',
      });
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setStatus({
          tone: 'info',
          text: "Copied the notes as text; this browser didn't allow copying the image with them.",
        });
      } catch {
        setStatus({ tone: 'error', text: "The browser didn't allow copying." });
      }
    }
  };

  /** The image leaves the session; its file stays in the browser while Undo can bring it back. */
  const removeAsset = (id: string) => {
    const name = assets.find((a) => a.id === id)?.name ?? 'image';
    commit((list) => list.filter((a) => a.id !== id));
    setIndex((i) => Math.max(0, Math.min(i, assets.length - 2)));
    setSelected(null);
    setStatus({
      tone: 'info',
      text: `Removed ${name}.`,
      action: { label: 'Undo', run: undo },
    });
  };

  const startOver = () => {
    const images = assets.length;
    const notes = allMarks.length;
    commit([]);
    setIndex(0);
    setSelected(null);
    setStatus({
      tone: 'info',
      text: `Removed ${count(images, 'image')} and ${count(notes, 'note')}.`,
      action: { label: 'Undo', run: undo },
    });
  };

  // The landing: no image yet, so the header floats over the painting in two glass pills.
  const landing = loaded && !asset;

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header
        className={cn(
          'flex h-14 shrink-0 items-center gap-3 px-4',
          landing ? 'absolute inset-x-0 top-0 z-10 h-16 px-5' : 'border-b border-border',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2.5',
            landing &&
              'h-9 rounded-full bg-background/80 px-3.5 shadow-sm ring-1 ring-border/70 backdrop-blur-md',
          )}
        >
          <PinchWordmark className="h-[15px]" />
        </div>
        <div
          className={cn(
            'ml-auto flex items-center gap-2',
            landing &&
              'gap-0.5 rounded-full bg-background/80 p-1 shadow-sm ring-1 ring-border/70 backdrop-blur-md',
          )}
        >
          {assets.length > 0 && (
            <p className="m-0 mr-2 text-[13px] text-muted-foreground" aria-live="polite">
              {tagged.length} of {assets.length} tagged · {count(allMarks.length, 'note')}
              {unchecked ? ` · ${unchecked} to check` : ''}
            </p>
          )}
          {aiOn && pending.length > 1 && (
            <ToolbarButton onClick={locateAll} disabled={locating.size > 0}>
              Place notes on {count(pending.length, 'image')}
            </ToolbarButton>
          )}
          {suggestAvailable && assets.length > 0 && (
            <label
              htmlFor="suggestions"
              className="flex min-h-9 items-center gap-2 px-1 text-sm"
              title="Grey suggestions in empty notes; Tab takes one"
            >
              <Switch
                id="suggestions"
                size="sm"
                checked={suggestPref}
                onCheckedChange={toggleSuggestions}
              />
              Suggestions
            </label>
          )}
          {assets.length > 0 && (
            <TooltipProvider>
              <div className="relative flex items-center">
                <ToolbarButton
                  onClick={(e) => (e.shiftKey ? copyAllAsText() : copyForAgent())}
                  title="Copy the open image with its notes drawn on, plus the notes as text. Shift-click: all notes as text."
                  aria-live="polite"
                  className="min-w-[8.75rem] justify-center rounded-r-none"
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                  {copied ? 'Copied' : 'Copy for agent'}
                </ToolbarButton>
                <ToolbarButton
                  aria-label="More ways to copy"
                  aria-haspopup="menu"
                  aria-expanded={copyMenu}
                  onClick={() => setCopyMenu((m) => !m)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && !copyMenu) {
                      e.preventDefault();
                      setCopyMenu(true);
                    }
                  }}
                  className="-ml-px rounded-l-none px-1.5"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </ToolbarButton>
                {copyMenu && (
                  <CopyMenu
                    onClose={() => setCopyMenu(false)}
                    items={[
                      {
                        label: 'Copy all notes as text',
                        hint: `${count(allMarks.length, 'note')} on ${count(tagged.length, 'image')}`,
                        run: copyAllAsText,
                        disabled: !tagged.length,
                      },
                    ]}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={exportZip}
                disabled={Boolean(exporting)}
                className="flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-60"
              >
                <Download className="size-4" aria-hidden />
                {exporting ?? 'Export for agent'}
              </button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Keyboard shortcuts"
                      aria-expanded={shortcuts}
                      data-shortcuts-trigger
                      onClick={() => setShortcuts((s) => !s)}
                      className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Keyboard className="size-4" aria-hidden />
                    </button>
                  }
                />
                <TooltipContent>
                  Keyboard shortcuts <Kbd>?</Kbd>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <ThemeToggle />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </header>

      {status && (
        // A toast: it floats over the page, so a message never moves the layout.
        <div
          role={status.tone === 'error' ? 'alert' : 'status'}
          className="fixed bottom-4 left-1/2 z-30 flex w-max max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground shadow-lg dark:shadow-none"
        >
          <span className="min-w-0 flex-1">{status.text}</span>
          {status.action && (
            <button
              type="button"
              onClick={() => {
                status.action?.run();
                setStatus(null);
              }}
              className="flex min-h-8 shrink-0 items-center rounded-md border border-border px-2.5 text-sm font-medium hover:bg-muted"
            >
              {status.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setStatus(null)}
            className="-mr-2 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {!loaded ? null : !asset ? (
        <EmptyState dragging={dragging} onChoose={() => fileInput.current?.click()} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Filmstrip
            assets={assets}
            urls={urls}
            index={index}
            onPick={go}
            onAdd={() => fileInput.current?.click()}
            onStartOver={startOver}
          />
          <Stage
            key={asset.id}
            asset={asset}
            url={urls[asset.id]}
            selected={selected}
            tool={tool}
            onTool={setTool}
            onSelect={(id) => {
              if (id !== selected) deselect();
              setSelected(id);
            }}
            onAdd={addMark}
            onChange={changeMark}
          />
          <Panel
            key={`panel-${asset.id}`}
            asset={asset}
            number={index + 1}
            total={assets.length}
            selected={selected}
            aiOn={aiOn}
            locating={locating.has(asset.id)}
            suggestionsOn={suggestionsOn}
            suggesting={suggesting}
            onSource={setSource}
            onSourceForAll={setSourceForAll}
            onSelect={(id) => {
              if (id !== selected) deselect();
              setSelected(id);
            }}
            onChangeMark={changeMark}
            onRemoveMark={removeMark}
            onDone={deselect}
            onNote={(note) =>
              update(asset.id, (a) => ({ ...a, note }), {
                coalesce: { key: `note:${asset.id}`, within: TYPING_PAUSE },
              })
            }
            onLocate={locateOne}
            onAddCentre={() => addMark({ kind: 'dot', x: 0.5, y: 0.5 })}
            onPrev={() => go(index - 1)}
            onNext={() => go(index + 1)}
            onRemove={() => removeAsset(asset.id)}
          />
        </div>
      )}
      {shortcuts && <ShortcutsDialog mac={mac} onClose={() => setShortcuts(false)} />}
    </div>
  );
}

/** A one-column menu under the copy button; Escape, a click outside or a choice closes it. */
function CopyMenu({
  items,
  onClose,
}: {
  items: { label: string; hint?: string; run: () => void; disabled?: boolean }[];
  onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [onClose]);
  return (
    <div
      ref={box}
      role="menu"
      aria-label="More ways to copy"
      className="absolute top-full right-0 z-30 mt-1 min-w-56 rounded-lg border border-border bg-background p-1 shadow-lg dark:shadow-none"
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={i === 0 ? first : undefined}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={item.run}
          className="flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
        >
          {item.label}
          {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Every key, by group. A row lists alternatives; each alternative is the keys pressed together. */
type ShortcutRow = { combos: string[][]; join?: 'or' | 'to'; what: string };
const SHORTCUTS: { group: string; rows: ShortcutRow[] }[] = [
  {
    group: 'Images',
    rows: [
      {
        combos: [
          ['←', '→'],
          ['J', 'K'],
        ],
        join: 'or',
        what: 'Previous or next image',
      },
      { combos: [['⌘', 'V']], what: 'Paste a screenshot' },
    ],
  },
  {
    group: 'Notes',
    rows: [
      { combos: [['1'], ['9']], join: 'to', what: 'Open note 1 to 9 on this image' },
      { combos: [['N']], what: 'Add a note at the centre' },
      { combos: [['⇧', 'Drag']], what: 'Draw an arrow from one spot to another' },
      { combos: [['A']], what: 'Arrow tool on or off: every drag draws an arrow' },
      { combos: [['S']], what: 'Cycle the source: Ours, Competitor, Other product, Concept, none' },
      { combos: [['Delete']], what: 'Delete the open note' },
      { combos: [['Esc']], what: 'Close the note, leave a field, or leave the Arrow tool' },
    ],
  },
  {
    group: 'On a focused pin, or an arrow’s tail or head',
    rows: [
      { combos: [['Arrows']], what: 'Move it 1%' },
      { combos: [['⇧', 'Arrows']], what: 'Move it 5%' },
      { combos: [['Enter']], what: 'Open its note' },
    ],
  },
  {
    group: 'In a field',
    rows: [
      { combos: [['Tab']], what: 'Take the grey suggestion' },
      { combos: [['⌘', 'Enter']], what: 'Done with this note' },
    ],
  },
  {
    group: 'Session',
    rows: [
      { combos: [['⌘', 'Z']], what: 'Undo' },
      { combos: [['⇧', '⌘', 'Z']], what: 'Redo' },
      { combos: [['⇧', 'Click']], what: 'On Copy for agent: copy all notes as text' },
      { combos: [['?']], what: 'These shortcuts' },
    ],
  },
];

/** The shortcuts, in a small dialog; Escape, the backdrop or the close button shuts it. */
function ShortcutsDialog({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => {
      // Back to the button or key that opened it.
      (opener?.isConnected
        ? opener
        : document.querySelector<HTMLElement>('[data-shortcuts-trigger]')
      )?.focus();
    };
  }, []);
  const show = (k: string) => (mac ? k : k === '⌘' ? 'Ctrl' : k === '⇧' ? 'Shift' : k);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative w-full max-w-md rounded-xl border border-border bg-background p-5 text-sm shadow-lg dark:shadow-none"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 id="shortcuts-title" className="m-0 text-sm font-medium">
            Keyboard shortcuts
          </h2>
          <button
            ref={close}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3 className="m-0 mb-1.5 text-[13px] font-medium text-muted-foreground">
                {g.group}
              </h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                {g.rows.map((row) => (
                  <div key={row.what} className="contents">
                    <dt className="flex flex-wrap items-center gap-1">
                      {row.combos.map((combo, j) => (
                        <span key={combo.join('+')} className="flex items-center gap-1">
                          {j > 0 && (
                            <span className="text-[13px] text-muted-foreground">{row.join}</span>
                          )}
                          {combo.map((k) => (
                            <Kbd key={k}>{show(k)}</Kbd>
                          ))}
                        </span>
                      ))}
                    </dt>
                    <dd className="m-0 text-[13px]">{row.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="mt-4 mb-0 text-xs text-muted-foreground">
          None of these fire while you type in a field; <Kbd>Esc</Kbd> leaves it first.
        </p>
      </div>
    </div>
  );
}

function ToolbarButton({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

/*
 * The landing: the painting fills the page, the same in both themes, and a
 * dark glass card sits in the middle. The card is always dark, so its text
 * colours are fixed, not the theme's: #f5f5f5 and #c4c4c4 on the card's
 * near-black keep 4.5:1 with the painting showing through.
 */
/** How far the painting drifts against the pointer, in px at the screen's edge. */
const PARALLAX = { x: 44, y: 28 };
/** The painting is drawn this much larger, so its edges never show as it drifts. */
const PARALLAX_SCALE = 1.1;

function EmptyState({ dragging, onChoose }: { dragging: boolean; onChoose: () => void }) {
  // Parallax: the painting drifts a little against the pointer, eased so it glides. Still under
  // reduced motion.
  const painting = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = painting.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let target = { x: 0, y: 0 };
    let now = { x: 0, y: 0 };
    let frame = 0;
    const tick = () => {
      now = { x: now.x + (target.x - now.x) * 0.08, y: now.y + (target.y - now.y) * 0.08 };
      el.style.transform = `translate3d(${now.x.toFixed(2)}px, ${now.y.toFixed(2)}px, 0) scale(${PARALLAX_SCALE})`;
      const left = Math.abs(target.x - now.x) + Math.abs(target.y - now.y);
      frame = left > 0.05 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      target = {
        x: -(e.clientX / window.innerWidth - 0.5) * PARALLAX.x,
        y: -(e.clientY / window.innerHeight - 0.5) * PARALLAX.y,
      };
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <section data-landing aria-label="Start" className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={painting}
        aria-hidden
        className="absolute inset-0 will-change-transform"
        style={{ transform: `scale(${PARALLAX_SCALE})` }}
      >
        <Image
          src="/pin-notes/landing.webp"
          alt=""
          fill
          preload
          sizes="100vw"
          quality={85}
          className="object-cover"
        />
      </div>
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.06)_30%,rgb(0_0_0/0.4)_100%)]"
      />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          <div className="flex flex-1 items-center justify-center px-6 pt-20 pb-8">
            {/*
             * The bezel: a liquid-glass frame around the card. A frosted, saturated blur of the
             * painting, a bright specular edge on the top-left and bottom-right (the masked
             * ring below), and light pooled along the inside edge.
             */}
            <div
              className={cn(
                'relative w-full max-w-[27rem] rounded-[2rem] bg-gradient-to-br from-white/30 via-white/[0.12] to-white/25 p-1.5 backdrop-blur-2xl backdrop-saturate-150 transition-[box-shadow,background-color] duration-300',
                'shadow-[inset_0_1px_1px_rgb(255_255_255/0.6),inset_0_-1px_1px_rgb(255_255_255/0.3),inset_0_0_18px_rgb(255_255_255/0.18),0_30px_80px_-20px_rgb(0_0_0/0.55)]',
                dragging && 'bg-white/40 ring-2 ring-white/80',
              )}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[inherit] p-px"
                style={{
                  background:
                    'linear-gradient(135deg, rgb(255 255 255 / 0.95), rgb(255 255 255 / 0) 32%, rgb(255 255 255 / 0) 66%, rgb(255 255 255 / 0.7))',
                  // Only the 1px edge shows: the middle is masked out.
                  WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
                  WebkitMaskComposite: 'xor',
                  mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
                }}
              />
              <div className="rounded-[1.625rem] bg-[#0e0e10]/90 px-7 pt-7 pb-6 text-[#f5f5f5] ring-1 ring-black/40">
                <DropFolder
                  active={dragging}
                  className="mx-auto -mt-2 mb-5 w-52 [@media(max-height:760px)]:w-44"
                />
                <h1 className="m-0 text-center text-[1.4rem] leading-snug font-normal tracking-tight text-balance">
                  Your taste, in everything your agent creates.
                </h1>
                <p className="mx-auto mt-2 mb-0 max-w-sm text-center text-sm leading-relaxed text-[#c4c4c4] text-balance">
                  Mark what you like and dislike on screenshots. Export your guidance for any AI
                  agent.
                </p>
                <div className="mt-5 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={onChoose}
                    className="flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <Plus className="size-4" aria-hidden />
                    Add images
                  </button>
                  <p
                    className="m-0 text-center text-[13px] leading-relaxed text-[#c4c4c4]"
                    aria-live="polite"
                  >
                    {dragging ? (
                      <span className="text-[#f5f5f5]">Drop to add them.</span>
                    ) : (
                      'Or drag images here or paste.'
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <p className="m-0 shrink-0 bg-gradient-to-t from-black/85 to-transparent px-6 pt-12 pb-4 text-center text-xs leading-relaxed text-white">
            <span className="mx-auto block max-w-3xl text-balance">
              Free, no account. Your images stay in this browser.
            </span>
            <span className="mx-auto mt-1 block">
              Created by{' '}
              <a
                href="https://yair-works.vercel.app"
                target="_blank"
                rel="noopener"
                className="underline underline-offset-2 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Yair Cohen
              </a>
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function Filmstrip({
  assets,
  urls,
  index,
  onPick,
  onAdd,
  onStartOver,
}: {
  assets: Asset[];
  urls: Record<string, string>;
  index: number;
  onPick: (i: number) => void;
  onAdd: () => void;
  onStartOver: () => void;
}) {
  const current = useRef<HTMLButtonElement>(null);
  // Keep the current image in view when it changes from the keyboard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the current image changes
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return (
    <nav aria-label="Images" className="flex w-52 shrink-0 flex-col border-r border-border">
      <ol className="m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto p-2">
        {assets.map((a, i) => {
          const marks = a.marks.filter((m) => verdictOf(m) !== 'empty');
          const good = marks.filter((m) => m.good.trim()).length;
          const bad = marks.filter((m) => m.bad.trim()).length;
          return (
            <li key={a.id}>
              <button
                ref={i === index ? current : undefined}
                type="button"
                aria-current={i === index ? 'true' : undefined}
                aria-label={`${i + 1}. ${a.name}, ${good} works, ${bad} doesn't`}
                onClick={() => onPick(i)}
                className={cn(
                  'relative flex w-full gap-2 rounded-lg p-1.5 text-left',
                  // The open image: a quiet fill and a 2px bar on its left edge.
                  i === index
                    ? 'bg-muted before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground before:content-[""]'
                    : 'hover:bg-muted',
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: a local image held by this browser */}
                <img
                  src={urls[a.id]}
                  alt=""
                  className="h-12 w-16 shrink-0 rounded object-cover object-top"
                />
                <span className="flex min-w-0 flex-col justify-center gap-0.5">
                  <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                    {hasNotes(a) && <Check className="size-3 text-foreground" aria-hidden />}
                  </span>
                  <span className="truncate text-[13px]">{a.name}</span>
                  {marks.length > 0 && (
                    <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{ background: VERDICT_COLOR.good }}
                        />
                        {good}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full"
                          style={{ background: VERDICT_COLOR.bad }}
                        />
                        {bad}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
        >
          <ImagePlus className="size-4" aria-hidden />
          Add more
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="size-4" aria-hidden />
          Start over
        </button>
      </div>
    </nav>
  );
}

/* ---------- Stage: the image and its marks ---------- */

/** What a drag on the image makes: a dot or an area (the default), or an arrow. */
type Tool = 'pin' | 'arrow';
const TOOLS: { kind: Tool; label: string; hint: string; icon: typeof MapPin }[] = [
  {
    kind: 'pin',
    label: 'Pin',
    hint: 'Click for a dot, drag for an area. Shift-drag for an arrow.',
    icon: MapPin,
  },
  {
    kind: 'arrow',
    label: 'Arrow',
    hint: 'Drag from one spot to another: "move this there", "align this with that". Key: A',
    icon: MoveUpRight,
  },
];

type ArrowEnd = 'tail' | 'head';

type Gesture =
  | {
      kind: 'draw';
      x0: number;
      y0: number;
      /** Drawing an arrow (the Arrow tool, or Shift held): the draft is a line, not a box. */
      asArrow: boolean;
      area: Area | null;
      arrow: Arrow | null;
      pointer: number;
    }
  | {
      kind: 'move';
      id: string;
      dx: number;
      dy: number;
      x0: number;
      y0: number;
      shape: Shape;
      moved: boolean;
    }
  | { kind: 'resize'; id: string; shape: Area }
  | { kind: 'end'; id: string; end: ArrowEnd; shape: Arrow };

function Stage({
  asset,
  url,
  selected,
  tool,
  onTool,
  onSelect,
  onAdd,
  onChange,
}: {
  asset: Asset;
  url: string;
  selected: string | null;
  tool: Tool;
  onTool: (tool: Tool) => void;
  onSelect: (id: string) => void;
  onAdd: (shape: Shape) => void;
  onChange: (id: string, change: Partial<Mark>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);

  // Fit the image inside the stage, whole.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const pad = 32;
      const aw = Math.max(0, el.clientWidth - pad * 2);
      const ah = Math.max(0, el.clientHeight - pad * 2);
      const scale = Math.min(aw / asset.width, ah / asset.height);
      setSize({ w: Math.floor(asset.width * scale), h: Math.floor(asset.height * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [asset.width, asset.height]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = frame.current?.getBoundingClientRect();
    if (!r) return { x: 0.5, y: 0.5 };
    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    };
  };

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = at(e);
    frame.current?.setPointerCapture(e.pointerId);
    setGesture({
      kind: 'draw',
      x0: p.x,
      y0: p.y,
      asArrow: tool === 'arrow' || e.shiftKey,
      area: null,
      arrow: null,
      pointer: e.pointerId,
    });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!gesture) return;
    const p = at(e);
    if (gesture.kind === 'draw') {
      if (gesture.asArrow) {
        const arrow = arrowFrom(gesture.x0, gesture.y0, p.x, p.y);
        setGesture({ ...gesture, arrow: isTinyArrow(arrow) && !gesture.arrow ? null : arrow });
        return;
      }
      const area = areaFrom(gesture.x0, gesture.y0, p.x, p.y);
      setGesture({ ...gesture, area: isTinyArea(area) && !gesture.area ? null : area });
    } else if (gesture.kind === 'move') {
      // A jitter of a few pixels is still a click, not a drag.
      if (!gesture.moved && Math.hypot(p.x - gesture.x0, p.y - gesture.y0) < 0.005) return;
      const s = gesture.shape;
      const shape: Shape =
        s.kind === 'dot'
          ? { kind: 'dot', x: clamp01(p.x - gesture.dx), y: clamp01(p.y - gesture.dy) }
          : s.kind === 'arrow'
            ? moveArrow(s, p.x - gesture.dx - s.x, p.y - gesture.dy - s.y)
            : {
                ...s,
                x: Math.min(1 - s.w, Math.max(0, p.x - gesture.dx)),
                y: Math.min(1 - s.h, Math.max(0, p.y - gesture.dy)),
              };
      onChange(gesture.id, { shape, confirmed: true });
      if (!gesture.moved) setGesture({ ...gesture, moved: true });
    } else if (gesture.kind === 'end') {
      // One end of an arrow follows the pointer; the other stays. Too short, and it waits.
      const s = gesture.shape;
      const arrow =
        gesture.end === 'tail'
          ? arrowFrom(p.x, p.y, s.x2, s.y2)
          : arrowFrom(s.x, s.y, p.x, p.y);
      if (!isTinyArrow(arrow)) onChange(gesture.id, { shape: arrow, confirmed: true });
    } else {
      const s = gesture.shape;
      const area = areaFrom(s.x, s.y, p.x, p.y);
      if (!isTinyArea(area)) onChange(gesture.id, { shape: area, confirmed: true });
    }
  };

  const onUp = (e: ReactPointerEvent) => {
    if (!gesture) return;
    if (gesture.kind === 'draw') {
      if (gesture.asArrow) {
        // A drag too short to be an arrow makes nothing: a slip, not a note.
        if (gesture.arrow && !isTinyArrow(gesture.arrow)) onAdd(gesture.arrow);
      } else if (gesture.area && !isTinyArea(gesture.area)) {
        onAdd(gesture.area);
      } else {
        // Clicking on while a note is open closes it and starts the next one: no extra click per pin.
        onAdd({ kind: 'dot', ...at(e) });
      }
    } else if (gesture.kind === 'move' && !gesture.moved) {
      onSelect(gesture.id);
    }
    setGesture(null);
  };

  const startMove = (e: ReactPointerEvent, mark: Mark) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    frame.current?.setPointerCapture(e.pointerId);
    const p = at(e);
    setGesture({
      kind: 'move',
      id: mark.id,
      dx: p.x - mark.shape.x,
      dy: p.y - mark.shape.y,
      x0: p.x,
      y0: p.y,
      shape: mark.shape,
      moved: false,
    });
  };

  const startResize = (e: ReactPointerEvent, mark: Mark) => {
    if (e.button !== 0 || mark.shape.kind !== 'area') return;
    e.stopPropagation();
    frame.current?.setPointerCapture(e.pointerId);
    setGesture({ kind: 'resize', id: mark.id, shape: mark.shape });
  };

  const startEnd = (e: ReactPointerEvent, mark: Mark, end: ArrowEnd) => {
    if (e.button !== 0 || mark.shape.kind !== 'arrow') return;
    e.stopPropagation();
    frame.current?.setPointerCapture(e.pointerId);
    setGesture({ kind: 'end', id: mark.id, end, shape: mark.shape });
  };

  /**
   * Arrow keys move a focused mark: 1% a press, 5% with Shift. On an arrow's
   * tail or head handle they move that end alone; on its number, the whole arrow.
   */
  const nudge = (e: ReactKeyboardEvent, mark: Mark, end?: ArrowEnd) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(mark.id);
      return;
    }
    if (!d) return;
    e.preventDefault();
    const s = mark.shape;
    let shape: Shape;
    if (s.kind === 'dot') {
      shape = { ...s, x: clamp01(s.x + d[0]), y: clamp01(s.y + d[1]) };
    } else if (s.kind === 'arrow') {
      shape =
        end === 'tail'
          ? arrowFrom(s.x + d[0], s.y + d[1], s.x2, s.y2)
          : end === 'head'
            ? arrowFrom(s.x, s.y, s.x2 + d[0], s.y2 + d[1])
            : moveArrow(s, d[0], d[1]);
      if (isTinyArrow(shape)) return;
    } else {
      shape = {
        ...s,
        x: Math.min(1 - s.w, Math.max(0, s.x + d[0])),
        y: Math.min(1 - s.h, Math.max(0, s.y + d[1])),
      };
    }
    onChange(mark.id, { shape, confirmed: true });
  };

  const draft = gesture?.kind === 'draw' ? gesture.area : null;
  const draftArrow = gesture?.kind === 'draw' ? gesture.arrow : null;
  // The open area dims the rest of the image. The dim is its own layer, clipped to the image,
  // so it never leaks onto the stage and never clips a pin sitting on the edge.
  const openArea = asset.marks.find((m) => m.id === selected)?.shape;
  const dim = openArea?.kind === 'area' ? openArea : null;

  return (
    <div
      ref={box}
      // A faint 24px grid behind the image, like a design canvas.
      className="relative min-w-0 flex-1 overflow-hidden bg-muted/40 bg-[linear-gradient(to_right,rgb(0_0_0/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.05)_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)]"
    >
      {/* The tool, floating over the top of the canvas: a segmented control, pills like the source picker. */}
      <fieldset className="absolute top-3 left-1/2 z-10 m-0 flex -translate-x-1/2 gap-0.5 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm dark:shadow-none">
        <legend className="sr-only">Tool</legend>
        {TOOLS.map((t) => (
          <button
            key={t.kind}
            type="button"
            aria-pressed={tool === t.kind}
            title={t.hint}
            onClick={() => onTool(t.kind)}
            className="relative inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors outline-none after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:-translate-x-1/2 after:-translate-y-1/2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-foreground"
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </fieldset>
      <div
        ref={frame}
        role="application"
        aria-label={
          tool === 'arrow'
            ? `${asset.name}. Drag from one spot to another to draw an arrow.`
            : `${asset.name}. Click to add a dot, drag to mark an area, Shift-drag to draw an arrow.`
        }
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setGesture(null)}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none select-none shadow-sm"
        style={{ width: size.w, height: size.h }}
      >
        {/* biome-ignore lint/performance/noImgElement: a local image held by this browser */}
        <img src={url} alt="" draggable={false} className="pointer-events-none size-full" />
        {dim && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]"
              style={{
                left: `${dim.x * 100}%`,
                top: `${dim.y * 100}%`,
                width: `${dim.w * 100}%`,
                height: `${dim.h * 100}%`,
              }}
            />
          </div>
        )}
        {asset.marks.map((m, i) => (
          <MarkView
            key={m.id}
            mark={m}
            number={i + 1}
            selected={m.id === selected}
            size={size}
            onDown={(e) => startMove(e, m)}
            onResize={(e) => startResize(e, m)}
            onEnd={(e, end) => startEnd(e, m, end)}
            onKey={(e, end) => nudge(e, m, end)}
          />
        ))}
        {draftArrow && (
          <svg
            aria-hidden
            width={size.w}
            height={size.h}
            className="pointer-events-none absolute inset-0 overflow-visible"
          >
            <ArrowLine arrow={draftArrow} size={size} color="#ffffff" dashed />
          </svg>
        )}
        {draft && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
            style={{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: `${draft.w * 100}%`,
              height: `${draft.h * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** An arrow in stage pixels: where its tail, head and the unit vector between them sit. */
function arrowPixels(a: Arrow, size: { w: number; h: number }) {
  const tx = a.x * size.w;
  const ty = a.y * size.h;
  const hx = a.x2 * size.w;
  const hy = a.y2 * size.h;
  const len = Math.hypot(hx - tx, hy - ty) || 1;
  return { tx, ty, hx, hy, len, ux: (hx - tx) / len, uy: (hy - ty) / len };
}

/**
 * An arrow drawn in the stage's SVG overlay: a line from the tail to a filled
 * head, a small ring at the tail, each over a dark halo so it reads on any
 * screenshot. A draft is white and dashed; an AI arrow not yet checked is dashed.
 */
function ArrowLine({
  arrow,
  size,
  color,
  dashed,
}: {
  arrow: Arrow;
  size: { w: number; h: number };
  color: string;
  dashed?: boolean;
}) {
  const { tx, ty, hx, hy, len, ux, uy } = arrowPixels(arrow, size);
  const head = Math.min(14, len / 3);
  const half = head * 0.42;
  const bx = hx - ux * head;
  const by = hy - uy * head;
  const ring = 4;
  const line = {
    x1: tx + ux * (ring + 2),
    y1: ty + uy * (ring + 2),
    x2: bx + ux * head * 0.3,
    y2: by + uy * head * 0.3,
  };
  const tip = `${hx},${hy} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`;
  const dash = dashed ? '6 5' : undefined;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <line {...line} stroke="rgb(0 0 0 / 0.55)" strokeWidth={6} />
      <line {...line} stroke={color} strokeWidth={3} strokeDasharray={dash} />
      <polygon points={tip} stroke="rgb(0 0 0 / 0.55)" strokeWidth={4} />
      <polygon points={tip} fill={color} />
      <circle cx={tx} cy={ty} r={ring} stroke="rgb(0 0 0 / 0.55)" strokeWidth={5.5} />
      <circle cx={tx} cy={ty} r={ring} stroke={color} strokeWidth={2.5} />
    </g>
  );
}

function MarkView({
  mark,
  number,
  selected,
  size,
  onDown,
  onResize,
  onEnd,
  onKey,
}: {
  mark: Mark;
  number: number;
  selected: boolean;
  size: { w: number; h: number };
  onDown: (e: ReactPointerEvent) => void;
  onResize: (e: ReactPointerEvent) => void;
  onEnd: (e: ReactPointerEvent, end: ArrowEnd) => void;
  onKey: (e: ReactKeyboardEvent, end?: ArrowEnd) => void;
}) {
  const v = verdictOf(mark);
  const color = VERDICT_COLOR[v];
  const unchecked = mark.origin === 'ai' && !mark.confirmed;
  const label = `Note ${number}${mark.label ? `: ${mark.label}` : ''}${v === 'empty' ? ' (empty)' : ''}${unchecked ? ', placed by AI' : ''}`;
  // An arrow's number sits just behind its tail, off the line, so the tail stays visible.
  const arrowPx = mark.shape.kind === 'arrow' ? arrowPixels(mark.shape, size) : null;
  const badgeAt = arrowPx
    ? {
        left: Math.min(size.w - 12, Math.max(12, arrowPx.tx - arrowPx.ux * 24)),
        top: Math.min(size.h - 12, Math.max(12, arrowPx.ty - arrowPx.uy * 24)),
      }
    : mark.shape.kind === 'dot'
      ? { left: `${mark.shape.x * 100}%`, top: `${mark.shape.y * 100}%` }
      : { left: 0, top: 0 };
  const pin = (
    <button
      type="button"
      data-mark
      aria-label={label}
      aria-pressed={selected}
      onPointerDown={onDown}
      onKeyDown={(e) => onKey(e)}
      className={cn(
        // The pin keeps its size; an invisible ::after takes the hit area to 44px or more.
        'pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-neutral-900 font-mono text-xs font-semibold text-white shadow-[0_1px_5px_rgb(0_0_0/0.5)] dark:bg-white dark:text-neutral-900 after:absolute after:-inset-3 after:content-[""] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:cursor-grabbing',
        selected ? 'size-8 ring-4 ring-white/50' : 'size-6',
      )}
      style={badgeAt}
    >
      {number}
    </button>
  );
  if (mark.shape.kind === 'dot') return pin;
  if (mark.shape.kind === 'arrow' && arrowPx) {
    const a = mark.shape;
    const handle =
      'pointer-events-auto absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-neutral-900 bg-white after:absolute after:-inset-4 after:content-[""] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:cursor-grabbing';
    return (
      <>
        <svg
          aria-hidden
          width={size.w}
          height={size.h}
          className="pointer-events-none absolute inset-0 overflow-visible"
        >
          <ArrowLine arrow={a} size={size} color={color} dashed={unchecked} />
          {selected && (
            // The open arrow moves by its line: a wide, invisible stroke takes the pointer.
            <line
              x1={arrowPx.tx}
              y1={arrowPx.ty}
              x2={arrowPx.hx}
              y2={arrowPx.hy}
              stroke="transparent"
              strokeWidth={18}
              className="cursor-move"
              style={{ pointerEvents: 'stroke' }}
              onPointerDown={onDown}
            />
          )}
        </svg>
        {pin}
        {selected && (
          <>
            <button
              type="button"
              data-mark
              aria-label={`${label}, tail`}
              onPointerDown={(e) => onEnd(e, 'tail')}
              onKeyDown={(e) => onKey(e, 'tail')}
              className={handle}
              style={{ left: arrowPx.tx, top: arrowPx.ty }}
            />
            <button
              type="button"
              data-mark
              aria-label={`${label}, head`}
              onPointerDown={(e) => onEnd(e, 'head')}
              onKeyDown={(e) => onKey(e, 'head')}
              className={handle}
              style={{ left: arrowPx.hx, top: arrowPx.hy }}
            />
          </>
        )}
      </>
    );
  }
  const s = mark.shape as Area;
  return (
    <div
      className={cn(
        'pointer-events-none absolute',
        unchecked ? 'border-2 border-dashed' : 'border-2',
      )}
      style={{
        left: `${s.x * 100}%`,
        top: `${s.y * 100}%`,
        width: `${s.w * 100}%`,
        height: `${s.h * 100}%`,
        borderColor: color,
        boxShadow: selected ? '0 0 0 1px rgb(0 0 0 / 0.5)' : '0 0 0 1px rgb(0 0 0 / 0.45)',
        background: selected ? 'transparent' : `${color}14`,
      }}
    >
      {selected && (
        <div className="pointer-events-auto absolute inset-0 cursor-move" onPointerDown={onDown} />
      )}
      {pin}
      {selected && (
        // The bottom-right corner resizes; the top-left one carries the number.
        <div
          onPointerDown={onResize}
          className="pointer-events-auto absolute -right-2 -bottom-2 size-3.5 cursor-nwse-resize rounded-sm border-2 border-neutral-900 bg-white after:absolute after:-inset-3 after:content-['']"
        />
      )}
    </div>
  );
}

/* ---------- Panel: notes on this image ---------- */

// Placeholders and suggestions sit a clear step lighter than typed text, still at 4.5:1 on the page.
const field =
  'w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-[#737373] dark:placeholder:text-[#7a7a7a] focus-visible:outline-2 focus-visible:outline-ring';

function Panel({
  asset,
  number,
  total,
  selected,
  aiOn,
  locating,
  suggestionsOn,
  suggesting,
  onSource,
  onSourceForAll,
  onSelect,
  onChangeMark,
  onRemoveMark,
  onDone,
  onNote,
  onLocate,
  onAddCentre,
  onPrev,
  onNext,
  onRemove,
}: {
  asset: Asset;
  number: number;
  total: number;
  selected: string | null;
  aiOn: boolean;
  locating: boolean;
  suggestionsOn: boolean;
  suggesting: string | null;
  onSource: (source: Source | undefined) => void;
  onSourceForAll: () => void;
  onSelect: (id: string) => void;
  onChangeMark: (id: string, change: Partial<Mark>) => void;
  onRemoveMark: (id: string) => void;
  onDone: () => void;
  onNote: (note: string) => void;
  onLocate: () => void;
  onAddCentre: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRemove: () => void;
}) {
  const mark = asset.marks.find((m) => m.id === selected);
  const markNumber = asset.marks.findIndex((m) => m.id === selected) + 1;
  const noteChanged = asset.note.trim() && asset.note.trim() !== asset.locatedNote;

  return (
    <aside aria-label="Notes" className="flex w-[22rem] shrink-0 flex-col border-l border-border">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">
          {number} / {total}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={asset.name}>
          {asset.name}
        </span>
        <button
          type="button"
          aria-label="Remove this image"
          onClick={onRemove}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <SourcePicker
          source={asset.source}
          total={total}
          onChange={onSource}
          onForAll={onSourceForAll}
        />
        {mark ? (
          <MarkEditor
            key={mark.id}
            mark={mark}
            number={markNumber}
            suggestion={suggestionsOn ? currentSuggestion(mark) : undefined}
            suggesting={suggestionsOn && suggesting === mark.id}
            onChange={(c) => onChangeMark(mark.id, c)}
            onRemove={() => onRemoveMark(mark.id)}
            onDone={onDone}
          />
        ) : (
          <section>
            <h2 className="m-0 mb-2 text-[13px] font-medium text-muted-foreground">
              Notes on this image
            </h2>
            {asset.marks.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                Click the image for a dot, drag across it for an area, or Shift-drag for an arrow,
                then say what works and what doesn’t.
              </p>
            ) : (
              <ol className="m-0 list-none space-y-1.5 p-0">
                {asset.marks.map((m, i) => (
                  <li key={m.id}>
                    <MarkRow mark={m} number={i + 1} onOpen={() => onSelect(m.id)} />
                  </li>
                ))}
              </ol>
            )}
            <button
              type="button"
              onClick={onAddCentre}
              className="mt-2 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-4" aria-hidden />
              Add a note without the mouse
            </button>
          </section>
        )}

        {/* Hidden while a note is open, so the editor has the whole panel. */}
        {!mark && (
          <section>
            <label
              htmlFor="whole-note"
              className="mb-2 block text-[13px] font-medium text-muted-foreground"
            >
              Or write freely about this image
            </label>
            <textarea
              id="whole-note"
              rows={5}
              maxLength={2000}
              value={asset.note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="The revenue number is great: big and alone. The filter row is noisy, too many chips…"
              className={field}
            />
            {aiOn ? (
              <>
                <button
                  type="button"
                  onClick={onLocate}
                  disabled={!noteChanged || locating}
                  className="mt-2 flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
                >
                  {asset.locatedNote && !noteChanged ? 'Placed' : 'Find these in the image'}
                </button>
                <div className="mt-2 text-xs text-muted-foreground">
                  <span aria-live="polite">
                    {locating && <WorkingPill>Finding the spots…</WorkingPill>}
                  </span>
                  {!locating && (
                    <p className="m-0">
                      Sends this image and note to Anthropic’s API to place each point as a note.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-2 mb-0 text-xs text-muted-foreground">
                Exported with the image as its overall note.
              </p>
            )}
            {asset.unplaced && asset.unplaced.length > 0 && !noteChanged && (
              <p className="mt-2 mb-0 text-xs text-muted-foreground">
                About the whole image, so not pinned:{' '}
                {asset.unplaced.map((u) => `“${u}”`).join(' ')}
              </p>
            )}
          </section>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border p-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={number === 1}
          className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-40"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={number === total}
          className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-40"
        >
          Next image
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}

function MarkRow({ mark, number, onOpen }: { mark: Mark; number: number; onOpen: () => void }) {
  const v = verdictOf(mark);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 rounded-lg border border-border p-2.5 text-left hover:bg-muted"
    >
      <span
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 font-mono text-xs font-semibold text-white dark:bg-white dark:text-neutral-900"
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-medium">
          {mark.label || mark.good || mark.bad || 'Empty note'}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {mark.shape.kind}
          {v !== 'empty' &&
            ` · ${v === 'both' ? 'works and doesn’t' : v === 'good' ? 'works' : 'doesn’t work'}`}
          {mark.origin === 'ai' && !mark.confirmed && (
            <span className="rounded bg-sky-500/10 px-1.5 text-xs text-sky-700 dark:text-sky-400">
              AI, to check
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function MarkEditor({
  mark,
  number,
  suggestion,
  suggesting,
  onChange,
  onRemove,
  onDone,
}: {
  mark: Mark;
  number: number;
  suggestion?: Suggestion;
  suggesting: boolean;
  onChange: (c: Partial<Mark>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const first = useRef<HTMLTextAreaElement>(null);
  const mac = useIsMac();
  // A new note opens ready to type; only when the editor opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opened note
  useEffect(() => {
    if (mark.origin === 'user' && verdictOf(mark) === 'empty') first.current?.focus();
  }, []);
  const doneOnShortcut = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <section className="space-y-3" aria-label={`Note ${number}`}>
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-[13px] font-medium text-muted-foreground">
          Note {number} · {mark.shape.kind}
        </h2>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto flex min-h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-muted"
        >
          <Check className="size-4" aria-hidden />
          Done
        </button>
      </div>
      {mark.origin === 'ai' && !mark.confirmed && (
        <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <p className="m-0">Placed by the AI from: “{mark.quote}”. Drag it if it’s off.</p>
          <button
            type="button"
            onClick={() => onChange({ confirmed: true })}
            className="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-muted"
          >
            It’s in the right place
          </button>
        </div>
      )}
      <SuggestedField
        ref={first}
        id={`works-${mark.id}`}
        label="What works"
        color={VERDICT_COLOR.good}
        value={mark.good}
        suggestion={suggestion?.works}
        suggesting={suggesting}
        example="One big number with nothing competing"
        onChange={(good, accepted) =>
          onChange({ good, accepted: withAccepted(mark.accepted, 'good', good, accepted) })
        }
        onKeyDown={doneOnShortcut}
      />
      <SuggestedField
        id={`doesnt-${mark.id}`}
        label="What doesn’t"
        color={VERDICT_COLOR.bad}
        value={mark.bad}
        suggestion={suggestion?.doesNotWork}
        suggesting={suggesting}
        example="Six badges compete for attention"
        onChange={(bad, accepted) =>
          onChange({ bad, accepted: withAccepted(mark.accepted, 'bad', bad, accepted) })
        }
        onKeyDown={doneOnShortcut}
      />
      <SuggestedInput
        id={`label-${mark.id}`}
        label="Short name (optional)"
        value={mark.label}
        suggestion={suggestion?.label}
        suggesting={suggesting}
        example="revenue headline"
        onChange={(label) => onChange({ label })}
        onKeyDown={doneOnShortcut}
      />
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onRemove}
          className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm text-red-600 hover:bg-muted dark:text-red-400"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete note
        </button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd>Enter</Kbd> done · <Kbd>Esc</Kbd> close
        </span>
      </div>
    </section>
  );
}

/** Record a taken suggestion; clearing a field forgets it, so what's typed next is the user's own. */
function withAccepted(
  prev: Mark['accepted'],
  field: 'good' | 'bad',
  value: string,
  accepted: boolean,
): Mark['accepted'] {
  const next = { ...prev };
  if (accepted) next[field] = value;
  else if (!value.trim()) delete next[field];
  return next.good || next.bad ? next : undefined;
}

/**
 * A note field with an AI suggestion as its grey placeholder: Tab in the empty
 * field takes it as real text, any other key types over it.
 */
function SuggestedField({
  ref,
  id,
  label,
  color,
  value,
  suggestion,
  suggesting,
  example,
  onChange,
  onKeyDown,
}: {
  ref?: React.Ref<HTMLTextAreaElement>;
  id: string;
  label: string;
  color: string;
  value: string;
  suggestion?: string;
  suggesting: boolean;
  example: string;
  onChange: (value: string, accepted: boolean) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const ghost = !value && suggestion ? suggestion : '';
  return (
    <div className="text-xs text-muted-foreground">
      <SuggestionLabel id={id} ghost={ghost} working={!value && suggesting}>
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </SuggestionLabel>
      <textarea
        ref={ref}
        id={id}
        rows={3}
        maxLength={1000}
        value={value}
        onChange={(e) => onChange(e.target.value, false)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !e.shiftKey && ghost) {
            e.preventDefault();
            onChange(ghost, true);
            return;
          }
          onKeyDown(e);
        }}
        aria-describedby={ghost ? `${id}-hint` : undefined}
        className={field}
        placeholder={ghost || (suggesting ? '' : example)}
      />
      <SuggestionHint id={id} ghost={ghost} />
    </div>
  );
}

/** The short name, one line, with the suggestion's name for the spot as its ghost text. */
function SuggestedInput({
  id,
  label,
  value,
  suggestion,
  suggesting,
  example,
  onChange,
  onKeyDown,
}: {
  id: string;
  label: string;
  value: string;
  suggestion?: string;
  suggesting: boolean;
  example: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const ghost = !value && suggestion ? suggestion : '';
  return (
    <div className="text-xs text-muted-foreground">
      <SuggestionLabel id={id} ghost={ghost} working={!value && suggesting}>
        {label}
      </SuggestionLabel>
      <input
        id={id}
        maxLength={60}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && !e.shiftKey && ghost) {
            e.preventDefault();
            onChange(ghost);
            return;
          }
          onKeyDown(e);
        }}
        aria-describedby={ghost ? `${id}-hint` : undefined}
        className={field}
        placeholder={ghost || (suggesting ? '' : example)}
      />
      <SuggestionHint id={id} ghost={ghost} />
    </div>
  );
}

/** A field's label row with, on the right, the suggestion's state. It keeps the pill's height, so a suggestion arriving doesn't move the field. */
function SuggestionLabel({
  id,
  ghost,
  working,
  children,
}: {
  id: string;
  ghost: string;
  working: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="mb-1 flex min-h-7 items-center gap-1.5">
      {children}
      <span className="ml-auto flex items-center gap-1" aria-live="polite">
        {ghost ? (
          <>
            AI suggestion · <Kbd>Tab</Kbd> to use
          </>
        ) : (
          working && <WorkingPill>Suggesting…</WorkingPill>
        )}
      </span>
    </label>
  );
}

function SuggestionHint({ id, ghost }: { id: string; ghost: string }) {
  if (!ghost) return null;
  return (
    <span id={`${id}-hint`} className="sr-only">
      Suggestion: {ghost} Press Tab to use it.
    </span>
  );
}

/** Whose design the image is. New images take the open one's. */
function SourcePicker({
  source,
  total,
  onChange,
  onForAll,
}: {
  source?: Source;
  total: number;
  onChange: (source: Source | undefined) => void;
  onForAll: () => void;
}) {
  // Source is optional: picking the chosen one again clears it.
  const pick = (kind: SourceKind) =>
    onChange(
      source?.kind === kind
        ? undefined
        : { kind, by: source?.by ?? '', link: source?.link ?? '' },
    );
  return (
    <section aria-labelledby="source-heading">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="source-heading" className="m-0 text-[13px] font-medium text-muted-foreground">
          Source
        </h2>
        {source && total > 1 && (
          <button
            type="button"
            onClick={onForAll}
            className="ml-auto min-h-7 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Set for all {total}
          </button>
        )}
      </div>
      {/*
       * The four kinds in the Segmented tray style, on two rows: the labels don't fit
       * one row at the panel's width, and `Segmented` only lays out a single row.
       */}
      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Whose design this is</legend>
        <div className="grid grid-cols-2 gap-0.5 rounded-xl border border-border p-1">
          {SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              aria-pressed={source?.kind === s.kind}
              title={s.hint}
              onClick={() => pick(s.kind)}
              className="relative inline-flex h-8 min-w-0 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors outline-none after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:-translate-x-1/2 after:-translate-y-1/2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-foreground"
            >
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
