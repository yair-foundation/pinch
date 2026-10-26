import './global.css';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import { ThemeProvider } from '@/components/site/theme-provider';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Pinch: talk through screenshots for your agent',
  description:
    'Talk through a batch of screenshots, pointing at what works and what doesn’t. Pinch turns what you say into rules that Claude, ChatGPT or any agent follows.',
  icons: { icon: '/pin-notes/icon.svg', apple: '/pin-notes/icon.svg' },
  openGraph: {
    title: 'Pinch',
    description:
      'Talk through screenshots, and your agent learns your taste.',
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

// ABC Favorit Light for the landing's title (D134), as --font-display.
const favorit = localFont({
  src: './fonts/ABCFavoritTrial-Light.otf',
  weight: '300',
  variable: '--font-display',
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={cn(geist.variable, geistMono.variable, favorit.variable, 'font-sans')}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
