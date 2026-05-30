import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { ROLE_HOME, isRole } from '@/lib/auth/roles';
import { loadUserNotificationPreferences } from '@/lib/notifications/preferences';

import { NotificationPreferenceRow } from './_components/NotificationPreferenceRow';

// 2026-05-30: shared notification preferences page for captain + exec +
// admin. Lists every (event_type, channel) the user is eligible for given
// their role; each row toggles a per-user opt-out.
//
// Shared route — not under /captain/* or /admin/* — because the page is
// role-agnostic. Each portal links to it from their drawer/sidebar.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Notification settings — Beakn',
};

// Human-friendly labels per event_type. Add a row here when a new dispatch
// event lands. Falls back to a humanised version of the raw key if missing.
const EVENT_LABELS: Record<string, string> = {
  'request.assigned': 'Request assigned to you',
  'request.approved': 'Captain approved your request',
  'request.rejected': 'Captain rejected your request',
  'request.reassigned': 'Request reassigned',
  'request.rolled_back': 'Request rolled back',
  'request.cancelled_by_customer': 'Customer cancelled their request',
  'request.rescheduled': 'Visit rescheduled',
  'request.created': 'New customer request',
  'request.pending_approval': 'Request needs your approval',
  'request.scheduled': 'Visit scheduled',
};

function humaniseEvent(key: string): string {
  return (
    EVENT_LABELS[key] ??
    key.replace(/^request\./, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

export default async function NotificationSettingsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/profile/notifications');
  const role = (session.user as { role?: string }).role;
  if (!isRole(role)) redirect('/login');

  const prefs = await loadUserNotificationPreferences(session.user.id, role);

  // Group by event_type so users see "for each event, here are the channels".
  const byEvent = new Map<string, typeof prefs>();
  for (const p of prefs) {
    const list = byEvent.get(p.eventType) ?? [];
    list.push(p);
    byEvent.set(p.eventType, list);
  }

  // Fallback when there's no browser history (deep link / fresh tab). Lands
  // on the role's home — captain dashboard, exec /today, admin dashboard.
  const backFallback = ROLE_HOME[role];

  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between gap-2 -ml-2">
          <BackButton
            fallback={backFallback}
            variant="ghost"
            size="sm"
          >
            Back
          </BackButton>
        </div>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Notification settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose how you want to be notified for each event. Toggle off to
            stop receiving that alert.
          </p>
        </header>

        {prefs.length === 0 ? (
          <section className="rounded-3xl border border-dashed bg-card/40 p-10 text-center space-y-3">
            <Icon
              name="notifications_off"
              size="md"
              className="text-muted-foreground mx-auto"
            />
            <p className="text-sm text-muted-foreground">
              You don't currently receive any notifications. If you expected
              this list to show events, ask an admin to seed the appropriate
              notification rules.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            {Array.from(byEvent.entries()).map(([eventType, rows]) => (
              <article
                key={eventType}
                className="rounded-3xl border bg-card p-4 sm:p-5 space-y-3"
              >
                <header className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold tracking-tight">
                    {humaniseEvent(eventType)}
                  </h2>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {eventType}
                  </Badge>
                </header>
                <div className="space-y-2">
                  {rows.map((row) => (
                    <NotificationPreferenceRow
                      key={`${row.eventType}|${row.channel}`}
                      eventType={row.eventType}
                      channel={row.channel}
                      initialEnabled={row.enabled}
                      label={humaniseEvent(row.eventType)}
                    />
                  ))}
                </div>
              </article>
            ))}
          </section>
        )}

        <section className="rounded-3xl border border-dashed bg-card/40 p-4 text-xs text-muted-foreground space-y-1">
          <p>
            <strong>In-app</strong> = the bell drawer + toast at the top of
            the page.
          </p>
          <p>
            <strong>Browser push</strong> = OS-level notification when the
            app is closed or in the background. Requires opt-in via the bell
            drawer's "Enable push" button.
          </p>
          <p>
            <strong>Email</strong> = sent to the address on your account.
          </p>
        </section>
      </div>
    </main>
  );
}
