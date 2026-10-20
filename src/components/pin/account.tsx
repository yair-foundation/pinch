'use client';

import { ClipboardCopy, LogOut, PlugZap, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, hit } from './dialog';

/*
 * The account in the page (D81): who is signed in, whether they may use
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
            ? 'Pinch is yours. Your rules are kept in your account, on every device you sign in on.'
            : `You haven’t bought Pinch yet. It is ${me.price} once.`}
        </p>
        {me.allowed && !confirming && <AgentConnect />}
        {confirming && (
          <p className="m-0 text-foreground" role="alert">
            Delete your account, your rules and their screenshots for good? Your purchase is kept,
            so signing in again still finds it.
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

/**
 * Connect your agent (D89): a key for the account, shown once inside the command that adds
 * Pinch to Claude Code as an MCP server; from then on the agent fetches the current rules
 * itself. A new key stops the old one; Disconnect stops it too.
 */
function AgentConnect() {
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const [made, setMade] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/pin/agent-key', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { key: null }))
      .then((r: { key: { createdAt: string } | null }) => setSince(r.key?.createdAt ?? null))
      .catch(() => setSince(null));
  }, []);
  const command = made
    ? `claude mcp add --transport http pinch ${made.url} --header "Authorization: Bearer ${made.key}"`
    : '';
  const run = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/pin/agent-key', { method });
      if (!res.ok) throw new Error();
      if (method === 'POST') {
        const next = (await res.json()) as { key: string; url: string };
        setMade(next);
        setSince(new Date().toISOString());
      } else {
        setMade(null);
        setSince(null);
        setNote('Disconnected. Your agent can’t fetch your rules any more.');
      }
    } catch {
      setNote('That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setNote('Copied. Paste it in your terminal.');
    } catch {
      setNote('The browser didn’t allow copying; select the command and copy it.');
    }
  };
  return (
    <section aria-labelledby="agent-title" className="space-y-2 border-t border-border pt-3">
      <h3 id="agent-title" className="text-sm font-medium text-foreground">
        Connect your agent
      </h3>
      <p>
        Claude Code fetches your rules for each task, always the current ones. Connect it once with
        your key.
      </p>
      {made ? (
        <>
          <p>Run this in your terminal. The key is shown only now.</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-foreground select-all">
            {command}
          </pre>
          <p>Then ask Claude Code to use your Pinch rules.</p>
        </>
      ) : since ? (
        <p>Connected since {new Date(since).toLocaleDateString()}.</p>
      ) : null}
      {note && (
        <p className="text-foreground" role="status">
          {note}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {made ? (
          <button type="button" onClick={copy} className={button}>
            <ClipboardCopy className="size-4" aria-hidden />
            Copy command
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run('POST')}
            disabled={busy || since === undefined}
            className={button}
          >
            <PlugZap className="size-4" aria-hidden />
            {since ? 'Make a new key' : 'Make a key'}
          </button>
        )}
        {since && (
          <button type="button" onClick={() => run('DELETE')} disabled={busy} className={button}>
            Disconnect
          </button>
        )}
      </div>
    </section>
  );
}
