import { loadDispatchQueue } from '@/lib/support/dispatch-queries';

import { SupportQueueTable, type SupportQueueRow } from '../_components/SupportQueueTable';

// =============================================================================
// HVA-245: /support/in-progress — partially dispatched / mid-flight items
// =============================================================================
//
// In-progress = line items with at least one dispatch row AND either
//   qty_remaining > 0 (partial) OR any dispatch not yet handed_off
//   (still mid-flight). Reuses the SupportQueueTable so support can
//   dispatch the rest from here too.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'In-progress — Support — Beakn',
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SupportInProgressPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = (params.q ?? '').trim();

  const rows = await loadDispatchQueue({
    search: search || undefined,
    mode: 'in_progress',
  });

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
        <h2 className="text-2xl font-semibold tracking-tight">In-progress</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {rowsWithAge.length === 0
            ? 'Nothing in flight right now.'
            : `${rowsWithAge.length} ${rowsWithAge.length === 1 ? 'item' : 'items'} mid-flight — partial dispatch or waiting to be handed off.`}
        </p>
      </header>

      <SupportQueueTable rows={rowsWithAge} initialSearch={search} />
    </section>
  );
}
