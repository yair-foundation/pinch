# Pinch

Tag screenshots for your agent. Add a batch of screens, mark what works and what doesn't with a dot, an area or an arrow, and say why and what it's about (visual, layout, copy, interaction, flow, accessibility). Then open Your rules: Pinch reads your notes, finds the patterns across images and keeps them as one taste library of rules, each with the notes and close-ups it draws on. Overlapping notes become one rule, notes that pull different ways keep where each holds, and a new batch strengthens a rule, adds one or flags a conflict. Edit or remove any rule, slice them by topic, and connect your agent: over MCP it fetches the current rules for each task, and a rule's close-ups with where each spot is when it needs to see them (D94), or copy them as a prompt for one chat (D93).

Pinch is $19 once, with a Google sign-in, sold through Lemon Squeezy (D81, D87). Marking images needs no account, and Your rules shows the first two rules Pinch finds; every rule, connecting an agent and AI suggestions come with buying. A buyer's rules are kept in their account, screenshots included, on every device they sign in on. Until Google sign-in and Lemon Squeezy are both configured, nothing is gated and Pinch works as a free, account-less tool whose rules stay in the browser.

Live at https://get-pinch.io. Desktop only (under 768px wide it shows one message), up to 100 images a session.

Optional, with keys: AI drafts for empty notes (suggestions), the AI reading of notes into rules, anonymous saving of the text of notes, and tagging of those notes by design area with Jev (TypeSafe).

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
| `PIN_LEARN` | unset | `0` turns reading notes into rules off. |
| `PIN_LEARN_MODEL` | `claude-opus-5-5` | Model that reads notes into rules (`/api/pin/learn`). |
| `PIN_LEARN_DAILY_USD` | `10` | Reading notes into rules for buyers: USD cap per day. |
| `PIN_LEARN_PER_VISITOR` | `60` | Readings (up to 30 notes each) per visitor per day; a visitor also gets at most a third of the day's dollars. |
| `PIN_LEARN_CALLS_PER_DAY` | `600` | Readings per day, all buyers. |
| `PIN_LEARN_PREVIEW_DAILY_USD` | `3` | The preview readings of visitors who haven't bought: USD cap per day, on its own ledger. |
| `PIN_LEARN_PREVIEW_PER_VISITOR` | `4` | Preview readings per visitor per day. |
| `PIN_LEARN_PREVIEW_CALLS_PER_DAY` | `200` | Preview readings per day, all visitors. |
| `BLOB_READ_WRITE_TOKEN` | unset | Vercel Blob store for the daily ledgers and saved note text. Either this or `BLOB_STORE_ID` turns it on; without both, everything is in memory and lost on restart. Required in production if saved notes should persist. |
| `BLOB_STORE_ID` | unset | See above (set by Vercel when a store is connected). |
| `ADMIN_PASSWORD` | unset | HTTP Basic password (any user name) for `GET /api/pin/notes`. Unset: 404 in production, open in `next dev`. Required to read saved notes in production. |
| `VISITOR_SALT` | `pinch` | Salt for the hashed visitor key in the daily ledgers (never the raw IP). Any string. |
| `JEV_API_KEY` | unset | TypeSafe key. Turns on tagging of saved notes by area. |
| `PIN_TAGS` | unset | `0` turns tagging off even with a key. |
| `JEV_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | Jev's endpoint; point it at the local stub to test. |
| `JEV_MODEL` | `jev-1.13.0` | Pinned Jev model. |
| `PIN_TAG_CALLS_PER_DAY` | `2000` | Jev calls per day, all saves. |
| `GOOGLE_CLIENT_ID` | unset | Google OAuth client (Web application). With the secret and `AUTH_SECRET`, turns on sign-in. |
| `GOOGLE_CLIENT_SECRET` | unset | Its secret (sensitive). |
| `AUTH_SECRET` | unset | Signs the session cookie: any long random string (sensitive), e.g. `openssl rand -base64 48`. Changing it signs everyone out. |
| `LEMONSQUEEZY_STORE_ID` | unset | Lemon Squeezy store id (a number). With the next three, turns billing on; with sign-in also on, Pinch is paid. |
| `LEMONSQUEEZY_PRODUCT_ID` | unset | The Pinch product's id. Orders of any other product are ignored. |
| `PINCH_BUY_URL` | unset | The product's checkout link (`https://<store>.lemonsqueezy.com/buy/<id>`). Pinch adds the buyer's email and account to it. |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | unset | The signing secret of the webhook pointed at `/api/pin/billing/webhook` (sensitive). |
| `LEMONSQUEEZY_API_KEY` | unset | Optional (sensitive). Lets "Paid already?" find a purchase by email when a webhook went astray. |
| `PINCH_PRICE` | `$19` | The price as the page shows it. |
| `PINCH_SUPPORT_EMAIL` | unset | Shown on `/terms` for questions and refunds; without it, the maker's site. |
| `BLOB_WEBHOOK_PUBLIC_KEY` | unset | Set by Vercel with the Blob store; needed for uploads of collections' batches to the account. |
| `PINCH_TEST_LOGIN` | unset | `1` turns on `POST /api/pin/auth/test`, a sign-in without Google for local tests. Never on Vercel, whatever it says. |

