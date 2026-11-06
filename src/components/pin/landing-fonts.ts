import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import { cn } from '@/lib/utils';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz', 'wdth'],
  variable: '--font-landing-display',
});
const body = Figtree({ subsets: ['latin'], variable: '--font-landing-body' });

/** The landing's type (D169), as classes for whatever holds it. */
export const LANDING_FONTS = cn(display.variable, body.variable);
