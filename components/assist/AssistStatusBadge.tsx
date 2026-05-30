import { Badge } from '@/components/ui/badge';
import { ASSIST_STATUS_LABELS, type AssistStatus } from '@/lib/assist/types';
import { cn } from '@/lib/utils';

// HVA-199: status pill — shared across list rows + detail header.

const STATUS_CLASS: Record<AssistStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700 border-blue-300/50',
  approved: 'bg-emerald-100 text-emerald-700 border-emerald-300/50',
  processing: 'bg-amber-100 text-amber-700 border-amber-300/50',
  dispatched: 'bg-primary/10 text-primary border-primary/30',
  rejected: 'bg-rose-100 text-rose-700 border-rose-300/50',
};

interface Props {
  status: AssistStatus;
  className?: string;
}

export function AssistStatusBadge({ status, className }: Props) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] uppercase tracking-wide',
        STATUS_CLASS[status],
        className,
      )}
    >
      {ASSIST_STATUS_LABELS[status]}
    </Badge>
  );
}
