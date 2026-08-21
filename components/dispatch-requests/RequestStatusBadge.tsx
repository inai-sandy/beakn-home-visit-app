import { Badge } from '@/components/ui/badge';
import {
  ORDER_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  type DispatchRequestOrderStatus,
  type DispatchRequestStatus,
} from '@/lib/dispatch-requests/status';
import { cn } from '@/lib/utils';

// HVA-342: one rendering of each status, shared by the exec's list, the exec's
// detail page and support's inbox — so the three screens cannot describe the
// same row differently.

const ORDER_TONE: Record<DispatchRequestOrderStatus, string> = {
  pending: 'border-muted-foreground/30 text-muted-foreground bg-muted/40',
  approved: 'border-emerald-500/30 text-emerald-700 bg-emerald-500/10',
  // Amber, not grey: a hold is something the exec has to act on — ring the
  // customer, change the promise — not a quiet waiting state.
  held: 'border-amber-500/30 text-amber-700 bg-amber-500/10',
  rejected: 'border-rose-500/30 text-rose-700 bg-rose-500/10',
};

const REQUEST_TONE: Record<DispatchRequestStatus, string> = {
  open: 'border-primary/40 text-primary bg-primary/10',
  closed: 'border-muted-foreground/30 text-muted-foreground bg-muted/40',
  cancelled: 'border-muted-foreground/30 text-muted-foreground bg-muted/40',
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: DispatchRequestOrderStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(ORDER_TONE[status], className)}>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

export function RequestStatusBadge({
  status,
  className,
}: {
  status: DispatchRequestStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(REQUEST_TONE[status], className)}>
      {REQUEST_STATUS_LABEL[status]}
    </Badge>
  );
}
