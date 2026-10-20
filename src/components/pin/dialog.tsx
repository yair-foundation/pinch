'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/*
 * Pinch's one dialog pattern: a small modal over a dim backdrop. Tab and
 * Shift+Tab stay inside it, Escape closes it, and when it goes focus returns
 * to what opened it. The app behind it is made inert by the caller (the
 * `inert` attribute on the rest of the page), so this only has to hold focus.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The hit area a small control gets: 44px each way, drawn on nothing. */
export const hit =
  'relative after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]';

export function Dialog({
  title,
  id,
  onClose,
  opener,
  fallback,
  children,
  className,
}: {
  title: string;
  /** The heading's id, so the dialog is named by it. */
  id: string;
  onClose: () => void;
  /** What had focus when the dialog opened; it gets focus back when the dialog closes. */
  opener: HTMLElement | null;
  /** A selector for where focus goes when the opener is gone (it was a key, or a toast). */
  fallback?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: set up once per opened dialog
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && el.contains(active);
      if (e.shiftKey ? active === first || !inside : active === last || !inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      const back =
        opener?.isConnected && !opener.closest('[inert]')
          ? opener
          : fallback
            ? document.querySelector<HTMLElement>(fallback)
            : null;
      // The app stops being inert in the same commit; focus it once that has landed.
      requestAnimationFrame(() => back?.focus());
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30"
      />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cn(
          'relative w-full max-w-md rounded-xl border border-border bg-background p-5 text-sm shadow-lg dark:shadow-none',
          className,
        )}
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 id={id} className="m-0 text-sm font-medium">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cn(
              hit,
              'ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
