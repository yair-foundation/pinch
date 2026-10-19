import { cn } from '@/lib/utils';

/*
 * The landing card's attention cue: a glassy folder; a screenshot chip flies
 * in from the top right with the cursor, drops into the folder, and the folder
 * glows from inside as it lands. A 3.7 s CSS loop, drawn in SVG. With
 * prefers-reduced-motion it is a still: the chip resting in the folder.
 * `active` is the real drag over the window: the folder holds its glow and
 * the chip and cursor stay out of the way.
 */

const CSS = `
@keyframes pin-chip {
  0%, 12% { transform: translate(236px, -30px); opacity: 0; }
  16% { opacity: 1; }
  38%, 48% { transform: translate(70px, 4px); opacity: 1; }
  60% { transform: translate(76px, 42px) scale(0.9); opacity: 0.25; }
  66%, 100% { transform: translate(76px, 48px) scale(0.86); opacity: 0; }
}
@keyframes pin-cursor {
  0%, 12% { transform: translate(332px, -8px); opacity: 0; }
  16% { opacity: 1; }
  38%, 48% { transform: translate(166px, 26px); opacity: 1; }
  60% { transform: translate(172px, 60px); opacity: 1; }
  72% { transform: translate(206px, 58px); opacity: 1; }
  80%, 100% { transform: translate(214px, 56px); opacity: 0; }
}
@keyframes pin-glow {
  0%, 52% { opacity: 0; }
  60% { opacity: 1; }
  68% { opacity: 0.75; }
  86%, 100% { opacity: 0; }
}
@keyframes pin-settle {
  0%, 54% { transform: scale(1); }
  60% { transform: scale(1.025); }
  70%, 100% { transform: scale(1); }
}
.pin-folder .pin-chip,
.pin-folder .pin-cursor,
.pin-folder .pin-glow,
.pin-folder .pin-body {
  animation-duration: 3.7s;
  animation-iteration-count: infinite;
  animation-timing-function: cubic-bezier(0.3, 0, 0.2, 1);
}
.pin-folder .pin-chip { animation-name: pin-chip; }
.pin-folder .pin-cursor { animation-name: pin-cursor; }
.pin-folder .pin-glow { animation-name: pin-glow; animation-timing-function: ease-in-out; }
.pin-folder .pin-body { animation-name: pin-settle; transform-origin: 120px 150px; }
.pin-folder[data-active] .pin-chip,
.pin-folder[data-active] .pin-cursor,
.pin-folder[data-active] .pin-body,
.pin-folder[data-active] .pin-glow { animation: none; }
.pin-folder[data-active] .pin-chip,
.pin-folder[data-active] .pin-cursor { opacity: 0; }
.pin-folder[data-active] .pin-glow { opacity: 1; }
.pin-folder[data-active] .pin-body { transform: scale(1.025); }
@media (prefers-reduced-motion: reduce) {
  .pin-folder .pin-chip,
  .pin-folder .pin-cursor,
  .pin-folder .pin-body,
  .pin-folder .pin-glow { animation: none; }
  .pin-folder .pin-chip { transform: translate(72px, 16px); opacity: 1; }
  .pin-folder .pin-cursor { opacity: 0; }
  .pin-folder:not([data-active]) .pin-glow { opacity: 0.35; }
}
`;

export function DropFolder({ active, className }: { active?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      data-active={active || undefined}
      className={cn('pin-folder pointer-events-none select-none', className)}
    >
      <style href="pin-drop-folder" precedence="default">
        {CSS}
      </style>
      <svg viewBox="30 0 184 158" aria-hidden className="h-auto w-full overflow-visible">
        <defs>
          <linearGradient id="pin-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="pin-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.24" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.09" />
          </linearGradient>
          <linearGradient id="pin-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id="pin-light" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.45" stopColor="#dfe6ff" stopOpacity="0.6" />
            <stop offset="1" stopColor="#c7d2ff" stopOpacity="0" />
          </radialGradient>
          <filter id="pin-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <g className="pin-body">
          {/* The back panel, with its tab. */}
          <path
            d="M66 26H110Q115 26 118 30L122 34Q124 36 128 36H194Q199 36 199 41V129Q199 134 194 134H65Q60 134 60 129V32Q60 26 66 26Z"
            fill="url(#pin-back)"
            stroke="#fff"
            strokeOpacity="0.16"
          />
          {/* The light inside the folder. */}
          <ellipse
            className="pin-glow"
            cx="128"
            cy="66"
            rx="62"
            ry="26"
            fill="url(#pin-light)"
            filter="url(#pin-blur)"
            opacity="0"
          />
        </g>
        {/* The chip, between the panels so the front covers it as it drops in. */}
        <g className="pin-chip" opacity="0">
          <rect width="104" height="28" rx="8" fill="#1c1c22" />
          <rect width="104" height="28" rx="8" fill="#fff" fillOpacity="0.14" />
          <rect
            x="0.5"
            y="0.5"
            width="103"
            height="27"
            rx="7.5"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.35"
          />
          <g
            transform="translate(9 6) scale(0.667)"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.85"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </g>
          <text
            x="31"
            y="18.5"
            fontSize="11"
            fontFamily="inherit"
            fill="#fff"
            fillOpacity="0.85"
            letterSpacing="0.1"
          >
            screen-01.png
          </text>
        </g>
        <g className="pin-body">
          {/* The front panel: a little wider at the top, like a folder seen from above. */}
          <path
            d="M47 56H88Q93 56 96 60L100 64Q102 66 106 66H193Q198 66 197.5 71L189 147Q188.5 152 183 152H57Q52 152 51.5 147L42.5 62Q42 56 47 56Z"
            fill="url(#pin-front)"
            stroke="url(#pin-edge)"
          />
        </g>
        {/* The cursor. */}
        <g className="pin-cursor" opacity="0">
          <path
            d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
            fill="#fff"
            stroke="#111"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}
