import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/lists/Pagination';
import { Icon } from '@/components/ui/icon';
import { db } from '@/db/client';
import { notificationRules } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { computePageRange, parsePage } from '@/lib/pagination';

import { RuleToggle } from './_components/RuleToggle';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Notification rules — Beakn admin',
};

interface RuleRow {
  id: string;
  eventType: string;
  channel: string;
  recipientRole: string;
  enabled: boolean;
  templateKey: string | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  in_app: 'In-app',
  push: 'Push',
  sms: 'SMS',
};

const RECIPIENT_LABELS: Record<string, string> = {
  customer: 'Customer',
  exec_assigned: 'Assigned exec',
  exec: 'Exec',
  captain_owning_city: 'Captain (city)',
  captain: 'Captain',
  super_admin: 'Super admin',
};

function eventTypeLabel(eventType: string): string {
  return eventType
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '))
    .join(' · ');
}

interface PageProps {
  searchParams: Promise<{
    q?: string;
    event?: string;
    channel?: string;
    page?: string;
  }>;
}

export default async function NotificationRulesAdminPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/notifications/rules');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const eventFilter = sp.event && sp.event !== 'all' ? sp.event : undefined;
  const channelFilter =
    sp.channel && sp.channel !== 'all' ? sp.channel : undefined;
  const page = parsePage(sp.page);
  const PAGE_SIZE = 50;
  const basePath = '/admin/settings/notifications/rules';

  const wherePredicate = and(
    eventFilter ? eq(notificationRules.eventType, eventFilter) : undefined,
    channelFilter ? eq(notificationRules.channel, channelFilter) : undefined,
    search.length > 0
      ? or(
          ilike(notificationRules.eventType, `%${search}%`),
          ilike(notificationRules.recipientRole, `%${search}%`),
          ilike(notificationRules.templateKey, `%${search}%`),
        )
      : undefined,
  );

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(notificationRules)
    .where(wherePredicate);

  const range = computePageRange({ total, page, pageSize: PAGE_SIZE });

  const rows: RuleRow[] = await db
    .select({
      id: notificationRules.id,
      eventType: notificationRules.eventType,
      channel: notificationRules.channel,
      recipientRole: notificationRules.recipientRole,
      enabled: notificationRules.enabled,
      templateKey: notificationRules.templateKey,
    })
    .from(notificationRules)
    .where(wherePredicate)
    .orderBy(
      asc(notificationRules.eventType),
      asc(notificationRules.channel),
      asc(notificationRules.recipientRole),
    )
    .limit(range.pageSize)
    .offset(range.offset);

  // For the event_type + channel dropdowns, load the full distinct set
  // (small, ~10 events × 5 channels — cheap one-time query).
  const eventOptions = await db
    .selectDistinct({ value: notificationRules.eventType })
    .from(notificationRules)
    .orderBy(asc(notificationRules.eventType));
  const channelOptions = await db
    .selectDistinct({ value: notificationRules.channel })
    .from(notificationRules)
    .orderBy(asc(notificationRules.channel));

  const grouped = new Map<string, RuleRow[]>();
  for (const r of rows) {
    if (!grouped.has(r.eventType)) grouped.set(r.eventType, []);
    grouped.get(r.eventType)!.push(r);
  }

  const enabledCount = rows.filter((r) => r.enabled).length;
  const showingCount = rows.length;

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Settings · Notifications
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Notification rules
          </h1>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? 'No notification rules match the current filter.'
              : `${enabledCount} of ${showingCount} shown on this page enabled · ${total} total match${total === 1 ? '' : 'es'}.`}
          </p>
        </header>

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
              placeholder="Event, recipient, template…"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Event type
            </span>
            <select
              name="event"
              defaultValue={eventFilter ?? 'all'}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All events</option>
              {eventOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Channel
            </span>
            <select
              name="channel"
              defaultValue={channelFilter ?? 'all'}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All channels</option>
              {channelOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {CHANNEL_LABELS[o.value] ?? o.value}
                </option>
              ))}
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

        {total === 0 ? (
          <div className="rounded-3xl border bg-muted/40 p-10 text-center">
            <Icon name="rule" size="lg" className="text-muted-foreground/70 mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">
              {search.length > 0 || eventFilter || channelFilter
                ? 'No rules match the current filter.'
                : 'No notification rules seeded yet.'}
            </p>
          </div>
        ) : (
          <section className="space-y-6">
            {Array.from(grouped.entries()).map(([eventType, eventRows]) => {
              const enabledInGroup = eventRows.filter((r) => r.enabled).length;
              return (
                <div key={eventType} className="rounded-2xl border bg-card overflow-hidden">
                  <header className="px-4 py-3 border-b bg-muted/30 flex items-baseline justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold tracking-tight">
                        {eventTypeLabel(eventType)}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {eventType}
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {enabledInGroup} / {eventRows.length} on
                    </p>
                  </header>
                  <ul className="divide-y">
                    {eventRows.map((r) => (
                      <li
                        key={r.id}
                        className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {CHANNEL_LABELS[r.channel] ?? r.channel} →{' '}
                            {RECIPIENT_LABELS[r.recipientRole] ?? r.recipientRole}
                          </p>
                          {r.templateKey && (
                            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              template: {r.templateKey}
                            </p>
                          )}
                        </div>
                        <RuleToggle
                          ruleId={r.id}
                          enabled={r.enabled}
                          label={`${r.eventType} ${r.channel} ${r.recipientRole}`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
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
    </main>
  );
}
