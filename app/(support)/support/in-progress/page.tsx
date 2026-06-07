import { loadDispatchQueue } from '@/lib/support/dispatch-queries';
import { loadSupportFilterOptions } from '@/lib/support/filter-options';

import { SupportFilters } from '../../_components/SupportFilters';
import { SupportQueueTable, type SupportQueueRow } from '../_components/SupportQueueTable';

// =============================================================================
// HVA-245: /support/in-progress — partially dispatched / mid-flight items
// HVA-246: pagination + sortable columns
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'In-progress — Support — Beakn',
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    sort?: string;
    dir?: string;
    city?: string;
    product?: string;
    customer?: string;
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

export default async function SupportInProgressPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = (params.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const sort = parseSort(params.sort);
  const dir = parseDir(params.dir);
  const cityId = params.city?.trim() || undefined;
  const productName = params.product?.trim() || undefined;
  const customerPhone = params.customer?.trim() || undefined;

  const [{ rows, totalCount, page: currentPage, pageSize }, filterOptions] =
    await Promise.all([
      loadDispatchQueue({
        search: search || undefined,
        mode: 'in_progress',
        page,
        pageSize: 25,
        sort,
        dir,
        cityId,
        productName,
        customerPhone,
      }),
      loadSupportFilterOptions(),
    ]);

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
          {totalCount === 0
            ? 'Nothing in flight right now.'
            : `${totalCount} ${totalCount === 1 ? 'item' : 'items'} mid-flight — partial dispatch or waiting to be handed off.`}
        </p>
      </header>

      <SupportFilters
        cities={filterOptions.cities}
        products={filterOptions.products}
        customers={filterOptions.customers}
        current={{
          city: cityId ?? '',
          product: productName ?? '',
          customer: customerPhone ?? '',
        }}
      />

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
