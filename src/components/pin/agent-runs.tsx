'use client';

import { ChevronRight, Trash2 } from 'lucide-react';
import { type Collection, type ExportedRule, rulesOf } from '@/lib/pin/learnings';
import {
  neverServed,
  type Report,
  type Run,
  rulesToLookAt,
  VERDICTS,
  type Verdict,
} from '@/lib/pin/runs';
import { cn } from '@/lib/utils';
import { hit } from './dialog';

/*
 * Your agent's work (D120): what each run of the connected agent did with the rules, newest
 * first, with the person's verdict on each piece of work it reported; above them, the rules the
 * runs say to look at, and the ones no run was served.
 */

const VERDICT_LABEL: Record<Verdict, string> = { good: 'Good', close: 'Close', off: 'Off' };

const iconButton = cn(
  hit,
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground',
);
const pill = cn(
  hit,
  'flex h-7 items-center rounded-full px-2.5 text-[13px] leading-none transition-colors duration-150 motion-reduce:transition-none',
);
const heading = 'flex items-center gap-2 text-[13px] font-medium text-muted-foreground';
const muted = 'm-0 text-[13px] text-muted-foreground';
const count = 'font-mono font-normal text-muted-foreground/70';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The agent's own name made readable ("claude-code" reads Claude Code). */
const agentLabel = (r: Run) =>
  r.agent
    ? r.agent
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ')
    : 'Your agent';

const times = (n: number, what: string) => `${what} ${n}×`;

