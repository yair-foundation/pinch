'use client';

import { ClipboardCopy, Info, MessageSquareText, PlugZap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AGENT_SETUPS } from '@/lib/pin/agent-setup';
import { cn } from '@/lib/utils';
import { Dialog, hit } from './dialog';

/*
 * Connect your agent (D89, D93): the one way rules leave Pinch. Two rows, as
 * in an integrations list: the MCP server, which the agent asks for the
 * current rules on each task with a key made here (a new key stops the old
 * one; Disconnect stops it too), and a prompt, the rules as text for one
 * chat. The key needs an account; the prompt doesn't.
 */

const button = cn(
  hit,
  'flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-[13px] transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-50',
);
const primary = cn(
  hit,
  'flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-medium text-background transition-colors duration-150 motion-reduce:transition-none hover:bg-foreground/85 disabled:opacity-50',
);

/** One way to connect: its icon, name and line, its actions on the right, and what it opens below. */
function Row({
  icon,
  name,
  line,
  actions,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  line: React.ReactNode;
  actions: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium text-foreground">{name}</p>
          <p className="m-0 text-[13px] text-muted-foreground">{line}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      {children}
    </li>
  );
}

export function ConnectDialog({
  account,
  rules,
  opener,
  onClose,
  onCopy,
}: {
  /** Signed in, can sign in, or neither (sign-in isn't set up here). */
  account: 'in' | 'out' | 'none';
  /** How many rules the agent gets. */
  rules: number;
  opener: HTMLElement | null;
  onClose: () => void;
  /** Copy every rule as a prompt. */
  onCopy: () => void;
}) {
  const [since, setSince] = useState<string | null | undefined>(
    account === 'in' ? undefined : null,
  );
  const [made, setMade] = useState<{ key: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [agent, setAgent] = useState(AGENT_SETUPS[0].id);
  useEffect(() => {
    if (account !== 'in') return;
    fetch('/api/pin/agent-key', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { key: null }))
      .then((r: { key: { createdAt: string } | null }) => setSince(r.key?.createdAt ?? null))
      .catch(() => setSince(null));
  }, [account]);
  const setup = AGENT_SETUPS.find((a) => a.id === agent) ?? AGENT_SETUPS[0];
  const steps = made ? setup.steps(made.url, made.key) : [];
  const run = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/pin/agent-key', { method });
      if (!res.ok) throw new Error();
      if (method === 'POST') {
        setMade((await res.json()) as { key: string; url: string });
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
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNote('Copied.');
    } catch {
      setNote('The browser didn’t allow copying; select it and copy it.');
    }
  };
  const mcpLine =
    account === 'none'
      ? 'Needs an account, and sign-in isn’t set up yet.'
      : account === 'out'
        ? 'Sign in to make a key.'
        : made
          ? 'Your key is shown only now.'
          : since
            ? `Connected since ${new Date(since).toLocaleDateString()}.`
            : 'Always your current rules, on every task.';
  return (
    <Dialog
      id="connect-title"
      title="Connect your agent"
      opener={opener}
      onClose={onClose}
      className="max-w-lg"
      aside={
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="About connecting"
                  className={cn(
                    hit,
                    'flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              }
            />
            <TooltipContent className="max-w-64">
              Your agent fetches your rules for each task, always the current ones: Claude Code,
              Cursor, VS Code, Codex and others. Connect it once with your key.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      }
    >
      <ul className="m-0 list-none space-y-2 rounded-2xl bg-muted/60 p-1.5">
        <Row
          icon={<PlugZap className="size-4" />}
          name="MCP server"
          line={mcpLine}
          actions={
            account === 'out' ? (
              <a href="/api/pin/auth/google" className={primary}>
                Sign in
              </a>
            ) : account === 'none' ? null : since && !made ? (
              <>
                <button
                  type="button"
                  onClick={() => run('POST')}
                  disabled={busy}
                  className={button}
                >
                  New key
                </button>
                <button
                  type="button"
                  onClick={() => run('DELETE')}
                  disabled={busy}
                  className={button}
                >
                  Disconnect
                </button>
              </>
            ) : made ? (
              <button
                type="button"
                onClick={() => run('DELETE')}
                disabled={busy}
                className={button}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                data-autofocus
                onClick={() => run('POST')}
                disabled={busy || since === undefined}
                className={primary}
              >
                Connect
              </button>
            )
          }
        >
          {made && (
            <div className="mt-3 space-y-2.5 border-t border-border pt-3 text-[13px] text-muted-foreground">
              <fieldset className="min-w-0 border-0 p-0">
                <legend className="sr-only">Your agent</legend>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_SETUPS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={a.id === agent}
                      onClick={() => {
                        setAgent(a.id);
                        setNote(null);
                      }}
                      className={cn(
                        hit,
                        'flex h-7 items-center rounded-md border px-2 text-[13px] transition-colors duration-150 motion-reduce:transition-none',
                        a.id === agent
                          ? 'border-foreground bg-muted text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </fieldset>
              {steps.map((s) => (
                <div key={s.where} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="m-0 min-w-0 flex-1">{s.where}</p>
                    <button type="button" onClick={() => copy(s.code)} className={button}>
                      <ClipboardCopy className="size-3.5" aria-hidden />
                      Copy
                    </button>
                  </div>
                  <pre className="m-0 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-foreground select-all">
                    {s.code}
                  </pre>
                </div>
              ))}
              <p className="m-0">
                Keep the key in your own settings, not a shared project. Then ask{' '}
                {setup.id === 'other' ? 'your agent' : setup.name} to use your Pinch rules.
              </p>
            </div>
          )}
        </Row>
        <Row
          icon={<MessageSquareText className="size-4" />}
          name="Prompt"
          line="Your rules as text, to paste into one chat."
          actions={
            <button
              type="button"
              data-autofocus={account !== 'in' || undefined}
              onClick={onCopy}
              disabled={!rules}
              className={button}
            >
              <ClipboardCopy className="size-3.5" aria-hidden />
              Copy
            </button>
          }
        />
      </ul>
      {note && (
        <p className="m-0 mt-3 text-[13px] text-foreground" role="status">
          {note}
        </p>
      )}
    </Dialog>
  );
}
