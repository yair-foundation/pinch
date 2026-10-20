import { useId } from 'react';
import { cn } from '@/lib/utils';

/*
 * The landing card's attention cue (D93): a glassy folder lying landscape,
 * after affectUI's Side Folder turned a quarter so its documents peek out of
 * the top and its tab sits top left. A screenshot chip comes in with the
 * cursor from the top right, drops in behind the frosted pocket, and the
 * pocket tips forward as it lands while the documents rise. A 3.7 s CSS
 * loop. Hovering the folder opens it and holds it open; `active` (a real drag
 * over the window) does the same, with the chip and cursor out of the way.
 * Under prefers-reduced-motion it is a still.
 *
 * Only the folder turns: its art is drawn as the original (documents to the
 * right) in two turned layers, the back with the documents and the pocket,
 * and the chip and cursor ride upright between and above them. The turn
 * (a quarter clockwise of the mirrored art) maps the art's right to the top
 * and its bottom to the left, so the shadow and the pocket's shading are set
 * along the art's x axis to fall down the screen. Sizes are in `cqw`, so it
 * scales with its box.
 */

/* The front pocket on a 380 × 520 grid: a narrow top part and a wider tab towards the bottom. */
const FRONT =
  'M40 0H290Q330 0 330 40V318Q330 338 344 348L364 362Q380 372 380 396V480Q380 520 340 520H40Q0 520 0 480V40Q0 0 40 0Z';
/* The widths of a document's lines; each differs, so it keys its line. */
const LINES = [78, 180, 140, 175, 126, 168, 110];
/* A mask (unlike clip-path: url()) also cuts the frosted blur to the pocket's shape, and scales with it. */
const MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 380 520' preserveAspectRatio='none'><path d='${FRONT}'/></svg>`,
)}") 0 0 / 100% 100% no-repeat`;

