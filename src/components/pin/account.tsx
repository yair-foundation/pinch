'use client';

import {
  CircleUserRound,
  Keyboard,
  Lock,
  LogOut,
  Moon,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FREE_CREDITS, NOTE_CREDITS, PACK_CREDITS, UPDATE_CREDITS } from '@/lib/pin/credits';
import { cn } from '@/lib/utils';
import { Dialog, hit } from './dialog';

/*
 * The account in the page (D81, D98): who is signed in, their credits, the
 * one offer, where to buy, and where their rules live, as `/api/pin/me`
 * says. Until billing is set up the answer is "open" and the page works as it
 * always did. Read again when the tab comes back, so a purchase made in
 * another tab shows without a reload.
 */

/** The one offer (D98): credits in a pack, the free ones, and what an update takes. */
export type Offer = { credits: number; free: number; update: number; note: number };
export const OFFER: Offer = {
  credits: PACK_CREDITS,
  free: FREE_CREDITS,
  update: UPDATE_CREDITS,
  note: NOTE_CREDITS,
};

export type Me = {
  paywall: boolean;
  signIn: boolean;
  testLogin: boolean;
  user: { email: string; name: string; picture?: string } | null;
  /** Whether the buyers' extras (suggestions) are open. */
  allowed: boolean;
  /** Credits left; null until billing is on. */
  credits: { balance: number; bought: boolean; original: boolean; closed: boolean } | null;
  offer?: Offer;
  price: string;
  buyUrl?: string;
  restore: boolean;
  /** Free covers one product, Pro every one (D123); null until plans are on. */
  plan: { pro: boolean; price: string; url?: string } | null;
  cloud: 'blob' | 'memory' | null;
  folder: string | null;
};

const OPEN: Me = {
  paywall: false,
  signIn: false,
  testLogin: false,
  user: null,
  allowed: true,
  credits: null,
  price: '$19.99',
  restore: false,
  plan: null,
  cloud: null,
  folder: null,
};

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/pin/me', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const next = (await res.json()) as Me;
      setMe(next);
      return next;
    } catch {
      // The page still works without the answer; the server gates what it must.
      setMe((m) => m ?? OPEN);
      return null;
    }
  }, []);
  useEffect(() => {
    refresh();
    const onFocus = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);
  return { me, refresh };
}

export const signOut = () => fetch('/api/pin/auth/signout', { method: 'POST' });

/**
 * Getting credits: sign in with Google, then buy the one offer. Takes the caller's own button and
 * hint styles, so it reads as theirs.
 */
