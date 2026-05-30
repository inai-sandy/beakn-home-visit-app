import { Badge } from '@/components/ui/badge';
import { ASSIST_PRIORITY_LABELS, type AssistPriority } from '@/lib/assist/types';
import { cn } from '@/lib/utils';

const PRIORITY_CLASS: Record<AssistPriority, string> = {
  high: 'bg-rose-100 text-rose-700 border-rose-300/50',
  medium: 'bg-amber-50 text-amber-700 border-amber-300/40',
  low: 'bg-muted text-muted-foreground border-border',
};

interface Props {
  priority: AssistPriority;
  className?: string;
}

export function AssistPriorityBadge({ priority, className }: Props) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] uppercase tracking-wide',
        PRIORITY_CLASS[priority],
        className,
      )}
    >
      {ASSIST_PRIORITY_LABELS[priority]}
    </Badge>
  );
}
