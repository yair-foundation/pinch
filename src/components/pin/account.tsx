'use client';

import { LogOut, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, hit } from './dialog';

/*
 * The account in the page (D79): who is signed in, whether they may use
 * Pinch, where to buy, and where their collections live, as `/api/pin/me`
 * says. Until billing is set up the answer is "open" and the page works as it
 * always did. Read again when the tab comes back, so a purchase made in
 * another tab shows without a reload.
 */

export type Me = {
  paywall: boolean;
  signIn: boolean;
  testLogin: boolean;
  user: { email: string; name: string } | null;
  allowed: boolean;
  price: string;
  buyUrl?: string;
  restore: boolean;
  cloud: 'blob' | 'memory' | null;
  folder: string | null;
};

const OPEN: Me = {
  paywall: false,
  signIn: false,
  testLogin: false,
  user: null,
  allowed: true,
  price: '$19',
  restore: false,
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

/** Whether the tool is closed to this visitor: billing is on, and they haven't bought it. */
export const locked = (me: Me | null) => Boolean(me?.paywall && !me.allowed);

export const signOut = () => fetch('/api/pin/auth/signout', { method: 'POST' });

/**
 * The landing card's action when Pinch is closed: sign in with Google, then buy. Takes the
 * card's own button and hint styles, so it reads as the card's.
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
        <p className={hintClass}>Pinch is {me.price} once. Sign in, then get it.</p>
      </>
    );
  const check = async () => {
    setChecking(true);
    try {
      if (me.restore) {
        const res = await fetch('/api/pin/billing/restore', { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) onMessage('error', body.error ?? 'That didn’t work. Try again.');
      }
      const next = await onRefresh();
      if (next && !next.allowed)
        onMessage(
          'info',
          `No purchase found for ${me.user?.email} yet. It can take a minute after paying; buy with this email, or check again.`,
        );
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <a href={me.buyUrl} className={buttonClass}>
        Get Pinch, {me.price}
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

const button = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-50',
);

/** Who is signed in, whether Pinch is theirs, sign out, and delete the account with its data. */
export function AccountDialog({
  me,
  opener,
  onClose,
  onSignOut,
  onDeleted,
}: {
  me: Me;
  opener: HTMLElement | null;
  onClose: () => void;
  onSignOut: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me.user) return null;
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
    <Dialog id="account-title" title="Account" opener={opener} onClose={onClose}>
      <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
        <p className="m-0">
          <span className="block text-sm text-foreground">{me.user.name || me.user.email}</span>
          {me.user.name ? me.user.email : null}
        </p>
        <p className="m-0">
          {me.allowed
            ? 'Pinch is yours. Your collections are kept in your account, on every device you sign in on.'
            : `You haven’t bought Pinch yet. It is ${me.price} once.`}
        </p>
        {confirming && (
          <p className="m-0 text-foreground" role="alert">
            Delete your account, your collections and their screenshots for good? Your purchase is
            kept, so signing in again still finds it.
          </p>
        )}
        {error && (
          <p className="m-0 text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {confirming ? (
          <>
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
            <button
              type="button"
              data-autofocus
              onClick={() => setConfirming(false)}
              className={button}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming(true)} className={button}>
              <Trash2 className="size-4" aria-hidden />
              Delete account
            </button>
            <button type="button" data-autofocus onClick={onSignOut} className={button}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
