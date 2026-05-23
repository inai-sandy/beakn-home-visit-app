'use client';

import { useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { markAllAnnouncementsReadAction } from '@/lib/content/actions';
import type {
  AnnouncementRow,
  AnnouncementSeverity,
} from '@/lib/content/types';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-156: AnnouncementsView — read surface shared by both portals
// =============================================================================
//
// Client component because of the mount-effect that fires
// markAllAnnouncementsReadAction once on render. Used by both the exec
// /announcements route and the captain /captain/announcements route.
//
// Per-row read state (`isRead`) is server-rendered; the visible "Unread"
// badge stays accurate for the initial paint. After the mount-effect
// fires, the next layout refetch (via revalidatePath in the action)
// drops the unread count from the drawer badge.
// =============================================================================

interface Props {
  announcements: AnnouncementRow[];
}

const severityBadgeClass: Record<AnnouncementSeverity, string> = {
  info: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  important: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  urgent: 'border-destructive/60 text-destructive',
};

const severityLabel: Record<AnnouncementSeverity, string> = {
  info: 'Info',
  important: 'Important',
  urgent: 'Urgent',
};

const severityCardAccent: Record<AnnouncementSeverity, string> = {
  info: '',
  important: 'border-l-4 border-l-amber-500/60',
  urgent: 'border-l-4 border-l-destructive',
};

export function AnnouncementsView({ announcements }: Props) {
  useEffect(() => {
    // Fire-and-forget. The action is idempotent (ON CONFLICT DO NOTHING)
    // so a fast double-mount during dev is harmless. We don't await the
    // result — the only consumer of the read state is the drawer badge,
    // which updates on the next nav via the action's revalidatePath call.
    void markAllAnnouncementsReadAction();
  }, []);

  if (announcements.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
        <Icon
          name="campaign"
          size="lg"
          className="text-muted-foreground/60 mx-auto mb-3"
          aria-hidden
        />
        <h2 className="text-lg font-semibold tracking-tight">
          No announcements yet
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          When admin broadcasts something to the team, it'll show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {announcements.map((a) => (
        <li
          key={a.id}
          className={cn(
            'rounded-2xl border bg-card p-4 shadow-sm space-y-2',
            severityCardAccent[a.severity],
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] uppercase tracking-wide',
                severityBadgeClass[a.severity],
              )}
            >
              {severityLabel[a.severity]}
            </Badge>
            {!a.isRead && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide border-primary/50 text-primary"
              >
                New
              </Badge>
            )}
          </div>
          <p className="text-base font-semibold tracking-tight">{a.title}</p>
          <p className="text-sm whitespace-pre-line text-foreground/90">
            {a.body}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {a.authorName ?? '—'} ·{' '}
            {a.publishedAt.toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </li>
      ))}
    </ul>
  );
}
