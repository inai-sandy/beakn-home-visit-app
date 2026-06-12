import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { formatInrFromPaise } from '@/lib/money';

import { AsOfNowTag } from '@/components/dashboard/AsOfNowTag';

// =============================================================================
// HVA-277: "What's pending on me?" — live obligations in one place
// =============================================================================
//
// Three rows, all as-of-now: overdue tasks, money still to collect on
// my requests, active warnings. Each row links to where it gets fixed.
// Rows render only when there is something to act on; an all-clear
// line replaces them when everything is clean.
// =============================================================================

interface Props {
  overdueCount: number;
  /** Snapshot: quotation totals minus net payments across my non-cancelled requests. */
  outstandingPaise: number;
  warnings: { soft: number; hard: number };
}

function Row({
  icon,
  text,
  href,
  hrefLabel,
  tone,
}: {
  icon: string;
  text: string;
  href: string;
  hrefLabel: string;
  tone: 'amber' | 'red' | 'neutral';
}) {
  const toneCls =
    tone === 'red'
      ? 'text-red-600'
      : tone === 'amber'
        ? 'text-amber-600'
        : 'text-foreground';
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon name={icon} size="sm" className={toneCls} />
        <p className="text-sm leading-snug">{text}</p>
      </div>
      <Link
        href={href}
        className="shrink-0 text-sm font-medium text-primary hover:underline"
      >
        {hrefLabel}
      </Link>
    </div>
  );
}

export function PendingOnMeCard({ overdueCount, outstandingPaise, warnings }: Props) {
  const hasWarnings = warnings.soft > 0 || warnings.hard > 0;
  const allClear = overdueCount === 0 && outstandingPaise === 0 && !hasWarnings;

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-1">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
          What’s pending on me?
        </h2>
        <AsOfNowTag />
      </div>
      {allClear ? (
        <p className="text-sm text-muted-foreground py-2">
          Nothing pending — no overdue tasks, no money to collect, no warnings.
        </p>
      ) : (
        <div className="divide-y">
          {overdueCount > 0 && (
            <Row
              icon="flag"
              tone="red"
              text={`${overdueCount} task${overdueCount === 1 ? '' : 's'} past the postponed date`}
              href="/tasks"
              hrefLabel="Open tasks"
            />
          )}
          {outstandingPaise > 0 && (
            <Row
              icon="payments"
              tone="amber"
              text={`${formatInrFromPaise(outstandingPaise)} still to collect on your requests`}
              href="/finance"
              hrefLabel="Open finance"
            />
          )}
          {hasWarnings && (
            <Row
              icon="warning"
              tone={warnings.hard > 0 ? 'red' : 'amber'}
              text={`Active warnings: ${warnings.soft} soft · ${warnings.hard} hard (of 5)`}
              href="/profile"
              hrefLabel="View"
            />
          )}
        </div>
      )}
    </section>
  );
}
