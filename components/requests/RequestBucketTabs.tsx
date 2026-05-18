'use client';

import Link from 'next/link';

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
//   * Link mode (captain page): pass `hrefByKey` — a plain map from
//     bucket key to URL string. The component renders <Link> anchors
//     so the captain's URL-driven bucket UX (HVA-127) is preserved.
//
//     Why a string map (not a `hrefFor: (key) => string` function):
//     this component is `'use client'`, but the captain page
//     (app/(captain)/captain/requests/page.tsx) is a Server Component
//     that mounts it. Function-typed props can't cross the RSC
//     server→client serialization boundary — Next.js rejects them with
//     "Functions cannot be passed directly to Client Components"
//     (production digests 1605197399 / 111855479 surfaced this on
//     2026-05-18 during Sandeep's walk of /captain/requests). A
//     `Record<K, string>` is plain JSON so it serializes cleanly.
//
//     Pre-2026-05-18, this prop was `hrefFor: (key) => string` and the
//     component also took a `LinkComponent` prop. Both function-typed,
//     both broken at the RSC boundary. `LinkComponent` is gone (Link is
//     imported directly above), `hrefFor` is now `hrefByKey`.
//
// One mode or the other — never both. The component is rendered as
// either a <nav> of buttons or Links depending on which prop is given.
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
  hrefByKey?: never;
}

interface LinkModeProps<K extends string> extends CommonProps<K> {
  /** Plain-string href per bucket key. Must be serializable JSON — no
   *  functions, no React components. See module comment for why. */
  hrefByKey: Record<K, string>;
  onSelect?: never;
}

type Props<K extends string> = ClickProps<K> | LinkModeProps<K>;

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

        const hrefByKey = (props as LinkModeProps<K>).hrefByKey;
        return (
          <Link
            key={b.key}
            href={hrefByKey[b.key]}
            aria-current={isActive ? 'page' : undefined}
            className={baseCls}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
