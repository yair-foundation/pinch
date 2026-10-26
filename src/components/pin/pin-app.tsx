'use client';

import {
  ArrowLeft,
  Library,
  Plus,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Asset,
  cleanScreenTag,
  exportName,
  itemsOf,
  type Mark,
  type Source,
  verdictOf,
} from '@/lib/pin/model';
import { assetsOf, readExport } from '@/lib/pin/import';
import { noteFingerprint } from '@/lib/pin/learnings';
import { screenGroup, } from '@/lib/pin/screen-index';
import { changedEntries, fingerprint, logEntries, MAX_BATCH } from '@/lib/pin/notes-log';
import { unzip } from '@/lib/pin/unzip';
import { updatePrice } from '@/lib/pin/credits';
import { cn } from '@/lib/utils';
import { PinchWordmark } from './brand';
import {
  AccessGate,
  AccountMenu,
  DeleteAccountDialog,
  OFFER,
  type Offer,
  signOut,
  useMe,
} from './account';
import { cloudBackend } from './cloud-store';
import { CollectionsView } from './collections';
import { browserBackend } from './collections-store';
import { Dialog, hit } from './dialog';
import { DropFolder } from './drop-folder';
import { Reel } from './reel';
import {
  buildExport,
  prepareImage,
} from './render';
import * as store from './store';

