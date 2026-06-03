import Link from 'next/link';

import { cn } from '@/lib/utils';

import type { ReportColumn } from '@/lib/reports/types';

// =============================================================================
// Universal report table renderer
// =============================================================================
//
// Every report's loader returns rows + a column schema describing how
// to format each cell. This component reads the schema and renders the
// table — same look across all 44 reports.
//
// Column.format dispatch:
//   - 'string'         → plain text
//   - 'number'         → Intl en-IN locale
//   - 'percent'        → `${n}%` or `—` for null
//   - 'currency_paise' → formatInrFromPaise; signed values handled
//   - 'date'           → '02 Jun 2026' (already an IST YYYY-MM-DD)
//   - 'datetime'       → '02 Jun 2026, 04:30 PM' (timestamptz string)
//   - 'days'           → '5d' / '12d'
//   - linksToRequest   → wraps the cell value in /requests/<id>
// =============================================================================

function formatInrFromPaise(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? '-' : '';
  return `${sign}${new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.abs(rupees))}`;
}

function formatCell(value: unknown, format: ReportColumn['format']): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'number':
      return new Intl.NumberFormat('en-IN').format(Number(value));
    case 'percent':
      return `${value}%`;
    case 'currency_paise':
      return formatInrFromPaise(Number(value));
    case 'date': {
      const v = String(value);
      const [y, m, d] = v.split('-').map(Number);
      if (!y || !m || !d) return v;
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    case 'datetime':
      try {
        return new Date(String(value)).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        });
      } catch {
        return String(value);
      }
    case 'days':
      return `${value}d`;
    default:
      return String(value);
  }
}

interface Props {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export function ReportTable({ columns, rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border bg-muted/30 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No rows for the selected filters and date range.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'py-2.5 px-4 whitespace-nowrap',
                    c.align === 'right'
                      ? 'text-right'
                      : c.align === 'center'
                        ? 'text-center'
                        : 'text-left',
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-muted/30">
                {columns.map((c) => {
                  const raw = row[c.key];
                  const text = formatCell(raw, c.format);
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        'py-3 px-4 whitespace-nowrap',
                        c.align === 'right'
                          ? 'text-right tabular-nums'
                          : c.align === 'center'
                            ? 'text-center'
                            : 'text-left',
                      )}
                    >
                      {c.linksToRequest && typeof raw === 'string' ? (
                        <Link
                          href={`/requests/${raw}`}
                          className="text-primary hover:underline"
                        >
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
