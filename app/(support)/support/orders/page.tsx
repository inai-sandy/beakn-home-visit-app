import { loadAllOrders } from '@/lib/support/orders-queries';
import { loadSupportFilterOptions } from '@/lib/support/filter-options';

import { SupportFilters } from '../../_components/SupportFilters';
import { OrdersListTable } from './_components/OrdersListTable';

// =============================================================================
// HVA-245: /support/orders — all-orders archive
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Orders — Support — Beakn',
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    sort?: string;
    dir?: string;
    city?: string;
    state?: string;
    product?: string;
    customer?: string;
  }>;
}

function parseSort(
  raw: string | undefined,
): 'customer' | 'state' | 'activity' | undefined {
  if (raw === 'customer' || raw === 'state' || raw === 'activity') return raw;
  return undefined;
}

function parseDir(raw: string | undefined): 'asc' | 'desc' | undefined {
  return raw === 'asc' || raw === 'desc' ? raw : undefined;
}

function parseDispatchState(
  raw: string | undefined,
): 'pending' | 'in_progress' | 'done' | undefined {
  if (raw === 'pending' || raw === 'in_progress' || raw === 'done') return raw;
  return undefined;
}

export default async function SupportOrdersIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = (params.q ?? '').trim();
  const pageNum = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const cityId = params.city?.trim() || undefined;
  const productName = params.product?.trim() || undefined;
  const customerPhone = params.customer?.trim() || undefined;
  const dispatchState = parseDispatchState(params.state);

  const [{ rows, totalCount, page, pageSize }, filterOptions] = await Promise.all([
    loadAllOrders({
      search: search || undefined,
      page: pageNum,
      pageSize: 25,
      sort: parseSort(params.sort),
      dir: parseDir(params.dir),
      cityId,
      productName,
      customerPhone,
      dispatchState,
    }),
    loadSupportFilterOptions(),
  ]);

  const now = Date.now();
  const tableRows = rows.map((r) => ({
    requestId: r.requestId,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    cityName: r.cityName,
    statusStageName: r.statusStageName,
    itemsCount: r.itemsCount,
    qtyTotal: r.qtyTotal,
    qtyDispatched: r.qtyDispatched,
    qtyRemaining: r.qtyRemaining,
    lastActivityIso: r.lastActivityAt.toISOString(),
    dispatchState: r.dispatchState,
    ageDays: Math.max(
      0,
      Math.floor((now - r.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)),
    ),
  }));

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Orders</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every order at ORDER_CONFIRMED or beyond. Searchable, sorted by last
          activity.
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
          state: dispatchState ?? '',
        }}
        showState
      />

      <OrdersListTable
        rows={tableRows}
        initialSearch={search}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
      />
    </section>
  );
}
