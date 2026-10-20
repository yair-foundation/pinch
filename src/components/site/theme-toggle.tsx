'use client';

import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from '@/components/ui/button';

/*
 * Both icons sit in the same spot and swap with `dark:`, which reads the class on <html> that is set
 * before first paint, so nothing animates on load. The outgoing icon turns and shrinks away while the
 * incoming one turns in. The theme provider switches themes with transitions off, so this one is forced
 * on (!); under reduced motion the icons swap without moving.
 */
const SWAP =
  'absolute inset-0 transition-[rotate,scale,opacity]! duration-500! ease-in-out! motion-reduce:transition-none!';

/** The light/dark switch in the header. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={className}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span aria-hidden className="relative size-4">
        <SunIcon
          className={`${SWAP} rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100`}
        />
        <MoonIcon
          className={`${SWAP} rotate-0 scale-100 opacity-100 dark:-rotate-90 dark:scale-0 dark:opacity-0`}
        />
      </span>
    </Button>
  );
}
