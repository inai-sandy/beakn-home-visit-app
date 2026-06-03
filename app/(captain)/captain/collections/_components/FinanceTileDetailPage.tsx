import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import {
  loadFinanceOrderList,
  loadFinanceReceivedDetail,
  type FinanceListSort,
} from '@/lib/captain/finance-queries';
import { parsePage } from '@/lib/pagination';

import {
  OrderDetailTable,
  PaymentDetailTable,
} from './FinanceTileDetailTable';

// =============================================================================
// Shared detail-page renderer used by the 3 portals
// =============================================================================
//
// Sandeep 2026-06-03: tapping a Finance hero tile opens a dedicated
// page (not a sheet) with the full table for that tile. All three
// portals (/captain/collections, /finance, /admin/portal/[captainId]/
// collections) point at this renderer with their own scope args.
//
// One file = one route convention: the per-portal page.tsx imports
// this and supplies (a) the scope filter args for the captain
// finance-queries loaders and (b) the back-link target.
// =============================================================================

export const FINANCE_TILE_SLUGS = [
  'order-book',
  'pipeline',
  'received',
  'outstanding',
] as const;
export type FinanceTileSlug = (typeof FINANCE_TILE_SLUGS)[number];

export function isFinanceTileSlug(value: unknown): value is FinanceTileSlug {
  return (
    typeof value === 'string' &&
    (FINANCE_TILE_SLUGS as readonly string[]).includes(value)
  );
}

const TITLES: Record<
  FinanceTileSlug,
  { title: string; subtitle: string }
> = {
  'order-book': {
    title: 'Order Book',
    subtitle:
      'Quotations on confirmed orders, sorted by outstanding amount. Tap any customer to drill into the request.',
  },
  pipeline: {
    title: 'Quotation Pipeline',
    subtitle:
      'Quotations submitted before the order is confirmed, sorted by oldest first.',
  },
  received: {
    title: 'Received',
    subtitle:
      'Every payment recorded against scoped requests, chronologically. Refunds shown as negative — the net figure matches the Finance hero tile.',
  },
  outstanding: {
    title: 'Outstanding',
    subtitle:
      'Requests with money still owed, sorted by outstanding desc. Fully-paid or refunded-out rows do not appear.',
  },
};

interface RenderProps {
  slug: FinanceTileSlug;
  /** Scope passed to loadFinanceOrderList / loadFinanceReceivedDetail. */
  scope: {
    captainUserId: string;
    isSuperAdmin: boolean;
    forceExecScope?: string;
    execFilter?: string;
    cityFilter?: string;
  };
  /** Path of the Finance home page (back link target). */
  backHref: string;
  /** Pretty label of the Finance home for the back link. */
  backLabel?: string;
  /** Page param for the order-list (Order Book / Pipeline / Outstanding). */
  page: number;
  /** Override where customer rows link. Defaults to /requests/[id]. */
  requestHref?: (requestId: string) => string;
}

export async function FinanceTileDetailPage({
  slug,
  scope,
  backHref,
  backLabel = 'Back to Finance',
  page,
  requestHref,
}: RenderProps) {
  if (!isFinanceTileSlug(slug)) notFound();
  const meta = TITLES[slug];

  // Pull the rows. Page-size is generous (250) so even the longest
  // tile sets render in one go without pagination — Sandeep wanted "a
  // table", not "a paginated list". If a portal ever sees > 250 rows
  // we'll add pagination as a follow-up.
  const PAGE_SIZE = 250;

  let body: React.ReactNode;
  if (slug === 'received') {
    const rows = await loadFinanceReceivedDetail({
      ...scope,
      limit: PAGE_SIZE,
    });
    body = <PaymentDetailTable rows={rows} requestHref={requestHref} />;
  } else {
    const sectionMap: Record<
      Exclude<FinanceTileSlug, 'received'>,
      { section: 'order_book' | 'pipeline' | 'all'; sort: FinanceListSort }
    > = {
      'order-book': { section: 'order_book', sort: 'outstanding_desc' },
      pipeline: { section: 'pipeline', sort: 'date_asc' },
      outstanding: { section: 'all', sort: 'outstanding_desc' },
    };
    const cfg = sectionMap[slug];
    const { rows } = await loadFinanceOrderList({
      ...scope,
      section: cfg.section,
      sort: cfg.sort,
      page,
      pageSize: PAGE_SIZE,
    });
    body = (
      <OrderDetailTable
        variant={
          slug === 'order-book'
            ? 'order_book'
            : slug === 'pipeline'
              ? 'pipeline'
              : 'outstanding'
        }
        rows={rows}
        requestHref={requestHref}
      />
    );
  }

  return (
    <main className="min-h-svh bg-background pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="arrow_back" size="xs" />
          {backLabel}
        </Link>

        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Finance · Detail
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {meta.title}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            {meta.subtitle}
          </p>
        </header>

        {body}
      </div>
    </main>
  );
}
