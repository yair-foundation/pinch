import type { Metadata } from 'next';

/*
 * Pinch's terms of sale and use (D81, D98): what is free, what credits buy and
 * how they are taken, what buyers of the earlier offer keep, the refund, what
 * happens to the person's content, and who to ask. Plain words, one page, in
 * the site's own type and colours. The support address is PINCH_SUPPORT_EMAIL
 * when it is set; otherwise the maker's site.
 */

export const metadata: Metadata = {
  title: 'Terms · Pinch',
  description: 'What is free in Pinch, what credits buy, and how your content is kept.',
};

const UPDATED = '2026-10-21';

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
          <h2>What is free</h2>
          <p>
            Marking screenshots, seeing every rule Pinch writes, editing them, keeping them in
            your account and connecting your agent are free. Reading your notes into rules takes
            credits, and every browser starts with 200 of them. Once you sign in, your free
            credits are your Google account’s, once.
          </p>
        </section>
        <section>
          <h2>What you buy</h2>
          <p>
            More credits, as one pack: 2,000 credits for $19.99, a single payment, bought as often
            as you like. You sign in with Google and pay through Lemon Squeezy, who sell Pinch for
            us as the merchant of record: they take the payment, charge any sales tax or VAT, and
            send your receipt. Credits belong to the email you bought with; sign in with the
            Google account of that email to use them on any device.
          </p>
        </section>
        <section>
          <h2>How credits are taken</h2>
          <p>
            An update, one click on Update rules, takes 20 credits and 3 for each note it reads:
            one note is 23 credits, five are 35, thirty are 110. Pinch shows the price before the
            update runs and takes no more. An update that reads nothing takes nothing; one that
            stops partway takes 20 and 3 for each note it read, and the rest comes back. Credits
            never expire. They aren’t money: they can’t be exchanged for cash or moved to another
            account. The AI steps also have daily fair-use limits shared by everyone; when a
            limit is reached they pause until the next day, your credits stay, and the rest of
            Pinch keeps working.
          </p>
        </section>
        <section>
          <h2>If you bought Pinch before credits</h2>
          <p>
            If you bought Pinch’s earlier offer, one payment of $19, before credits went on sale,
            you keep what it included, under its daily fair-use limits, and spend no credits. If
            you would rather use credits, ask us.
          </p>
        </section>
        <section>
          <h2>Refunds</h2>
          <p>
            If a pack isn’t for you, ask for a refund within 14 days of buying it and you get the
            whole payment back, however many of its credits you used. A refund takes back what is
            left of that pack. Your rules and your account stay yours.
          </p>
        </section>
        <section>
          <h2>Your content</h2>
          <p>
            Your screenshots, recordings, notes and rules are yours. Recordings of your voice stay
            in your browser: a voice model, downloaded once from Hugging Face, turns them into
            words there, and Pinch never receives them. Images stay in your browser until you
            sign in; then your rules keep their screenshots in your account, stored privately for
            you alone, up to 200 MB free and 2 GB once you have bought a pack. To read your notes
            into rules, Pinch sends each note’s words and the close-up of its mark to Anthropic,
            the AI it uses, and keeps neither on the way. Delete your account in Pinch and your
            rules are deleted; your credits stay with your email. In Pinch, “How Pinch uses your
            data” says what is sent where.
          </p>
        </section>
        <section>
          <h2>Using it well</h2>
          <p>
            Don’t use Pinch to break the law, to upload what you have no right to, to load it with
            automated requests, or to collect free credits through new browsers or accounts. Your
            account is for you; don’t share it.
          </p>
        </section>
        <section>
          <h2>No guarantee</h2>
          <p>
            Pinch is provided as it is. We work to keep it running and your rules safe, but we
            can’t promise it will never fail; keep a copy of what matters (Connect agent copies
            your rules as a prompt). As far as the law allows, our liability is limited to what
            you paid.
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
