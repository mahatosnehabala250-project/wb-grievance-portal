'use client';

import type { MouseEvent, ReactNode } from 'react';
import { objectHref, type ObjectType } from '@/lib/objects';

/**
 * A place or person name that opens its page. Every such name in the app is
 * drawn the same way — a faint underline that turns saffron on hover — so
 * "this can be opened" reads the same on every screen.
 *
 * Without an id there is nothing to open, so the name renders as plain text.
 */
export function ObjectLink({ type, id, children, className = '', title }: {
  type: ObjectType; id?: string | null; children: ReactNode; className?: string; title?: string;
}) {
  if (!id) return <span className={className}>{children}</span>;
  // Rows that open a complaint on click must not also fire when a name inside them is followed.
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <a
      href={objectHref({ type, key: id })}
      onClick={stop}
      title={title}
      className={`rounded-sm underline decoration-foreground/25 decoration-1 underline-offset-[3px] transition-colors hover:decoration-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {children}
    </a>
  );
}

/** A place name in Bengali where one exists, with the English beside it. */
export function PlaceName({ label, bn, quiet = false }: { label: string; bn?: string | null; quiet?: boolean }) {
  if (!bn || bn === label) return <>{label}</>;
  return (
    <>
      <span lang="bn">{bn}</span>
      <span className={`ml-1.5 ${quiet ? 'text-muted-foreground' : 'text-muted-foreground/90'} text-[0.85em]`}>{label}</span>
    </>
  );
}
