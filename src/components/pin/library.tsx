'use client';

import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Collection } from '@/lib/pin/learnings';
import {
  filterReferences,
  type LibraryFilter,
  markedOf,
  type Reference,
  referenceReach,
  referencesOf,
} from '@/lib/pin/library';
import { cleanScreenTag, itemsLine, SOURCES, sourceLabel } from '@/lib/pin/model';
import { cn } from '@/lib/utils';
import { Dialog, hit } from './dialog';
import { tagHit } from './topic-style';

/*
 * The library (D124): every screenshot the author has noted, as one pool. A masonry of marked
 * copies, newest batch first, sorted by product (screen tag) and source; each opens to its notes,
 * where its tag can change and it can be removed. Adding goes back to the images, where notes are
 * written. The pictures come from the batch zips Your rules already opens.
 */

const chip =
  'flex h-7 items-center gap-1 rounded-md border px-2 text-[13px] leading-none whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none';
const button = cn(
  hit,
  'flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm transition-colors duration-150 motion-reduce:transition-none hover:bg-muted disabled:opacity-50',
);
const field =
  'w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors duration-150 placeholder:text-[#737373] focus:border-foreground/25 motion-reduce:transition-none dark:placeholder:text-[#7a7a7a]';
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Picture = { url: string; width?: number; height?: number };

