# Status

## Current state (2026-10-20)

Pinch is its own repository, moved whole out of the GenUI repository where it began as the `/pin` route (decisions D58–D67 in [decisions.md](decisions.md)). The move changed no behaviour: the same app at `/`, the same three API paths, the same IndexedDB name, `localStorage` keys, Blob keys and environment variable names, so existing browsers keep their sessions and the same Blob store can be reused. The host switching that served Pinch from the GenUI deployment is gone; `HANDBOOK_PASSWORD` became `ADMIN_PASSWORD` (realm "Pinch admin") and `PLAYGROUND_SALT` became `VISITOR_SALT` (with a default). Verified on a production build in headless Chromium: landing in both themes pixel-compared with the original, two images added, a dot, an area and an arrow placed with notes, undo, the source key, the shortcuts dialog, an export checked with `unzip -t` (README, AGENTS.md, notes.json, contact sheet, marked copies, crops), reload keeping the session, the 100-image cap, the desktop-only message at 390px, the API routes without keys, same-origin and cross-origin saves, the admin GET without and with the password, and note tagging against the local Jev stub.

Your rules became one taste library on 2026-10-20 (D86, D87, D88). Opening it (the image screen's main button) keeps the open images' new notes, and the AI reads them on its own against the rules already there: overlapping notes become one rule drawing on all of them, notes that pull different ways keep where each holds, a new batch strengthens rules, adds rules or flags a conflict. Rules stand apart from images, each opening to its notes and close-ups; they are guidance at once, and the pencil edits them (no approve or dismiss, D88). One collection, sliced by topic and by the author's own tags. Marking images is free with no account; a visitor sees the first two rules and the rest as placeholders, and buying (after a Google sign-in) opens every rule, every export (rules and the batch zip) and AI suggestions, and moves the browser's rules into the account. Verified in a production build in paid test mode, with the model mocked and with the real model (readings cost $0.01 to $0.03): the free screen, the pay prompts, the preview, sign-in, purchase by webhook, the move without duplicates, the hidden rules read again, a second batch strengthening a rule and raising a conflict, slicing, exports. Not verified: a real Google sign-in or Lemon Squeezy checkout against this flow.

Pinch became one paid tool on 2026-10-20 (D81): Google sign-in, $19 once through Lemon Squeezy (a signed webhook marks the purchase under the buyer's email), every AI step and the account's collections behind the gate, collections kept in the account with their screenshots, a terms page and an Account dialog that signs out or deletes the account. It is off until Google and Lemon Squeezy are configured (README, Deploying), so the live site works as before until then. Rules lost Approve and Reject (D80): a kept rule is an agreed one; the export picks topics or copies the rules as text; a rule's topics are editable. Note saving has a switch (D82). Verified on production builds in Chromium, light and dark: billing off (as live today) and billing on with test values, the local test sign-in, signed webhooks (forged, other store, paid, refunded, a late paid report after a refund), the account's collections in server memory, moving the browser's collections into the account, the export dialog, copy as text, the note switch, account deletion keeping the purchase. Not verified here: a real Google sign-in, a real Lemon Squeezy checkout and webhook, the Blob store's presigned uploads and downloads, and the real model's rule drafts (the preview has no Anthropic key).

Collections, import of an export and learnings were built on 2026-10-20 (D79): batches kept in named collections, one learning per note drafted by the AI from the note's words or written by hand, and exported as `design-rules.md` with each rule's close-up.

Notes carry optional topic chips (Visual, Layout, Copy, Interaction, Flow, Accessibility), suggested with a suggestion and carried into the export (D75, 2026-10-20).

AI placement ("Find in image") and the free-text box were removed on 2026-10-20 (D68), and all 21 findings of an end-to-end review fixed.

Built and live: the landing with the painting (dusk and a dark card in dark mode, night and a light card in light, crossfading on a theme change), parallax and liquid-glass bezel; a Pin / Area / Arrow toolbar; sources as four radio buttons; topic chips on each note; opening an export; Your rules, read from notes into a taste library, sliced by tags, with the rules export; Google sign-in, Lemon Squeezy and collections in the account (off until configured); the note-saving switch; the terms page; suggestions with Tab to accept and Esc to dismiss; the zip export in the Scrawl-like reading contract; undo and redo; keyboard shortcuts; Measure spacing on a dot or an area (D73) and Check spacing between items on an area (D74); anonymous saving of note text with Jev area tags and the owner's JSON read; desktop only; 100 images a session.

## Not built

- **A fuller trial.** Marking is free and the first two rules show; there is no free allowance of every rule or an export (a trial with a monthly plan is being weighed).
- **Serving rules to an agent per task**: the export picks by topic, and copies as text; an MCP server that hands an agent the rules a task needs is not built (it needs rules outside the browser, which the account now provides).
- **Teams**: one account, one person; no shared collections.
- **Two tabs or devices editing one collection at once**: the last save wins.
- **A notes page.** The owner reads saved notes as JSON only (`GET /api/pin/notes`); a page was not wanted.

## Things not to reintroduce

- Host-based routing or a `/pin` path: the site is the tool.
- A footer line about saving or sending data, unless the user asks for it back; the privacy page is the planned fix.
- A mobile layout: the user said no mobile version (D67).
- Images or file names on the server, except a signed-in buyer's own collections in their account (D81): otherwise only note text is ever saved or sent.
