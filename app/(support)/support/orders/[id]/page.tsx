import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OrderCommentsBlock } from '@/components/order-comments/OrderCommentsBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { loadOrderDetail } from '@/lib/support/order-detail';

import { DispatchHistoryBlock } from './_components/DispatchHistoryBlock';
import { ItemsDispatchTable } from './_components/ItemsDispatchTable';

// =============================================================================
// HVA-239 (HVA-231 Phase 2 PR-B): /support/orders/[id] — per-order detail
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: 'Order — Support — Beakn',
};

export default async function SupportOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) notFound();
  const detail = await loadOrderDetail(id);
  if (!detail) notFound();

  const sessionUser = session.user as { id: string; role?: string };
  const canDispatch =
    sessionUser.role === USER_ROLES.SUPPORT ||
    sessionUser.role === USER_ROLES.SUPER_ADMIN;

  const { request: req, items, dispatches } = detail;
  const totalDispatched = items.reduce((s, i) => s + i.quantityDispatched, 0);
  const totalRemaining = items.reduce((s, i) => s + i.quantityRemaining, 0);

  return (
    <section className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8">
          <Link href="/support">
            <Icon name="arrow_back" size="xs" />
            <span>Back to queue</span>
          </Link>
        </Button>
      </div>

      <header className="space-y-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-2xl font-semibold tracking-tight">
            {req.customerName}
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {req.statusStageName}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {req.cityName} · {req.customerPhone}
          {req.execName && ` · Exec ${req.execName}`}
          {req.captainName && ` · Captain ${req.captainName}`}
        </p>
        <p className="text-xs text-muted-foreground">
          Order opened {req.createdAt.toLocaleDateString()} ·{' '}
          {totalRemaining} units remaining of {totalRemaining + totalDispatched}
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Items ({items.length})
        </h3>
        <ItemsDispatchTable items={items} canDispatch={canDispatch} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Dispatch history ({dispatches.length})
        </h3>
        <DispatchHistoryBlock
          dispatches={dispatches.map((d) => ({
            dispatchId: d.dispatchId,
            createdAtIso: d.createdAt.toISOString(),
            dispatchedByName: d.dispatchedByName,
            notes: d.notes,
            currentStage: d.currentStage,
            items: d.items,
          }))}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Order comments
        </h3>
        <OrderCommentsBlock
          requestId={req.id}
          currentUserId={(session.user as { id: string }).id}
        />
      </section>
    </section>
  );
}
