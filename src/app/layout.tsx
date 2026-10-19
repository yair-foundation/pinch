import './global.css';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/site/theme-provider';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pinch: tag screenshots for your agent',
  description:
    'Pin what works and what doesn’t on a batch of screenshots, with a dot or an area, then export it all for Claude, ChatGPT or any agent. Free, no account; your images stay in your browser.',
  icons: { icon: '/pin-notes/icon.svg', apple: '/pin-notes/icon.svg' },
  openGraph: {
    title: 'Pinch',
    description:
      'Pin what works and what doesn’t on screenshots, then export it all for any agent.',
  },
};

// Geist for all text, exposed as --font-sans (Tailwind's font-sans); Geist
// Mono for keyboard hints, as --font-mono.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={cn(geist.variable, geistMono.variable, 'font-sans')}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
