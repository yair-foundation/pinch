# Pilot: does a design memory keep its users?

The plan this tests (D123): free covers one product, Pro covers every product for $29 a month, and the person's own agent reads their notes into rules (D122), with credits kept for Pinch's own reading. The question isn't whether people like Pinch on day one. It's whether they keep correcting, extending and using their rules through Pinch after the first week.

## Who

10–15 people, each with a real design project running for the next month and a coding agent they already use (Claude Code, Codex, Cursor):

- product and brand designers who mock up with an agent;
- design-minded developers and founders who know what they like but can't name it.

Leave out people who only collect references with no project to apply them to; they test a moodboard, not Pinch.

## Before inviting anyone

1. In Lemon Squeezy: a Pro product, monthly, $29, with its checkout link. Decide on a trial (7 days is a reasonable start) there, not in code.
2. In Vercel: `LEMONSQUEEZY_PRO_PRODUCT_ID`, `PINCH_PRO_URL`, `PINCH_PLANS_SINCE` (the day plans begin) and, if the price differs, `PINCH_PRO_PRICE`. Add the `subscription_*` events to the webhook. Everyone who paid before that day keeps Pro.
3. Set `ADMIN_PASSWORD` if it isn't, for the pilot view below.
4. Check the whole loop on a fresh account yourself: sign in, mark a batch, read it with your agent (Read with your agent on Your rules), connect, build something, report it, judge it.

## The invite (draft, not sent)

> I'm testing Pinch, a tool that keeps your design taste as rules your coding agent follows: you mark what works and what doesn't on screenshots, your agent reads them into rules, and every agent you connect gets them, in every session. It's free for one product. For the next month I'd like you to use it on real work and tell me where it helps and where it gets in the way. Pro is $29 a month if you want it on every product; I'll ask whether you'd pay, not make you.

## What to watch

`GET /api/pin/pilot`, behind `ADMIN_PASSWORD`, lists each account by the first characters of its hashed key, with counts only: runs in the last 7 and 30 days, pieces of work reported and the Good, Close and Off verdicts on them, notes the agent read, rules it proposed, its last run and, once plans are on, whether it has Pro. Nothing anyone made or said.

| Week | Sign of a keeper | Sign of a one-off |
| --- | --- | --- |
| 1 | A batch read, the agent connected, a first report judged | Notes marked, never read |
| 2 | Runs every few days; a rule proposed or edited after a report | No runs after the first week |
| 3–4 | A second product tagged; Pro asked about or bought | Export downloaded, then nothing |

## How to decide

- **Keep the plan** when at least half are still running their agent with Pinch in week 4, and at least a third reach for a second product (paid, or asked for).
- **Rethink the boundary** when people stay active but never need a second product: the line is in the wrong place, not the price.
- **Rethink the subscription** when most read once, export and leave: a one-time purchase fits that better, at any price.
- **Ask each person**, at the end, one question: what would you lose if Pinch went away tomorrow?

Also compare, on your own notes, the agent's reading with Pinch's (D122): faithful to the notes, few duplicates, conflicts caught. If the agent's is clearly worse, keep Pinch's reading as the default and price the credits into Pro.
