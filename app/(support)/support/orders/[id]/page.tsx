import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OrderCommentsBlock } from '@/components/order-comments/OrderCommentsBlock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { formatInrFromPaise } from '@/lib/money';
import { loadOrderDetail } from '@/lib/support/order-detail';
import { cn } from '@/lib/utils';

import { DispatchHistoryBlock } from './_components/DispatchHistoryBlock';

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

const PRIORITY_LABEL: Record<'low' | 'med' | 'high', string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

const PRIORITY_TONE: Record<'low' | 'med' | 'high', string> = {
  low: 'bg-muted text-muted-foreground',
  med: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  high: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
};

export default async function SupportOrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) notFound();
  const detail = await loadOrderDetail(id);
  if (!detail) notFound();

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
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No line items recorded yet — exec / captain needs to break the
            quotation into products first.
          </p>
        ) : (
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Product</th>
                    <th className="text-right px-3 py-2 font-medium">Total</th>
                    <th className="text-right px-3 py-2 font-medium">Done</th>
                    <th className="text-right px-3 py-2 font-medium">Left</th>
                    <th className="text-left px-3 py-2 font-medium">Priority</th>
                    <th className="text-left px-3 py-2 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{it.productName}</div>
                        {it.productSku && (
                          <div className="text-[11px] font-mono text-muted-foreground">
                            {it.productSku}
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground">
                          Unit {formatInrFromPaise(it.unitPricePaise)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {it.quantityTotal}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {it.quantityDispatched}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {it.quantityRemaining}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]', PRIORITY_TONE[it.priority])}
                        >
                          {PRIORITY_LABEL[it.priority]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {it.targetDispatchDate ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
