import { loadDispatchQueue } from '@/lib/support/dispatch-queries';

import { SupportQueueTable, type SupportQueueRow } from './_components/SupportQueueTable';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): /support — dispatch queue
// HVA-245: renamed Queue → Pending; mode='pending' filter
// HVA-246: pagination + sortable columns (customer / product / age)
// =============================================================================
//
// Pending = line items where qty_dispatched = 0 (nobody has touched this
// item yet). Items with partial dispatch move to /support/in-progress.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pending — Support — Beakn',
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}

function parseSort(
  raw: string | undefined,
): 'customer' | 'product' | 'age' | undefined {
  if (raw === 'customer' || raw === 'product' || raw === 'age') return raw;
  return undefined;
}

function parseDir(raw: string | undefined): 'asc' | 'desc' | undefined {
  return raw === 'asc' || raw === 'desc' ? raw : undefined;
}

export default async function SupportPendingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = (params.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const sort = parseSort(params.sort);
  const dir = parseDir(params.dir);

  const { rows, totalCount, page: currentPage, pageSize } =
    await loadDispatchQueue({
      search: search || undefined,
      mode: 'pending',
      page,
      pageSize: 25,
      sort,
      dir,
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
        <h2 className="text-2xl font-semibold tracking-tight">Pending</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {totalCount === 0
            ? 'Nothing waiting for first dispatch right now.'
            : `${totalCount} ${totalCount === 1 ? 'item' : 'items'} waiting for first dispatch.`}
        </p>
      </header>

      <SupportQueueTable
        rows={rowsWithAge}
        initialSearch={search}
        page={currentPage}
        pageSize={pageSize}
        totalCount={totalCount}
      />
    </section>
  );
}