## Testing the AI steps and Jev locally

- **Anthropic.** Put `ANTHROPIC_API_KEY` in `.env.local` and run `pnpm dev`; the account menu shows the Suggestions switch, and Your rules reads new notes into rules on its own. Each step keeps its own daily ledger (in memory locally).
- **Jev, without a key.** `pnpm jev-stub` starts a stand-in on port 3999 that answers the area questions from keywords in the note. In a second terminal: `JEV_API_KEY=stub JEV_ENDPOINT=http://localhost:3999 pnpm dev`. Write a note, wait about six seconds for it to be saved, and read it back (below) to see its `tags`. The stub tests the plumbing, never the tagging quality.
- **Paid mode, locally.** Set the Google and Lemon Squeezy variables to any test values, plus `AUTH_SECRET` and `PINCH_TEST_LOGIN=1`, then `pnpm build && pnpm start`. Sign in with `POST /api/pin/auth/test` (`{"email": "you@example.com"}`, same origin), and mark the purchase by sending the webhook route an `order_created` body signed with the webhook secret (HMAC-SHA256 of the raw body, hex, in `X-Signature`). Without a Blob store, the account's rules live in the server's memory. Signed in but not bought, Your rules gets the preview: two rules in full, the rest hidden.
- **The rules benchmark.** `ANTHROPIC_API_KEY=… node --import tsx scripts/rules-bench/run.ts <out-dir> [runs] [builds] [held-out]` reads the cases in `scripts/rules-bench/cases.ts` with a plain prompt, with Pinch before the foundation and with Pinch as it is, has a judge score each against the case's key, then puts each one's guidance to work on a fresh task (D90). A few dollars a run; results in [docs/rules-bench.md](docs/rules-bench.md).
- **Reading saved notes.** `GET /api/pin/notes` lists the saved days; `?day=YYYY-MM-DD` returns a day's document (each note under its random id, with `at` and, once tagged, `tags`); `?summary=YYYY-MM` counts a month's notes by area. In production send the password: `curl -u admin:$ADMIN_PASSWORD "https://get-pinch.io/api/pin/notes?summary=2026-10"`. In `next dev` without `ADMIN_PASSWORD` the route is open.

## Project structure

```
src/app/                 layout (fonts, metadata, theme), page (the tool at "/"), robots.ts, global.css
src/app/api/pin/         suggest, learn, notes; me, auth/ (google, callback, signout, test), billing/ (webhook,
                         restore), account, cloud/ (collections, batches, upload)
src/app/terms/           the terms page
src/components/pin/      the app (pin-app.tsx), collections (collections.tsx; kept in the browser, collections-store.ts,
                         or the account, cloud-store.ts), Connect agent (connect-agent.tsx), the account menu and its
                         gate (account.tsx), shimmer, landing folder, wordmark, IndexedDB store, canvas and zip
                         rendering, topic tags and their picker
src/components/site/     theme provider and toggle
src/components/ui/       button, switch, tooltip (Base UI)
src/lib/pin/             the pure model, suggestion prompt and filter, export summary, contact sheet, zip writer and
                         reader, export import, collections and learnings, rule-draft prompt, notes log, store, tags
                         and tagger, AI ledgers; tests in __tests__/
src/lib/                 session, google, account, billing, access, cloud (sign-in, purchases, the gate, the
                         account's collections); blob-doc (JSON documents in Blob), budget (prices, refusal, visitor
                         key), jev (one request to Jev), auth (admin Basic auth, same-origin check), image (sniffing)
public/pin-notes/        icon.svg (favicon), landing.webp, landing-night.webp (the paintings)
scripts/                 jev-stub.mjs, format.mjs, rules-bench/ (the rules benchmark: cases, the baseline, the runner)
docs/                    architecture, decisions, design, status
```

