'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-246 (HVA-245-FIX2): SortableColumnHeader — clickable column header
// =============================================================================
//
// Drop into a <th>. Reads ?sort + ?dir from URL, renders the label with an
// indicator (↕ idle, ↑ asc, ↓ desc), and pushes URL changes on click. Cycles:
//   idle → asc → desc → idle
// Sibling columns reset to idle when this one is clicked.
//
// URL contract (shared by all 4 support pages):
//   ?sort=<key>   (omitted → default sort)
//   ?dir=asc|desc (omitted → default per-key)
// =============================================================================

interface Props {
  /** The `?sort=` value this column owns. */
  sortKey: string;
  label: string;
  /** Default direction the column should start with when going idle → asc. */
  defaultDir?: 'asc' | 'desc';
  /** Tailwind text-align utility — pass 'text-right' for numeric columns. */
  align?: 'left' | 'right';
  className?: string;
}

export function SortableColumnHeader({
  sortKey,
  label,
  defaultDir = 'asc',
  align = 'left',
  className,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- URL push, not a server mutation
  const [isPending, startTransition] = useTransition();

  const activeSort = params.get('sort');
  const activeDir = params.get('dir');
  const isActive = activeSort === sortKey;
  const dir: 'asc' | 'desc' | 'idle' = isActive
    ? activeDir === 'desc'
      ? 'desc'
      : 'asc'
    : 'idle';

  function onClick() {
    const next = new URLSearchParams(params.toString());
    // page resets on sort change
    next.delete('page');
    if (!isActive) {
      next.set('sort', sortKey);
      next.set('dir', defaultDir);
    } else if (dir === 'asc') {
      next.set('sort', sortKey);
      next.set('dir', 'desc');
    } else {
      next.delete('sort');
      next.delete('dir');
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const indicator =
    dir === 'asc' ? 'arrow_upward' : dir === 'desc' ? 'arrow_downward' : 'unfold_more';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className={cn(
        'inline-flex items-center gap-1 -mx-1 px-1 py-0.5 rounded-md hover:bg-muted transition-colors text-xs uppercase tracking-wide font-medium text-muted-foreground',
        align === 'right' && 'justify-end',
        isActive && 'text-foreground',
        className,
      )}
      aria-label={`Sort by ${label} ${dir === 'idle' ? 'ascending' : dir === 'asc' ? 'descending' : 'none'}`}
    >
      <span>{label}</span>
      <Icon
        name={indicator}
        size="xs"
        className={cn(
          'text-muted-foreground/60',
          isActive && 'text-foreground/80',
        )}
      />
    </button>
  );
}