export function AgentRuns({
  collection,
  runs,
  onJudge,
  onRemove,
}: {
  collection: Collection;
  runs: Run[];
  onJudge: (run: Run, report: Report, verdict: Verdict | null) => void;
  onRemove: (run: Run) => void;
}) {
  const byKey = new Map(rulesOf(collection).map((r) => [r.rule.id, r]));
  const ruleText = (key: string) => byKey.get(key)?.rule.text.trim() ?? 'A removed rule';
  const look = rulesToLookAt(collection, runs).slice(0, 8);
  const unused = neverServed(collection, runs);
  const newest = [...runs].sort((a, b) => b.updated.localeCompare(a.updated));

  return (
    <section aria-labelledby="agent-work" className="space-y-2.5">
      <h3 id="agent-work" className={heading}>
        Your agent’s work
        <span className={count}>{runs.length}</span>
      </h3>

      {look.length > 0 && (
        <ul className="list-none divide-y divide-border rounded-xl border border-border px-4 py-1">
          {look.map(({ rule, signal }) => (
            <li key={rule.rule.id} className="space-y-0.5 py-2">
              <p className="m-0 truncate text-sm text-foreground">{rule.rule.text.trim()}</p>
              <p className={muted}>
                {[
                  signal.setAside.length ? times(signal.setAside.length, 'Set aside') : '',
                  signal.failed ? times(signal.failed, 'Check failed') : '',
                  signal.off ? times(signal.off, 'In work marked Off') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {signal.setAside.filter(Boolean).length > 0 && (
                <p className={cn(muted, 'truncate')}>
                  {signal.setAside.filter(Boolean).at(-1)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {unused.length > 0 && <Unused rules={unused} runs={runs.filter((r) => r.asks.length).length} />}

      <ol className="list-none space-y-2 p-0">
        {newest.map((r, i) => (
          <li key={r.id}>
            <RunCard
              run={r}
              open={i === 0}
              ruleText={ruleText}
              onJudge={(p, v) => onJudge(r, p, v)}
              onRemove={() => onRemove(r)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Unused({ rules, runs }: { rules: ExportedRule[]; runs: number }) {
  return (
    <details className="group rounded-xl border border-border px-4 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        Not served in {runs} runs
        <span className={count}>{rules.length}</span>
      </summary>
      <ul className="m-0 mt-2 list-none space-y-1 p-0 pb-1">
        {rules.map((r) => (
          <li key={r.rule.id} className={cn(muted, 'truncate')}>
            {r.rule.text.trim()}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RunCard({
  run,
  open,
  ruleText,
  onJudge,
  onRemove,
}: {
  run: Run;
  open: boolean;
  ruleText: (key: string) => string;
  onJudge: (p: Report, v: Verdict | null) => void;
  onRemove: () => void;
}) {
  const asked = [
    ...new Set(run.asks.flatMap((a) => [...a.topics, ...a.tags, ...a.screen])),
  ].join(', ');
  return (
    <details open={open} className="group rounded-xl border border-border px-4 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {run.reports.length
            ? run.reports.map((p) => p.work).join(', ')
            : agentLabel(run)}
        </span>
        <span className="shrink-0 text-[13px] text-muted-foreground">{when(run.updated)}</span>
      </summary>

      <div className="space-y-3 pt-2 pb-1">
        {run.reports.length ? (
          <ol className="m-0 list-none space-y-3 p-0">
            {run.reports.map((p) => (
              <li key={p.id}>
                <Piece report={p} ruleText={ruleText} onJudge={(v) => onJudge(p, v)} />
              </li>
            ))}
          </ol>
        ) : (
          <p className={muted}>No work reported.</p>
        )}
        <div className="flex items-center gap-3 border-t border-border pt-2">
          <p className={cn(muted, 'flex-1')}>
            {[
              run.reports.length ? agentLabel(run) : '',
              `${run.served.length} ${run.served.length === 1 ? 'rule' : 'rules'} served`,
              asked ? `for ${asked}` : '',
              run.evidence.length
                ? `${run.evidence.length} ${run.evidence.length === 1 ? 'close-up' : 'close-ups'} opened`
                : '',
              run.checks ? 'checks taken' : '',
              run.notesRead
                ? `${run.notesRead} ${run.notesRead === 1 ? 'note' : 'notes'} read into rules`
                : '',
              run.proposals.length
                ? `${run.proposals.length} ${run.proposals.length === 1 ? 'rule' : 'rules'} proposed`
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <button
            type="button"
            aria-label="Remove this run"
            title="Remove"
            onClick={onRemove}
            className={iconButton}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </details>
  );
}

function Piece({
  report: p,
  ruleText,
  onJudge,
}: {
  report: Report;
  ruleText: (key: string) => string;
  onJudge: (v: Verdict | null) => void;
}) {
  const checks =
    p.checksRun !== undefined
      ? `Checks ${p.checksRun}${p.failed.length ? `, ${p.failed.length} failing` : ''}`
      : p.failed.length
        ? `${p.failed.length} ${p.failed.length === 1 ? 'check' : 'checks'} failing`
        : '';
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 min-w-0 flex-1 text-[15px] leading-snug text-foreground">{p.work}</p>
        <fieldset className="m-0 flex gap-1 border-0 p-0">
          <legend className="sr-only">Your verdict on {p.work}</legend>
          {VERDICTS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={p.verdict === v}
              onClick={() => onJudge(p.verdict === v ? null : v)}
              className={cn(
                pill,
                p.verdict === v
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {VERDICT_LABEL[v]}
            </button>
          ))}
        </fieldset>
      </div>
      <p className={muted}>
        {[`Followed ${p.followed.length}`, `Set aside ${p.setAside.length}`, checks]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {p.setAside.length > 0 && (
        <ul className="m-0 list-none space-y-1 p-0">
          {p.setAside.map((x) => (
            <li key={x.rule} className="text-[13px]">
              <span className="text-foreground line-through decoration-muted-foreground/50">
                {ruleText(x.rule)}
              </span>
              {x.why && <span className="text-muted-foreground"> {x.why}</span>}
            </li>
          ))}
        </ul>
      )}
      {p.failed.length > 0 && (
        <ul className="m-0 list-none space-y-1 p-0">
          {p.failed.map((f) => (
            <li key={f.check} className={muted}>
              <span className="text-foreground">{f.check}</span>
              {f.rules.length > 0 && ` · ${f.rules.map(ruleText).join(' · ')}`}
            </li>
          ))}
        </ul>
      )}
      {p.open.length > 0 && (
        <ul className="m-0 list-disc space-y-1 pl-5">
          {p.open.map((o) => (
            <li key={o} className={muted}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
