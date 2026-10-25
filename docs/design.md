# Design

The visual rules Pinch follows, condensed from the design foundations of the system it came from. Read before any visual change. The token values live in code (`src/app/global.css`); this page says what they are for.

## Principles

- **Minimal, low-text.** One focal element; cut captions and side notes. Hidden-but-needed text is sr-only or in a tooltip.
- **Colour is an accent, not a background.** Surfaces stay neutral; colour carries meaning: green for what works, red for what doesn't, amber for both (`VERDICT_COLOR` in `render.ts`), magenta only in the crops sent to the AI. A best example (D108) is marked with a filled star in the text colour, not a colour of its own. The one exception is the topic tags (D76): each topic has a tint (`TOPIC_TONES` in `pin-app.tsx`; fuchsia, blue, teal, violet, orange, green, never red) that fills the tag and colours its label when it is on.
- **One style in both themes.** Light takes dark's visual language, not its colours: hollow bordered panels, a solid default button (black in light, light grey in dark), hollow secondary buttons, 6px buttons, 8px inputs and textareas. Badges, chips and icon buttons are pills or circles; topic tags are 28px with 6px corners.
- **44px is the hit area, not the button.** Every control has a hit area at least 44px each way while the visible button keeps its size (28, 36 or 40px): the shared `Button` has it built in, raw controls add a centred `after:` pseudo-element (see the tool switch in `pin-app.tsx`). Inline text links are exempt. Topic tags are the one exception (D78): their hit areas are 36px tall, so rows 8px apart tile without overlapping.

## Typography

Geist for all text (`--font-sans`), Geist Mono for keyboard hints (`font-mono`). Text takes a role, never a one-off size:

| Role | Current value | Where |
| --- | --- | --- |
| Landing headline | 1.4rem regular, snug leading, tight tracking | landing card |
| Page title | 24px medium, tight tracking | Your rules |
| Card title | 15px medium | a rule's title |
| Group label | 13px medium muted, with its count | a topic's rules on Your rules |
| Section heading (panel titles) | 14px medium | notes panel |
| Body, labels, fields | 13–14px | everywhere |
| Meta (counts, hints) | 13px muted | header, panel |
| Keyboard key | 12px mono in a bordered chip | `Kbd` |

- **13px is the floor.** Smaller only for secondary information the user can do without (a footnote); never a label, value, action or warning. The desktop-only message is 13px.
- Placeholders (a grey suggestion, an example) render muted and regular weight.

## Colour

Tokens only (`text-foreground`, `text-muted-foreground`, `bg-background`, `bg-muted`, `border-border`, …); no hard-coded greys apart from the landing, which sits on a painting and uses white at set opacities.

| | Light | Dark |
| --- | --- | --- |
| Page (`--background`) | `#fafafa` | `#000` |
| Text (`--foreground`) | `#3d3d3d` | `#d8d8d8` |
| Muted text | `#5d5d5d` | `#9b9b9b` |
| Border (`--border`) | `#e5e5e5` | `#2b2b2b` |
| Primary (buttons) | `#121212` | `#f2f2f2` |

- Coloured borders only for selection, focus or validation errors, at least 2px. Never for decoration or status.
- Shadows mean elevation, in light mode only: menus, tooltips, the toast and the drag frame carry a shadow with `dark:shadow-none`; dark mode uses borders and surface contrast. Nothing resting on a surface has a shadow.
- Radius scale: sm 4, md 6, lg 8, xl 12, 2xl 14, 3xl 20, 4xl 40 (px). Buttons 6px, inputs 8px, panels 10–14px, the landing bezel 32px.

## Motion

- Short and purposeful: a 300 ms transition on the landing card's drag state, the side folder on the landing (affectUI's Side Folder, turned landscape), the shimmer while rules load, the 700 ms crossfade of the landing painting between themes, the 700 ms sunrise and sunset of the sun and moon icons in the theme switch and of the logo's two theme colours, the 700 ms colour fade of the landing pills, the pointer parallax on the painting, `animate-in` fades on tooltips, the fade-in of each picture in the gallery as it loads (D132). No decorative motion.
- **Reduced motion is honoured.** The painting, the theme icons and the logo swap without moving; spinners hide under `motion-reduce:hidden`; the parallax, the folder, the shimmer and the gallery's fade-in stand still under `prefers-reduced-motion`; nothing needed is conveyed by motion alone.

## Icons

- `lucide-react` only, never decorative, never colour-coded, `aria-hidden` beside a text label.
- Any control without a text label has an `aria-label` and, where it helps, a tooltip (the shortcuts button).

## Accessibility

**Target: WCAG 2.2 level AA**, in both themes and with the keyboard. Where a rule above asks for more than AA (44px hit areas against AA's 24px, honouring reduced motion), the stricter rule holds.

- Every control and image has a name: pins and arrow ends carry `aria-label`s with their number and verdict; the stage is a `role="application"` with instructions; the images list is a `nav`; the notes panel an `aside`.
- Colour is never the only key: a verdict shows as colour and as a word ("works", "doesn't work"); marks are numbered.
- Keyboard: every action has a key (the `?` dialog lists them); focus rings stay on real controls; focus returns to the opener when the shortcuts dialog closes.
- Status messages: the toast is `role="status"` (information) or `role="alert"` (errors); the header count is `aria-live="polite"`.
- Text contrast is checked against the tokens; translucent surfaces (the landing pills, the toast) are checked by hand in both themes.

## Copy

- **No text arrows**: never "→", "←" or similar in UI copy. Write "to" for a direction, an en dash for a range, ", then" for a sequence. Lucide arrow icons are fine.
- **Short labels**, 2–4 words, no explanations in a label; the explanation goes in a toast, a tooltip or the shortcuts dialog.
- Plain words, one idea per sentence, no exclamation marks. Say what happened and what to do next ("Added 2 images. Click the image for a dot…").
- The export's text (README, AGENTS.md) is written for an agent: tell it where to look first and how to refer to notes; never make it ask the author what a note already says.
