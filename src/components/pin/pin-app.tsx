'use client';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Globe,
  House,
  Keyboard,
  Library,
  Lightbulb,
  Loader2,
  Lock,
  MapPin,
  MoveUpRight,
  Plus,
  RotateCcw,
  SquareDashed,
  Swords,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ThemeToggle } from '@/components/site/theme-toggle';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  type Area,
  type Arrow,
  type Asset,
  areaFrom,
  arrowFrom,
  currentSuggestion,
  isTinyArea,
  isTinyArrow,
  type Mark,
  moveArrow,
  needsSuggestion,
  SOURCES,
  type Shape,
  sourceLabel,
  type Source,
  type Suggestion,
  shapeKey,
  sortTopics,
  TOPICS,
  type Topic,
  toggleTopic,
  topicLabel,
  verdictOf,
} from '@/lib/pin/model';
import { assetsOf, readExport } from '@/lib/pin/import';
import { changedEntries, fingerprint, logEntries, MAX_BATCH } from '@/lib/pin/notes-log';
import type { SuggestResult } from '@/lib/pin/suggest';
import { imageSummary } from '@/lib/pin/summary';
import { unzip } from '@/lib/pin/unzip';
import { cn } from '@/lib/utils';
import { PinchWordmark } from './brand';
import { CollectionsView } from './collections';
import { Dialog, hit } from './dialog';
import { DropFolder } from './drop-folder';
import { TOPIC_TONES, tagHit } from './topic-style';
import {
  bitmapOf,
  buildExport,
  contextForAi,
  cropForAi,
  download,
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

/** An image with something written on a mark: what the progress line and the filmstrip count. */
const hasMarks = (a: Asset) => a.marks.some((m) => verdictOf(m) !== 'empty');

/**
 * A toast; an information one can carry one action, such as Undo after something was removed.
 * A sticky one stays until dismissed, like an error, without being one.
 */
type Status = {
  tone: 'info' | 'error';
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
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
function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[13px]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A short-lived "working" state: a pill with a spinner, which reduced motion hides. */
function WorkingPill({
  children,
  className,
  ...props
}: React.ComponentProps<'span'> & { children: React.ReactNode }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px] text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="size-3 animate-spin motion-reduce:hidden" aria-hidden />
      {children}
    </span>
  );
}

/** Grey suggestion text and the "Suggesting…" pill fade: 200ms, opacity only, none under reduced motion. */
const ghostFade = 'transition-opacity duration-200 ease-out motion-reduce:transition-none';

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
/** The open image's id, so a reload comes back to it. */
const OPEN_KEY = 'pinch-open';
/** Written after every save, for browsers without BroadcastChannel: other tabs hear it as a `storage` event. */
const SAVED_KEY = 'pinch-saved';
const CHANNEL = 'pinch-session';

/** Files Pinch takes: anything the browser calls an image, or an image by its name when the type is blank. */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif|tiff?)$/i;
const isSvg = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
const isImageFile = (f: File) =>
  f.type.startsWith('image/') || (!f.type && IMAGE_EXT.test(f.name)) || isSvg(f);
/** A zip: a Pinch export to open, by its type or, when the type is blank or generic, its name. */
const isZip = (f: File) => /zip/.test(f.type) || /\.zip$/i.test(f.name);

/** Whether this browser says it is a small or touch device: a phone or a tablet, not a narrow window. */
const isSmallDevice = () =>
  window.matchMedia('(pointer: coarse)').matches ||
  window.screen.width * window.devicePixelRatio < 768;

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
  return next ? { kind: next.kind } : undefined;
}

/**
 * Pinch needs a pointer and room: drawing on an image, side by side with its notes. On a phone or
 * tablet it shows one message instead, in the style of yair-works.vercel.app's: a black screen,
 * the line centred in a frame marked by four small squares. The message is gated by width in CSS
 * (so the server and the first paint agree), and lifted after mount on a desktop-class device:
 * a laptop zoomed to 200% or a narrow window keeps the app (WCAG 1.4.4, 1.4.10).
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
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(!isSmallDevice());
  }, []);
  return (
    <>
      {!desktop && <DesktopOnly />}
      <div className={desktop ? undefined : 'max-md:hidden'}>
        <Workspace />
      </div>
    </>
  );
}

/** A pin on the stage, by its note's id. */
const pinOf = (id: string) =>
  document.querySelector<HTMLElement>(`button[data-mark="${id}"]:not([data-end])`);

/** One tab's name, so a tab can tell its own saves from another's. */
const TAB_ID = newId();

type DialogKind = 'shortcuts' | 'privacy' | 'home';

