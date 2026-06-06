import { loadDispatchQueue } from '@/lib/support/dispatch-queries';

import { SupportQueueTable, type SupportQueueRow } from './_components/SupportQueueTable';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): /support — dispatch queue
// =============================================================================
//
// Replaces the Phase 1 placeholder with the real queue. Server-renders
// the rows + counts; the client wrapper handles search debounce + row
// selection + dispatch modal.
//
// Query: every quotation_line_items row where parent request is at
// ORDER_CONFIRMED+ AND has remaining qty > 0. Sorted by priority desc
// → target_dispatch_date asc → item createdAt asc.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Queue — Support — Beakn',
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SupportQueuePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = (params.q ?? '').trim();

  const rows = await loadDispatchQueue({ search: search || undefined });

  const now = Date.now();
  const rowsWithAge: SupportQueueRow[] = rows.map((r) => {
    const ageMs = now - r.orderCreatedAt.getTime();
    const ageDays = Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    return {
      lineItemId: r.lineItemId,
      requestId: r.requestId,
      productName: r.productName,
      productSku: r.productSku,
      quantityTotal: r.quantityTotal,
      quantityRemaining: r.quantityRemaining,
      unitPricePaise: r.unitPricePaise,
      priority: r.priority,
      targetDispatchDate: r.targetDispatchDate,
      customerName: r.customerName,
      cityName: r.cityName,
      daysSinceOrder: ageDays,
    };
  });

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Dispatch queue</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {rowsWithAge.length === 0
            ? 'Nothing in the queue right now.'
            : `${rowsWithAge.length} ${rowsWithAge.length === 1 ? 'item' : 'items'} awaiting dispatch.`}
        </p>
      </header>

      <SupportQueueTable rows={rowsWithAge} initialSearch={search} />
    </section>
  );
}
