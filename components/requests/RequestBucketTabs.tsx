'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// =============================================================================
// HVA-65: shared bucket-tabs strip
// =============================================================================
//
// Two driving modes for filter state:
//
//   * Click-handler mode (exec page): pass `onSelect`. The component
//     renders <button> elements that call back into the parent's
//     useState. Bucket selection stays in-memory; URL is unchanged.
//
//   * Link mode (captain page): pass `hrefFor` instead of `onSelect`.
//     The component renders <a>/<Link>-style anchors so the captain's
//     URL-driven bucket UX (HVA-127) is preserved verbatim.
//
// One or the other — never both. The component is rendered as either a
// `<nav>` of buttons or anchors depending on which prop is provided.
// =============================================================================

export interface BucketSpec<K extends string> {
  key: K;
  label: string;
  count: number;
}

interface CommonProps<K extends string> {
  buckets: readonly BucketSpec<K>[];
  active: K;
}

interface ClickProps<K extends string> extends CommonProps<K> {
  onSelect: (key: K) => void;
  hrefFor?: never;
  LinkComponent?: never;
}

interface LinkProps<K extends string> extends CommonProps<K> {
  hrefFor: (key: K) => string;
  /** Pass next/link's Link (or any component accepting href + children). */
  LinkComponent: React.ComponentType<{
    href: string;
    'aria-current'?: 'page' | undefined;
    className?: string;
    children: ReactNode;
  }>;
  onSelect?: never;
}

type Props<K extends string> = ClickProps<K> | LinkProps<K>;

export function RequestBucketTabs<K extends string>(props: Props<K>) {
  const { buckets, active } = props;

  return (
    <nav
      aria-label="Filter by status"
      className="flex flex-wrap gap-1.5 border-b pb-3"
    >
      {buckets.map((b) => {
        const isActive = b.key === active;
        const baseCls = cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          isActive
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        );
        const countCls = cn(
          'rounded-full px-1.5 py-0.5 text-[10px]',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted-foreground/15 text-muted-foreground',
        );
        const inner = (
          <>
            <span>{b.label}</span>
            <span className={countCls}>{b.count}</span>
          </>
        );

        if ('onSelect' in props && props.onSelect) {
          return (
            <button
              type="button"
              key={b.key}
              onClick={() => props.onSelect(b.key)}
              aria-current={isActive ? 'page' : undefined}
              className={baseCls}
            >
              {inner}
            </button>
          );
        }

        const { LinkComponent, hrefFor } = props as LinkProps<K>;
        return (
          <LinkComponent
            key={b.key}
            href={hrefFor(b.key)}
            aria-current={isActive ? 'page' : undefined}
            className={baseCls}
          >
            {inner}
          </LinkComponent>
        );
      })}
    </nav>
  );
}
