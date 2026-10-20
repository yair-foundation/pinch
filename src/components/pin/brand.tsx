import { cn } from '@/lib/utils';

/*
 * Pinch's brand: the "pinch" wordmark (the user's SVG, 734×184) and a square
 * mark made from its "p", used as the favicon (public/pin-notes/icon.svg, the
 * same drawing) and on top of the landing card. Both draw in currentColor
 * where the surface decides the colour; the mark is always black and white.
 */

/** The "p" of the wordmark, in the wordmark's own coordinates. */
const P_GLYPH =
  'M109.375 155.371C89.7461 155.371 72.9492 147.266 63.4766 135.254V183.789H0V43.75H63.4766V60.0586C73.6328 47.7539 90.2344 40.1367 110.449 40.1367C142.285 40.1367 163.477 60.1562 163.477 97.7539C163.477 135.254 140.82 155.371 109.375 155.371ZM61.2305 98.1445C61.2305 114.746 68.8477 123.73 79.3945 123.73C90.0391 123.73 97.3633 114.746 97.3633 98.1445C97.3633 81.6406 90.1367 72.4609 79.3945 72.4609C68.75 72.4609 61.2305 81.6406 61.2305 98.1445Z';

const WORDMARK = `${P_GLYPH}M188.125 151.758V43.75H251.504V151.758H188.125ZM185.391 19.043C185.391 6.93359 201.016 0 219.863 0C238.613 0 254.238 6.93359 254.238 19.043C254.238 31.0547 238.613 37.9883 219.863 37.9883C201.016 37.9883 185.391 31.0547 185.391 19.043ZM278.301 151.758V43.75H325.273V62.8906C331.426 50.6836 344.414 40.625 362.285 40.625C383.281 40.625 394.902 53.6133 394.902 80.3711V151.758H346.562V86.2305C346.562 78.2227 342.656 75.1953 337.285 75.1953C331.816 75.1953 326.641 78.6133 326.641 88.0859V151.758H278.301ZM510.176 155.664C451.484 155.664 416.523 132.812 416.523 96.9727C416.523 61.1328 455.098 39.8438 512.227 39.8438C567.5 39.8438 602.949 59.1797 607.148 87.207H532.344C531.074 76.9531 525.02 69.1406 513.398 69.1406C499.629 69.1406 491.914 79.1016 491.914 97.168C491.914 115.332 498.555 126.367 513.203 126.367C523.359 126.367 530.684 120.02 532.344 107.91H608.125C603.34 141.113 560.273 155.664 510.176 155.664ZM627.891 151.758V11.7188H671.934V58.9844C677.891 48.6328 689.121 40.918 703.965 40.918C722.91 40.918 733.359 52.7344 733.359 76.7578V151.758H689.316V82.6172C689.316 75.6836 685.898 73.0469 681.211 73.0469C676.426 73.0469 671.934 76.0742 671.934 84.1797V151.758H627.891Z`;

/** The wordmark with a small "TM" at its top right as part of the lockup, in currentColor. Decorative. */
function Lockup({ className }: { className?: string }) {
  return (
    <span aria-hidden className="inline-flex items-start">
      <svg
        viewBox="0 0 734 184"
        aria-hidden
        fill="currentColor"
        className={cn('h-4 w-auto', className)}
      >
        <path d={WORDMARK} />
      </svg>
      <span className="ml-0.5 -translate-y-[0.25em] font-sans text-[9px] leading-none font-medium tracking-wide opacity-60 select-none">
        TM
      </span>
    </span>
  );
}

/*
 * Each copy of the lockup takes its theme's own text colour (#3d3d3d in light, #d8d8d8 in dark: the
 * --foreground values), and the two swap like a sunrise and sunset, as the theme switch does: the
 * outgoing copy sinks out of the clip while the incoming one comes up from below. Swapped with `dark:`,
 * so nothing animates on load. The theme provider switches with transitions off, so the transition is
 * forced on (!); under reduced motion the copies swap without moving. The clip has vertical room for the
 * "TM" above the lockup.
 */
const SWAP =
  'col-start-1 row-start-1 transition-[translate,opacity]! duration-700! ease-in-out! motion-reduce:transition-none!';

/**
 * The wordmark, named "Pinch" for assistive tech (the two copies are decorative), with a small "TM" at
 * its top right as part of the lockup. Size it by the svg's height.
 */
export function PinchWordmark({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Pinch" className="-my-1.5 inline-grid overflow-hidden py-1.5">
      <span
        className={cn(SWAP, 'translate-y-0 text-[#3d3d3d] opacity-100 dark:translate-y-full dark:opacity-0')}
      >
        <Lockup className={className} />
      </span>
      <span
        className={cn(SWAP, 'translate-y-full text-[#d8d8d8] opacity-0 dark:translate-y-0 dark:opacity-100')}
      >
        <Lockup className={className} />
      </span>
    </span>
  );
}