const CSS = `
.pin-sf {
  --pin-sf-ease: cubic-bezier(0.2, 0.85, 0.25, 1);
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  container-type: inline-size;
}
.pin-sf-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52%;
  aspect-ratio: 520 / 440;
  container-type: inline-size;
  transform: translate(-50%, -50%);
  transition: transform 0.6s var(--pin-sf-ease);
}
/* The folder's art, upright on the 440 × 520 grid, turned to lie landscape in the icon. */
.pin-sf-turn {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 84.6154cqw;
  height: 100cqw;
  container-type: inline-size;
  perspective: 260cqw;
  perspective-origin: 40% 50%;
  transform: translate(-50%, -50%) rotate(90deg) scaleX(-1);
}
.pin-sf-layer { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.pin-sf-back {
  filter:
    drop-shadow(-5.4cqw 0 6.4cqw rgba(60, 130, 180, 0.28))
    drop-shadow(-1.8cqw 0 2.7cqw rgba(60, 130, 180, 0.16))
    drop-shadow(-0.45cqw 0 0.9cqw rgba(60, 130, 180, 0.1));
}
.pin-sf-doc {
  transform-box: fill-box;
  transform-origin: center;
  filter: drop-shadow(0 3px 4px rgba(0, 30, 60, 0.18));
  transition: transform 0.55s var(--pin-sf-ease);
}
.pin-sf-doc--top    { transform: translate(83px, 43px) rotate(3deg); }
.pin-sf-doc--bottom { transform: translate(78px, 68px) rotate(4deg); }
.pin-sf-doc--middle { transform: translate(73px, 56px) rotate(-2deg); }
.pin-sf-front {
  position: absolute;
  left: 0;
  top: 0;
  width: 86.3636%;
  height: 100%;
  -webkit-mask: ${MASK};
  mask: ${MASK};
  background:
    linear-gradient(270deg, rgba(0, 40, 75, 0) 76%, rgba(0, 40, 75, 0.26) 100%),
    linear-gradient(250deg, rgba(132, 214, 248, 0.45) 0%, rgba(69, 170, 220, 0.45) 100%);
  -webkit-backdrop-filter: blur(4.5cqw) saturate(1.1);
  backdrop-filter: blur(4.5cqw) saturate(1.1);
  transform-origin: 0 50%;
  transition: transform 0.6s var(--pin-sf-ease);
}
.pin-sf-front svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

/* The chip and the cursor, upright in the icon: they come from its top right. */
.pin-sf-chip, .pin-sf-cursor { position: absolute; left: 0; top: 0; opacity: 0; }
.pin-sf-chip {
  display: flex;
  align-items: center;
  gap: 3cqw;
  width: 65cqw;
  height: 16cqw;
  padding: 0 3.8cqw;
  border-radius: 4.6cqw;
  background: rgb(28 28 34 / 0.92);
  box-shadow: inset 0 0 0 0.6cqw rgb(255 255 255 / 0.3), 0 1.5cqw 4cqw rgb(0 0 0 / 0.25);
  color: rgb(255 255 255 / 0.88);
  font-size: 7.3cqw;
  line-height: 1;
  white-space: nowrap;
}
.pin-sf-chip svg { width: 8.5cqw; height: 8.5cqw; flex: none; }
.pin-sf-cursor svg { width: 13cqw; height: 13cqw; display: block; }

.pin-sf-chip, .pin-sf-cursor, .pin-sf-front, .pin-sf-doc {
  animation-duration: 3.7s;
  animation-iteration-count: infinite;
  animation-timing-function: cubic-bezier(0.3, 0, 0.2, 1);
}
.pin-sf-chip { animation-name: pin-sf-chip; }
.pin-sf-cursor { animation-name: pin-sf-cursor; }
.pin-sf-front { animation-name: pin-sf-front; }
.pin-sf-doc--top { animation-name: pin-sf-doc-top; }
.pin-sf-doc--bottom { animation-name: pin-sf-doc-bottom; }
.pin-sf-doc--middle { animation-name: pin-sf-doc-middle; }
@keyframes pin-sf-chip {
  0%, 12% { transform: translate(70cqw, -40cqw); opacity: 0; }
  18% { opacity: 1; }
  40%, 48% { transform: translate(18cqw, -14cqw); opacity: 1; }
  62% { transform: translate(18cqw, 12cqw) scale(0.92); opacity: 1; }
  70%, 100% { transform: translate(18cqw, 22cqw) scale(0.9); opacity: 0; }
}
/* The cursor's tip rides on the chip's right part, then lets go and moves off. */
@keyframes pin-sf-cursor {
  0%, 12% { transform: translate(118cqw, -34cqw); opacity: 0; }
  18% { opacity: 1; }
  40%, 48% { transform: translate(66cqw, -8cqw); opacity: 1; }
  60% { transform: translate(66cqw, 14cqw); opacity: 1; }
  74% { transform: translate(82cqw, 28cqw); opacity: 1; }
  84%, 100% { transform: translate(86cqw, 32cqw); opacity: 0; }
}
@keyframes pin-sf-front {
  0%, 50% { transform: none; }
  62%, 70% { transform: translateZ(3cqw) rotateY(-12deg); }
  86%, 100% { transform: none; }
}
@keyframes pin-sf-doc-top {
  0%, 50%, 86%, 100% { transform: translate(83px, 43px) rotate(3deg); }
  62%, 70% { transform: translate(100px, 35px) rotate(6deg); }
}
@keyframes pin-sf-doc-bottom {
  0%, 50%, 86%, 100% { transform: translate(78px, 68px) rotate(4deg); }
  62%, 70% { transform: translate(93px, 75px) rotate(7deg); }
}
@keyframes pin-sf-doc-middle {
  0%, 50%, 86%, 100% { transform: translate(73px, 56px) rotate(-2deg); }
  62%, 70% { transform: translate(95px, 54px) rotate(0deg); }
}

/* Hovered, or a real drag over the window: open and still, the chip and cursor gone. */
.pin-sf-icon:hover, .pin-sf[data-active] .pin-sf-icon {
  transform: translate(-50%, -50%) scale(1.03);
}
.pin-sf-icon:hover *, .pin-sf[data-active] .pin-sf-icon * { animation: none; }
.pin-sf-icon:hover .pin-sf-chip, .pin-sf-icon:hover .pin-sf-cursor,
.pin-sf[data-active] .pin-sf-chip, .pin-sf[data-active] .pin-sf-cursor { opacity: 0; }
.pin-sf-icon:hover .pin-sf-front, .pin-sf[data-active] .pin-sf-front { transform: translateZ(3cqw) rotateY(-12deg); }
.pin-sf-icon:hover .pin-sf-doc--top, .pin-sf[data-active] .pin-sf-doc--top { transform: translate(100px, 35px) rotate(6deg); }
.pin-sf-icon:hover .pin-sf-doc--bottom, .pin-sf[data-active] .pin-sf-doc--bottom { transform: translate(93px, 75px) rotate(7deg); }
.pin-sf-icon:hover .pin-sf-doc--middle, .pin-sf[data-active] .pin-sf-doc--middle { transform: translate(95px, 54px) rotate(0deg); }

@media (prefers-reduced-motion: reduce) {
  .pin-sf-icon, .pin-sf-icon *, .pin-sf-doc, .pin-sf-front { animation: none; transition: none; }
  .pin-sf-chip, .pin-sf-cursor { opacity: 0; }
}
`;

