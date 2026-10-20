import type { Metadata } from 'next';

/*
 * Pinch's terms of sale and use (D81): what is bought, for how long, the
 * refund, what happens to the buyer's content, and who to ask. Plain words,
 * one page, in the site's own type and colours. The support address is
 * PINCH_SUPPORT_EMAIL when it is set; otherwise the maker's site.
 */

export const metadata: Metadata = {
  title: 'Terms · Pinch',
  description: 'What you buy when you buy Pinch, and how your content is kept.',
};

const UPDATED = '2026-10-20';

export default function Terms() {
  const email = process.env.PINCH_SUPPORT_EMAIL?.trim();
  const link =
    '-mx-1 rounded px-1 text-foreground underline underline-offset-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-muted';
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 bg-background px-6 py-12 text-foreground">
      <p className="text-[13px]">
        <a href="/" className={link}>
          Back to Pinch
        </a>
      </p>
      <h1 className="mt-6 text-[1.4rem] leading-snug font-normal tracking-tight">Terms</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Last changed {UPDATED}.</p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-medium [&_h2]:text-foreground">
        <section>
          <h2>What you buy</h2>
          <p>
            Marking screenshots in Pinch is free, and so are the first rules Pinch finds in your
            notes. Seeing every rule, keeping them in your account and exporting anything is one
            payment of $19, for early access. You sign in with Google and pay through Lemon Squeezy, who sell Pinch for us as the merchant of record: they take
            the payment, charge any sales tax or VAT, and send your receipt. The purchase belongs to
            the email you bought with; sign in with the Google account of that email to use it on
            any device.
          </p>
        </section>
        <section>
          <h2>What it includes</h2>
          <p>
            Pinch as it is today, and every update we ship in the twelve months after you buy. The
            AI steps, suggestions and reading your notes into rules, have daily fair-use limits shared by everyone;
            when a limit is reached they pause until the next day, and the rest of Pinch keeps
            working.
          </p>
        </section>
        <section>
          <h2>Refunds</h2>
          <p>
            If Pinch isn’t for you, ask for a refund within 14 days of buying and you get the whole
            payment back. A refund ends your access.
          </p>
        </section>
        <section>
          <h2>Your content</h2>
          <p>
            Your screenshots, notes and rules are yours. The batch you are tagging stays in your
            browser. Your rules, kept in your account once you buy with their screenshots, are stored
            privately for you alone; delete your account in Pinch and they are deleted. In Pinch,
            “How Pinch uses your data” says what is sent where.
          </p>
        </section>
        <section>
          <h2>Using it well</h2>
          <p>
            Don’t use Pinch to break the law, to upload what you have no right to, or to load it
            with automated requests. Your account is for you; don’t share it.
          </p>
        </section>
        <section>
          <h2>No guarantee</h2>
          <p>
            Pinch is provided as it is. We work to keep it running and your collections safe, but we
            can’t promise it will never fail; keep a copy of what matters (Pinch downloads a
            collection as one file). As far as the law allows, our liability is limited to what you
            paid.
          </p>
        </section>
        <section>
          <h2>Changes and questions</h2>
          <p>
            If these terms change, the date above changes with them. Questions, refunds and help:{' '}
            {email ? (
              <a href={`mailto:${email}`} className={link}>
                {email}
              </a>
            ) : (
              <a
                href="https://yair-works.vercel.app"
                target="_blank"
                rel="noopener"
                className={link}
              >
                Yair Cohen
              </a>
            )}
            .
          </p>
        </section>
      </div>
    </main>
  );
}
