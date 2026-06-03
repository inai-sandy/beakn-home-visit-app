import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { Pagination } from '@/components/lists/Pagination';
import {
  fetchTeamContacts,
  loadCaptainTeamExecOptions,
  loadCaptainTeamUserIds,
} from '@/lib/captain/contacts-queries';
import { computePageRange, parsePage } from '@/lib/pagination';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacts — Beakn admin',
};

interface PageProps {
  params: Promise<{ captainId: string }>;
  searchParams: Promise<{
    q?: string;
    exec?: string;
    type?: string;
    page?: string;
  }>;
}

export default async function AdminPortalContactsPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = await params;
  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const execFilterParam = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const typeRaw = sp.type;
  const typeFilter =
    typeRaw === 'Customer' || typeRaw === 'Business' ? typeRaw : undefined;
  const page = parsePage(sp.page);

  const [teamUserIds, teamExecs] = await Promise.all([
    loadCaptainTeamUserIds(captainId),
    loadCaptainTeamExecOptions(captainId),
  ]);
  const teamSet = new Set(teamUserIds);
  const execFilter =
    execFilterParam && teamSet.has(execFilterParam) ? execFilterParam : undefined;

  const { rows, total } = await fetchTeamContacts({
    teamUserIds,
    search: search.length > 0 ? search : undefined,
    typeFilter,
    execFilter,
    page,
    pageSize: 50,
  });

  const range = computePageRange({ total, page, pageSize: 50 });
  const basePath = `/admin/portal/${captainId}/contacts`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Captured by this captain&apos;s team. Filter + paginate the same as
          the captain view.
        </p>
      </header>
      <ViewOnlyNotice />

      <form
        method="GET"
        action={basePath}
        className="rounded-2xl border bg-card p-3 grid grid-cols-1 sm:grid-cols-4 gap-3"
      >
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Search
          </span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Name, phone, city, firm…"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Exec
          </span>
          <select
            name="exec"
            defaultValue={execFilter ?? 'all'}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All execs</option>
            {teamExecs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Type
          </span>
          <select
            name="type"
            defaultValue={typeFilter ?? 'all'}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All types</option>
            <option value="Customer">Customer</option>
            <option value="Business">Business</option>
          </select>
        </label>
        <div className="sm:col-span-4 flex justify-end gap-2">
          <Link
            href={basePath}
            className="h-10 px-4 rounded-md border text-sm font-medium hover:bg-accent inline-flex items-center"
          >
            Reset
          </Link>
          <button
            type="submit"
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Apply
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <Icon
            name="person_off"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground mt-3">
            {search.length > 0 || execFilter || typeFilter
              ? 'No contacts match the current filter.'
              : 'No contacts captured by this team yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Contacts">
          {rows.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight truncate">
                  {c.name}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {c.phone}
                  {c.firmName ? ` · ${c.firmName}` : ''}
                  {c.cityName ? ` · ${c.cityName}` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Captured by {c.capturedByName ?? 'Unknown'} · {c.type}
                  {c.convertedAt ? ' · converted' : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {range.totalPages > 1 && (
        <Pagination
          pathname={basePath}
          page={page}
          totalPages={range.totalPages}
          from={range.offset + 1}
          to={Math.min(range.offset + range.pageSize, total)}
          total={total}
        />
      )}
    </div>
  );
}