/*
 * Pinch: add a batch of screenshots and talk through them on the reel (D131, `reel.tsx`), the
 * microphone and the pointer kept as a take; Your rules reads notes into rules. Images stay in
 * this browser; the text of written notes is saved anonymously (`notes-log.ts`).
 */

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

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
 * History: snapshots of the session before each change, so a toast's Undo puts it back.
 * A change can coalesce into the step before it, by key and within a pause; a silent
 * change is no step at all.
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

  undo(): Asset[] | undefined {
    const step = this.past.pop();
    if (!step) return undefined;
    this.future.push(this.current);
    this.current = step.before;
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

/** A note's fingerprint as the rules keep it, to find it among the open images (D110). */
const markPrint = (a: Asset, m: Mark) =>
  noteFingerprint(exportName(a), itemsOf(m.good).join('\n'), itemsOf(m.bad).join('\n'));

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
const SENT_KEY = 'pinch-sent';
/** "off" when the visitor switched off saving their notes' words (D82). */
const SAVE_NOTES_KEY = 'pinch-save-notes';
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

/** One tab's name, so a tab can tell its own saves from another's. */
const TAB_ID = newId();

type DialogKind = 'shortcuts' | 'privacy' | 'home' | 'delete' | 'pay';

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
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  // The batch, or the collections in its place (D79). Per visit.
  const [view, setView] = useState<'batch' | 'collections'>('batch');
  const viewRef = useRef(view);
  viewRef.current = view;
  // Who is looking, and their credits (D81, D98). Anyone marks images and reads notes into
  // rules with their credits; AI suggestions are for buyers, once billing is on.
  const { me, refresh: refreshMe } = useMe();
  // Credits are counted once billing is on, except for buyers of the original offer (D98).
  const credits =
    me?.paywall && me.credits && !me.credits.original
      ? { balance: me.credits.balance, closed: me.credits.closed }
      : null;
  // The rules live in the account once signed in, in this browser otherwise.
  const cloudKey = me?.user && me.cloud && me.folder ? `${me.cloud} ${me.folder}` : '';
  const backend = useMemo(() => {
    if (!cloudKey) return browserBackend;
    const [mode, folder] = cloudKey.split(' ');
    return cloudBackend(folder, mode as 'blob' | 'memory');
  }, [cloudKey]);
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
      setStatus((s) => (s?.action ? null : s));
      collect();
    },
    [collect],
  );
  const undo = useCallback(() => restore(history.current.undo()), [restore]);

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
  }, []);

  // Back from Google: say how it went, once, and take the word out of the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const signin = url.searchParams.get('signin');
    if (!signin) return;
    setStatus(
      signin === 'off'
        ? { tone: 'error', text: 'Sign-in isn’t set up on this site yet.' }
        : { tone: 'error', text: 'Sign-in didn’t finish. Try again.' },
    );
    url.searchParams.delete('signin');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
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
            ? 'Browser storage is full. Remove some images, then continue.'
            : store.inMemory()
              ? 'This browser blocks storage, so your session lasts until you close the tab. Open Your rules before you leave.'
              : "Couldn't save in this browser. Open Your rules to keep what your notes teach.",
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
    if (local.get(SAVE_NOTES_KEY) === 'off') return;
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
      // No cap on images (D103): only the browser's storage stops them.
      const added: Asset[] = [];
      const addedUrls: Record<string, string> = {};
      let full = false;
      for (const { asset, image } of found.assets) {
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
      if (full)
        lines.push(
          `Browser storage is full${leftOut ? `, so ${count(leftOut, 'image')} ${leftOut === 1 ? 'was' : 'were'} left out` : ''}. Remove images, then continue.`,
        );
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
      // No cap on images (D103): only the browser's storage stops them, and the message says so.
      const images = all;
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
      // And its tag (D100), for the same reason.
      const screenTag = cleanScreenTag(assetsRef.current[indexRef.current]?.screenTag);
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
          ...(screenTag ? { screenTag } : {}),
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
      const trouble = failed.length > 0 || skipped > 0 || full;
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

  /** A screen tag merged into another on Your rules (D129): the open images take the new name. */
  const renameScreenTag = (from: string, into: string) => {
    const moves = (a: Asset) =>
      Boolean(cleanScreenTag(a.screenTag)) &&
      screenGroup(cleanScreenTag(a.screenTag)) === screenGroup(from);
    if (!assetsRef.current.some(moves)) return;
    commit((list) => list.map((a) => (moves(a) ? { ...a, screenTag: into } : a)));
  };

  const tagged = assets.filter(hasMarks);
  const allMarks = tagged.flatMap((a) => a.marks.filter((m) => verdictOf(m) !== 'empty'));

  const startOver = () => {
    const images = assets.length;
    const notes = allMarks.length;
    commit([]);
    setIndex(0);
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
  }, [markExported]);

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
  // The batch's own controls in the header: its count, suggestions, export and keys.
  const batchTools = view === 'batch' && assets.length > 0;
  // Credits bought, in this tab or another: the ask goes, and says so.
  const balanceAtPay = useRef<number | null>(null);
  useEffect(() => {
    const balance = me?.credits?.balance;
    if (dialog !== 'pay' || balance === undefined || balanceAtPay.current === null) return;
    if (balance > balanceAtPay.current) {
      closeDialog();
      setStatus({ tone: 'info', text: `Credits added: ${balance} to use.` });
    }
  }, [dialog, me, closeDialog]);
  const openPay = () => {
    balanceAtPay.current = me?.credits?.balance ?? 0;
    openDialog('pay');
  };
  // Each open note's best mark, when the author set one, so it reaches the rules (D110).
  const openBest = useMemo(
    () =>
      new Map<string, boolean>(
        assets.flatMap((a) =>
          a.marks
            .filter((m) => verdictOf(m) !== 'empty' && m.best !== undefined)
            .map((m) => [markPrint(a, m), Boolean(m.best)] as const),
        ),
      ),
    [assets],
  );
  /** A best example marked on Your rules, carried to its note on an open image (D110). */
  const setOpenBest = (print: string, best: boolean) => {
    const a = assetsRef.current.find((x) => x.marks.some((m) => markPrint(x, m) === print));
    if (!a) return;
    update(a.id, (x) => ({
      ...x,
      marks: x.marks.map((m) => (markPrint(x, m) === print ? { ...m, best } : m)),
    }));
  };
  // Each open note's screen tags by its fingerprint as kept, so tags typed later reach the rules.
  const openScreens = useMemo(
    () =>
      new Map<string, string | undefined>(
        assets.flatMap((a) =>
          a.marks
            .filter((m) => verdictOf(m) !== 'empty')
            .map(
              (m) =>
                [
                  noteFingerprint(
                    exportName(a),
                    itemsOf(m.good).join('\n'),
                    itemsOf(m.bad).join('\n'),
                  ),
                  cleanScreenTag(a.screenTag) || undefined,
                ] as const,
            ),
        ),
      ),
    [assets],
  );
  // The open notes as the rules know them, to tell whether coming to the rules brings new ones.
  const openPrints = useMemo(
    () =>
      assets.flatMap((a) =>
        a.marks
          .filter((m) => verdictOf(m) !== 'empty')
          .map((m) => noteFingerprint(exportName(a), m.good, m.bad)),
      ),
    [assets],
  );

  const leaveAccount = async (text: string) => {
    closeDialog();
    setView('batch');
    await refreshMe();
    setStatus({ tone: 'info', text });
  };

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
              'h-9 rounded-full bg-background/80 px-3.5 shadow-sm ring-1 ring-border/70 backdrop-blur-md transition-colors! duration-700! ease-in-out! motion-reduce:transition-none!',
          )}
        >
          {landing ? (
            <PinchWordmark className="h-[15px]" />
          ) : (
            // Home is a new batch; a modified click still opens a new tab, as a link should.
            <a
              href={pathname}
              data-home-trigger
              aria-label={view === 'collections' ? 'Pinch, back to your images' : 'Pinch, start over'}
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
              'gap-0.5 rounded-full bg-background/80 p-1 shadow-sm ring-1 ring-border/70 backdrop-blur-md transition-colors! duration-700! ease-in-out! motion-reduce:transition-none!',
          )}
        >
          {loaded && (
            // Between the images and the rules, which take their place (D79). With images open
            // it is the batch's main step (D87): the notes go to the rules, which read them.
            <button
              type="button"
              onClick={() => setView(view === 'batch' ? 'collections' : 'batch')}
              className={cn(
                hit,
                'flex items-center text-sm transition-colors duration-150 motion-reduce:transition-none',
                landing
                  ? 'h-7 gap-1.5 rounded-full px-2.5 hover:bg-muted'
                  : batchTools
                    ? 'min-h-9 gap-2 rounded-md bg-foreground px-3 font-medium text-background hover:bg-foreground/85'
                    : 'min-h-9 gap-2 rounded-md border border-border px-3 hover:bg-muted',
              )}
            >
              {view === 'batch' ? (
                <Library className="size-4" aria-hidden />
              ) : (
                <ArrowLeft className="size-4" aria-hidden />
              )}
              {view === 'batch' ? 'Your rules' : 'Back'}
            </button>
          )}
          {me?.paywall && me.signIn && !me.user && (
            // Signing in keeps the rules and the credits in the account, on any device (D98).
            <a
              href="/api/pin/auth/google"
              className={cn(
                hit,
                'flex items-center text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
                landing ? 'h-7 rounded-full px-2.5' : 'min-h-9 rounded-md px-2.5',
              )}
            >
              Sign in
            </a>
          )}
          {loaded && (
            // The account and the page's settings, at the far right (D93).
            <AccountMenu
              me={me}
              landing={landing}
              onShortcuts={() => openDialog('shortcuts')}
              onPrivacy={() => openDialog('privacy')}
              onDelete={() => openDialog('delete')}
              onSignOut={async () => {
                await signOut();
                await leaveAccount('Signed out.');
              }}
            />
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
          This browser blocks storage, so your session lasts until you close the tab. Open Your
          rules before you leave.
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
          key={cloudKey || 'browser'}
          inert={dialog !== null}
          backend={backend}
          moveFrom={cloudKey ? browserBackend : undefined}
          openPrints={openPrints}
          openScreens={openScreens}
          onRenameScreenTag={renameScreenTag}
          openBest={openBest}
          onOpenBest={setOpenBest}
          batchZip={batchZip}
          account={me?.user ? 'in' : me?.signIn ? 'out' : 'none'}
          credits={credits}
          plan={me?.plan ?? null}
          onPay={openPay}
          onCredits={refreshMe}
          onBack={() => setView('batch')}
          onStatus={setStatus}
        />
      ) : !asset ? (
        <EmptyState
          dragging={dragging}
          inert={dialog !== null}
          offer={me?.paywall ? { ...OFFER, price: me.price } : undefined}
          onChoose={() => fileInput.current?.click()}
        />
      ) : (
        // The walkthrough (D131): the batch on a reel, talked through with the microphone on.
        <Reel
          assets={assets}
          urls={urls}
          index={index}
          inert={dialog !== null}
          onIndex={setIndex}
          onSave={store.saveTake}
        />
      )}
      {dialog === 'shortcuts' && (
        <ShortcutsDialog mac={mac} opener={opener.current} onClose={closeDialog} />
      )}
      {dialog === 'privacy' && (
        <PrivacyDialog opener={opener.current} onClose={closeDialog} />
      )}
      {dialog === 'delete' && (
        <DeleteAccountDialog
          opener={opener.current}
          onClose={closeDialog}
          onDeleted={() =>
            leaveAccount('Your account and its rules were deleted. Your credits are kept.')
          }
        />
      )}
      {dialog === 'pay' && me && (
        <Dialog id="pay-title" title="Get credits" opener={opener.current} onClose={closeDialog}>
          <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
            <p>
              {me.credits?.closed && !me.user
                ? 'Your credits moved into your account when you signed in here. Sign in to use them.'
                : `${OFFER.credits.toLocaleString('en')} credits are ${me.price}, and never run out. An update takes ${OFFER.update} credits and ${OFFER.note} a note: one note is ${updatePrice(1)} credits, five are ${updatePrice(5)}, thirty are ${updatePrice(30)}. Marking images, your rules and your agent stay free.`}
            </p>
            <div className="flex flex-col items-start gap-2">
              <AccessGate
                me={me}
                buttonClass={cn(
                  hit,
                  'flex min-h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background',
                )}
                hintClass="m-0 text-[13px] text-muted-foreground"
                onRefresh={refreshMe}
                onSignOut={async () => {
                  await signOut();
                  await leaveAccount('Signed out.');
                }}
                onMessage={(tone, text) => setStatus({ tone, text })}
              />
            </div>
          </div>
        </Dialog>
      )}
      {dialog === 'home' && (
        <Dialog
          id="home-title"
          title="Start over?"
          opener={opener.current}
          onClose={closeDialog}
        >
          <p className="m-0 text-muted-foreground">
            Your {count(assets.length, 'image')} and {count(allMarks.length, 'note')} are kept in
            this browser until you start over. Open Your rules first to keep what your notes teach.
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
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
              onClick={() => {
                closeDialog();
                setView('collections');
              }}
              className={cn(
                hit,
                'flex min-h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors duration-150 motion-reduce:transition-none hover:bg-foreground/85',
              )}
            >
              Open your rules
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * How Pinch uses what the user gives it, in four lines (D93); opened from the landing footer and
 * the account menu. The terms page says the rest.
 */
function PrivacyDialog({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const item = (title: string, body: React.ReactNode) => (
    <li>
      <strong className="font-medium text-foreground">{title}</strong> {body}
    </li>
  );
  return (
    <Dialog
      id="privacy-title"
      title="How Pinch uses your data"
      opener={opener}
      onClose={onClose}
      fallback="[data-account-trigger]"
    >
      <ul className="m-0 list-none space-y-2.5 p-0 text-[13px] leading-relaxed text-muted-foreground">
        {item(
          'Images',
          'stay in this browser. The close-up of each mark goes to Anthropic with a suggestion, and with its note when you update your rules, never stored on the way; once you sign in, your rules keep theirs in your account.',
        )}
        {item(
          'Notes',
          'go to Anthropic to find your rules, and their words are kept anonymously for 90 days, topic-tagged by TypeSafe’s Jev.',
        )}
        {item(
          'Account',
          'holds your Google email, name and picture; Lemon Squeezy takes the payment. Until you sign in, your credits are counted under a random id kept in this browser. Your agent’s key is kept only as a hash; with it your agent gets your rules, their close-ups and, when it asks, the screenshots they come from. Deleting your account deletes your rules; your credits are kept.',
        )}
        {item(
          'No ads, no analytics.',
          <>
            Made by{' '}
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
      </ul>
    </Dialog>
  );
}

/** Every key, by group. A row lists alternatives; each alternative is the keys pressed together. */
type ShortcutRow = { combos: string[][]; join?: 'or' | 'to'; what: string };
const SHORTCUTS: { group: string; rows: ShortcutRow[] }[] = [
  {
    group: 'Recording',
    rows: [
      { combos: [['R']], what: 'Record, or resume, after a five-second count' },
      { combos: [['Space']], what: 'Pause, or resume' },
      { combos: [['Esc']], what: 'Stop the count' },
    ],
  },
  {
    group: 'The reel',
    rows: [
      {
        combos: [['→'], ['↓']],
        join: 'or',
        what: 'Next screen; a scroll or a swipe turns it too',
      },
      { combos: [['←'], ['↑']], join: 'or', what: 'Previous screen' },
      { combos: [['F']], what: 'The end, to finish' },
      { combos: [['Enter']], what: 'Finish, on the end' },
    ],
  },
  {
    group: 'Session',
    rows: [
      { combos: [['⌘', 'V']], what: 'Paste a screenshot' },
      { combos: [['?']], what: 'The keys, on the reel' },
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
      fallback="[data-account-trigger]"
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

/** The landing card's main button and the hint under it. */
const LANDING_BUTTON =
  'flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white transition-colors! duration-700! ease-in-out! motion-reduce:transition-none! hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:outline-white';
const LANDING_HINT = 'm-0 text-center text-[13px] leading-relaxed text-current/80';

/** A key named on the landing card, on the card's own colours. */
const LandingKey = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-current/20 px-1.5 py-0.5 font-mono text-[12px] text-current">
    {children}
  </kbd>
);

function EmptyState({
  dragging,
  inert,
  offer,
  onChoose,
}: {
  dragging: boolean;
  inert: boolean;
  /** The one offer and the free credits, once billing is on (D98). */
  offer?: Offer & { price: string };
  onChoose: () => void;
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
                  className="mx-auto -mt-3 mb-3 w-64 [@media(max-height:760px)]:w-52"
                />
                <h1 className="m-0 text-center text-[1.4rem] leading-snug font-normal tracking-tight text-balance">
                  Talk your agent through your taste
                </h1>
                <p className="mx-auto mt-2 mb-0 max-w-sm text-center text-sm leading-relaxed text-current/80 text-balance">
                  Walk through your screenshots out loud. Pinch turns what you say into rules for
                  your agent.
                </p>
                <p className="mx-auto mt-2 mb-0 max-w-sm text-center text-sm leading-relaxed text-current/80 text-balance">
                  <LandingKey>R</LandingKey> records, <LandingKey>Space</LandingKey> pauses, the
                  arrows turn. It stays on this computer.
                </p>
                <div className="mt-5 flex flex-col items-center gap-3">
                  <button type="button" onClick={onChoose} className={LANDING_BUTTON}>
                    <Plus className="size-4" aria-hidden />
                    Add images
                  </button>
                  <p className={LANDING_HINT} aria-live="polite">
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
              {offer
                ? `Talking through images is free. Start free with ${offer.free} credits; top up anytime. Your voice is never kept.`
                : 'Free, no account. Images stay in this browser, and your voice is never kept.'}
            </span>
            <span className="mx-auto mt-1 block">
              <a
                href="/terms"
                className="-mx-1 rounded px-1 underline underline-offset-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Terms
              </a>{' '}
              · Created by{' '}
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