/** A short digest of the session's notes, to tell whether anything changed since the last export. */
const digestOf = (list: Asset[]) => {
  const s = JSON.stringify(list);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${list.length}:${h >>> 0}`;
};

/** Ghost buttons and links: a muted fill on hover, with a short colour transition. */
const hoverFill = 'transition-colors duration-150 motion-reduce:transition-none hover:bg-muted';

function Workspace() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  // Suggestions: available on the server, and on in this browser (the default).
  const [suggestAvailable, setSuggestAvailable] = useState(false);
  const [suggestPref, setSuggestPref] = useState(true);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const suggestStopped = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  // The one dialog open, and what had focus before it, so closing it puts focus back.
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openDialog = useCallback((kind: DialogKind) => {
    opener.current = document.activeElement as HTMLElement | null;
    setDialog(kind);
  }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  // The session as last exported (or copied whole), kept with it, so going home can ask first.
  const exported = useRef<string | undefined>(undefined);
  const markExported = useCallback(() => {
    exported.current = digestOf(assetsRef.current);
    store.saveExported(exported.current).catch(() => undefined);
  }, []);
  const pathname = usePathname() ?? '/pin';
  // The session is in memory only: the browser blocked its storage.
  const [volatile, setVolatile] = useState(false);
  // Another tab saved this session since it was loaded here; this tab stops saving until reloaded.
  const stale = useRef(false);
  // A tall image fills the stage's width and scrolls, or fits whole. Per visit.
  const [fitWidth, setFitWidth] = useState(true);
  // Suggestions the user dismissed, by note and field, with the shape they were written for.
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  // What a drag draws: a dot or area (Pin), or an arrow. Per visit; A toggles it, Esc leaves it.
  const [tool, setTool] = useState<Tool>('pin');
  // The batch, or the collections in its place (D75). Per visit.
  const [view, setView] = useState<'batch' | 'collections'>('batch');
  const viewRef = useRef(view);
  viewRef.current = view;
  const history = useRef<History>(null as unknown as History);
  history.current ??= new History();
  // The latest session, kept in step with history so handlers never read a stale render.
  const assetsRef = useRef(assets);
  // The session as last written to storage; saving it again would only alarm the other tabs.
  const lastSaved = useRef<Asset[] | null>(null);
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
        // Marks an older session had the AI place are ordinary marks now, nothing left to check.
        const kept = saved
          .filter((a) => next[a.id])
          .map((a) => ({
            ...a,
            marks: a.marks.map((m) =>
              m.origin === 'ai' && !m.confirmed ? { ...m, confirmed: true } : m,
            ),
          }));
        history.current.reset(kept);
        assetsRef.current = kept;
        lastSaved.current = kept;
        exported.current = await store.loadExported().catch(() => undefined);
        setAssets(kept);
        setUrls(next);
        // Back to the image that was open, if it is still here.
        const at = kept.findIndex((a) => a.id === local.get(OPEN_KEY));
        if (at > 0) setIndex(at);
      } catch {
        // Storage opened but failed mid-way: keep the visit in memory rather than lose each change.
        store.forceMemory();
      } finally {
        setVolatile(store.inMemory());
        setLoaded(true);
      }
    })();
    fetch('/api/pin/suggest')
      .then((r) => r.json())
      .then((r) => setSuggestAvailable(Boolean(r.available)))
      .catch(() => setSuggestAvailable(false));
    setSuggestPref(local.get(SUGGEST_KEY) !== 'off');
  }, []);

  // An information toast goes by itself, staying longer the more it says; an error stays until
  // dismissed, and so does a sticky one. One with an Undo button stays a little longer.
  useEffect(() => {
    if (status?.tone !== 'info' || status.sticky) return;
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
  // closing the tab right after an edit loses nothing. Once another tab has saved, this one
  // stops: its copy is older, and writing it would throw the other tab's work away.
  const saving = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const staleToast = useCallback(
    () =>
      setStatus({
        tone: 'info',
        sticky: true,
        text: 'This session changed in another tab. Reload to see it; changes made here since are not being saved.',
        action: { label: 'Reload', run: () => window.location.reload() },
      }),
    [],
  );
  const persist = useCallback(() => {
    if (assetsRef.current === lastSaved.current) return;
    if (stale.current) {
      staleToast();
      return;
    }
    if (saving.current) {
      dirty.current = true;
      return;
    }
    const list = assetsRef.current;
    saving.current = store
      .saveAssets(list)
      .then(() => {
        lastSaved.current = list;
        // Tell the other tabs, so they stop writing over this.
        const note = { tab: TAB_ID, at: Date.now() };
        channel.current?.postMessage(note);
        local.set(SAVED_KEY, JSON.stringify(note));
      })
      .catch((e) =>
        setStatus({
          tone: 'error',
          text: store.isQuotaError(e)
            ? 'Browser storage is full. Remove images or export, then continue.'
            : store.inMemory()
              ? 'This browser blocks storage, so your session lasts until you close the tab. Export before you leave.'
              : "Couldn't save in this browser. Export to keep your notes.",
        }),
      )
      .finally(() => {
        saving.current = null;
        if (dirty.current) {
          dirty.current = false;
          persist();
        }
      });
  }, [staleToast]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: persist reads the ref; this runs on every change to assets
  useEffect(() => {
    if (loaded) persist();
  }, [assets, loaded, persist]);

  // Another tab saving the session makes this tab's copy stale. BroadcastChannel where it exists;
  // the `storage` event on the saved-at key carries the same news elsewhere.
  useEffect(() => {
    const heard = (from: unknown) => {
      if (!from || (from as { tab?: string }).tab === TAB_ID || stale.current) return;
      stale.current = true;
      staleToast();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SAVED_KEY || !e.newValue) return;
      try {
        heard(JSON.parse(e.newValue));
      } catch {}
    };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = (e) => heard(e.data);
    } else {
      window.addEventListener('storage', onStorage);
    }
    return () => {
      channel.current?.close();
      channel.current = null;
      window.removeEventListener('storage', onStorage);
    };
  }, [staleToast]);

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

  // The open image is remembered per browser, so a reload comes back to it.
  useEffect(() => {
    if (asset?.id) local.set(OPEN_KEY, asset.id);
  }, [asset?.id]);

  const update = useCallback(
    (id: string, change: (a: Asset) => Asset, opts?: { coalesce?: Coalesce; silent?: boolean }) =>
      commit((list) => list.map((a) => (a.id === id ? change(a) : a)), opts),
    [commit],
  );

  /**
   * A Pinch export opens into the session: its images and notes join what is there, as added
   * images do, so a batch can move between browsers. The zip is read here and kept nowhere.
   */
  const openExport = useCallback(
    async (file: File) => {
      setStatus({ tone: 'info', text: `Opening ${file.name}…`, sticky: true });
      let found: ReturnType<typeof assetsOf>;
      try {
        const files = await unzip(await file.arrayBuffer());
        found = assetsOf(readExport(files), files, newId);
      } catch (e) {
        setStatus({ tone: 'error', text: `Couldn't open ${file.name}. ${(e as Error).message}` });
        return;
      }
      const room = Math.max(0, MAX_IMAGES - assetsRef.current.length);
      const added: Asset[] = [];
      const addedUrls: Record<string, string> = {};
      let full = false;
      for (const { asset, image } of found.assets.slice(0, room)) {
        try {
          await store.putImage(asset.id, image);
        } catch (e) {
          if (store.isQuotaError(e)) full = true;
          break;
        }
        addedUrls[asset.id] = URL.createObjectURL(image);
        added.push(asset);
      }
      setUrls((u) => ({ ...u, ...addedUrls }));
      urlsRef.current = { ...urlsRef.current, ...addedUrls };
      const before = assetsRef.current;
      if (added.length) {
        if (!before.some(hasMarks)) setIndex(before.length);
        commit((list) => [...list, ...added]);
      }
      const notes = added.reduce((n, a) => n + a.marks.length, 0);
      const leftOut = found.assets.length - added.length;
      const lines = [`Opened ${file.name}: ${count(added.length, 'image')}, ${count(notes, 'note')}.`];
      if (found.missing) lines.push(`${count(found.missing, 'image')} missing from the zip.`);
      if (full) lines.push('Browser storage is full. Remove images or export, then continue.');
      else if (leftOut) lines.push(`${count(leftOut, 'image')} left out. ${FULL_MESSAGE}`);
      const trouble = found.missing > 0 || leftOut > 0;
      setStatus({ tone: trouble ? 'error' : 'info', text: lines.join(' ') });
    },
    [commit],
  );

  const addFiles = useCallback(
    async (dropped: File[]) => {
      for (const file of dropped.filter(isZip)) await openExport(file);
      const files = dropped.filter((f) => !isZip(f));
      if (!files.length) return;
      const all = files.filter(isImageFile);
      const skipped = files.length - all.length;
      const skippedLine = skipped ? `Skipped ${count(skipped, 'file')} that aren't images.` : '';
      if (!all.length) {
        if (skippedLine) setStatus({ tone: 'error', text: skippedLine });
        return;
      }
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
      // Files the browser couldn't read, with a reason when there is one to give.
      const failed: string[] = [];
      let scaled = 0;
      let full = false;
      // New images take the open image's source: a batch is usually from one place.
      const open = assetsRef.current[indexRef.current]?.source;
      const source: Source | undefined = open ? { kind: open.kind } : undefined;
      for (const file of images) {
        const name = file.name || 'Pasted image.png';
        if (isSvg(file)) {
          failed.push(`${name} (SVG isn't supported)`);
          continue;
        }
        let prepared: Awaited<ReturnType<typeof prepareImage>>;
        try {
          prepared = await prepareImage(file);
        } catch {
          failed.push(name);
          continue;
        }
        const id = newId();
        try {
          await store.putImage(id, prepared.blob);
        } catch (e) {
          // No room left in the browser: keep what got in, and say so once.
          if (store.isQuotaError(e)) {
            full = true;
            break;
          }
          failed.push(name);
          continue;
        }
        if (prepared.scaled) scaled++;
        addedUrls[id] = URL.createObjectURL(prepared.blob);
        added.push({
          id,
          name,
          type: prepared.type,
          width: prepared.width,
          height: prepared.height,
          note: '',
          marks: [],
          ...(source ? { source } : {}),
        });
      }
      setUrls((u) => ({ ...u, ...addedUrls }));
      urlsRef.current = { ...urlsRef.current, ...addedUrls };
      // A fresh batch opens on its first image; added to work in progress, the place is kept.
      const before = assetsRef.current;
      if (added.length) {
        if (!before.some(hasMarks)) setIndex(before.length);
        commit((list) => [...list, ...added]);
      }
      // One message for the batch: what got in, what didn't and why, what was scaled.
      const lines = [`Added ${count(added.length, 'image')}.`];
      if (failed.length)
        lines.push(`Couldn't read ${count(failed.length, 'file')}: ${failed.join(', ')}.`);
      if (skippedLine) lines.push(skippedLine);
      if (scaled)
        lines.push(`Scaled down ${count(scaled, 'screenshot')} to fit (16 megapixel limit).`);
      if (full) lines.push('Browser storage is full. Remove images or export, then continue.');
      if (leftOut) lines.push(`${count(leftOut, 'image')} left out. ${FULL_MESSAGE}`);
      const trouble = failed.length > 0 || skipped > 0 || full || leftOut > 0;
      if (!trouble && !before.length && added.length) lines.push(HOW_TO_MARK);
      setStatus({ tone: trouble ? 'error' : 'info', text: lines.join(' ') });
    },
    [commit, openExport],
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
      if (isTyping(e.target) || viewRef.current === 'collections') return;
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

  /** Close the open note and put focus back on its pin, so the keyboard stays where the user was. */
  const closeNote = useCallback(() => {
    const id = selected;
    deselect();
    if (id) requestAnimationFrame(() => pinOf(id)?.focus());
  }, [selected, deselect]);

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
    const field = (['good', 'bad'] as const).find((f) => f in change);
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
      update(asset.id, (a) => ({ ...a, source }));
    },
    [asset, update],
  );
  const setSourceForAll = () => {
    const source = asset?.source;
    if (!source) return;
    commit((list) => list.map((a) => ({ ...a, source: { kind: source.kind } })));
    setStatus({
      tone: 'info',
      text: `Set ${count(assets.length, 'image')} to ${sourceLabel(source.kind)}.`,
    });
  };

  // Keys: arrows or J/K move between images, 1–9 and [ ] open a note, N adds one, A toggles the
  // Arrow tool, S cycles the source, Delete removes the note whose pin is focused, Escape closes
  // the open note (then leaves the Arrow tool), ⌘Z and ⇧⌘Z undo and redo, ? lists them all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog holds the keyboard; it closes itself on Escape. The collections have no keys.
      if (dialog || view === 'collections') return;
      if (e.key === 'Escape') {
        if (isTyping(e.target)) (e.target as HTMLElement).blur();
        else if (!selected && tool !== 'pin') setTool('pin');
        closeNote();
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || key === 'y')) {
        const isRedo = key === 'y' || e.shiftKey;
        // While a field is still being typed in, the browser's own undo keeps the keystrokes.
        if (isTyping(e.target) && !isRedo) {
          const el = e.target as HTMLElement;
          const field = el.id.match(/^(works|doesnt)-(.+)$/);
          const openKey = field
            ? `text:${field[2]}:${{ works: 'good', doesnt: 'bad' }[field[1]]}`
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
        openDialog('shortcuts');
        return;
      }
      // Delete removes the note whose pin (or arrow handle) has focus: never one merely open.
      const focusedPin = (e.target as HTMLElement)?.closest?.<HTMLElement>('[data-mark]');
      if ((e.key === 'Delete' || e.key === 'Backspace') && focusedPin?.dataset.mark) {
        e.preventDefault();
        removeMark(focusedPin.dataset.mark);
        return;
      }
      const open = (mark: Mark | undefined) => {
        if (!mark) return;
        e.preventDefault();
        if (mark.id !== selected) deselect();
        setSelected(mark.id);
      };
      if (asset && /^[1-9]$/.test(e.key)) {
        open(asset.marks[Number(e.key) - 1]);
        return;
      }
      // [ and ] walk the notes on this image, for the tenth note and beyond: from the open note,
      // else from the focused pin, else from either end.
      if (asset && (e.key === '[' || e.key === ']') && asset.marks.length) {
        const from = selected ?? focusedPin?.dataset.mark;
        const at = asset.marks.findIndex((m) => m.id === from);
        const last = asset.marks.length - 1;
        open(
          asset.marks[
            e.key === ']'
              ? at < 0
                ? 0
                : Math.min(last, at + 1)
              : at < 0
                ? last
                : Math.max(0, at - 1)
          ],
        );
        return;
      }
      if (asset && key === 'n') {
        e.preventDefault();
        // The selected tool decides what appears at the centre: a dot, a standard area or an arrow.
        addMark(
          tool === 'area'
            ? standardAreaAt({ x: 0.5, y: 0.5 })
            : tool === 'arrow'
              ? { kind: 'arrow', x: 0.35, y: 0.5, x2: 0.65, y2: 0.5 }
              : { kind: 'dot', x: 0.5, y: 0.5 },
        );
        return;
      }
      // P, R and A pick a tool; Esc with nothing open goes back to Pin.
      const picked = asset && ({ p: 'pin', r: 'area', a: 'arrow' } as Record<string, Tool>)[key];
      if (picked) {
        e.preventDefault();
        setTool(picked);
        const name = TOOLS.find((t) => t.kind === picked)?.label;
        setStatus({
          tone: 'info',
          text: `${name} tool: ${TOOL_WHAT[picked].charAt(0).toLowerCase()}${TOOL_WHAT[picked].slice(1)}${picked === 'pin' ? '' : ' Esc or P goes back to Pin.'}`,
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
    closeNote,
    removeMark,
    addMark,
    setSource,
    asset,
    dialog,
    openDialog,
    tool,
    undo,
    redo,
    view,
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

  const tagged = assets.filter(hasMarks);
  const allMarks = tagged.flatMap((a) => a.marks.filter((m) => verdictOf(m) !== 'empty'));

  /** Builds and downloads the zip; true when it went out. */
  const exportZip = async (): Promise<boolean> => {
    if (!tagged.length) {
      setStatus({ tone: 'error', text: 'Write a note on at least one image first.' });
      return false;
    }
    deselect();
    try {
      const { blob, name } = await buildExport(assets, store.getImage, (done, total) =>
        setExporting(`Preparing ${Math.min(done + 1, total)} of ${total}…`),
      );
      download(blob, name);
      markExported();
      const skipped = assets.length - tagged.length;
      setStatus({
        tone: 'info',
        text: `Exported ${count(tagged.length, 'image')} and ${count(allMarks.length, 'note')}${skipped ? `; ${count(skipped, 'image')} without notes left out` : ''}. The zip holds README.md and notes.json, your images, a marked copy of each, and a close-up of every note. Give your agent the whole folder, starting with README.md.`,
      });
      return true;
    } catch (e) {
      setStatus({ tone: 'error', text: (e as Error).message });
      return false;
    } finally {
      setExporting(null);
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

  /** The batch as its export, for a collection to keep; null when it has no notes yet. */
  const batchZip = useCallback(async () => {
    const list = assetsRef.current;
    if (!list.some(hasMarks)) return null;
    deselect();
    try {
      const made = await buildExport(list, store.getImage, (done, total) =>
        setStatus({
          tone: 'info',
          text: `Preparing ${Math.min(done + 1, total)} of ${total}…`,
          sticky: true,
        }),
      );
      // Kept in a collection is kept: going home won't ask about this batch.
      markExported();
      return made;
    } finally {
      setStatus((s) => (s?.sticky ? null : s));
    }
  }, [deselect, markExported]);

  /** A batch kept in a collection, opened into the session like any export. */
  const openStoredBatch = useCallback(
    (file: File) => {
      setView('batch');
      openExport(file);
    },
    [openExport],
  );

  /**
   * The logo goes home, which in Pinch means a new batch: straight there when everything was
   * exported since the last change, after a question when something wasn't.
   */
  const goHome = () => {
    if (!assets.length) return;
    if (digestOf(assetsRef.current) !== exported.current) openDialog('home');
    else startOver();
  };

  // The landing: no image yet, so the header floats over the painting in two glass pills.
  const landing = loaded && !asset && view === 'batch';
  // The batch's own controls in the header: its count, suggestions, copy, export and keys.
  const batchTools = view === 'batch' && assets.length > 0;

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-background text-foreground">
      {/* While a dialog is open, everything behind it is inert: no focus, no clicks, nothing read. */}
      <header
        inert={dialog !== null}
        className={cn(
          'flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1',
          landing ? 'absolute inset-x-0 top-0 z-10 h-16 px-5 py-0' : 'border-b border-border',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2.5',
            landing &&
              'h-9 rounded-full bg-background/80 px-3.5 shadow-sm ring-1 ring-border/70 backdrop-blur-md',
          )}
        >
          {landing ? (
            <PinchWordmark className="h-[15px]" />
          ) : (
            // Home is a new batch; a modified click still opens a new tab, as a link should.
            <a
              href={pathname}
              data-home-trigger
              aria-label={view === 'collections' ? 'Pinch, back to the batch' : 'Pinch, start a new batch'}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                if (view === 'collections') setView('batch');
                else goHome();
              }}
              className={cn(
                hoverFill,
                hit,
                '-mx-1.5 flex items-center rounded-md px-1.5 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              )}
            >
              <PinchWordmark className="h-[15px]" />
            </a>
          )}
        </div>
        <div
          className={cn(
            'ml-auto flex items-center gap-2',
            landing &&
              'gap-0.5 rounded-full bg-background/80 p-1 shadow-sm ring-1 ring-border/70 backdrop-blur-md',
          )}
        >
          {batchTools && (
            <p
              className="m-0 mr-2 text-[13px] text-muted-foreground max-[900px]:hidden"
              aria-live="polite"
            >
              {tagged.length} of {assets.length} tagged · {count(allMarks.length, 'note')}
            </p>
          )}
          {suggestAvailable && batchTools && (
            <label
              htmlFor="suggestions"
              className="flex min-h-9 items-center gap-2 px-1 text-sm"
              title="Grey suggestions in empty notes; Tab takes one. Sends the marked area to Anthropic."
            >
              <Switch
                id="suggestions"
                size="sm"
                checked={suggestPref}
                onCheckedChange={toggleSuggestions}
                aria-describedby="suggestions-note"
              />
              Suggestions
            </label>
          )}
          {suggestAvailable && batchTools && (
            // The switch's description, outside its label so it doesn't join the name.
            <span id="suggestions-note" className="sr-only">
              Sends the marked area to Anthropic.
            </span>
          )}
          {batchTools && (
            <TooltipProvider>
              <ToolbarButton
                onClick={copyForAgent}
                title="Copy the open image with its notes drawn on, plus the notes as text."
                aria-live="polite"
                className="justify-center min-[900px]:min-w-[8.75rem]"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {/* One element, so the button's gap doesn't open a second space after "Copy". */}
                <span>
                  {copied ? 'Copied' : 'Copy'}
                  {!copied && <span className="max-[900px]:hidden"> for agent</span>}
                </span>
              </ToolbarButton>
              <button
                type="button"
                onClick={exportZip}
                disabled={Boolean(exporting)}
                className={cn(
                  hit,
                  'flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-60',
                )}
              >
                <Download className="size-4" aria-hidden />
                {/* One element, so the button's gap doesn't open a second space after "Export". */}
                <span>
                  {exporting ?? (
                    <>
                      Export<span className="max-[900px]:hidden"> for agent</span>
                    </>
                  )}
                </span>
              </button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Keyboard shortcuts"
                      aria-expanded={dialog === 'shortcuts'}
                      data-shortcuts-trigger
                      onClick={() => (dialog ? closeDialog() : openDialog('shortcuts'))}
                      className={cn(
                        hit,
                        'flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
                      )}
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
          {loaded && (
            // Between the batch and the collections, which take its place (D75).
            <button
              type="button"
              onClick={() => setView(view === 'batch' ? 'collections' : 'batch')}
              className={cn(
                hit,
                'flex items-center text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                landing
                  ? 'h-7 gap-1.5 rounded-full px-2.5'
                  : 'min-h-9 gap-2 rounded-md border border-border px-3',
              )}
            >
              {view === 'batch' ? (
                <Library className="size-4" aria-hidden />
              ) : (
                <ArrowLeft className="size-4" aria-hidden />
              )}
              {view === 'batch' ? 'Collections' : assets.length ? 'Back to batch' : 'Back'}
            </button>
          )}
          <ThemeToggle />
          {(assets.length > 0 || view === 'collections') && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="How Pinch uses your data"
                      aria-expanded={dialog === 'privacy'}
                      data-privacy-trigger
                      onClick={() => openDialog('privacy')}
                      className={cn(
                        hit,
                        'flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Lock className="size-4" aria-hidden />
                    </button>
                  }
                />
                <TooltipContent>How Pinch uses your data</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {/* Driven by the Add images buttons; hidden from assistive tech, which would read it as an unreachable "Choose files". */}
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.zip,application/zip"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </header>

      {volatile && !landing && (
        // The session can't be kept: a banner, not a toast, because it holds for the whole visit.
        <p
          role="status"
          inert={dialog !== null}
          className="m-0 shrink-0 border-b border-border bg-muted/60 px-4 py-2 text-center text-[13px] text-foreground"
        >
          This browser blocks storage, so your session lasts until you close the tab. Export before
          you leave.
        </p>
      )}

      {status && (
        // A toast: it floats over the page, so a message never moves the layout.
        <div
          role={status.tone === 'error' ? 'alert' : 'status'}
          inert={dialog !== null}
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
              className={cn(
                hit,
                'flex min-h-8 shrink-0 items-center rounded-md border border-border px-2.5 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
              )}
            >
              {status.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setStatus(null)}
            className={cn(
              hit,
              '-mr-2 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {!loaded ? null : view === 'collections' ? (
        <CollectionsView
          inert={dialog !== null}
          openNotes={allMarks.length}
          batchZip={batchZip}
          onOpenBatch={openStoredBatch}
          onStatus={setStatus}
        />
      ) : !asset ? (
        <EmptyState
          dragging={dragging}
          inert={dialog !== null}
          onChoose={() => fileInput.current?.click()}
          onPrivacy={() => openDialog('privacy')}
        />
      ) : (
        <div inert={dialog !== null} className="flex min-h-0 flex-1">
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
            fitWidth={fitWidth}
            onFitWidth={setFitWidth}
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
            onDone={closeNote}
            onPrev={() => go(index - 1)}
            onNext={() => go(index + 1)}
            onRemove={() => removeAsset(asset.id)}
            dismissed={dismissed}
            onDismiss={(markId, field, shape) =>
              setDismissed((d) => ({ ...d, [`${markId}:${field}`]: shape }))
            }
          />
        </div>
      )}
      {dialog === 'shortcuts' && (
        <ShortcutsDialog mac={mac} opener={opener.current} onClose={closeDialog} />
      )}
      {dialog === 'privacy' && <PrivacyDialog opener={opener.current} onClose={closeDialog} />}
      {dialog === 'home' && (
        <Dialog
          id="home-title"
          title="Start a new batch?"
          opener={opener.current}
          onClose={closeDialog}
        >
          <p className="m-0 text-muted-foreground">
            Your {count(assets.length, 'image')} and {count(allMarks.length, 'note')} are kept in
            this browser until you start over. Export them first if you want to keep them.
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={async () => {
                closeDialog();
                if (await exportZip()) startOver();
              }}
              className={cn(
                hit,
                'flex min-h-9 items-center rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
              )}
            >
              Export and start over
            </button>
            <button
              type="button"
              onClick={() => {
                closeDialog();
                startOver();
              }}
              className={cn(
                hit,
                'flex min-h-9 items-center rounded-md bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors duration-150 motion-reduce:transition-none hover:bg-destructive/20',
              )}
            >
              Start over
            </button>
            <button
              type="button"
              data-autofocus
              onClick={closeDialog}
              className={cn(
                hit,
                'flex min-h-9 items-center rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
              )}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** How Pinch uses what the user gives it, said plainly; opened from the landing footer and the header. */
function PrivacyDialog({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const item = (title: string, body: React.ReactNode) => (
    <p className="m-0">
      <strong className="font-medium text-foreground">{title}</strong> {body}
    </p>
  );
  return (
    <Dialog
      id="privacy-title"
      title="How Pinch uses your data"
      opener={opener}
      onClose={onClose}
      fallback="[data-privacy-trigger]"
    >
      <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[13px] leading-relaxed text-muted-foreground">
        {item(
          'Your images',
          'stay in this browser, stored in its IndexedDB. They are not uploaded, except for AI suggestions, as below.',
        )}
        {item(
          'AI suggestions',
          'are on by default; the switch is in the header. Only AI suggestions send anything to Anthropic: when you open an empty note, a 768px copy of the screenshot and a crop around the marked spot are sent to Anthropic’s API (Claude Haiku) to write a suggestion. We don’t store them. Turn suggestions off and nothing is sent.',
        )}
        {item(
          'Notes text:',
          'the words of your notes (what works, what doesn’t and the short name) are saved without your name, images, file names or links, and kept for 90 days, to learn how designers judge screens. This can’t be switched off. A salted hash of your IP address is used only to count daily limits.',
        )}
        {item(
          'Topic tags:',
          'each saved note’s words are sent to TypeSafe’s Jev to tag its topic (type, colour, layout, and so on). Nothing else goes with them.',
        )}
        {item(
          'Collections',
          'and their batches and rules stay in this browser. When you ask for drafts, the words of a collection’s notes (what works, what doesn’t, their topics and whose design it is) are sent to Anthropic’s API (Claude) to draft a rule for each. Never the images or file names, and we don’t store them.',
        )}
        {item(
          'No accounts, no ads, no analytics.',
          'Your theme and settings are kept in this browser.',
        )}
        {item(
          'Contact:',
          <>
            Created by{' '}
            <a
              href="https://yair-works.vercel.app"
              target="_blank"
              rel="noopener"
              className="-mx-1 rounded px-1 text-foreground underline underline-offset-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-muted"
            >
              Yair Cohen
            </a>
            .
          </>,
        )}
      </div>
    </Dialog>
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
      { combos: [['['], [']']], join: 'or', what: 'Open the previous or next note' },
      { combos: [['N']], what: 'Add a note at the centre: a dot, or an area or arrow when that tool is on' },
      { combos: [['⇧', 'Drag']], what: 'Draw an arrow from one spot to another' },
      { combos: [['P']], what: 'Pin tool: click for a dot, drag for an area' },
      { combos: [['R']], what: 'Area tool: drag for an area, click for a standard box' },
      { combos: [['A']], what: 'Arrow tool: every drag draws an arrow' },
      { combos: [['S']], what: 'Cycle the source: Ours, Competitor, Other product, Concept, none' },
      { combos: [['Esc']], what: 'Close the note, leave a field, or go back to the Pin tool' },
    ],
  },
  {
    group: 'On a focused pin, or an arrow’s tail or head',
    rows: [
      { combos: [['Arrows']], what: 'Move it 1%' },
      { combos: [['⇧', 'Arrows']], what: 'Move it 5%' },
      { combos: [['Enter']], what: 'Open its note' },
      { combos: [['Delete']], what: 'Delete its note' },
    ],
  },
  {
    group: 'On a focused area’s corner handle',
    rows: [
      { combos: [['Arrows']], what: 'Resize the area 1%' },
      { combos: [['⇧', 'Arrows']], what: 'Resize it 5%' },
    ],
  },
  {
    group: 'In a field',
    rows: [
      { combos: [['Tab']], what: 'Take the grey suggestion and its topics; the next Tab moves on' },
      { combos: [['Esc']], what: 'Dismiss the grey suggestion' },
      { combos: [['⌘', 'Enter']], what: 'Done with this note; focus returns to its pin' },
    ],
  },
  {
    group: 'Session',
    rows: [
      { combos: [['⌘', 'Z']], what: 'Undo' },
      { combos: [['⇧', '⌘', 'Z']], what: 'Redo' },
      { combos: [['?']], what: 'These shortcuts' },
    ],
  },
];

/** The shortcuts, in a small dialog; Escape, the backdrop or the close button shuts it. */
function ShortcutsDialog({
  mac,
  opener,
  onClose,
}: {
  mac: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
}) {
  const show = (k: string) => (mac ? k : k === '⌘' ? 'Ctrl' : k === '⇧' ? 'Shift' : k);
  return (
    <Dialog
      id="shortcuts-title"
      title="Keyboard shortcuts"
      opener={opener}
      onClose={onClose}
      fallback="[data-shortcuts-trigger]"
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3 className="m-0 mb-1.5 text-[13px] font-medium text-muted-foreground">{g.group}</h3>
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
      <p className="mt-4 mb-0 text-[13px] text-muted-foreground">
        None of these fire while you type in a field; <Kbd>Esc</Kbd> leaves it first.
      </p>
    </Dialog>
  );
}

function ToolbarButton({ children, className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        hit,
        'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

/*
 * The landing: the painting fills the page (dusk in dark mode, night in light mode, crossfading
 * when the theme changes), and a glass card sits in the middle, light in light mode and dark in
 * dark mode. The card sets its own text colour (#1a1a1a on white 90%, #f5f5f5 on near-black 90%)
 * and its secondary text is 80% of it, which keeps 4.5:1 with the painting showing through.
 */
/** How far the painting drifts against the pointer, in px at the screen's edge. */
const PARALLAX = { x: 44, y: 28 };
/** The painting is drawn this much larger, so its edges never show as it drifts. */
const PARALLAX_SCALE = 1.1;

function EmptyState({
  dragging,
  inert,
  onChoose,
  onPrivacy,
}: {
  dragging: boolean;
  inert: boolean;
  onChoose: () => void;
  onPrivacy: () => void;
}) {
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
    // The painting is drawn larger than the page for the parallax; this clips it, so the page never scrolls sideways.
    <section
      data-landing
      aria-label="Start"
      inert={inert}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
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
        {/*
         * Light mode lays the night painting over the dusk one and fades it in. The theme
         * provider switches themes with transitions off, so this one is forced on (!); it
         * stands still under reduced motion.
         */}
        <Image
          src="/pin-notes/landing-night.webp"
          alt=""
          fill
          sizes="100vw"
          quality={85}
          className="object-cover opacity-100 transition-opacity! duration-700! ease-in-out! motion-reduce:transition-none! dark:opacity-0"
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
              <div className="overflow-hidden rounded-[1.625rem] bg-white/90 px-7 pt-7 pb-6 text-[#1a1a1a] ring-1 ring-black/10 transition-colors! duration-700! ease-in-out! motion-reduce:transition-none! dark:bg-[#0e0e10]/90 dark:text-[#f5f5f5] dark:ring-black/40">
                <DropFolder
                  active={dragging}
                  className="mx-auto -mt-2 mb-5 w-52 [@media(max-height:760px)]:w-44"
                />
                <h1 className="m-0 text-center text-[1.4rem] leading-snug font-normal tracking-tight text-balance">
                  Your taste, in everything your agent creates.
                </h1>
                <p className="mx-auto mt-2 mb-0 max-w-sm text-center text-sm leading-relaxed text-current/80 text-balance">
                  Mark what you like and dislike on screenshots. Export your guidance for any AI
                  agent.
                </p>
                <div className="mt-5 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={onChoose}
                    className="flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white transition-colors! duration-700! ease-in-out! motion-reduce:transition-none! hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:outline-white"
                  >
                    <Plus className="size-4" aria-hidden />
                    Add images
                  </button>
                  <p
                    className="m-0 text-center text-[13px] leading-relaxed text-current/80"
                    aria-live="polite"
                  >
                    {dragging ? (
                      <span className="text-current">Drop to add them.</span>
                    ) : (
                      'Or drag images or a Pinch export here, or paste.'
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <p className="m-0 shrink-0 bg-gradient-to-t from-black/85 to-transparent px-6 pt-12 pb-4 text-center text-[13px] leading-relaxed text-white">
            <span className="mx-auto block max-w-3xl text-balance">
              Free, no account. Images stay in this browser; AI suggestions send the marked area to
              Anthropic.{' '}
              <button
                type="button"
                data-privacy-trigger
                onClick={onPrivacy}
                className="-mx-1 rounded px-1 underline underline-offset-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                How Pinch uses your data
              </button>
            </span>
            <span className="mx-auto mt-1 block">
              Created by{' '}
              <a
                href="https://yair-works.vercel.app"
                target="_blank"
                rel="noopener"
                className="-mx-1 rounded px-1 underline underline-offset-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
    <nav
      aria-label="Images"
      className="flex w-52 shrink-0 flex-col border-r border-border max-[900px]:w-36"
    >
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
                    : 'transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                )}
              >
                {/* biome-ignore lint/performance/noImgElement: a local image held by this browser */}
                <img
                  src={urls[a.id]}
                  alt=""
                  className="h-12 w-16 shrink-0 rounded object-cover object-top"
                />
                <span className="flex min-w-0 flex-col justify-center gap-0.5">
                  <span className="flex items-center gap-1 font-mono text-[13px] text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                    {hasMarks(a) && <Check className="size-3 text-foreground" aria-hidden />}
                  </span>
                  <span className="truncate text-[13px]">{a.name}</span>
                  {marks.length > 0 && (
                    <span className="flex items-center gap-2 font-mono text-[13px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ThumbsUp aria-hidden className="size-4" />
                        {good}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ThumbsDown aria-hidden className="size-4" />
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
          className={cn(
            hit,
            'flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
          )}
        >
          <Plus className="size-4" aria-hidden />
          Add more
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className={cn(
            hit,
            'flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
          )}
        >
          <RotateCcw className="size-4" aria-hidden />
          Start over
        </button>
      </div>
    </nav>
  );
}

/* ---------- Stage: the image and its marks ---------- */

/** What a drag on the image makes: a dot or an area (the default), or an arrow. */
type Tool = 'pin' | 'area' | 'arrow';
const TOOLS: { kind: Tool; label: string; hint: string; icon: typeof MapPin }[] = [
  {
    kind: 'pin',
    label: 'Pin',
    hint: 'Click for a dot, drag for an area. Shift-drag for an arrow. Key: P',
    icon: MapPin,
  },
  {
    kind: 'area',
    label: 'Area',
    hint: 'Drag to mark an area; click for a standard box. Key: R',
    icon: SquareDashed,
  },
  {
    kind: 'arrow',
    label: 'Arrow',
    hint: 'Drag from one spot to another: "move this there", "align this with that". Key: A',
    icon: MoveUpRight,
  },
];
/** What each tool does, for the stage's name and the toast when a key picks one. */
const TOOL_WHAT: Record<Tool, string> = {
  pin: 'Click to add a dot, drag to mark an area, Shift-drag to draw an arrow.',
  area: 'Drag to mark an area, or click for a standard box.',
  arrow: 'Drag from one spot to another to draw an arrow.',
};
/** The box a click makes with the Area tool: a share of the image, centred on the click, kept inside. */
const STANDARD_AREA = { w: 0.16, h: 0.1 };
const standardAreaAt = (p: { x: number; y: number }): Area => ({
  kind: 'area',
  x: Math.min(1 - STANDARD_AREA.w, Math.max(0, p.x - STANDARD_AREA.w / 2)),
  y: Math.min(1 - STANDARD_AREA.h, Math.max(0, p.y - STANDARD_AREA.h / 2)),
  ...STANDARD_AREA,
});
/** What the first upload and an empty panel say. */
const HOW_TO_MARK =
  'Click the image for a dot, drag across it for an area, or pick Area or Arrow in the toolbar, then say what works and what doesn’t.';

type ArrowEnd = 'tail' | 'head';

/** An image this much taller than wide is a full-page capture: fitted whole it is a sliver. */
const TALL = 2.2;
const isTall = (a: { width: number; height: number }) => a.height / a.width > TALL;

/** The pill style the stage's floating controls share: the Tool switch and the Fit switch. */
const stagePill =
  'absolute top-3 z-10 m-0 flex gap-0.5 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur-sm dark:shadow-none';
/**
 * A pill in a segmented tray. Hover fills an unselected pill with the muted tone; the selected
 * one is stronger: the accent fill plus a faint ring, so it still reads as selected beside a
 * hovered neighbour.
 */
const stagePillButton =
  'relative inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors duration-150 outline-none motion-reduce:transition-none after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-foreground/15 aria-pressed:hover:bg-accent';

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
  fitWidth,
  onFitWidth,
  onSelect,
  onAdd,
  onChange,
}: {
  asset: Asset;
  url: string;
  selected: string | null;
  tool: Tool;
  onTool: (tool: Tool) => void;
  /** A tall image fills the width and scrolls; otherwise every image fits whole. */
  fitWidth: boolean;
  onFitWidth: (on: boolean) => void;
  onSelect: (id: string) => void;
  onAdd: (shape: Shape) => void;
  onChange: (id: string, change: Partial<Mark>) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const tall = isTall(asset);
  const scrolls = tall && fitWidth;

  // Fit the image inside the stage: whole, or to its width when a tall image is set to scroll.
  // Marks are fractions of the frame and the pointer is read against the frame's rectangle, so
  // scrolling changes nothing about drawing.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const pad = 32;
      const aw = Math.max(0, el.clientWidth - pad * 2);
      const ah = Math.max(0, el.clientHeight - pad * 2);
      const scale = scrolls ? aw / asset.width : Math.min(aw / asset.width, ah / asset.height);
      setSize({ w: Math.floor(asset.width * scale), h: Math.floor(asset.height * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [asset.width, asset.height, scrolls]);

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
        // A click (or a drag too small to be an area). Clicking while a note is open closes it and
        // starts the next one: no extra click per pin. With the Area tool it makes a standard box.
        onAdd(tool === 'area' ? standardAreaAt(at(e)) : { kind: 'dot', ...at(e) });
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

  /** Arrow keys on an area's corner handle resize it: 1% a press, 5% with Shift. Enter opens the note. */
  const resizeByKey = (e: ReactKeyboardEvent, mark: Mark) => {
    if (mark.shape.kind !== 'area') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(mark.id);
      return;
    }
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d) return;
    e.preventDefault();
    const s = mark.shape;
    const area = areaFrom(s.x, s.y, s.x + s.w + d[0], s.y + s.h + d[1]);
    if (!isTinyArea(area)) onChange(mark.id, { shape: area, confirmed: true });
  };

  const draft = gesture?.kind === 'draw' ? gesture.area : null;
  const draftArrow = gesture?.kind === 'draw' ? gesture.arrow : null;
  // The open area dims the rest of the image. The dim is its own layer, clipped to the image,
  // so it never leaks onto the stage and never clips a pin sitting on the edge.
  const openArea = asset.marks.find((m) => m.id === selected)?.shape;
  const dim = openArea?.kind === 'area' ? openArea : null;

  return (
    <div className="relative min-w-0 flex-1">
      {/* The tool, floating over the top of the canvas: a segmented control, pills like the source picker. */}
      <fieldset className={cn(stagePill, 'left-1/2 -translate-x-1/2')}>
        <legend className="sr-only">Tool</legend>
        {TOOLS.map((t) => (
          <button
            key={t.kind}
            type="button"
            aria-pressed={tool === t.kind}
            title={t.hint}
            onClick={() => onTool(t.kind)}
            className={stagePillButton}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </fieldset>
      {tall && (
        // A full-page capture: fit it whole (a sliver), or to the width and scroll down it.
        <fieldset className={cn(stagePill, 'right-3')}>
          <legend className="sr-only">How the tall image fits</legend>
          <button
            type="button"
            aria-pressed={!fitWidth}
            title="Fit the whole image in the stage"
            onClick={() => onFitWidth(false)}
            className={stagePillButton}
          >
            Fit
          </button>
          <button
            type="button"
            aria-pressed={fitWidth}
            title="Fit the image to the stage's width and scroll down it"
            onClick={() => onFitWidth(true)}
            className={stagePillButton}
          >
            Fit width
          </button>
        </fieldset>
      )}
      <div
        ref={box}
        // A faint 24px grid behind the image, like a design canvas. Scrolls only for a tall image.
        className={cn(
          'absolute inset-0 flex bg-muted/40 bg-[linear-gradient(to_right,rgb(0_0_0/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.05)_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)]',
          scrolls
            ? 'overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]'
            : 'overflow-hidden',
        )}
      >
        {/* Auto margins centre the frame and, unlike flex alignment, still let it scroll when it is taller than the stage. */}
        <div
          ref={frame}
          role="application"
          aria-label={`${asset.name}. ${TOOL_WHAT[tool]}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setGesture(null)}
          className="relative m-auto shrink-0 cursor-crosshair touch-none select-none shadow-sm"
          style={{
            width: size.w,
            height: size.h,
            marginTop: scrolls ? 32 : undefined,
            marginBottom: scrolls ? 32 : undefined,
          }}
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
              onResizeKey={(e) => resizeByKey(e, m)}
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
  onResizeKey,
  onEnd,
  onKey,
}: {
  mark: Mark;
  number: number;
  selected: boolean;
  size: { w: number; h: number };
  onDown: (e: ReactPointerEvent) => void;
  onResize: (e: ReactPointerEvent) => void;
  onResizeKey: (e: ReactKeyboardEvent) => void;
  onEnd: (e: ReactPointerEvent, end: ArrowEnd) => void;
  onKey: (e: ReactKeyboardEvent, end?: ArrowEnd) => void;
}) {
  const v = verdictOf(mark);
  const color = VERDICT_COLOR[v];
  const label = `Note ${number}${mark.label ? `: ${mark.label}` : ''}${v === 'empty' ? ' (empty)' : ''}`;
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
      data-mark={mark.id}
      aria-label={label}
      aria-pressed={selected}
      onPointerDown={onDown}
      onKeyDown={(e) => onKey(e)}
      className={cn(
        // The pin keeps its size; an invisible ::after takes the hit area to 44px or more.
        'pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-neutral-900 font-mono text-[13px] font-semibold text-white shadow-[0_1px_5px_rgb(0_0_0/0.5)] dark:bg-white dark:text-neutral-900 after:absolute after:-inset-3 after:content-[""] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:cursor-grabbing',
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
          <ArrowLine arrow={a} size={size} color={color} />
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
              data-mark={mark.id}
              data-end
              aria-label={`${label}, tail`}
              onPointerDown={(e) => onEnd(e, 'tail')}
              onKeyDown={(e) => onKey(e, 'tail')}
              className={handle}
              style={{ left: arrowPx.tx, top: arrowPx.ty }}
            />
            <button
              type="button"
              data-mark={mark.id}
              data-end
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
      className="pointer-events-none absolute border-2"
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
        // The bottom-right corner resizes, by drag or, once focused, by the arrow keys; the
        // top-left one carries the number.
        <button
          type="button"
          data-mark={mark.id}
          data-end
          aria-label={`${label}, corner: arrow keys resize`}
          onPointerDown={onResize}
          onKeyDown={onResizeKey}
          className="pointer-events-auto absolute -right-2 -bottom-2 size-3.5 cursor-nwse-resize rounded-sm border-2 border-neutral-900 bg-white after:absolute after:-inset-3 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
  suggestionsOn,
  suggesting,
  onSource,
  onSourceForAll,
  onSelect,
  onChangeMark,
  onRemoveMark,
  onDone,
  onPrev,
  onNext,
  onRemove,
  dismissed,
  onDismiss,
}: {
  asset: Asset;
  number: number;
  total: number;
  selected: string | null;
  suggestionsOn: boolean;
  suggesting: string | null;
  onSource: (source: Source | undefined) => void;
  onSourceForAll: () => void;
  onSelect: (id: string) => void;
  onChangeMark: (id: string, change: Partial<Mark>) => void;
  onRemoveMark: (id: string) => void;
  onDone: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRemove: () => void;
  /** Suggestions dismissed, by `note:field`, with the shape key they were written for. */
  dismissed: Record<string, string>;
  onDismiss: (markId: string, field: SuggestedKey, shape: string) => void;
}) {
  const mark = asset.marks.find((m) => m.id === selected);
  const markNumber = asset.marks.findIndex((m) => m.id === selected) + 1;
  const suggestion = mark && suggestionsOn ? currentSuggestion(mark) : undefined;

  return (
    <aside
      aria-label="Notes"
      className="flex w-[22rem] shrink-0 flex-col border-l border-border max-[900px]:w-64"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <span className="font-mono text-[13px] text-muted-foreground">
          {number} / {total}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={asset.name}>
          {asset.name}
        </span>
        <button
          type="button"
          aria-label="Remove this image"
          onClick={onRemove}
          className={cn(
            hit,
            'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
          )}
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
            suggestion={suggestion}
            suggesting={suggestionsOn && suggesting === mark.id}
            dismissed={(field) =>
              Boolean(suggestion) && dismissed[`${mark.id}:${field}`] === suggestion?.shape
            }
            onDismiss={(field) => suggestion && onDismiss(mark.id, field, suggestion.shape)}
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
              <p className="m-0 text-sm text-muted-foreground">{HOW_TO_MARK}</p>
            ) : (
              <ol className="m-0 list-none space-y-1.5 p-0">
                {asset.marks.map((m, i) => (
                  <li key={m.id}>
                    <MarkRow mark={m} number={i + 1} onOpen={() => onSelect(m.id)} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border p-3">
        <button
          type="button"
          onClick={onPrev}
          disabled={number === 1}
          className={cn(
            hit,
            'flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-40',
          )}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={number === total}
          className={cn(
            hit,
            'flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-40',
          )}
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
  const topics = sortTopics(mark.topics ?? []);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 rounded-lg border border-border p-2.5 text-left transition-colors duration-150 motion-reduce:transition-none hover:bg-muted"
    >
      <span
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 font-mono text-[13px] font-semibold text-white dark:bg-white dark:text-neutral-900"
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-medium">
          {mark.label || mark.good || mark.bad || 'Empty note'}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {mark.shape.kind}
          {v !== 'empty' && (
            <>
              {' · '}
              {(v === 'good' || v === 'both') && (
                <ThumbsUp aria-hidden className="size-3.5" />
              )}
              {(v === 'bad' || v === 'both') && (
                <ThumbsDown aria-hidden className="size-3.5" />
              )}
              {v === 'both' ? 'works and doesn’t' : v === 'good' ? 'works' : 'doesn’t work'}
            </>
          )}
          {topics.length > 0 && (
            <span className="min-w-0 truncate">· {topics.map(topicLabel).join(', ')}</span>
          )}
        </span>
      </span>
    </button>
  );
}

/** The fields a suggestion fills, by the suggestion's own names. */
type SuggestedKey = 'works' | 'doesNotWork';

function MarkEditor({
  mark,
  number,
  suggestion,
  suggesting,
  dismissed,
  onDismiss,
  onChange,
  onRemove,
  onDone,
}: {
  mark: Mark;
  number: number;
  suggestion?: Suggestion;
  suggesting: boolean;
  dismissed: (field: SuggestedKey) => boolean;
  onDismiss: (field: SuggestedKey) => void;
  onChange: (c: Partial<Mark>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const first = useRef<HTMLTextAreaElement>(null);
  const mac = useIsMac();
  // A note opens ready to type, however it was opened (a click on its pin, a key), so the next
  // keystrokes go into it and never fire a shortcut. The caret goes after any text already there.
  useEffect(() => {
    const el = first.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const ghost = (field: SuggestedKey) =>
    dismissed(field) ? undefined : suggestion?.[field] || undefined;
  // A suggestion's topics come with its words, unless the note already has topics of its own.
  const ownTopics = mark.topics !== undefined;
  const showsGhost = Boolean((!mark.good && ghost('works')) || (!mark.bad && ghost('doesNotWork')));
  const suggestedTopics = !ownTopics && showsGhost ? suggestion?.topics : undefined;
  const takeTopics = (accepted: boolean) =>
    accepted && !ownTopics && suggestion?.topics?.length ? { topics: suggestion.topics } : {};
  const doneOnShortcut = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <section className="space-y-3" aria-label={`Note ${number}`}>
      {/* The note's actions sit by its title, as the image's do; the keys for them are in Done's tooltip. */}
      <TooltipProvider>
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-[13px] font-medium text-muted-foreground">
            Note {number} · {mark.shape.kind}
          </h2>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Delete note"
                  onClick={onRemove}
                  className={cn(
                    hit,
                    'ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              }
            />
            <TooltipContent>Delete note</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={onDone}
                  className={cn(
                    hit,
                    'flex min-h-8 items-center gap-1 rounded-md px-2 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                  )}
                >
                  <Check className="size-4" aria-hidden />
                  Done
                </button>
              }
            />
            <TooltipContent>
              <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>Enter</Kbd> done · <Kbd>Esc</Kbd> close
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      <SuggestedField
        ref={first}
        id={`works-${mark.id}`}
        label="What works"
        verdict="good"
        value={mark.good}
        suggestion={ghost('works')}
        suggesting={suggesting}
        example="One big number with nothing competing"
        onChange={(good, accepted) =>
          onChange({
            good,
            accepted: withAccepted(mark.accepted, 'good', good, accepted),
            ...takeTopics(accepted),
          })
        }
        onDismiss={() => onDismiss('works')}
        onKeyDown={doneOnShortcut}
      />
      <SuggestedField
        id={`doesnt-${mark.id}`}
        label="What doesn’t"
        verdict="bad"
        value={mark.bad}
        suggestion={ghost('doesNotWork')}
        suggesting={suggesting}
        example="Six badges compete for attention"
        onChange={(bad, accepted) =>
          onChange({
            bad,
            accepted: withAccepted(mark.accepted, 'bad', bad, accepted),
            ...takeTopics(accepted),
          })
        }
        onDismiss={() => onDismiss('doesNotWork')}
        onKeyDown={doneOnShortcut}
      />
      <TopicPicker
        topics={mark.topics}
        suggested={suggestedTopics}
        onChange={(topics) => onChange({ topics })}
      />
    </section>
  );
}

/**
 * What a note is about: six toggle tags, any number on, none needed. Off, a tag is outlined; on,
 * it is filled with its tint. While a grey suggestion shows and the note has no
 * topics yet, the suggestion's topics have a dashed border: taking the suggestion turns them on.
 */
function TopicPicker({
  topics,
  suggested,
  onChange,
}: {
  topics?: Topic[];
  suggested?: Topic[];
  onChange: (topics: Topic[]) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0 text-[13px] text-muted-foreground">
      <legend className="mb-1 p-0 text-[13px] leading-7 font-medium">This note is about</legend>
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
 * Keys on a field that shows a grey suggestion. Tab takes it as real text and keeps focus in the
 * field, so the next Tab moves on as usual; Shift+Tab moves back without taking it; Escape, or
 * Delete or Backspace in the empty field, dismisses it (the second Escape then closes the note).
 * Returns whether the key was spent here.
 */
function ghostKey(
  e: React.KeyboardEvent,
  ghost: string,
  accept: () => void,
  dismiss: () => void,
): boolean {
  if (!ghost) return false;
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    accept();
    return true;
  }
  if (e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    e.stopPropagation();
    dismiss();
    return true;
  }
  return false;
}

/**
 * Whether something stays for a moment after it is switched off, so it can fade out: true while
 * `on`, and for `ms` after it goes.
 */
function useLingers(on: boolean, ms: number) {
  const [lingering, setLingering] = useState(on);
  useEffect(() => {
    if (on) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on || lingering;
}

/**
 * The grey suggestion drawn over an empty field: the field's own box, padding and type, so it
 * reads as a placeholder, but it can fade in and out, which a native placeholder cannot. Hidden
 * from assistive tech (the sr-only hint beside the field carries the words); it follows the
 * field's size when the user resizes it. The last text stays while it fades out.
 */
function Ghost({
  text,
  field,
}: {
  text: string;
  field: React.RefObject<HTMLElement | null>;
}) {
  const last = useRef(text);
  if (text) last.current = text;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [field]);
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-0 left-0 size-full overflow-hidden rounded-lg border border-transparent px-3 py-2 text-sm whitespace-pre-wrap text-[#737373] [overflow-wrap:break-word] dark:text-[#7a7a7a]',
        ghostFade,
      )}
      style={{ opacity: text ? 1 : 0, width: size?.w, height: size?.h }}
    >
      {last.current}
    </div>
  );
}

/*
 * The suggestion hint ("AI suggestion · Tab to use · Esc to dismiss") shows once: the first time a
 * suggestion appears, on one field, until the owner closes it or uses a suggestion (Tab, Esc,
 * Delete, or typing in that field). Then it never comes back, in this browser.
 */
const HINT_KEY = 'pinch-suggestion-hint';
const hintListeners = new Set<() => void>();
let hintOwner: string | null = null;
let hintSeen: boolean | null = null;
const emitHint = () => {
  for (const l of hintListeners) l();
};
const subscribeHint = (l: () => void) => {
  hintListeners.add(l);
  return () => {
    hintListeners.delete(l);
  };
};
const readHintSeen = () => {
  if (hintSeen === null) hintSeen = local.get(HINT_KEY) === '1';
  return hintSeen;
};
function dismissHint() {
  if (readHintSeen()) return;
  hintSeen = true;
  hintOwner = null;
  local.set(HINT_KEY, '1');
  emitHint();
}

/** Whether this field shows the one-time hint now, and how to close it for good. */
function useSuggestionHint(id: string, ghost: string) {
  // On the server it counts as seen, so the page never flashes a hint before it knows.
  const seen = useSyncExternalStore(subscribeHint, readHintSeen, () => true);
  const owner = useSyncExternalStore(subscribeHint, () => hintOwner, () => null);
  // The first field to show a suggestion claims the hint; if it goes away unused (another note
  // opens), the next one may.
  useEffect(() => {
    if (ghost && !seen && hintOwner === null) {
      hintOwner = id;
      emitHint();
    }
  }, [ghost, seen, id]);
  useEffect(
    () => () => {
      if (hintOwner === id) {
        hintOwner = null;
        emitHint();
      }
    },
    [id],
  );
  return { visible: !seen && owner === id && Boolean(ghost), dismiss: dismissHint };
}

/** A key chip inside the hint, whose colours are the page's inverted. */
const tipKbd = 'border-background/30 bg-background/15 text-background';

/** The hint above a field: the keys for a grey suggestion, with a close button. */
function SuggestionTip({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <div
      role="status"
      aria-hidden={!visible}
      className={cn(
        'absolute bottom-full left-0 z-20 mb-2 flex w-max max-w-full items-center gap-1 rounded-md bg-foreground py-1.5 pr-1 pl-2.5 text-[13px] leading-tight text-background shadow-lg transition-opacity duration-200 motion-reduce:transition-none dark:shadow-none',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <span>
        AI suggestion · <Kbd className={tipKbd}>Tab</Kbd> to use · <Kbd className={tipKbd}>Esc</Kbd>{' '}
        to dismiss
      </span>
      <button
        type="button"
        tabIndex={visible ? 0 : -1}
        aria-label="Close this hint"
        onClick={onClose}
        className={cn(
          hit,
          'relative flex size-6 shrink-0 items-center justify-center rounded text-background transition-colors duration-150 outline-none motion-reduce:transition-none hover:bg-background/20 focus-visible:ring-2 focus-visible:ring-background/60',
        )}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * A note field with an AI suggestion as its grey text: Tab in the empty field takes it as real
 * text, Escape dismisses it, any other key types over it. The example placeholder shows only
 * when no suggestion applies.
 */
function SuggestedField({
  ref,
  id,
  label,
  verdict,
  value,
  suggestion,
  suggesting,
  example,
  onChange,
  onDismiss,
  onKeyDown,
}: {
  ref?: React.Ref<HTMLTextAreaElement>;
  id: string;
  label: string;
  verdict: 'good' | 'bad';
  value: string;
  suggestion?: string;
  suggesting: boolean;
  example: string;
  onChange: (value: string, accepted: boolean) => void;
  onDismiss: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const ghost = !value && suggestion ? suggestion : '';
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const hint = useSuggestionHint(id, ghost);
  const ghostLingers = useLingers(Boolean(ghost), 220);
  const Icon = verdict === 'good' ? ThumbsUp : ThumbsDown;
  return (
    <div className="relative text-[13px] text-muted-foreground">
      <SuggestionLabel id={id} working={!value && suggesting}>
        <Icon aria-hidden className="size-4 shrink-0" />
        {label}
      </SuggestionLabel>
      <div className="relative">
        <SuggestionTip visible={hint.visible} onClose={hint.dismiss} />
        <textarea
          ref={setRef}
          id={id}
          rows={3}
          maxLength={1000}
          value={value}
          onChange={(e) => {
            if (hint.visible) hint.dismiss();
            onChange(e.target.value, false);
          }}
          onKeyDown={(e) => {
            const used = ghostKey(
              e,
              ghost,
              () => {
                if (hint.visible) hint.dismiss();
                onChange(ghost, true);
              },
              () => {
                if (hint.visible) hint.dismiss();
                onDismiss();
              },
            );
            if (!used) onKeyDown(e);
          }}
          aria-describedby={ghost ? `${id}-hint` : undefined}
          className={field}
          placeholder={ghostLingers || suggesting ? '' : example}
        />
        <Ghost text={ghost} field={inner} />
      </div>
      <SuggestionHint id={id} ghost={ghost} />
    </div>
  );
}

/**
 * A field's label row with, on the right, the "Suggesting…" pill, which fades and keeps its
 * height, so a suggestion arriving doesn't move the field.
 */
function SuggestionLabel({
  id,
  working,
  children,
}: {
  id: string;
  working: boolean;
  children: React.ReactNode;
}) {
  return (
    // Positioned, so its sr-only live region stays inside the panel's scroll area.
    <label htmlFor={id} className="relative mb-1 flex min-h-7 items-center gap-1.5">
      {children}
      <WorkingPill
        aria-hidden={!working}
        className={cn('ml-auto', ghostFade, working ? 'opacity-100' : 'opacity-0')}
      >
        Suggesting…
      </WorkingPill>
      <span className="sr-only" aria-live="polite">
        {working ? 'Suggesting…' : ''}
      </span>
    </label>
  );
}

function SuggestionHint({ id, ghost }: { id: string; ghost: string }) {
  if (!ghost) return null;
  return (
    <span id={`${id}-hint`} className="sr-only">
      Suggestion: {ghost} Press Tab to use it, Escape to dismiss it.
    </span>
  );
}

/**
 * Whose design the image is: four radio rows, optional (Clear takes it off). New images take
 * the open one's. Arrow keys move and choose, as in any radio group.
 */
/** One icon per source: our own product, a rival, the wider world, an idea. */
const SOURCE_ICONS = { ours: House, competitor: Swords, other: Globe, concept: Lightbulb };

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
  const group = useRef<HTMLDivElement>(null);
  const current = SOURCES.findIndex((s) => s.kind === source?.kind);
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    // Two columns: left and right move one, up and down move a row.
    const step = { ArrowDown: 2, ArrowRight: 1, ArrowUp: -2, ArrowLeft: -1 }[e.key];
    const to =
      step !== undefined
        ? (i + step + SOURCES.length) % SOURCES.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? SOURCES.length - 1
            : undefined;
    if (to === undefined) return;
    e.preventDefault();
    // The page's own arrow keys change the image; inside the group they only move the choice.
    e.stopPropagation();
    onChange({ kind: SOURCES[to].kind });
    group.current?.querySelectorAll<HTMLButtonElement>('[role=radio]')[to]?.focus();
  };
  const small = cn(
    hit,
    'min-h-7 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
  );
  return (
    <section aria-labelledby="source-heading">
      <div className="mb-2 flex items-center gap-1">
        <h2 id="source-heading" className="m-0 text-[13px] font-medium text-muted-foreground">
          Source
        </h2>
        {source && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={cn(small, 'ml-auto')}
          >
            Clear
          </button>
        )}
        {source && total > 1 && (
          <button type="button" onClick={onForAll} className={small}>
            Set for all {total}
          </button>
        )}
      </div>
      {/* A 2×2 grid of bordered radio buttons; 36px buttons 8px apart, so their 44px hit areas tile. */}
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby="source-heading"
        className="grid grid-cols-2 gap-2"
      >
        {SOURCES.map((s, i) => {
          const checked = i === current;
          const Icon = SOURCE_ICONS[s.kind];
          return (
            // biome-ignore lint/a11y/useSemanticElements: a styled radio row; the group keeps its own roving tabindex and arrow keys
            <button
              key={s.kind}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked || (current < 0 && i === 0) ? 0 : -1}
              title={s.hint}
              onClick={() => onChange({ kind: s.kind })}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                hit,
                'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] leading-tight transition-colors duration-150 outline-none motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                checked
                  ? 'border-choice font-medium text-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                  checked ? 'border-choice' : 'border-foreground/30',
                )}
              >
                {checked && <span className="size-2 rounded-full bg-choice" />}
              </span>
              <Icon aria-hidden className="size-4 shrink-0" />
              {s.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
