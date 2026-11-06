import { MissingMouse } from './landing-art';
import { LANDING_FONTS } from './landing-fonts';
import './landing.css';

/*
 * Pinch needs a pointer and room, so a phone gets this instead (D170), in the landing's look: nothing
 * else to do here, and a joke about why. The message is gated by width in CSS (so the server and the
 * first paint agree), and lifted after mount on a desktop-class device: a laptop zoomed to 200% or a
 * narrow window keeps the app (WCAG 1.4.4, 1.4.10).
 */
export function DesktopOnly() {
  return (
    <div
      role="status"
      className={`pinch-landing phone-message fixed inset-0 z-[100] hidden overflow-y-auto max-md:block ${LANDING_FONTS}`}
    >
      <div className="flex min-h-full flex-col items-center justify-center gap-7 px-6 py-10 text-center">
        <MissingMouse className="w-full max-w-[320px]" />
        <div>
          <p className="title m-0 text-[44px] text-balance">Pinch needs a mouse.</p>
          <p className="mx-auto mt-4 mb-0 max-w-[300px] text-[18px] leading-[1.45] text-balance">
            Your phone hasn’t got one. Come back on a computer, at <strong>get-pinch.io</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
