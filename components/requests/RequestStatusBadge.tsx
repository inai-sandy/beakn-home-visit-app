import { Badge } from '@/components/ui/badge';

import type { RequestRow } from './types';

// =============================================================================
// HVA-65: shared status badge for request rows
// =============================================================================
//
// Captures the cancelled-vs-stage rendering rule from HVA-142: a non-null
// `cancelled_at` overrides whatever the status_stage_id says — cancelled
// requests show a destructive "Cancelled" pill regardless of their last
// recorded stage.
// =============================================================================

export function RequestStatusBadge({
  row,
}: {
  row: Pick<RequestRow, 'statusName' | 'cancelledAt'>;
}) {
  if (row.cancelledAt !== null) {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Cancelled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      {row.statusName}
    </Badge>
  );
}
