# Status

## Current state (2026-10-19)

Pinch is its own repository, moved whole out of the GenUI repository where it began as the `/pin` route (decisions D58–D67 in [decisions.md](decisions.md)). The move changed no behaviour: the same app at `/`, the same three API paths, the same IndexedDB name, `localStorage` keys, Blob keys and environment variable names, so existing browsers keep their sessions and the same Blob store can be reused. The host switching that served Pinch from the GenUI deployment is gone; `HANDBOOK_PASSWORD` became `ADMIN_PASSWORD` (realm "Pinch admin") and `PLAYGROUND_SALT` became `VISITOR_SALT` (with a default). Verified on a production build in headless Chromium: landing in both themes pixel-compared with the original, two images added, a dot, an area and an arrow placed with notes, undo, the source key, the shortcuts dialog, Copy for agent, an export checked with `unzip -t` (README, AGENTS.md, notes.json, contact sheet, marked copies, crops), reload keeping the session, the 100-image cap, the desktop-only message at 390px, the API routes without keys, same-origin and cross-origin saves, the admin GET without and with the password, and note tagging against the local Jev stub.

Collections, import of an export and learnings were built on 2026-10-20 (D77): batches kept in named collections in this browser, one learning per note drafted by the AI from the note's words or written by hand, approved, edited or rejected, marked personal taste or this project, and exported as `design-rules.md` with each rule's close-up. Verified on a production build in Chromium in light and dark with the drafting route mocked (no key here): the real model's drafts are untested.

Notes carry optional topic chips (Visual, Layout, Copy, Interaction, Flow, Accessibility), suggested with a suggestion and carried into the export (D73, 2026-10-20).

AI placement ("Find in image") and the free-text box were removed on 2026-10-20 (D68), and all 21 findings of an end-to-end review fixed.

Built and live: the landing with the painting (dusk and a dark card in dark mode, night and a light card in light, crossfading on a theme change), parallax and liquid-glass bezel; a Pin / Area / Arrow toolbar; sources as four radio buttons; topic chips on each note; opening an export; collections with learnings and the rules export; suggestions with Tab to accept and Esc to dismiss; Copy for agent (image plus text, or all notes as text); the zip export in the Scrawl-like reading contract; undo and redo; keyboard shortcuts; anonymous saving of note text with Jev area tags and the owner's JSON read; desktop only; 100 images a session.

## Not built

- **Sync**: collections live in one browser; moving them means downloading their batches and importing them elsewhere (learnings don't travel yet).
- **Picking rules per task**: the export takes the approved rules the author ticks; choosing the ones that fit a task, or an MCP server that serves them, is not built.
- **Editing a learning's topics**: they come from the note; change the note's tags and add the batch again.
- **A notes page.** The owner reads saved notes as JSON only (`GET /api/pin/notes`); a page was not wanted.

## Things not to reintroduce

- Host-based routing or a `/pin` path: the site is the tool.
- A footer line about saving or sending data, unless the user asks for it back; the privacy page is the planned fix.
- A mobile layout: the user said no mobile version (D67).
- Images or file names on the server: only note text is ever saved or sent.
