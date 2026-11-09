'use client';

import { X } from 'lucide-react';
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
  type Source,
  verdictOf,
} from '@/lib/pin/model';
import { assetsOf, readExport } from '@/lib/pin/import';
import { changedEntries, fingerprint, logEntries, MAX_BATCH } from '@/lib/pin/notes-log';
import { unzip } from '@/lib/pin/unzip';
import { applyTake, flipVerdict, removedScreens, takesApplied } from '@/lib/pin/voice-notes';
import { isPdf } from '@/lib/pin/pdf-pages';
import {
  NOTE_TEXT_SAVED,
  NOTES_FILE,
  notesPackageRoot,
  READING_SHOWN,
  takeFile,
  takePackage,
} from '@/lib/pin/notes-package';
import { zip } from '@/lib/pin/zip';
import { cn } from '@/lib/utils';
import { PinchWordmark } from './brand';
import { COMING_BACK_ATTRIBUTE, HAS_SESSION_KEY } from './coming-back';
import { Landing } from './landing';
import {
  AccountMenu,
  DeleteAccountDialog,
  signOut,
  useMe,
} from './account';
import { cloudBackend } from './cloud-store';
import { browserBackend } from './collections-store';
import { DesktopOnly } from './desktop-only';
import { Dialog, hit } from './dialog';
import { pdfPages } from './pdf';
import { Reel } from './reel';
import {
  buildExport,
  download,
  prepareImage,
} from './render';
import { readSaved, savedNotesPackage } from './saved-notes';
import { screenText } from './screen-text';
import * as store from './store';

/*
 * Pinch: add a batch of screenshots and talk through them on the reel (D131, `reel.tsx`), the
 * microphone and the pointer kept as a take; Export gives the package (D157, D163). Nothing of a
 * take leaves this browser. Notes and rules saved before go out with one export (D164).
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
  remove: (key: string) => {
    try {
      window.localStorage.removeItem(key);
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

export function PinApp() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(!isSmallDevice());
  }, []);
  return (
    <>
      {!desktop && <DesktopOnly />}
      <div data-workspace className={desktop ? undefined : 'max-md:hidden'}>
        <Workspace />
      </div>
    </>
  );
}

/** One tab's name, so a tab can tell its own saves from another's. */
const TAB_ID = newId();