export function Library({
  collection: c,
  filesOf,
  crops,
  onTag,
  onRemove,
  onAdd,
}: {
  collection: Collection;
  /** A batch's export, read once while Your rules is open. */
  filesOf: (batchId: string) => Promise<Map<string, Uint8Array> | null>;
  /** Each note's close-up, by `batch/ref`. */
  crops: Record<string, string>;
  onTag: (r: Reference, tag: string) => void;
  onRemove: (r: Reference) => void;
  onAdd: () => void;
}) {
  const all = referencesOf(c);
  const [filter, setFilter] = useState<LibraryFilter>({});
  const [open, setOpen] = useState<{ key: string; opener: HTMLElement | null } | null>(null);
  const pictures = usePictures(c, filesOf);
  const shown = filterReferences(all, filter);
  const tags = [...new Map(all.filter((r) => r.tag).map((r) => [r.tag.toLowerCase(), r.tag])).values()];
  const untagged = all.filter((r) => !r.tag).length;
  const sources = SOURCES.filter((s) => all.some((r) => r.source === s.kind));
  const chipFor = (label: string, n: number, on: boolean, pick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      onClick={pick}
      className={cn(
        tagHit,
        chip,
        on
          ? 'border-foreground bg-muted text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
      <span className="font-mono opacity-70">{n}</span>
    </button>
  );
  const current = open ? all.find((r) => r.key === open.key) : undefined;

  return (
    <section aria-label="References" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {chipFor('All', all.length, !filter.tag && filter.tag !== '' && !filter.source, () => setFilter({}), 'all')}
        {tags.map((t) =>
          chipFor(
            t,
            filterReferences(all, { tag: t }).length,
            filter.tag === t,
            () => setFilter(filter.tag === t ? {} : { tag: t }),
            `tag:${t}`,
          ),
        )}
        {untagged > 0 &&
          tags.length > 0 &&
          chipFor('No tag', untagged, filter.tag === '', () => setFilter(filter.tag === '' ? {} : { tag: '' }), 'notag')}
        {sources.length > 1 &&
          sources.map((s) =>
            chipFor(
              s.label,
              filterReferences(all, { source: s.kind }).length,
              filter.source === s.kind,
              () => setFilter(filter.source === s.kind ? {} : { source: s.kind }),
              `source:${s.kind}`,
            ),
          )}
        <button type="button" onClick={onAdd} className={cn(button, 'ml-auto')}>
          <ImagePlus className="size-4" aria-hidden />
          Add
        </button>
      </div>

      {shown.length ? (
        <ul className="m-0 list-none columns-2 gap-3 p-0 sm:columns-3 [&>li]:mb-3">
          {shown.map((r) => {
            const pic = pictures[r.key];
            return (
              <li key={r.key} className="break-inside-avoid">
                <button
                  type="button"
                  onClick={(e) => setOpen({ key: r.key, opener: e.currentTarget })}
                  className="group block w-full overflow-hidden rounded-xl border border-border text-left transition-colors duration-150 motion-reduce:transition-none hover:border-foreground/25"
                >
                  {pic ? (
                    // biome-ignore lint/performance/noImgElement: a marked copy from the batch's zip, as a blob URL
                    <img
                      src={pic.url}
                      alt={r.image}
                      width={pic.width}
                      height={pic.height}
                      loading="lazy"
                      decoding="async"
                      className="block h-auto w-full bg-muted"
                    />
                  ) : (
                    <span
                      className="block w-full animate-pulse bg-muted motion-reduce:animate-none"
                      style={{ aspectRatio: '4 / 3' }}
                      aria-hidden
                    />
                  )}
                  <span className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {r.tag || r.image}
                    </span>
                    {r.best && (
                      <Star className="size-3.5 shrink-0 fill-foreground text-foreground" aria-label="Best example" />
                    )}
                    <span className="shrink-0 text-muted-foreground">
                      {[count(r.notes.length, 'note'), r.rules ? count(r.rules, 'rule') : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-center text-sm text-muted-foreground">No references here.</p>
      )}

      {current && open && (
        <ReferenceDialog
          collection={c}
          reference={current}
          picture={pictures[current.key]}
          crops={crops}
          opener={open.opener}
          onClose={() => setOpen(null)}
          onTag={(tag) => onTag(current, tag)}
          onRemove={() => {
            setOpen(null);
            onRemove(current);
          }}
        />
      )}
    </section>
  );
}

/** Each reference's marked copy as a picture, from the batch zips, while the library is open. */
function usePictures(c: Collection, filesOf: (batchId: string) => Promise<Map<string, Uint8Array> | null>) {
  const [pictures, setPictures] = useState<Record<string, Picture>>({});
  const batchIds = c.batches.map((b) => b.id).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pictures follow the batches
  useEffect(() => {
    let cancelled = false;
    const made: Record<string, Picture> = {};
    (async () => {
      for (const b of c.batches) {
        const files = await filesOf(b.id);
        if (cancelled) return;
        if (!files) continue;
        let manifest: unknown = null;
        try {
          const raw = files.get(`${b.root}notes.json`);
          manifest = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
        } catch {
          manifest = null;
        }
        const numbers = new Set(b.notes.map((n) => n.ref.split('.')[0]));
        for (const number of numbers) {
          const marked = markedOf(manifest, b.root, number);
          const bytes = marked && files.get(marked.path);
          if (!marked || !bytes) continue;
          made[`${b.id}/${number}`] = {
            url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })),
            width: marked.width,
            height: marked.height,
          };
        }
        setPictures({ ...made });
      }
    })();
    return () => {
      cancelled = true;
      for (const p of Object.values(made)) URL.revokeObjectURL(p.url);
      setPictures({});
    };
  }, [batchIds, filesOf]);
  return pictures;
}

/** One reference: its marked copy, its notes with their close-ups, its tag, and Remove. */
function ReferenceDialog({
  collection: c,
  reference: r,
  picture,
  crops,
  opener,
  onClose,
  onTag,
  onRemove,
}: {
  collection: Collection;
  reference: Reference;
  picture?: Picture;
  crops: Record<string, string>;
  opener: HTMLElement | null;
  onClose: () => void;
  onTag: (tag: string) => void;
  onRemove: () => void;
}) {
  const [tag, setTag] = useState(r.tag);
  const [removing, setRemoving] = useState(false);
  const reach = referenceReach(c, r.batch.id, r.number);
  const saveTag = () => {
    if (cleanScreenTag(tag) !== r.tag) onTag(tag);
  };
  return (
    <Dialog
      id="reference-title"
      title={r.image}
      opener={opener}
      onClose={() => {
        saveTag();
        onClose();
      }}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {picture && (
          // biome-ignore lint/performance/noImgElement: a marked copy from the batch's zip, as a blob URL
          <img
            src={picture.url}
            alt={r.image}
            width={picture.width}
            height={picture.height}
            className="block h-auto max-h-[50vh] w-full rounded-lg bg-muted object-contain"
          />
        )}
        <p className="m-0 text-[13px] text-muted-foreground">
          {[
            r.source ? sourceLabel(r.source) : '',
            count(r.notes.length, 'note'),
            r.rules ? `feeds ${count(r.rules, 'rule')}` : 'feeds no rule yet',
            r.unread ? `${r.unread} not read` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="space-y-1">
          <label htmlFor="reference-tag" className="text-[13px] font-medium text-muted-foreground">
            Screen tag
          </label>
          <input
            id="reference-tag"
            value={tag}
            maxLength={40}
            placeholder="A product or feature"
            onChange={(e) => setTag(e.target.value)}
            onBlur={saveTag}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveTag();
              }
            }}
            className={field}
          />
        </div>
        <ol className="m-0 list-none space-y-3 p-0">
          {r.notes.map((n) => {
            const crop = crops[`${r.batch.id}/${n.ref}`];
            return (
              <li key={n.ref} className="flex gap-3">
                {crop ? (
                  // biome-ignore lint/performance/noImgElement: a close-up from the batch's zip, as a blob URL
                  <img
                    src={crop}
                    alt=""
                    className="size-16 shrink-0 rounded-md bg-muted object-cover"
                  />
                ) : (
                  <span className="size-16 shrink-0 rounded-md bg-muted" aria-hidden />
                )}
                <div className="min-w-0 space-y-0.5 text-[13px]">
                  {n.label && <p className="m-0 font-medium text-foreground">{n.label}</p>}
                  {n.works && <p className="m-0 text-foreground">{itemsLine(n.works)}</p>}
                  {n.doesNotWork && (
                    <p className="m-0 text-muted-foreground">{itemsLine(n.doesNotWork)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {removing ? (
          <div className="space-y-3 rounded-lg bg-muted px-3 py-2.5">
            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
              {count(reach.notes, 'note')} deleted with it.
              {reach.rules > 0 &&
                ` ${count(reach.rules, 'rule')} came from them alone and ${reach.rules === 1 ? 'goes' : 'go'} too.`}
              {reach.fewer > 0 &&
                ` ${count(reach.fewer, 'rule')} ${reach.fewer === 1 ? 'keeps its' : 'keep their'} other notes.`}
              {reach.last && ' It is the last of its batch, so the batch goes.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRemoving(false)} className={button}>
                Cancel
              </button>
              <button
                type="button"
                onClick={onRemove}
                className={cn(
                  hit,
                  'flex min-h-9 items-center gap-2 rounded-md bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors duration-150 motion-reduce:transition-none hover:bg-destructive/20',
                )}
              >
                <Trash2 className="size-4" aria-hidden />
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={() => setRemoving(true)} className={button}>
              <Trash2 className="size-4" aria-hidden />
              Remove
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
