'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Icon } from '@/components/ui/icon';

import type { ReportColumn } from '@/lib/reports/types';

// =============================================================================
// Sortable column chip strip (renders ABOVE the table)
// =============================================================================
//
// Quick way to flip the active sort column + direction without
// touching the table headers. Each sortable column gets a chip; the
// active one shows its direction arrow. Clicking the same chip flips
// the direction; clicking a different chip switches column.
// =============================================================================

interface Props {
  columns: ReportColumn[];
  activeKey: string | undefined;
  direction: 'asc' | 'desc';
  basePath: string;
}

export function ReportSortHeader({
  columns,
  activeKey,
  direction,
  basePath,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const sortable = columns.filter((c) => c.sortable);
  if (sortable.length === 0) return null;

  function pickSort(key: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (activeKey === key) {
      next.set('dir', direction === 'asc' ? 'desc' : 'asc');
    } else {
      next.set('sort', key);
      next.set('dir', 'desc');
    }
    next.delete('page');
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <nav aria-label="Sort columns" className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1">
        Sort:
      </span>
      {sortable.map((c) => {
        const isActive = c.key === activeKey;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => pickSort(c.key)}
            aria-current={isActive ? 'true' : undefined}
            className={
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ' +
              (isActive
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground')
            }
          >
            {c.label}
            {isActive && (
              <Icon
                name={direction === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                size="xs"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