export function AccessGate({
  me,
  buttonClass,
  hintClass,
  onRefresh,
  onSignOut,
  onMessage,
}: {
  me: Me;
  buttonClass: string;
  hintClass: string;
  onRefresh: () => Promise<Me | null>;
  onSignOut: () => void;
  onMessage: (tone: 'info' | 'error', text: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const link =
    '-mx-1 rounded px-1 underline underline-offset-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-black/5 dark:hover:bg-white/10';
  if (!me.user)
    return (
      <>
        {me.signIn ? (
          <a href="/api/pin/auth/google" className={buttonClass}>
            Continue with Google
          </a>
        ) : (
          <span className={cn(buttonClass, 'pointer-events-none opacity-60')}>
            Sign-in isn’t set up yet
          </span>
        )}
        <p className={hintClass}>Credits are kept with your Google account.</p>
      </>
    );
  const offer = me.offer ?? OFFER;
  const check = async () => {
    const before = me.credits?.balance ?? 0;
    const wasOriginal = Boolean(me.credits?.original);
    setChecking(true);
    try {
      if (me.restore) {
        const res = await fetch('/api/pin/billing/restore', { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) onMessage('error', body.error ?? 'That didn’t work. Try again.');
      }
      const next = await onRefresh();
      // Found: a pack's credits came, or an order of the original offer (D98).
      const found =
        (next?.credits?.balance ?? 0) > before || (!wasOriginal && Boolean(next?.credits?.original));
      if (next && !found)
        onMessage(
          'info',
          `No new purchase found for ${me.user?.email} yet. It can take a minute after paying; buy with this email, or check again.`,
        );
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <a href={me.buyUrl} className={buttonClass}>
        Get {offer.credits.toLocaleString('en')} credits, {me.price}
      </a>
      <p className={hintClass}>
        Signed in as {me.user.email}.{' '}
        <button type="button" onClick={check} disabled={checking} className={link}>
          {checking ? 'Checking…' : 'Paid already?'}
        </button>{' '}
        <button type="button" onClick={onSignOut} className={link}>
          Sign out
        </button>
      </p>
    </>
  );
}

/** The signed-in person's face: their Google picture, or the first letter of their name. */
export function Avatar({ me, className }: { me: Me | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  const user = me?.user;
  const picture = user?.picture && !broken ? user.picture : '';
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium uppercase text-foreground',
        className,
      )}
    >
      {picture ? (
        // biome-ignore lint/performance/noImgElement: Google's own image host, a few dozen pixels
        <img
          src={picture}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : user ? (
        (user.name || user.email).charAt(0)
      ) : (
        <CircleUserRound className="size-[60%] text-muted-foreground" />
      )}
    </span>
  );
}

/** A switch drawn inside a menu item, which is itself the control: the small switch's look. */
const Knob = ({ on }: { on: boolean }) => (
  <span
    aria-hidden
    className={cn(
      'flex h-5 w-8 shrink-0 items-center rounded-full px-0.5 transition-colors duration-150 motion-reduce:transition-none',
      on ? 'bg-primary' : 'bg-input dark:bg-input/80',
    )}
  >
    <span
      className={cn(
        'size-3.5 rounded-full transition-transform duration-150 motion-reduce:transition-none',
        on ? 'translate-x-3 bg-background dark:bg-primary-foreground' : 'bg-background dark:bg-foreground',
      )}
    />
  </span>
);

const item = cn(
  'flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-sm text-foreground/85 outline-none transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground',
);

/**
 * The account, as a menu that floats below the avatar at the header's far right (after
 * affectUI's Profile Menu): who is signed in, then the page's own settings (suggestions, the
 * theme), its help (shortcuts, how Pinch uses your data), and the account's own actions.
 * Without an account it holds the settings and help alone. Arrow keys move through it, Escape
 * or a click outside closes it, and focus goes back to the avatar.
 */
export function AccountMenu({
  me,
  landing,
  suggestions,
  onShortcuts,
  onPrivacy,
  onDelete,
  onSignOut,
}: {
  me: Me | null;
  /** Over the landing's painting: the trigger sits in the glass pill. */
  landing: boolean;
  /** The suggestions switch, when suggestions are available to this visitor. */
  suggestions?: { on: boolean; onToggle: () => void };
  onShortcuts: () => void;
  onPrivacy: () => void;
  onDelete: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  const user = me?.user;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role^=menuitem]')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, { capture: true });
    };
  }, [open, close]);

  /** A choice that leaves the menu: focus goes to the avatar first, so a dialog returns there. */
  const choose = (run: () => void) => () => {
    close(true);
    run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? (i + 1) % items.length
        : e.key === 'ArrowUp'
          ? (i - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : null;
    if (next === null) {
      if (e.key === 'Tab') close(false);
      return;
    }
    e.preventDefault();
    // The page's own arrow keys change the image; inside the menu they only move.
    e.stopPropagation();
    items[next]?.focus();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={user ? `Account: ${user.email}` : 'Settings'}
        title={user?.email}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        data-account-trigger
        onClick={() => setOpen(!open)}
        className={cn(
          hit,
          'flex items-center justify-center rounded-full outline-none transition-[box-shadow] duration-150 motion-reduce:transition-none hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring',
          landing ? 'size-7' : 'size-8',
          open && 'ring-2 ring-border',
        )}
      >
        <Avatar me={me} className="size-full text-[13px]" />
      </button>
      {open && (
        <div
          id="account-menu"
          className="absolute top-[calc(100%+0.5rem)] right-0 z-40 w-72 rounded-[22px] bg-muted p-1.5 shadow-lg ring-1 ring-border/70 backdrop-blur-md dark:shadow-none"
        >
          <div className="rounded-2xl border border-border bg-background px-2 pt-4 pb-2 shadow-xs">
            <div className="flex items-center gap-3 px-2.5 pb-3">
              <Avatar me={me} className="size-10 text-sm" />
              <div className="grid min-w-0">
                <span className="truncate text-[15px] leading-snug font-medium text-foreground">
                  {user ? user.name || user.email : 'Pinch'}
                </span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {user ? user.email : 'Not signed in'}
                </span>
              </div>
            </div>
            <div
              ref={list}
              role="menu"
              aria-label={user ? 'Account' : 'Settings'}
              tabIndex={-1}
              onKeyDown={onKey}
              className="grid gap-0.5"
            >
              {suggestions && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={suggestions.on}
                  title="Grey suggestions in empty notes; Tab takes one. Sends the marked area to Anthropic."
                  onClick={suggestions.onToggle}
                  className={item}
                >
                  <Sparkles aria-hidden />
                  <span className="flex-1">Suggestions</span>
                  <Knob on={suggestions.on} />
                </button>
              )}
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={dark}
                onClick={() => setTheme(dark ? 'light' : 'dark')}
                className={item}
              >
                <Moon aria-hidden />
                <span className="flex-1">Dark mode</span>
                <Knob on={dark} />
              </button>
              <button type="button" role="menuitem" onClick={choose(onShortcuts)} className={item}>
                <Keyboard aria-hidden />
                <span className="flex-1">Keyboard shortcuts</span>
                <kbd className="rounded border border-border px-1.5 font-mono text-[12px] text-muted-foreground">
                  ?
                </kbd>
              </button>
              <button type="button" role="menuitem" onClick={choose(onPrivacy)} className={item}>
                <Lock aria-hidden />
                <span className="flex-1">How Pinch uses your data</span>
              </button>
              {user && (
                <>
                  <hr className="mx-3 my-1 border-border" />
                  <button type="button" role="menuitem" onClick={choose(onSignOut)} className={item}>
                    <LogOut aria-hidden />
                    <span className="flex-1">Sign out</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={choose(onDelete)}
                    className={cn(
                      item,
                      'text-destructive hover:text-destructive focus-visible:text-destructive [&>svg]:text-destructive',
                    )}
                  >
                    <Trash2 aria-hidden />
                    <span className="flex-1">Delete account</span>
                  </button>
                </>
              )}
            </div>
          </div>
          {user && me?.plan && (
            <div className="flex items-center gap-2 px-3.5 pt-2.5 text-[13px]">
              <span className="flex-1 text-muted-foreground">
                {me.plan.pro ? 'Pro' : 'Free plan'}
              </span>
              {me.plan.url && (
                <a
                  href={me.plan.url}
                  className="rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-background"
                >
                  Get Pro
                </a>
              )}
            </div>
          )}
          {me?.paywall && me.credits && !me.credits.original && (
            <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1.5 text-[13px]">
              <span className="flex-1 text-muted-foreground">
                {me.credits.closed
                  ? 'Your credits are in your account.'
                  : `${me.credits.balance.toLocaleString('en')} credits left`}
              </span>
              {user && me.buyUrl && (
                <a
                  href={me.buyUrl}
                  className="rounded-md px-1.5 py-0.5 font-medium text-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-background"
                >
                  Get more
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "Are you sure" before the account and its rules go for good; the credits are kept. */
export function DeleteAccountDialog({
  opener,
  onClose,
  onDeleted,
}: {
  opener: HTMLElement | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/pin/account', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      onDeleted();
    } catch {
      setError('The account wasn’t deleted. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      id="delete-title"
      title="Delete your account?"
      opener={opener}
      onClose={onClose}
      fallback="[data-account-trigger]"
    >
      <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
        Your account, your rules and their screenshots go for good. Your credits are kept, so
        signing in again still finds them.
      </p>
      {error && (
        <p className="m-0 mt-2 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className={cn(
            hit,
            'flex min-h-9 items-center rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted',
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className={cn(
            hit,
            'flex min-h-9 items-center gap-2 rounded-md bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors duration-150 motion-reduce:transition-none hover:bg-destructive/20 disabled:opacity-50',
          )}
        >
          <Trash2 className="size-4" aria-hidden />
          {busy ? 'Deleting…' : 'Delete for good'}
        </button>
      </div>
    </Dialog>
  );
}
