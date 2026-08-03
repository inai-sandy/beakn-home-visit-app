import { Badge } from '@/components/ui/badge';
import {
  ITEM_STATE_TONE,
  formatDispatchPill,
  type OrderDispatchSummary,
} from '@/lib/dispatch/fulfilment';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-305: dispatch progress pill for the exec + captain request lists
// =============================================================================
//
// Answers "which of my orders have actually shipped" without opening each
// one. Orders go out in installments, so the partial case shows the split
// ("3 of 8 shipped") rather than a bare yes/no.
//
// Renders nothing at all when there's nothing meaningful to say — before
// ORDER_CONFIRMED, or on an order with no line items. A row that simply
// isn't ready to ship should look quiet, not "Not shipped".
// =============================================================================

const DELIVERED_TONE =
  'border-emerald-600/40 text-emerald-800 bg-emerald-600/15';

export function DispatchPill({
  summary,
}: {
  summary: OrderDispatchSummary | null | undefined;
}) {
  if (!summary || summary.unitsTotal <= 0) return null;

  const tone = summary.fullyDelivered
    ? DELIVERED_TONE
    : ITEM_STATE_TONE[summary.state];

  return (
    <Badge variant="outline" className={cn('text-[10px] tabular-nums', tone)}>
      {formatDispatchPill(summary)}
    </Badge>
  );
}
