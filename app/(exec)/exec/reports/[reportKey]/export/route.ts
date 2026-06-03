import { NextResponse, type NextRequest } from 'next/server';

import { getServerSession } from '@/lib/auth-server';
import { findReport } from '@/lib/reports/registry';
import { defaultReportRange } from '@/lib/reports/types';
import { getIstDateString } from '@/lib/today/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_EXPORT_ROWS = 5000;

function isValidIstDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ reportKey: string }> },
) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_exec' && user.role !== 'super_admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { reportKey } = await context.params;
  const def = findReport(reportKey);
  if (!def) return NextResponse.json({ error: 'unknown report' }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const istToday = getIstDateString();
  const defaults = defaultReportRange(istToday);
  const fromDate = isValidIstDate(sp.get('from')) ? sp.get('from')! : defaults.fromDate;
  const toDate = isValidIstDate(sp.get('to')) ? sp.get('to')! : defaults.toDate;
  const bucketRaw = sp.get('bucket');
  const bucket: 'day' | 'week' | 'month' =
    bucketRaw === 'day' || bucketRaw === 'week' || bucketRaw === 'month'
      ? bucketRaw
      : def.defaultBucket ?? 'day';
  const sortKey = sp.get('sort') ?? undefined;
  const sortDirection = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const search = (sp.get('q') ?? '').trim();

  const result = await def.load({
    scope: { kind: 'exec', execUserId: user.id },
    range: { fromDate, toDate },
    bucket,
    filters: { search: search.length > 0 ? search : undefined },
    sort: sortKey ? { key: sortKey, direction: sortDirection } : undefined,
    pagination: { page: 1, pageSize: MAX_EXPORT_ROWS },
  });

  const header = result.columns.map((c) => csvEscape(c.label)).join(',');
  const lines = (result.rows as Record<string, unknown>[]).map((row) =>
    result.columns.map((c) => csvEscape(row[c.key] ?? '')).join(','),
  );
  const body = [header, ...lines].join('\n');
  const filename = `${reportKey}_${fromDate}_to_${toDate}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
