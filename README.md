# Pinch

Tag screenshots for your agent. Add a batch of screens, mark what works and what doesn't with a dot, an area or an arrow, say why, and export it all as a folder an AI agent reads: `README.md`, `AGENTS.md`, `notes.json`, a contact sheet, every image with its marks drawn on and a close-up of every note. Free, no account; the images never leave the browser.

Live at https://pinch-tool.vercel.app. Desktop only (under 768px wide it shows one message), up to 100 images a session.

Optional, with keys: an AI step that places the notes you write about an image ("Find in image"), AI drafts for empty notes (suggestions), anonymous saving of the text of notes, and tagging of those notes by design area with Jev (TypeSafe).

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
| `ANTHROPIC_API_KEY` | unset | Turns on the AI steps ("Find in image", suggestions). Required for them, nothing else. |
| `PIN_AI` | unset | `0` turns every AI step off even with a key. |
| `PIN_MODEL` | `claude-opus-5-5` | Model for "Find in image" (`/api/pin/locate`). |
| `PIN_EFFORT` | `medium` | Its effort: `low`, `medium` or `high`. |
| `PIN_AI_DAILY_USD` | `3` | "Find in image": USD cap per UTC day, all visitors. |
| `PIN_AI_PER_VISITOR` | `60` | Its calls per visitor per day. |
| `PIN_AI_CALLS_PER_DAY` | `300` | Its calls per day, all visitors. |
| `PIN_SUGGEST` | unset | `0` turns suggestions off. |
| `PIN_SUGGEST_MODEL` | `claude-haiku-5-5` | Model for suggestions (`/api/pin/suggest`). |
| `PIN_SUGGEST_DAILY_USD` | `2` | Suggestions: USD cap per day. |
| `PIN_SUGGEST_PER_VISITOR` | `300` | Suggestions per visitor per day. |
| `PIN_SUGGEST_CALLS_PER_DAY` | `4000` | Suggestions per day, all visitors. |
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

- **Anthropic.** Put `ANTHROPIC_API_KEY` in `.env.local` and run `pnpm dev`; the header shows the Suggestions switch and, once an image has an overall note, "Find in image". Each step keeps its own daily ledger (in memory locally).
- **Jev, without a key.** `pnpm jev-stub` starts a stand-in on port 3999 that answers the area questions from keywords in the note. In a second terminal: `JEV_API_KEY=stub JEV_ENDPOINT=http://localhost:3999 pnpm dev`. Write a note, wait about six seconds for it to be saved, and read it back (below) to see its `tags`. The stub tests the plumbing, never the tagging quality.
- **Reading saved notes.** `GET /api/pin/notes` lists the saved days; `?day=YYYY-MM-DD` returns a day's document (each note under its random id, with `at` and, once tagged, `tags`); `?summary=YYYY-MM` counts a month's notes by area. In production send the password: `curl -u admin:$ADMIN_PASSWORD "https://pinch-tool.vercel.app/api/pin/notes?summary=2026-10"`. In `next dev` without `ADMIN_PASSWORD` the route is open.

## Project structure

```
src/app/                 layout (fonts, metadata, theme), page (the tool at "/"), robots.ts, global.css
src/app/api/pin/         locate, suggest, notes: the three route handlers
src/components/pin/      the app (pin-app.tsx), landing folder animation, wordmark, IndexedDB store, canvas and zip rendering
src/components/site/     theme provider and toggle
src/components/ui/       button, switch, tooltip (Base UI)
src/lib/pin/             the pure model, locate and suggest prompts, export summary, contact sheet, zip writer,
                         notes log, store, tags and tagger, AI ledgers; tests in __tests__/
src/lib/                 blob-doc (compare-and-swap JSON in Blob), budget (prices, refusal, visitor key),
                         jev (one request to Jev), auth (admin Basic auth, same-origin check), image (type sniffing)
public/pin-notes/        icon.svg (favicon), landing.webp (the painting)
scripts/                 jev-stub.mjs, format.mjs
docs/                    architecture, decisions, design, status
```

More in [docs/architecture.md](docs/architecture.md). Agents start with [AGENTS.md](AGENTS.md).

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New Project**, import the repository. Framework preset: Next.js; build command `pnpm build`; install command `pnpm install`. Deploy once with no variables to see the tool run.
3. **Storage.** In the project's Storage tab create (or connect) a **Blob** store. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project. To keep the notes and ledgers the live site already holds, connect the same store the site uses now: the keys are `pin-notes/text/<day>.json`, `pin-notes/ai/<day>.json`, `pin-notes/suggest/<day>.json` and `pin-notes/tags/<day>.json`.
4. **Environment variables** (Settings, Environment Variables, Production): `ANTHROPIC_API_KEY` (sensitive) for the AI steps, `ADMIN_PASSWORD` (sensitive) to read saved notes, `JEV_API_KEY` (sensitive) for tagging, and any cap you want to change from its default. Redeploy after changing them.
5. **Domain.** Settings, Domains: add the domain (the live one is `pinch-tool.vercel.app`; a custom domain needs its DNS pointed at Vercel as the dialog says). Keeping the same origin keeps every visitor's session: images and notes live in their browser's IndexedDB (`pin-notes`) and `localStorage` under that origin.
6. Check `/robots.txt` (allows `/`, disallows `/api/`), `/api/pin/locate` (`{"available":true}` with a key) and `GET /api/pin/notes` with the password.

## Privacy

Images stay in the browser (IndexedDB), never uploaded. "Find in image" sends one image and its note to Anthropic; a suggestion sends a close-up and a scaled-down screen; neither is stored. The text of written notes (never images, file names, links, "made by" or IP addresses) is saved anonymously for 90 days and tagged by area with Jev. The landing page does not yet say so; see [docs/status.md](docs/status.md).

## License

No license chosen yet. All rights reserved until one is.
