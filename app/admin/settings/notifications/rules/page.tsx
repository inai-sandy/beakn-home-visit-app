import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { db } from '@/db/client';
import { notificationRules } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';

import { RuleToggle } from './_components/RuleToggle';

// =============================================================================
// HVA-50: /admin/settings/notifications/rules — toggle notification rules
// =============================================================================
//
// Reads `notification_rules`, groups by event_type, renders a table per
// event with one row per (channel, recipient_role) and a switch toggling
// `enabled`. The engine reads only enabled=true rules, so toggling here
// directly changes what fires in prod.
//
// Body composition still lives in code (lib/notifications/compose/*) —
// `template_key` is shown but read-only for now (admin-edit comes in a
// later ticket when body composition moves to the DB).
// =============================================================================

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

export default async function NotificationRulesAdminPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/notifications/rules');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const rows = await db
    .select({
      id: notificationRules.id,
      eventType: notificationRules.eventType,
      channel: notificationRules.channel,
      recipientRole: notificationRules.recipientRole,
      enabled: notificationRules.enabled,
      templateKey: notificationRules.templateKey,
    })
    .from(notificationRules)
    .orderBy(
      asc(notificationRules.eventType),
      asc(notificationRules.channel),
      asc(notificationRules.recipientRole),
    );

  const grouped = new Map<string, RuleRow[]>();
  for (const r of rows) {
    if (!grouped.has(r.eventType)) grouped.set(r.eventType, []);
    grouped.get(r.eventType)!.push(r);
  }

  const enabledCount = rows.filter((r) => r.enabled).length;
  const totalCount = rows.length;

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
            {enabledCount} of {totalCount} rules enabled. Toggle a switch to
            change what fires.
          </p>
        </header>

        {totalCount === 0 ? (
          <div className="rounded-3xl border bg-muted/40 p-10 text-center">
            <Icon name="rule" size="lg" className="text-muted-foreground/70 mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">
              No notification rules seeded yet.
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
      </div>
    </main>
  );
}
