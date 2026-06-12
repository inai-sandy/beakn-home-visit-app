import { formatInrFromPaise } from '@/lib/money';

// =============================================================================
// HVA-277: "How is my period?" — the window-driven tile grid
// =============================================================================
//
// EVERY tile here recomputes when the from/to picker changes — that is
// the redesign's acceptance test (Sandeep: "the info has to modify
// every tile when we change the dates"). Presentational only; the page
// loads all values through the SSOT metric registry + window helpers.
//
// Each tile carries a plain-language sublabel of what it counts, so a
// number can never quietly mean something else.
// =============================================================================

interface Props {
  /** Net cash received in the window (inbound − refunds), paise. */
  collectedPaise: number;
  /** Quotation value of orders confirmed in the window, paise. */
  bookedPaise: number;
  /** DISTINCT requests whose visit completed in the window. */
  visitedRequests: number;
  /** DISTINCT requests confirmed in the window. */
  ordersCount: number;
  /** orders ÷ visitedRequests; null when nothing visited. */
  conversionPct: number | null;
  quotationsCount: number;
  contactsCaptured: number;
  tasksDone: number;
  tasksTotal: number;
}

function Tile({
  value,
  label,
  sublabel,
  emphasis,
}: {
  value: string;
  label: string;
  sublabel: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 min-w-0">
      <p
        className={
          emphasis
            ? 'text-2xl font-semibold tracking-tight truncate'
            : 'text-xl font-semibold tracking-tight truncate'
        }
      >
        {value}
      </p>
      <p className="text-sm font-medium mt-0.5">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
        {sublabel}
      </p>
    </div>
  );
}

export function WindowTiles({
  collectedPaise,
  bookedPaise,
  visitedRequests,
  ordersCount,
  conversionPct,
  quotationsCount,
  contactsCaptured,
  tasksDone,
  tasksTotal,
}: Props) {
  return (
    <section aria-label="Your numbers for the selected dates" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          emphasis
          value={formatInrFromPaise(collectedPaise)}
          label="Collected"
          sublabel="Cash received minus refunds"
        />
        <Tile
          emphasis
          value={formatInrFromPaise(bookedPaise)}
          label="Booked"
          sublabel="Value of orders confirmed"
        />
        <Tile
          value={String(visitedRequests)}
          label="Customers visited"
          sublabel="Requests with a completed visit"
        />
        <Tile
          value={String(ordersCount)}
          label="Orders confirmed"
          sublabel="Each request counts once"
        />
        <Tile
          value={conversionPct === null ? '—' : `${conversionPct}%`}
          label="Conversion"
          sublabel={
            conversionPct === null
              ? 'No completed visits in these dates'
              : 'Of customers visited, ordered'
          }
        />
        <Tile
          value={String(quotationsCount)}
          label="Quotations"
          sublabel="Submitted in these dates"
        />
        <Tile
          value={String(contactsCaptured)}
          label="Contacts captured"
          sublabel="New contacts you added"
        />
        <Tile
          value={tasksTotal === 0 ? '—' : `${tasksDone}/${tasksTotal}`}
          label="Tasks done"
          sublabel={
            tasksTotal === 0
              ? 'No tasks dated in these dates'
              : 'Completed of all tasks dated here'
          }
        />
      </div>
    </section>
  );
}
