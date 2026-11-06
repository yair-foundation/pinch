import type { Metadata } from 'next';

/*
 * Pinch's terms of use (D81, D98, D157): what is free, what those who bought
 * credits or the earlier offer keep, the refund, what happens to the person's content, and who to ask. Plain words, one page, in
 * the site's own type and colours. The support address is PINCH_SUPPORT_EMAIL
 * when it is set; otherwise the maker's site.
 */

export const metadata: Metadata = {
  title: 'Terms · Pinch',
  description: 'What is free in Pinch, what happens to credits, and how your content is kept.',
};

const UPDATED = '2026-11-06';

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
            Pinch is free for now: talking through your screenshots and exporting the package for
            your agent. It needs no account. If you already keep notes in one, they stay yours there.
          </p>
        </section>
        <section>
          <h2>If you hold credits</h2>
          <p>
            Pinch isn’t selling credits right now, and reading notes into rules is paused, so credits
            have nothing to buy. The credits you hold stay with your email and never expire. They
            aren’t money: they can’t be exchanged for cash or moved to another account. Payments
            went through Lemon Squeezy, who sold Pinch for us as the merchant of record.
          </p>
        </section>
        <section>
          <h2>If you bought Pinch before credits</h2>
          <p>
            If you bought Pinch’s earlier offer, one payment of $19, before credits went on sale,
            you keep what it included.
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
            words there, and Pinch never receives them. A small text model, also from Hugging Face, reads
            the text on your screenshots there. Your images and notes stay in your browser
            unless you signed in to keep notes before; those keep their screenshots in your account, stored privately for
            you alone, up to 200 MB free and 2 GB once you have bought a pack. Delete your account in
            Pinch and your notes and rules are deleted; any credits you hold stay with your email. In Pinch, “How Pinch uses your
            data” says what is sent where.
          </p>
        </section>
        <section>
          <h2>Using it well</h2>
          <p>
            Don’t use Pinch to break the law, to upload what you have no right to, to load it with
            automated requests. Your account is for you; don’t share it.
          </p>
        </section>
        <section>
          <h2>No guarantee</h2>
          <p>
            Pinch is provided as it is. We work to keep it running and your rules safe, but we
            can’t promise it will never fail; keep a copy of what matters (Export). As far as the law allows, our liability is limited to what
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
