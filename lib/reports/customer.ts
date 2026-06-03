import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

import type { ReportArgs, ReportResult } from './types';
import { REPORT_PAGE_SIZE } from './types';

// =============================================================================
// Customer / contact reports (35-38)
// =============================================================================

function paginate<T>(rows: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

// 35. New leads per day
interface LeadDayRow {
  bucket: string;
  newLeads: number;
}

export async function reportNewLeads(
  args: ReportArgs,
): Promise<ReportResult<LeadDayRow>> {
  const { fromDate, toDate } = args.range;
  const result = await db.execute<{ bucket: string; cnt: number }>(sql`
    SELECT
      (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS bucket,
      COUNT(*)::int AS cnt
    FROM leads
    WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${fromDate}
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${toDate}
    GROUP BY (created_at AT TIME ZONE 'Asia/Kolkata')::date
  `);
  const raw =
    (result as unknown as { rows?: Array<{ bucket: string; cnt: number }> }).rows
    ?? (result as unknown as Array<{ bucket: string; cnt: number }>);
  const all = (raw ?? []).map<LeadDayRow>((r) => ({
    bucket: r.bucket,
    newLeads: r.cnt,
  }));
  all.sort((a, b) =>
    args.sort?.direction === 'asc'
      ? a.bucket.localeCompare(b.bucket)
      : b.bucket.localeCompare(a.bucket),
  );
  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'newLeads', label: 'New leads', format: 'number', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total new leads', value: String(all.reduce((s, r) => s + r.newLeads, 0)) },
      ],
    },
  };
}

// 36. Lead → request conversion %
interface LeadConvRow {
  bucket: string;
  leads: number;
  converted: number;
  conversionPct: number | null;
}

export async function reportLeadConversion(
  args: ReportArgs,
): Promise<ReportResult<LeadConvRow>> {
  const { fromDate, toDate } = args.range;
  const result = await db.execute<{
    bucket: string;
    leads: number;
    converted: number;
  }>(sql`
    SELECT
      (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS bucket,
      COUNT(*)::int AS leads,
      SUM(CASE WHEN converted_to_request_id IS NOT NULL THEN 1 ELSE 0 END)::int AS converted
    FROM leads
    WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${fromDate}
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${toDate}
    GROUP BY (created_at AT TIME ZONE 'Asia/Kolkata')::date
  `);
  const raw =
    (result as unknown as { rows?: Array<{ bucket: string; leads: number; converted: number }> }).rows
    ?? (result as unknown as Array<{ bucket: string; leads: number; converted: number }>);
  const all = (raw ?? []).map<LeadConvRow>((r) => ({
    bucket: r.bucket,
    leads: r.leads,
    converted: r.converted,
    conversionPct:
      r.leads > 0 ? Math.round((r.converted / r.leads) * 100) : null,
  }));
  all.sort((a, b) =>
    args.sort?.direction === 'asc'
      ? a.bucket.localeCompare(b.bucket)
      : b.bucket.localeCompare(a.bucket),
  );

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const totalLeads = all.reduce((s, r) => s + r.leads, 0);
  const totalConverted = all.reduce((s, r) => s + r.converted, 0);
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'leads', label: 'Leads', format: 'number', align: 'right', sortable: true },
      { key: 'converted', label: 'Converted', format: 'number', align: 'right', sortable: true },
      { key: 'conversionPct', label: 'Conversion %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total leads', value: String(totalLeads) },
        { label: 'Total converted', value: String(totalConverted) },
        {
          label: 'Overall',
          value:
            totalLeads > 0
              ? `${Math.round((totalConverted / totalLeads) * 100)}%`
              : '—',
        },
      ],
    },
  };
}

// 37. Repeat customer count — customers with >1 visit_request
interface RepeatRow {
  customerPhone: string;
  customerName: string;
  requestCount: number;
}

export async function reportRepeatCustomers(
  args: ReportArgs,
): Promise<ReportResult<RepeatRow>> {
  void args;
  const result = await db.execute<{
    customer_phone: string;
    customer_name: string;
    cnt: number;
  }>(sql`
    SELECT
      customer_phone,
      MAX(customer_name) AS customer_name,
      COUNT(*)::int AS cnt
    FROM visit_requests
    WHERE cancelled_at IS NULL
    GROUP BY customer_phone
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `);
  const raw =
    (result as unknown as { rows?: Array<{ customer_phone: string; customer_name: string; cnt: number }> }).rows
    ?? (result as unknown as Array<{ customer_phone: string; customer_name: string; cnt: number }>);
  const all = (raw ?? []).map<RepeatRow>((r) => ({
    customerPhone: r.customer_phone,
    customerName: r.customer_name,
    requestCount: r.cnt,
  }));
  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'customerName', label: 'Customer', format: 'string', align: 'left' },
      { key: 'customerPhone', label: 'Phone', format: 'string', align: 'left' },
      { key: 'requestCount', label: 'Requests', format: 'number', align: 'right' },
    ],
    footer: {
      entries: [
        { label: 'Repeat customers', value: String(all.length) },
        {
          label: 'Total repeat requests',
          value: String(all.reduce((s, r) => s + r.requestCount, 0)),
        },
      ],
    },
  };
}

// 38. Distribution: BHK + Interest + City
interface DistRow {
  dimension: string;
  count: number;
}

export async function reportRequestDistribution(
  args: ReportArgs,
): Promise<ReportResult<DistRow>> {
  const { fromDate, toDate } = args.range;
  const result = await db.execute<{ dimension: string; cnt: number }>(sql`
    SELECT bhk::text AS dimension, COUNT(*)::int AS cnt
    FROM visit_requests
    WHERE cancelled_at IS NULL
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${fromDate}
      AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${toDate}
    GROUP BY bhk
    ORDER BY cnt DESC
  `);
  const raw =
    (result as unknown as { rows?: Array<{ dimension: string; cnt: number }> }).rows
    ?? (result as unknown as Array<{ dimension: string; cnt: number }>);
  const rows = (raw ?? []).map<DistRow>((r) => ({
    dimension: r.dimension,
    count: r.cnt,
  }));
  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'dimension', label: 'BHK', format: 'string', align: 'left' },
      { key: 'count', label: 'Requests', format: 'number', align: 'right' },
    ],
    footer: {
      entries: [
        { label: 'Total', value: String(rows.reduce((s, r) => s + r.count, 0)) },
      ],
    },
  };
}
