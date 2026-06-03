import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { Pagination } from '@/components/lists/Pagination';
import { ReportFiltersBar } from '@/components/reports/ReportFiltersBar';
import { ReportTable } from '@/components/reports/ReportTable';
import { ReportBucketToggle } from '@/components/reports/ReportBucketToggle';
import { ReportSortHeader } from '@/components/reports/ReportSortHeader';
import { getServerSession } from '@/lib/auth-server';
import { parsePage } from '@/lib/pagination';
import { findReport } from '@/lib/reports/registry';
import { defaultReportRange, REPORT_PAGE_SIZE } from '@/lib/reports/types';
import { getIstDateString } from '@/lib/today/time';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ reportKey: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { reportKey } = await params;
  const def = findReport(reportKey);
  return { title: def ? `${def.title} — My reports` : 'Report' };
}

function parseBucket(
  raw: string | undefined,
  fallback: 'day' | 'week' | 'month' = 'day',
): 'day' | 'week' | 'month' {
  if (raw === 'day' || raw === 'week' || raw === 'month') return raw;
  return fallback;
}

function isValidIstDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function ExecReportDetailPage({ params, searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) {
    const { reportKey } = await params;
    redirect(`/login?next=/exec/reports/${reportKey}`);
  }
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_exec' && user.role !== 'super_admin') redirect('/login');

  const { reportKey } = await params;
  const def = findReport(reportKey);
  if (!def) notFound();

  const sp = await searchParams;
  const istToday = getIstDateString();
  const defaults = defaultReportRange(istToday);
  const fromDate = isValidIstDate(sp.from) ? sp.from : defaults.fromDate;
  const toDate = isValidIstDate(sp.to) ? sp.to : defaults.toDate;
  const bucket = parseBucket(sp.bucket, def.defaultBucket ?? 'day');
  const sortKey = sp.sort;
  const sortDirection = sp.dir === 'asc' ? 'asc' : 'desc';
  const page = parsePage(sp.page);
  const search = (sp.q ?? '').trim();

  const result = await def.load({
    scope: { kind: 'exec', execUserId: user.id },
    range: { fromDate, toDate },
    bucket,
    filters: { search: search.length > 0 ? search : undefined },
    sort: sortKey ? { key: sortKey, direction: sortDirection } : undefined,
    pagination: { page, pageSize: REPORT_PAGE_SIZE },
  });

  const totalPages = Math.max(1, Math.ceil(result.total / REPORT_PAGE_SIZE));
  const fromIdx = result.total === 0 ? 0 : (page - 1) * REPORT_PAGE_SIZE + 1;
  const toIdx = Math.min(page * REPORT_PAGE_SIZE, result.total);

  const exportParams = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(sp).filter(([, v]) => typeof v === 'string'),
    ),
    from: fromDate,
    to: toDate,
    bucket,
  } as Record<string, string>);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link
          href="/exec/reports"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="arrow_back" size="xs" />
          All reports
        </Link>
        <Link
          href={`/exec/reports/${reportKey}/export?${exportParams.toString()}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded-full border px-3 py-1.5 hover:bg-accent transition-colors"
        >
          <Icon name="download" size="xs" />
          Export CSV
        </Link>
      </div>

      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
          Reports · {def.category}
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{def.title}</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">{def.blurb}</p>
      </header>

      <ReportFiltersBar
        fromDate={fromDate}
        toDate={toDate}
        captainUserId="all"
        execUserId="all"
        cityId="all"
        search={search}
        basePath={`/exec/reports/${reportKey}`}
      />

      {def.defaultBucket && (
        <ReportBucketToggle active={bucket} basePath={`/exec/reports/${reportKey}`} />
      )}

      <ReportSortHeader
        columns={result.columns}
        activeKey={sortKey}
        direction={sortDirection}
        basePath={`/exec/reports/${reportKey}`}
      />

      <ReportTable
        columns={result.columns}
        rows={result.rows as Record<string, unknown>[]}
      />

      {result.footer && (
        <section
          aria-label="Aggregate totals"
          className="rounded-2xl border bg-card p-4 space-y-2"
        >
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            Aggregate totals
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {result.footer.entries.map((e) => (
              <div key={e.label} className="space-y-0.5">
                <dt className="text-[11px] text-muted-foreground">{e.label}</dt>
                <dd className="text-base font-semibold tabular-nums">{e.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {totalPages > 1 && (
        <Pagination
          pathname={`/exec/reports/${reportKey}`}
          page={page}
          totalPages={totalPages}
          from={fromIdx}
          to={toIdx}
          total={result.total}
        />
      )}
    </main>
  );
}