export function DropFolder({ active, className }: { active?: boolean; className?: string }) {
  const id = `pin-sf${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div aria-hidden data-active={active || undefined} className={cn('pin-sf select-none', className)}>
      <style href="pin-side-folder" precedence="default">
        {CSS}
      </style>
      <div className="pin-sf-icon">
        <div className="pin-sf-turn">
        {/* The back of the folder. */}
        <svg className="pin-sf-layer pin-sf-back" viewBox="0 0 440 520" aria-hidden>
          <defs>
            <filter id={`${id}-hl`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
              <feOffset in="blur" dx="-3" result="offset" />
              <feComposite in="blur" in2="offset" operator="arithmetic" k2="1" k3="-1" result="diff" />
              <feFlood floodColor="#fff" floodOpacity="0.65" />
              <feComposite in2="diff" operator="in" result="light" />
              <feComposite in="light" in2="SourceAlpha" operator="in" />
            </filter>
          </defs>
          <rect x="0" y="18" width="440" height="486" rx="36" fill="#5bb7ea" />
          <rect x="0" y="18" width="440" height="486" rx="36" fill="#000" filter={`url(#${id}-hl)`} />
        </svg>

        {/* The documents, each sliding on its own. */}
        <svg className="pin-sf-layer" viewBox="0 0 440 520" aria-hidden>
          <defs>
            <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="100%" stopColor="#eaf2f8" />
            </linearGradient>
            <symbol id={`${id}-doc`} overflow="visible">
              <rect
                x="0.6"
                y="0.6"
                width="278.8"
                height="348.8"
                rx="19.4"
                fill={`url(#${id}-paper)`}
                stroke="rgba(0,0,0,0.12)"
                strokeWidth="1.2"
              />
              {/* The page's lines, drawn across the art's grain so they read across the turned page. */}
              {LINES.map((w, i) => (
                <rect
                  key={w}
                  x={184 - i * 28}
                  y={320 - w}
                  width="9"
                  height={w}
                  rx="4.5"
                  fill="rgba(0,0,0,0.12)"
                />
              ))}
            </symbol>
          </defs>
          <g transform="scale(1.15)">
            <use className="pin-sf-doc pin-sf-doc--top" href={`#${id}-doc`} />
            <use className="pin-sf-doc pin-sf-doc--bottom" href={`#${id}-doc`} />
            <use className="pin-sf-doc pin-sf-doc--middle" href={`#${id}-doc`} />
          </g>
        </svg>
        </div>

        {/* The screenshot going in, between the documents and the pocket. */}
        <div className="pin-sf-chip">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            screen-01.png
        </div>

        {/* The frosted front pocket. */}
        <div className="pin-sf-turn">
          <div className="pin-sf-front">
            <svg viewBox="0 0 380 520" aria-hidden>
              <path d={FRONT} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
            </svg>
          </div>
        </div>

        {/* The cursor carrying it. */}
        <div className="pin-sf-cursor">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path
                d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
                fill="#fff"
                stroke="#111"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
        </div>
      </div>
    </div>
  );
}
