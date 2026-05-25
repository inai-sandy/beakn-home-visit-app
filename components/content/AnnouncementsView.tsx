'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { acknowledgeAnnouncementAction } from '@/lib/content/actions';
import type {
  AnnouncementCategoryRow,
  AnnouncementImportance,
  AnnouncementRow,
} from '@/lib/content/types';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-156-FIX2 + HVA-120: AnnouncementsView read surface
// =============================================================================
//
// Client component shared by exec + captain portals. Renders the flat
// announcement list with:
//   * category dropdown filter
//   * importance dropdown filter
//   * text search box (title / body)
//   * per-row "I've read this" button (calls acknowledgeAnnouncementAction)
//
// Acknowledgement is one-way per HVA-120 §13.1 — after tapping, the button
// flips to "Acknowledged ✓" and stays that way.
// =============================================================================

const ALL = '__all__';

interface Props {
  announcements: AnnouncementRow[];
  categories: AnnouncementCategoryRow[];
  /** Optional per-card overlay rendered in the top-right corner. Admin
   *  passes an Edit/Manage icon-button so the admin list and the team's
   *  read surface share the same card shape. When set, the per-row
   *  Acknowledge button is suppressed (admin manages, doesn't ack) and
   *  the ack rate "X/Y acknowledged" is appended to the metadata line. */
  renderRowOverlay?: (a: AnnouncementRow) => ReactNode;
}

const importanceBadgeClass: Record<AnnouncementImportance, string> = {
  info: 'border-blue-500/40 text-blue-700 dark:text-blue-300',
  important: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  urgent: 'border-destructive/60 text-destructive',
};

const importanceLabel: Record<AnnouncementImportance, string> = {
  info: 'Info',
  important: 'Important',
  urgent: 'Urgent',
};

const importanceCardAccent: Record<AnnouncementImportance, string> = {
  info: '',
  important: 'border-l-4 border-l-amber-500/60',
  urgent: 'border-l-4 border-l-destructive',
};

export function AnnouncementsView({
  announcements,
  categories,
  renderRowOverlay,
}: Props) {
  const adminMode = renderRowOverlay !== undefined;
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [importanceFilter, setImportanceFilter] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [busyAckId, setBusyAckId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return announcements.filter((a) => {
      if (categoryFilter !== ALL && a.categoryId !== categoryFilter) {
        return false;
      }
      if (importanceFilter !== ALL && a.importance !== importanceFilter) {
        return false;
      }
      if (q.length === 0) return true;
      const haystack = `${a.title} ${a.body} ${a.categoryName}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [announcements, categoryFilter, importanceFilter, search]);

  async function onAck(a: AnnouncementRow) {
    if (busyAckId !== null) return;
    setBusyAckId(a.id);
    try {
      const res = await acknowledgeAnnouncementAction({
        announcementId: a.id,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Acknowledged');
      startTransition(() => router.refresh());
    } finally {
      setBusyAckId(null);
    }
  }

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
    <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="sm:w-40">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-11" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-40">
          <Select value={importanceFilter} onValueChange={setImportanceFilter}>
            <SelectTrigger className="h-11" aria-label="Filter by importance">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All importance</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="important">Important</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1">
          <Icon
            name="search"
            size="sm"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search announcements"
            className="h-11 pl-9"
            aria-label="Search announcements"
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {filtered.length} of {announcements.length} announcement
        {announcements.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No announcements match the filter.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((a) => {
            const ackBusy = busyAckId === a.id || isPending;
            return (
              <li
                key={a.id}
                className={cn(
                  'rounded-2xl border bg-card p-4 shadow-sm space-y-2 relative',
                  importanceCardAccent[a.importance],
                )}
              >
                {renderRowOverlay && (
                  <div className="absolute top-3 right-3">
                    {renderRowOverlay(a)}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap pr-10">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] uppercase tracking-wide',
                      importanceBadgeClass[a.importance],
                    )}
                  >
                    {importanceLabel[a.importance]}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {a.categoryName}
                  </Badge>
                  {!a.isPublished && (
                    <Badge variant="outline" className="text-[10px]">
                      Unpublished
                    </Badge>
                  )}
                </div>
                <p className="text-base font-semibold tracking-tight">
                  {a.title}
                </p>
                <p className="text-sm whitespace-pre-line text-foreground/90">
                  {a.body}
                </p>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    {a.authorName ?? '—'} ·{' '}
                    {a.publishDate.toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {adminMode &&
                      a.ackTotal !== null &&
                      a.ackTotal > 0 && (
                        <>
                          {' · '}
                          {a.ackCount ?? 0}/{a.ackTotal} acknowledged
                          {a.ackTotal > 0 &&
                            ` (${Math.round(((a.ackCount ?? 0) / a.ackTotal) * 100)}%)`}
                        </>
                      )}
                  </p>
                  {/* Acknowledge button suppressed in admin context — admin
                      manages from the overlay icon, the team acknowledges. */}
                  {!adminMode &&
                    (a.isAcknowledged ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                        <Icon
                          name="check_circle"
                          size="xs"
                          className="text-emerald-600"
                        />
                        Acknowledged
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onAck(a)}
                        disabled={ackBusy}
                        className="h-9"
                      >
                        {ackBusy ? (
                          <>
                            <Icon
                              name="progress_activity"
                              size="xs"
                              className="animate-spin"
                            />
                            Saving…
                          </>
                        ) : (
                          <>
                            <Icon name="done_all" size="xs" />
                            I've read this
                          </>
                        )}
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
