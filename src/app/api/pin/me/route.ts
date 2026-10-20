import { accessOf } from '@/lib/access';
import { userFolder } from '@/lib/account';
import { billingConfig, checkoutUrl } from '@/lib/billing';
import { hasBlob } from '@/lib/blob-doc';
import { googleConfigured } from '@/lib/google';
import { testLoginOn } from '@/lib/session';

/*
 * What the page needs to know about whoever is looking (D81): whether Pinch
 * is paid here, who is signed in, whether they may use it, where to buy, and
 * where their collections are kept. Read fresh, so a purchase shows the
 * moment its webhook lands.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { paywall, session, allowed } = await accessOf(request, true);
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
      price: config?.price ?? '$19',
      buyUrl:
        paywall && session && config
          ? checkoutUrl(config.buyUrl, session.email, session.user)
          : undefined,
      restore: Boolean(paywall && config?.apiKey),
      cloud: session ? (hasBlob() ? 'blob' : 'memory') : null,
      folder: session ? userFolder(session.user) : null,
    },
    { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } },
  );
}
