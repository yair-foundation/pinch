'use client';

import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';
import { type ReactNode, useEffect, useEffectEvent } from 'react';
import { flushSync } from 'react-dom';

/*
 * next-themes with Pinch's settings: the class on <html>, dark by default,
 * the system theme honoured once chosen, no transition while switching. The
 * storage key is the one Pinch's browsers already hold from before it had its
 * own repository, so nobody's choice of theme resets.
 *
 * next-themes renders an inline script that sets the theme before first
 * paint. The server's copy runs; when React renders the element again in the
 * browser, React 19 logs "Encountered a script tag" in dev. A data-block type
 * on the client keeps it quiet (React skips data blocks), and the script
 * carries suppressHydrationWarning, so the server's executable copy stays.
 */
const scriptProps =
  typeof window === 'undefined' ? undefined : { type: 'application/json' as const };

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null);

/** D toggles the theme when nothing is being typed, as the site Pinch came from did. */
function ThemeHotKey() {
  const { setTheme, resolvedTheme } = useTheme();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'd') return;
    e.preventDefault();
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    if (document.startViewTransition)
      document.startViewTransition(() => flushSync(() => setTheme(next)));
    else setTheme(next);
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="genui-theme"
      scriptProps={scriptProps}
    >
      <ThemeHotKey />
      {children}
    </NextThemeProvider>
  );
}
