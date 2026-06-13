import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import { PlanVisitButton } from './PlanVisitButton';
import type { LeadRow } from '../../_components/types';

// =============================================================================
// HVA-73 PR 1: Requests list on the contact detail page
// =============================================================================
//
// Zero state: empty card + "Plan a Visit" primary button (the button
// also appears in the populated state, labelled "Plan Another Visit").
// Populated state: cards sorted newest first, each tappable into
// /requests/[id]. Status badge colour-codes via status_code prefix.
// =============================================================================

export interface ContactRequestRow {
  id: string;
  customerName: string;
  cityName: string;
  statusStageCode: string;
  statusStageName: string;
  assignedExecName: string | null;
  totalAmountPaise: number | null;
  /** HVA-281: CartPlus order number for this request's actual quotation. */
  orderNumber: string | null;
  createdAt: string; // ISO
}

interface Props {
  lead: Pick<
    LeadRow,
    | 'id'
    | 'type'
    | 'name'
    | 'phone'
    | 'email'
    | 'cityName'
    | 'bhk'
    | 'firmName'
    | 'businessTypeName'
    | 'interest'
  >;
  requests: ContactRequestRow[];
}

const STATUS_BADGE_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  SUBMITTED: 'secondary',
  ASSIGNED: 'default',
  VISIT_SCHEDULED: 'default',
  VISIT_COMPLETED: 'default',
  QUOTATION_SENT: 'default',
  ORDER_CONFIRMED: 'default',
  ORDER_EXECUTED_SUCCESSFULLY: 'default',
  PENDING_CAPTAIN_APPROVAL: 'secondary',
  REJECTED: 'destructive',
  CUSTOMER_REJECTED: 'destructive',
  CANCELLED: 'destructive',
};

function rupees(paise: number): string {
  // ₹ amounts are stored in paise (integer); divide by 100 for display.
  // Indian-style grouping (1,23,456) handled by the `en-IN` locale.
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function ContactRequestsSection({ lead, requests }: Props) {
  const hasRequests = requests.length > 0;

  return (
    <section
      aria-label="Requests"
      className="rounded-2xl border bg-card p-4 space-y-4"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
          Requests
          <span className="text-sm font-normal text-muted-foreground">
            ({requests.length})
          </span>
        </h2>
        <PlanVisitButton
          lead={lead}
          label={hasRequests ? 'Plan Another Visit' : 'Plan a Visit'}
        />
      </header>

      {!hasRequests ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center space-y-2">
          <Icon
            name="event_busy"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            No requests yet. Tap <strong>Plan a Visit</strong> to add one.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Request history">
          {requests.map((r) => {
            const variant = STATUS_BADGE_VARIANT[r.statusStageCode] ?? 'outline';
            return (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className={cn(
                    'block rounded-xl border bg-background px-3 py-2.5 shadow-sm',
                    'transition-colors hover:bg-accent/40 active:bg-accent',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium truncate">
                        {r.customerName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.createdAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <Badge variant={variant} className="text-[10px] shrink-0">
                      {r.statusStageName}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                    <Badge variant="secondary" className="text-[10px]">
                      {r.cityName}
                    </Badge>
                    {r.assignedExecName && (
                      <span className="text-muted-foreground">
                        with {r.assignedExecName}
                      </span>
                    )}
                    {r.totalAmountPaise !== null && r.totalAmountPaise > 0 && (
                      <span className="text-muted-foreground font-mono">
                        {rupees(r.totalAmountPaise)}
                      </span>
                    )}
                    {r.orderNumber && (
                      <Badge variant="outline" className="text-[10px]">
                        #{r.orderNumber}
                      </Badge>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
