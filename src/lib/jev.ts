/*
 * Jev (TypeSafe's decision model) answers yes/no ("noul") questions about a
 * piece of state. Pinch asks it which design areas a saved note is about
 * (`pin/notes-tags.ts`, `pin/notes-tagger.ts`).
 *
 * API: POST https://api.typesafe.ai/v1/systemone with { model, state, questions }
 * (docs.typesafe.ai/api). There is no multi-select, so each area is its own
 * yes/no question, all in one request.
 */

/** JEV_ENDPOINT points a local run at a stub (scripts/jev-stub.mjs) to test the plumbing without a key. */
const endpoint = () => process.env.JEV_ENDPOINT ?? 'https://api.typesafe.ai/v1/systemone';
/** Pinned so a model update can't move the tags silently. */
export const JEV_MODEL = process.env.JEV_MODEL ?? 'jev-1.13.0';
const TIMEOUT_MS = 3_000;
/** An answer needs at least this probability to count as a yes. */
export const THRESHOLD = 0.6;

export type JevAnswers = Record<string, { type?: string; noul?: number }>;

export type JevReply =
  | { ok: true; answers: JevAnswers; model: string; ms: number; inputTokens: number }
  | { ok: false; error: string };

/**
 * One request to Jev: a state and a set of yes/no questions, the answers back.
 * Never throws; the timeout and key checks are the same for every caller.
 */
export async function askJevQuestions(
  state: unknown,
  questions: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JevReply> {
  const key = process.env.JEV_API_KEY;
  if (!key) return { ok: false, error: 'JEV_API_KEY is not set.' };
  const started = Date.now();
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = response.status === 401 ? ' (check JEV_API_KEY)' : '';
      return { ok: false, error: `Jev returned ${response.status}${detail}.` };
    }
    const body = (await response.json()) as {
      model?: string;
      answers?: JevAnswers;
      usage?: { input_tokens?: number };
    };
    if (!body.answers) return { ok: false, error: 'Jev sent no answers.' };
    return {
      ok: true,
      answers: body.answers,
      model: body.model ?? JEV_MODEL,
      ms: Date.now() - started,
      inputTokens: body.usage?.input_tokens ?? 0,
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return { ok: false, error: timedOut ? 'Jev timed out.' : 'Jev could not be reached.' };
  }
}
