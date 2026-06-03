// =============================================================================
// Reports framework — shared types
// =============================================================================
//
// Sandeep 2026-06-03: 44-report build. Same SSOT calc discipline as
// `lib/metrics/*`: net inbound − outbound on revenue, IST timezone
// wrap on every timestamptz date cast, DISTINCT request_id on status-
// history joins, attribution always via visit_requests.assigned_exec.
//
// Every report accepts:
//   - scope:   global / captain-team / exec-self
//   - range:   IST date range (inclusive both ends)
//   - filter:  optional per-report dimension filters (city, exec, etc.)
//   - sort:    server-side sort key + direction
//   - page:    1-based pagination
// =============================================================================

export type ReportScope =
  | { kind: 'global' }
  | { kind: 'captain'; captainUserId: string }
  | { kind: 'exec'; execUserId: string };

export interface ReportRange {
  fromDate: string; // YYYY-MM-DD (IST)
  toDate: string; // YYYY-MM-DD (IST)
}

/** Bucketing for trend-style reports. */
export type ReportBucket = 'day' | 'week' | 'month';

export interface ReportFilters {
  /** Captain user id to narrow to that captain's team (only meaningful
   *  when scope.kind === 'global'). */
  captainUserId?: string;
  /** Exec user id (only meaningful when scope.kind === 'global' or
   *  'captain'). */
  execUserId?: string;
  /** City id. */
  cityId?: string;
  /** Free-text search across the report's "primary" string column
   *  (customer name / exec name / etc.) — implementation per report. */
  search?: string;
}

/** Server-side sort. */
export interface ReportSort {
  /** Column key as exposed by the report. */
  key: string;
  direction: 'asc' | 'desc';
}

export interface ReportPagination {
  page: number; // 1-based
  pageSize: number; // default 50
}

/** Common args passed to every report loader. */
export interface ReportArgs {
  scope: ReportScope;
  range: ReportRange;
  filters?: ReportFilters;
  sort?: ReportSort;
  pagination?: ReportPagination;
  /** When set, the loader returns rows bucketed by this granularity
   *  (for trend reports). Other reports may ignore it. */
  bucket?: ReportBucket;
}

/** What a report loader returns. */
export interface ReportResult<TRow> {
  rows: TRow[];
  total: number;
  /** Schema for the table view — column key, label, alignment, format. */
  columns: ReportColumn[];
  /** Aggregate footer values shown beneath the table. */
  footer?: ReportFooter;
}

export interface ReportColumn {
  key: string;
  label: string;
  /** How the cell formats this column's value. The page component
   *  renders accordingly. */
  format:
    | 'string'
    | 'number'
    | 'percent'
    | 'currency_paise'
    | 'date'
    | 'datetime'
    | 'days';
  align?: 'left' | 'right' | 'center';
  /** Whether the column is sortable server-side. */
  sortable?: boolean;
  /** When true, this column is wrapped in a Link to /requests/<value>
   *  (the column's value is treated as a request id). Convenience for
   *  drill-down rows. */
  linksToRequest?: boolean;
}

export interface ReportFooter {
  /** Label → value pairs. Values pre-formatted as strings. */
  entries: Array<{ label: string; value: string }>;
}

/** Default page size. */
export const REPORT_PAGE_SIZE = 50;

/** Last-30-days IST default range. */
export function defaultReportRange(istToday: string): ReportRange {
  const [y, m, d] = istToday.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - 29));
  const fromDate = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
  return { fromDate, toDate: istToday };
}