type DialogKind = 'shortcuts' | 'privacy' | 'home' | 'delete';

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
  // Who is looking (D81, D98).
  const { me, refresh: refreshMe } = useMe();
  // What was saved before D164 is in the account once signed in, and may be in this browser too.
  const cloudKey = me?.user && me.cloud && me.folder ? `${me.cloud} ${me.folder}` : '';
  const savedIn = useMemo(() => {
    if (!cloudKey) return [browserBackend];
    const [mode, folder] = cloudKey.split(' ');
    return [cloudBackend(folder, mode as 'blob' | 'memory'), browserBackend];
  }, [cloudKey]);
  // Notes or rules saved before takes became export-only (D163), for their owner to take (D164).
  const [hasSaved, setHasSaved] = useState(false);
  useEffect(() => {
    let current = true;
    readSaved(savedIn)
      .then((saved) => {
        if (current) setHasSaved(saved !== null);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [savedIn]);
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
  // Show the page once the session is in, and say for next time whether one is waiting (D173).
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.removeAttribute(COMING_BACK_ATTRIBUTE);
    if (assets.length) local.set(HAS_SESSION_KEY, '1');
    else local.remove(HAS_SESSION_KEY);
  }, [assets.length, loaded]);

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
    if (!NOTE_TEXT_SAVED || local.get(SAVE_NOTES_KEY) === 'off') return;
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
      // A PDF is its pages, each a screenshot of its own, in order (D139).
      const files: File[] = [];
      const unreadable: string[] = [];
      for (const file of dropped.filter((f) => !isZip(f))) {
        if (!isPdf(file)) {
          files.push(file);
          continue;
        }
        try {
          files.push(
            ...(await pdfPages(file, (page, pages) =>
              setStatus({
                tone: 'info',
                text: `Reading ${file.name}: page ${page} of ${pages}…`,
                sticky: true,
              }),
            )),
          );
        } catch {
          unreadable.push(`${file.name} (the PDF couldn't be read)`);
        }
      }
      if (!files.length) {
        if (unreadable.length)
          setStatus({ tone: 'error', text: `Couldn't read ${unreadable.join(', ')}.` });
        return;
      }
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
      const failed: string[] = [...unreadable];
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

  const tagged = assets.filter(hasMarks);
  const allMarks = tagged.flatMap((a) => a.marks.filter((m) => verdictOf(m) !== 'empty'));
  // The text on each noted screen is read ahead of Export, once a take has made notes (D166).
  const notedScreens = tagged.map((a) => a.id).join(' ');
  useEffect(() => {
    for (const id of notedScreens.split(' ').filter(Boolean)) void screenText(id, store.getImage);
  }, [notedScreens]);

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
      const made = await buildExport(
        list,
        store.getImage,
        (done, total) =>
          setStatus({
            tone: 'info',
            text: `Preparing ${Math.min(done + 1, total)} of ${total}…`,
            sticky: true,
          }),
        (id) => screenText(id, store.getImage),
      );
      // Kept in a collection is kept: going home won't ask about this batch.
      markExported();
      return made;
    } finally {
      setStatus((s) => (s?.sticky ? null : s));
    }
  }, [markExported]);

  /** This take as the package an agent reads (D163): all of Pinch's output, one click from the end. */
  const exportTake = useCallback(async () => {
    try {
      const made = await batchZip();
      if (!made) {
        setStatus({ tone: 'info', text: 'There are no notes to export yet.' });
        return;
      }
      const found = await unzip(await made.blob.arrayBuffer());
      const stamp = new Date().toISOString();
      const pack = takePackage(readExport(found), found, stamp);
      // The take itself goes beside the folder (D183), for the placing of notes to be tuned on.
      const takes = takesApplied(assetsRef.current, await store.loadTakes()).map(takeFile);
      download(
        new Blob(zip([...pack.files, ...takes]) as BlobPart[], { type: 'application/zip' }),
        `${notesPackageRoot(stamp).slice(0, -1)}.zip`,
      );
      setStatus({
        tone: pack.missing ? 'error' : 'info',
        text: pack.missing
          ? `Exported ${count(pack.notes, 'note')}, but ${count(pack.missing, 'close-up')} couldn’t be read, so they’re not in the zip.`
          : `Exported ${count(pack.notes, 'note')}. Point your agent at ${NOTES_FILE}.`,
      });
    } catch {
      setStatus({ tone: 'error', text: 'The export didn’t finish. Try again.' });
    }
  }, [batchZip]);

  /** Everything saved before D164, for its owner to take: all that's left of Your notes. */
  const exportSaved = useCallback(async () => {
    try {
      const pack = await savedNotesPackage(savedIn, (done, total) =>
        setStatus({ tone: 'info', text: `Preparing ${done} of ${total}…`, sticky: true }),
      );
      if (!pack) {
        setStatus({ tone: 'info', text: 'There are no saved notes to export.' });
        return;
      }
      download(
        new Blob(zip(pack.files) as BlobPart[], { type: 'application/zip' }),
        `${notesPackageRoot(new Date().toISOString()).slice(0, -1)}.zip`,
      );
      const what = [
        pack.notes ? count(pack.notes, 'note') : '',
        pack.rules ? count(pack.rules, 'rule') : '',
      ]
        .filter(Boolean)
        .join(' and ');
      setStatus({
        tone: pack.missing ? 'error' : 'info',
        text: pack.missing
          ? `Exported ${what}, but ${count(pack.missing, 'close-up')} couldn’t be read, so they’re not in the zip.`
          : pack.notes
            ? `Exported ${what}. Point your agent at ${NOTES_FILE}.`
            : `Exported ${what}.`,
      });
    } catch {
      setStatus({ tone: 'error', text: 'The export didn’t finish. Try again.' });
    }
  }, [savedIn]);

  /**
   * The logo goes home, which in Pinch means a new batch: straight there when everything was
   * exported since the last change, after a question when something wasn't.
   */
  const goHome = () => {
    if (!assets.length) return;
    if (digestOf(assetsRef.current) !== exported.current) openDialog('home');
    else startOver();
  };

  // The landing: no image yet, so the header floats over the page, on the title's grid.
  const landing = !asset;
  const leaveAccount = async (text: string) => {
    closeDialog();
    await refreshMe();
    setStatus({ tone: 'info', text });
  };

  return (
    <div
      className={cn(
        'relative flex h-dvh min-h-0 flex-col bg-background text-foreground',
        landing && 'overflow-y-auto',
      )}
    >
      {/* While a dialog is open, everything behind it is inert: no focus, no clicks, nothing read. */}
      <header
        inert={dialog !== null}
        className={cn(
          'flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1',
          landing
            ? 'absolute inset-x-0 top-0 z-10 h-16 px-6 py-0 sm:px-[8vw]'
            : 'border-b border-border',
        )}
      >
        <div className={cn('flex items-center gap-2.5')}>
          {landing ? (
            <PinchWordmark className="h-[15px]" ink />
          ) : (
            // Home is a new batch; a modified click still opens a new tab, as a link should.
            <a
              href={pathname}
              data-home-trigger
              aria-label="Pinch, start over"
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                goHome();
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
        <div className={cn('ml-auto flex items-center', landing ? 'gap-0.5' : 'gap-2')}>
          {READING_SHOWN && me?.paywall && me.signIn && !me.user && (
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
              onExportSaved={hasSaved ? () => void exportSaved() : undefined}
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
          accept="image/*,.pdf,application/pdf,.zip,application/zip"
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
          This browser blocks storage, so your session lasts until you close the tab. Export
          before you leave.
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

      {!asset ? (
        <Landing
          dragging={dragging}
          inert={dialog !== null}
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
          onTake={(take) => {
            const known = assetsRef.current.flatMap((a) => (a.screenTag ? [a.screenTag] : []));
            commit((list) => applyTake(list, take, known));
            // The screens said "remove it" over (D139) go in a step of their own, so Undo
            // brings them back and keeps the take's notes.
            const gone = new Set(removedScreens(take, known));
            const leaving = assetsRef.current.filter((a) => gone.has(a.id));
            if (!leaving.length) return;
            commit((list) => list.filter((a) => !gone.has(a.id)));
            setIndex((i) => Math.min(i, Math.max(0, assetsRef.current.length - 1)));
            setStatus({
              tone: 'info',
              text:
                leaving.length === 1
                  ? `Removed ${leaving[0].name}.`
                  : `Removed ${count(leaving.length, 'screen')}.`,
              action: { label: 'Undo', run: undo },
            });
          }}
          onFlip={(assetId, markId) =>
            update(assetId, (a) => ({
              ...a,
              marks: a.marks.map((m) => (m.id === markId ? flipVerdict(m) : m)),
            }))
          }
          onExport={() => void exportTake()}
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
            leaveAccount('Your account and its notes were deleted.')
          }
        />
      )}
      {dialog === 'home' && (
        <Dialog
          id="home-title"
          title="Start over?"
          opener={opener.current}
          onClose={closeDialog}
        >
          <p className="m-0 text-muted-foreground">
            {allMarks.length > 0
              ? `Your ${count(assets.length, 'image')} and ${count(allMarks.length, 'note')} are kept in this browser until you start over. Export first to keep them.`
              : `Your ${count(assets.length, 'image')} ${assets.length === 1 ? 'is' : 'are'} kept in this browser until you start over.`}
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
            {allMarks.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  closeDialog();
                  void exportTake();
                }}
                className={cn(
                  hit,
                  'flex min-h-9 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors duration-150 motion-reduce:transition-none hover:bg-foreground/85',
                )}
              >
                Export
              </button>
            )}
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
          'stay in this browser: a small text model from Hugging Face, about 11 MB and downloaded once, reads them here. If you signed in to keep notes before, those notes keep their images in your account.',
        )}
        {item(
          'Your voice',
          'stays in this browser: a voice model from Hugging Face, up to 570 MB and downloaded once, turns it into words here, and the recording is kept only in this browser.',
        )}
        {item(
          'Notes',
          'stay in this browser until you export them, and Pinch doesn’t keep their words.',
        )}
        {item(
          'Account',
          'is only for people who already have one, and holds your Google email, name and picture; Lemon Squeezy took any payment. An agent’s key is kept only as a hash. Deleting your account deletes your notes and rules; any credits you hold are kept.',
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
      { combos: [['R']], what: 'Record, or resume' },
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


