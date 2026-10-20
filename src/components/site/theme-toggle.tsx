'use client';

import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from '@/components/ui/button';

/*
 * Both icons sit in the same spot and swap with `dark:`, which reads the class on <html> that is set
 * before first paint, so nothing animates on load. A sunrise and a sunset: the outgoing icon sinks
 * below the edge of the clip while the incoming one comes up from below it, and the same the other way.
 * The theme provider switches themes with transitions off, so this one is forced on (!); under reduced
 * motion the icons swap without moving.
 */
const SWAP =
  'absolute inset-0 transition-[translate,opacity]! duration-700! ease-in-out! motion-reduce:transition-none!';

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
      <span aria-hidden className="relative size-4 overflow-hidden">
        <SunIcon
          className={`${SWAP} translate-y-full opacity-0 dark:translate-y-0 dark:opacity-100`}
        />
        <MoonIcon
          className={`${SWAP} translate-y-0 opacity-100 dark:translate-y-full dark:opacity-0`}
        />
      </span>
    </Button>
  );
}
