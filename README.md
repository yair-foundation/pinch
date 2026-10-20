# Pinch

Tag screenshots for your agent. Add a batch of screens, mark what works and what doesn't with a dot, an area or an arrow, say why and what it's about (visual, layout, copy, interaction, flow, accessibility), and export it all as a folder an AI agent reads: `README.md`, `AGENTS.md`, `notes.json`, a contact sheet, every image with its marks drawn on and a close-up of every note. Free, no account; the images never leave the browser. Batches can be kept in collections, where each note becomes a learning: the rule it teaches, which you approve, edit or reject, mark as personal taste or this project, and export as a rules file with its evidence.

Live at https://pinch-tool.vercel.app. Desktop only (under 768px wide it shows one message), up to 100 images a session.

Optional, with keys: AI drafts for empty notes (suggestions), AI drafts of the rule each note in a collection teaches, anonymous saving of the text of notes, and tagging of those notes by design area with Jev (TypeSafe).

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Nothing else is needed: without keys the AI steps are off, saved notes live in memory, and the owner's read of them is open in `next dev`.

Checks, all of which must pass before a change is done:

```bash
pnpm test                 # node:test via tsx, src/**/__tests__/*.test.ts
pnpm types:check          # next typegen, then tsc --noEmit
pnpm lint                 # biome lint
pnpm build                # next build
```

`pnpm format <files>` runs Prettier on the files you name, in the style of their folder.

## Environment variables

Every variable is optional; the tool runs with none. Copy `.env.example` to `.env.local` for a local run. Never commit `.env*`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Turns on suggestions and rule drafts. Required for them, nothing else. |
| `PIN_AI` | unset | `0` turns suggestions and rule drafts off even with a key. |
| `PIN_SUGGEST` | unset | `0` turns suggestions off. |
| `PIN_SUGGEST_MODEL` | `claude-haiku-5-5` | Model for suggestions (`/api/pin/suggest`). |
| `PIN_SUGGEST_DAILY_USD` | `2` | Suggestions: USD cap per day. |
| `PIN_SUGGEST_PER_VISITOR` | `300` | Suggestions per visitor per day; a visitor also gets at most a third of the day's dollars. |
| `PIN_SUGGEST_CALLS_PER_DAY` | `4000` | Suggestions per day, all visitors. |
| `PIN_LEARN` | unset | `0` turns rule drafts off. |
| `PIN_LEARN_MODEL` | `claude-opus-5-5` | Model for rule drafts (`/api/pin/learn`). |
| `PIN_LEARN_DAILY_USD` | `2` | Rule drafts: USD cap per day. |
| `PIN_LEARN_PER_VISITOR` | `60` | Draft requests (up to 12 notes each) per visitor per day; a visitor also gets at most a third of the day's dollars. |
| `PIN_LEARN_CALLS_PER_DAY` | `600` | Draft requests per day, all visitors. |
| `BLOB_READ_WRITE_TOKEN` | unset | Vercel Blob store for the daily ledgers and saved note text. Either this or `BLOB_STORE_ID` turns it on; without both, everything is in memory and lost on restart. Required in production if saved notes should persist. |
| `BLOB_STORE_ID` | unset | See above (set by Vercel when a store is connected). |
| `ADMIN_PASSWORD` | unset | HTTP Basic password (any user name) for `GET /api/pin/notes`. Unset: 404 in production, open in `next dev`. Required to read saved notes in production. |
| `VISITOR_SALT` | `pinch` | Salt for the hashed visitor key in the daily ledgers (never the raw IP). Any string. |
| `JEV_API_KEY` | unset | TypeSafe key. Turns on tagging of saved notes by area. |
| `PIN_TAGS` | unset | `0` turns tagging off even with a key. |
| `JEV_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | Jev's endpoint; point it at the local stub to test. |
| `JEV_MODEL` | `jev-1.13.0` | Pinned Jev model. |
| `PIN_TAG_CALLS_PER_DAY` | `2000` | Jev calls per day, all saves. |

## Testing the AI steps and Jev locally

- **Anthropic.** Put `ANTHROPIC_API_KEY` in `.env.local` and run `pnpm dev`; the header shows the Suggestions switch, and a collection with notes to review shows Draft. Each step keeps its own daily ledger (in memory locally).
- **Jev, without a key.** `pnpm jev-stub` starts a stand-in on port 3999 that answers the area questions from keywords in the note. In a second terminal: `JEV_API_KEY=stub JEV_ENDPOINT=http://localhost:3999 pnpm dev`. Write a note, wait about six seconds for it to be saved, and read it back (below) to see its `tags`. The stub tests the plumbing, never the tagging quality.
- **Reading saved notes.** `GET /api/pin/notes` lists the saved days; `?day=YYYY-MM-DD` returns a day's document (each note under its random id, with `at` and, once tagged, `tags`); `?summary=YYYY-MM` counts a month's notes by area. In production send the password: `curl -u admin:$ADMIN_PASSWORD "https://pinch-tool.vercel.app/api/pin/notes?summary=2026-10"`. In `next dev` without `ADMIN_PASSWORD` the route is open.

