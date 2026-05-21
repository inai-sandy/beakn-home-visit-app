import type { ExecLeadsBreakdown } from '@/lib/captain/exec-drill-queries';

// =============================================================================
// HVA-167: Leads Enrolled — 2-bucket × 2-type matrix
// =============================================================================
//
// D4: leads have no status column. Only two truthful buckets — converted
// (`convertedToRequestId IS NOT NULL`) and not-yet-converted. Split by
// leads.type ('Customer' | 'Business'). Four numbers total.
// =============================================================================

interface Props {
  data: ExecLeadsBreakdown;
}

export function LeadsEnrolledCard({ data }: Props) {
  const total =
    data.business.converted +
    data.business.notYetConverted +
    data.customer.converted +
    data.customer.notYetConverted;
  return (
    <section
      aria-label="Total leads enrolled"
      className="rounded-2xl border bg-card p-4 space-y-3"
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight">
          Total Leads Enrolled
        </h2>
        <p className="text-xs text-muted-foreground">{total} total</p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Bucket
          label="Business"
          converted={data.business.converted}
          notYet={data.business.notYetConverted}
        />
        <Bucket
          label="Customer"
          converted={data.customer.converted}
          notYet={data.customer.notYetConverted}
        />
      </div>
    </section>
  );
}

function Bucket({
  label,
  converted,
  notYet,
}: {
  label: string;
  converted: number;
  notYet: number;
}) {
  return (
    <div className="rounded-xl border bg-background p-3 space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <dl className="space-y-1 text-sm">
        <Row label="Converted" value={converted} />
        <Row label="Not yet converted" value={notYet} muted />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className={muted ? 'text-xs text-muted-foreground' : 'text-xs'}>
        {label}
      </dt>
      <dd className="text-sm font-semibold tracking-tight">{value}</dd>
    </div>
  );
}