More in [docs/architecture.md](docs/architecture.md). Agents start with [AGENTS.md](AGENTS.md).

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New Project**, import the repository. Framework preset: Next.js; build command `pnpm build`; install command `pnpm install`. Deploy once with no variables to see the tool run.
3. **Storage.** In the project's Storage tab create (or connect) a **Blob** store. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project. To keep the notes and ledgers the live site already holds, connect the same store the site uses now: the keys are `pin-notes/text/<day>.json`, `pin-notes/suggest/<day>.json` and `pin-notes/tags/<day>.json`.
4. **Environment variables** (Settings, Environment Variables, Production): `ANTHROPIC_API_KEY` (sensitive) for suggestions and rule drafts, `ADMIN_PASSWORD` (sensitive) to read saved notes, `JEV_API_KEY` (sensitive) for tagging, and any cap you want to change from its default. Redeploy after changing them.
5. **Selling Pinch** (D81). Until all of this is set, Pinch stays free.
   - **Google sign-in:** in Google Cloud Console, APIs & Services, Credentials, create an OAuth client ID of type Web application. Authorized redirect URI: `https://<your domain>/api/pin/auth/callback` (and the same on any other domain you serve). On the consent screen, the scopes are `openid`, `email` and `profile`, and the app goes to production so anyone can sign in. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a fresh `AUTH_SECRET` in Vercel.
   - **Lemon Squeezy:** create the store and a product, Pinch, $19, single payment, and copy its checkout link into `PINCH_BUY_URL`; the store and product ids go in `LEMONSQUEEZY_STORE_ID` and `LEMONSQUEEZY_PRODUCT_ID`. Under Settings, Webhooks, add `https://<your domain>/api/pin/billing/webhook` with the events `order_created` and `order_refunded`, and put its signing secret in `LEMONSQUEEZY_WEBHOOK_SECRET`. Optionally create an API key for `LEMONSQUEEZY_API_KEY`. In the product's confirmation settings, send buyers back to `https://<your domain>/`.
   - **Blob:** the connected store already provides `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY`; the account's collections use them.
   - Redeploy, then sign in, buy with a test-mode product, and check the landing opens.
6. **Domain.** Settings, Domains: add the domain (the live one is `get-pinch.io`, bought through Vercel; `pinch-tool.vercel.app` serves the same deployment. A domain bought elsewhere needs its DNS pointed at Vercel as the dialog says. Google's redirect URI and the Lemon Squeezy webhook name the domain, so change them with it). Keeping the same origin keeps every visitor's session: images and notes live in their browser's IndexedDB (`pin-notes`) and `localStorage` under that origin.
7. Check `/robots.txt` (allows `/`, disallows `/api/`), `/api/pin/suggest` and `/api/pin/learn` (`{"available":true}` with a key) and `GET /api/pin/notes` with the password.

## Privacy

Images stay in the browser (IndexedDB) until a signed-in buyer's rules move into their account: the rules, their notes and screenshots are then stored privately in the Blob store under the account's folder, and deleted with the account. Without a purchase they stay in the browser. An account keeps the email and name Google gives; purchases are kept under a hash of the email, and Lemon Squeezy keeps the payment details. One cookie (`pinch-session`) keeps the sign-in. Suggestions send a close-up of the marked spot and a scaled-down screen to Anthropic, not stored. Reading notes into rules sends only words: the new notes' (what works, what doesn't, the short name, their topics and whose design it is) and the existing rules', not stored. It happens when anyone opens Your rules, bought or not. The text of written notes (what works, what doesn't, the short name; never images, file names, links, the account or IP addresses) is saved anonymously for 90 days and tagged by area with Jev, unless the visitor switches it off in the privacy dialog (D82). The landing footer says so in one line, and the "How Pinch uses your data" dialog (footer and header) says it in full.

## License

No license chosen yet. All rights reserved until one is.

The expert foundation (`src/lib/pin/foundation.ts`) is written in Pinch's own words, drawing on GenUI's design foundations (the Yair Foundation's), Anthropic's [frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) (Apache License 2.0) and Vercel's [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (MIT, © Vercel Labs). No text of theirs is copied.
