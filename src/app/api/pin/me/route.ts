import { accessOf, paywallOn } from '@/lib/access';
import { userFolder } from '@/lib/account';
import { billingConfig, checkoutUrl } from '@/lib/billing';
import { hasBlob } from '@/lib/blob-doc';
import { browserOf, mergeBrowser } from '@/lib/credits';
import { googleConfigured } from '@/lib/google';
import { FREE_CREDITS, NOTE_CREDITS, PACK_CREDITS, UPDATE_CREDITS } from '@/lib/pin/credits';
import { sessionOf, testLoginOn } from '@/lib/session';

/*
 * What the page needs to know about whoever is looking (D81, D98): whether
 * Pinch is paid here, who is signed in, their credits and the one offer,
 * where to buy, and where their rules are kept. Read fresh, so a purchase
 * shows the moment its webhook lands. Signed in, what this browser spent
 * before moves into the account, once. A browser gets its id cookie here.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const signedIn = sessionOf(request);
  if (paywallOn() && signedIn)
    await mergeBrowser(browserOf(request).id, signedIn.email).catch((e) =>
      console.error('[pin] merge', (e as Error).message),
    );
  const { paywall, session, browser, credits, allowed } = await accessOf(request);
  const config = billingConfig();
  return Response.json(
    {
      paywall,
      signIn: googleConfigured(),
      testLogin: testLoginOn(),
      user: session
        ? { email: session.email, name: session.name, picture: session.picture ?? '' }
        : null,
      allowed,
      credits: credits
        ? {
            balance: credits.balance,
            bought: credits.bought,
            original: credits.original,
            closed: credits.closed,
          }
        : null,
      offer: {
        credits: PACK_CREDITS,
        free: FREE_CREDITS,
        update: UPDATE_CREDITS,
        note: NOTE_CREDITS,
      },
      price: config?.price ?? '$19.99',
      buyUrl:
        paywall && session && config
          ? checkoutUrl(config.buyUrl, session.email, session.user)
          : undefined,
      restore: Boolean(paywall && config?.apiKey),
      cloud: session ? (hasBlob() ? 'blob' : 'memory') : null,
      folder: session ? userFolder(session.user) : null,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        ...(browser.setCookie ? { 'Set-Cookie': browser.setCookie } : {}),
      },
    },
  );
}
