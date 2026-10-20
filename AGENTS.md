<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Pinch: rules for agents

- Pinch is one paid tool at `/` (D81): a Next.js app with route handlers under `/api/pin/` (suggest, learn, notes; me, auth, billing, account, cloud) and a `/terms` page. [README.md](README.md) says what it is; [docs/architecture.md](docs/architecture.md) where each piece lives; [docs/design.md](docs/design.md) the visual rules it follows; [docs/decisions.md](docs/decisions.md) why things are the way they are; [docs/status.md](docs/status.md) what is built and what isn't.
- The app is `src/components/pin/pin-app.tsx`, with the collections in `collections.tsx` and the account in `account.tsx`; pure logic (model, export, notes, tags) is in `src/lib/pin/` with tests beside it in `__tests__/`; shared server bits (Blob documents, prices, Jev, auth, image sniffing, the session, Google sign-in, accounts, billing, the gate, the account's collections) are in `src/lib/`.
- Before calling code done: `pnpm test`, `pnpm types:check` (runs `next typegen` first) and `pnpm lint` all clean, and `pnpm build` passing. Check visual changes on a production build in light and dark.
- Format only files you created, with `pnpm format <files>`; edit existing files in their own style. `pnpm exec biome check --write <file>` sorts imports on a file you made.
- Ask before anything outward-facing: pushing, deploying, publishing, deleting, sending.
- Keep the identifiers existing users depend on: the IndexedDB names `pin-notes` and `pinch-collections`, the `localStorage` keys (`pinch-*`, `genui-theme`), the cookie `pinch-session`, the Blob keys under `pin-notes/`, `pinch-accounts/`, `pinch-purchases/` and `pinch-users/`, the env var names, and the API paths under `/api/pin/` (the Google callback and the Lemon Squeezy webhook URLs are registered outside the code).
- Privacy: images leave the browser only into a signed-in buyer's own collections in their account (D81); otherwise only the text of notes is saved, anonymously and only while the visitor's switch is on (D82), and only note text goes to Jev. Never log emails, images, file names, links, "made by" or IP addresses on the server; the visitor key is a salted hash, accounts and purchases are keyed by hashes. Keep every AI step and the tagging off without their keys and behind their daily caps, and every paid step behind the gate (`src/lib/access.ts`).
- No secrets in the repository: `.env*` is ignored; `.env.example` lists every variable with no values.
- Copy: no text arrows in UI strings; short labels; see [docs/design.md](docs/design.md).
- New decisions go at the top of `docs/decisions.md`, numbered on from D85, with the reason.
