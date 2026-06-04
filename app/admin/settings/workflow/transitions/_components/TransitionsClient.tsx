'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

import type { TransitionRow } from '@/lib/admin/transitions';

import { setTransitionRequiresDatetimeAction } from '../actions';

interface Props {
  transitions: TransitionRow[];
}

const KIND_BADGE: Record<string, { label: string; tone: string }> = {
  forward: {
    label: 'Forward',
    tone: 'bg-primary/10 text-primary border-primary/30',
  },
  forward_skip: {
    label: 'Forward skip',
    tone: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/30 dark:text-sky-200',
  },
  rollback: {
    label: 'Rollback',
    tone: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-200',
  },
  specific_backward: {
    label: 'Captain reject',
    tone: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/30 dark:text-rose-200',
  },
};

export function TransitionsClient({ transitions }: Props) {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left py-2.5 px-3">From</th>
              <th className="text-left py-2.5 px-3">To</th>
              <th className="text-left py-2.5 px-3">Kind</th>
              <th className="text-left py-2.5 px-3">Role</th>
              <th className="text-center py-2.5 px-3" title="Requires reason">
                Reason
              </th>
              <th className="text-center py-2.5 px-3" title="Requires quotation">
                Quote
              </th>
              <th className="text-center py-2.5 px-3" title="Requires date+time picker">
                Date+time
              </th>
              <th className="text-left py-2.5 px-3">Auto-task</th>
              <th className="text-left py-2.5 px-3">Event</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transitions.map((t) => (
              <TransitionRowView key={t.id} row={t} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransitionRowView({ row }: { row: TransitionRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const kindBadge = KIND_BADGE[row.kind] ?? {
    label: row.kind,
    tone: 'bg-muted/40 text-muted-foreground border-muted',
  };

  function toggleRequiresDatetime(next: boolean) {
    startTransition(async () => {
      const result = await setTransitionRequiresDatetimeAction({
        id: row.id,
        requiresDatetime: next,
      });
      if (result.ok) {
        toast.success(
          next
            ? `Calendar picker enabled for ${row.toName}`
            : `Calendar picker disabled for ${row.toName}`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <tr className="hover:bg-muted/30">
      <td className="py-2.5 px-3">
        <p className="text-sm font-medium tracking-tight">{row.fromName}</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {row.fromCode}
        </p>
      </td>
      <td className="py-2.5 px-3">
        <p className="text-sm font-medium tracking-tight">{row.toName}</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {row.toCode}
        </p>
      </td>
      <td className="py-2.5 px-3">
        <Badge
          variant="outline"
          className={`text-[10px] ${kindBadge.tone}`}
        >
          {kindBadge.label}
        </Badge>
      </td>
      <td className="py-2.5 px-3">
        <Badge variant="outline" className="text-[10px]">
          {row.allowedRole}
        </Badge>
      </td>
      <td className="py-2.5 px-3 text-center">
        {row.requiresReason ? '✓' : <span className="text-muted-foreground/50">—</span>}
      </td>
      <td className="py-2.5 px-3 text-center">
        {row.requiresQuotation ? '✓' : <span className="text-muted-foreground/50">—</span>}
      </td>
      <td className="py-2.5 px-3 text-center">
        <Switch
          checked={row.requiresDatetime}
          disabled={pending}
          onCheckedChange={toggleRequiresDatetime}
          aria-label={`Toggle calendar picker for ${row.fromCode} to ${row.toCode}`}
        />
      </td>
      <td className="py-2.5 px-3">
        {row.autoTaskType ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {row.autoTaskType}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="py-2.5 px-3">
        {row.emitsEvent ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {row.emitsEvent}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
    </tr>
  );
}
