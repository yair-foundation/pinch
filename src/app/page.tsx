import { COMING_BACK_SCRIPT } from '@/components/pin/coming-back';
import { PinApp } from '@/components/pin/pin-app';

// The whole site is the tool: Pinch lives at "/". Its metadata is on the layout.
export default function Page() {
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own constant, and it has to run before the first paint (coming-back.ts) */}
      <script dangerouslySetInnerHTML={{ __html: COMING_BACK_SCRIPT }} />
      <PinApp />
    </>
  );
}