## Project structure

```
src/app/                 layout (fonts, metadata, theme), page (the tool at "/"), robots.ts, global.css
src/app/api/pin/         suggest, learn, notes: the three route handlers
src/components/pin/      the app (pin-app.tsx), collections (collections.tsx, its own IndexedDB store), landing folder
                         animation, wordmark, IndexedDB store, canvas and zip rendering, topic tag styles
src/components/site/     theme provider and toggle
src/components/ui/       button, switch, tooltip (Base UI)
src/lib/pin/             the pure model, suggestion prompt and filter, export summary, contact sheet, zip writer and
                         reader, export import, collections and learnings, rule-draft prompt, notes log, store, tags
                         and tagger, AI ledgers; tests in __tests__/
src/lib/                 blob-doc (compare-and-swap JSON in Blob), budget (prices, refusal, visitor key),
                         jev (one request to Jev), auth (admin Basic auth, same-origin check), image (type sniffing)
public/pin-notes/        icon.svg (favicon), landing.webp, landing-night.webp (the paintings)
scripts/                 jev-stub.mjs, format.mjs
docs/                    architecture, decisions, design, status
```

More in [docs/architecture.md](docs/architecture.md). Agents start with [AGENTS.md](AGENTS.md).

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New Project**, import the repository. Framework preset: Next.js; build command `pnpm build`; install command `pnpm install`. Deploy once with no variables to see the tool run.
3. **Storage.** In the project's Storage tab create (or connect) a **Blob** store. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project. To keep the notes and ledgers the live site already holds, connect the same store the site uses now: the keys are `pin-notes/text/<day>.json`, `pin-notes/suggest/<day>.json` and `pin-notes/tags/<day>.json`.
4. **Environment variables** (Settings, Environment Variables, Production): `ANTHROPIC_API_KEY` (sensitive) for suggestions and rule drafts, `ADMIN_PASSWORD` (sensitive) to read saved notes, `JEV_API_KEY` (sensitive) for tagging, and any cap you want to change from its default. Redeploy after changing them.
5. **Domain.** Settings, Domains: add the domain (the live one is `pinch-tool.vercel.app`; a custom domain needs its DNS pointed at Vercel as the dialog says). Keeping the same origin keeps every visitor's session: images and notes live in their browser's IndexedDB (`pin-notes`) and `localStorage` under that origin.
6. Check `/robots.txt` (allows `/`, disallows `/api/`), `/api/pin/suggest` and `/api/pin/learn` (`{"available":true}` with a key) and `GET /api/pin/notes` with the password.

## Privacy

Images stay in the browser (IndexedDB), never uploaded; so do collections, their batches and rules. Suggestions send a close-up of the marked spot and a scaled-down screen to Anthropic, not stored. Rule drafts send only the words of a collection's notes (what works, what doesn't, the short name, their topics and whose design it is), not stored. The text of written notes (what works, what doesn't, the short name; never images, file names, links or IP addresses) is saved anonymously for 90 days and tagged by area with Jev. The landing footer says so in one line, and the "How Pinch uses your data" dialog (footer and header) says it in full.

## License

No license chosen yet. All rights reserved until one is.
