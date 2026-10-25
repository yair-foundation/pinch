import type { AgentReading } from '@/lib/pin/agent-reading';
import type { Collection } from '@/lib/pin/learnings';
import type { Proposal } from '@/lib/pin/proposals';
import type { Run, Verdict } from '@/lib/pin/runs';

/*
 * Where collections are kept: in this browser (`collections-store.ts`), or in
 * the signed-in account (`cloud-store.ts`, D81). The collections view works
 * the same on either; it only says which.
 */
export type CollectionsBackend = {
  kind: 'browser' | 'account';
  list(): Promise<Collection[]>;
  save(c: Collection): Promise<void>;
  /** The collection and every batch it holds. */
  remove(c: Collection): Promise<void>;
  /** A batch's export zip, by the batch's id. */
  putBatch(id: string, zip: Blob): Promise<void>;
  getBatch(id: string): Promise<Blob | undefined>;
  deleteBatch(id: string): Promise<void>;
  /** The rules the agent proposed, waiting (D116): only an account has an agent to propose. */
  proposals?(): Promise<Proposal[]>;
  dropProposal?(id: string): Promise<void>;
  /** What the agent's runs did with the rules (D120), the person's verdicts, and removing one. */
  runs?(): Promise<Run[]>;
  judge?(run: string, report: string, verdict: Verdict | null): Promise<void>;
  /** What was wrong with a piece of work judged close or off (D125), or taken back with ''. */
  correct?(run: string, report: string, correction: string): Promise<void>;
  dropRun?(id: string): Promise<void>;
  /** The readings of notes the agent made itself, waiting to be applied (D122). */
  readings?(): Promise<AgentReading[]>;
  dropReading?(id: string): Promise<void>;
};
