'use client';

import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/notifications/in-app-actions';
import type { InAppNotificationRow } from '@/lib/notifications/in-app-queries';
import { cn } from '@/lib/utils';

import { getEventTypeIcon } from './event-type-icon';
import { PushSubscribeToggle } from './PushSubscribeToggle';
import { useNotificationPoll } from './use-notification-poll';

// HVA-53: cap how many new items get individual toasts on a single tick. A
// quiet day = at most 1; a noisy day (multiple rules fire on one event) =
// the user sees one toast per item up to this cap, then a summary toast.
const MAX_TOASTS_PER_TICK = 3;

// HVA-52: Reusable in-app notification bell.
//
// Server passes:
//   - `unreadCount` for the badge
//   - `initialNotifications` for the drawer's initial paint (so the user
//     sees content immediately when they tap)
//
// Subsequent updates ride on the layout-level `revalidatePath('/', 'layout')`
// emitted by the mark-as-read actions. HVA-53 layers a polling tick on top
// to push fresher state without a full nav; HVA-55 (Phase 2) swaps SSE in.
//
// Reused by both exec and captain — no role-specific wiring lives here.

interface Props {
  unreadCount: number;
  initialNotifications: InAppNotificationRow[];
  triggerClassName?: string;
}

export function NotificationBell({
  unreadCount: initialUnreadCount,
  initialNotifications,
  triggerClassName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();

  // HVA-53: poll-driven live updates. Initial cursor is the newest item the
  // server already gave us (+1ms baked in by the route handler when the
  // initial fetch happens; here we approximate with new Date().toISOString()
  // since the SSR payload doesn't carry an explicit cursor).
  useNotificationPoll({
    initialCursor:
      items.length > 0
        ? new Date(items[0].createdAt.getTime() + 1).toISOString()
        : new Date().toISOString(),
    drawerOpen: open,
    onTick: (response) => {
      // Always reconcile the badge — even on a quiet tick the unread count
      // may have changed (e.g. user marked items read in another tab).
      setUnreadCount(response.unreadCount);
      if (response.newItems.length === 0) return;
      // Prepend the new items into the local list, capped at 50 so the
      // drawer doesn't grow unbounded between full reloads.
      setItems((prev) => {
        const merged = [...response.newItems, ...prev];
        return merged.slice(0, 50);
      });
      // Fire toasts. One toast per item up to the cap; if we got more, a
      // single summary toast captures the rest so the user knows there's
      // more in the drawer.
      const toShow = response.newItems.slice(0, MAX_TOASTS_PER_TICK);
      for (const item of toShow) {
        toast(item.title, {
          description: item.body,
          action: item.linkUrl
            ? {
                label: 'Open',
                onClick: () => {
                  router.push(item.linkUrl!);
                },
              }
            : undefined,
        });
      }
      const remaining = response.newItems.length - toShow.length;
      if (remaining > 0) {
        toast(`${remaining} more notification${remaining === 1 ? '' : 's'}`, {
          description: 'Open the bell to see them all.',
        });
      }
    },
  });

  function onItemClick(item: InAppNotificationRow) {
    // Optimistically mark this item read in the local list so the dot + the
    // bell badge update immediately. The Server Action settles the DB; the
    // next poll tick reconciles.
    if (item.readAt === null) {
      setItems((prev) =>
        prev.map((r) =>
          r.id === item.id ? { ...r, readAt: new Date() } : r,
        ),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    startTransition(async () => {
      const result = await markNotificationReadAction(item.id);
      if (!result.ok) {
        toast.error('Could not mark as read');
      }
      if (item.linkUrl) {
        setOpen(false);
        router.push(item.linkUrl);
      }
    });
  }

  function onMarkAllRead() {
    if (items.every((r) => r.readAt !== null)) return;
    setItems((prev) =>
      prev.map((r) =>
        r.readAt === null ? { ...r, readAt: new Date() } : r,
      ),
    );
    setUnreadCount(0);
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        toast.error('Could not mark all as read');
      }
    });
  }

  const displayedCount = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
          className={cn('relative h-10 w-10', triggerClassName)}
        >
          <Icon name="notifications" size="sm" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-semibold tabular-nums flex items-center justify-center px-1"
              aria-hidden
            >
              {displayedCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-5 py-4 border-b">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription className="sr-only">
            Recent notifications for your account.
          </SheetDescription>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              {unreadCount} unread
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0 || isPending}
              className="h-7 px-2 text-xs"
            >
              Mark all as read
            </Button>
          </div>
          {/* HVA-54: opt-in/out toggle for browser push notifications. Renders
              null on unsupported browsers (no PushManager / SW). */}
          <div className="pt-2">
            <PushSubscribeToggle />
          </div>
        </SheetHeader>

        <div className="overflow-y-auto h-[calc(100vh-128px)]">
          {items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const unread = item.readAt === null;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onItemClick(item)}
                      className={cn(
                        'w-full text-left px-5 py-3 flex gap-3 transition-colors hover:bg-accent/40',
                        unread && 'bg-primary/5',
                      )}
                      disabled={isPending}
                    >
                      <div className="shrink-0 pt-0.5">
                        <Icon
                          name={getEventTypeIcon(item.eventType)}
                          size="sm"
                          className={
                            unread ? 'text-primary' : 'text-muted-foreground'
                          }
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p
                          className={cn(
                            'text-sm leading-snug truncate',
                            unread ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.body}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(item.createdAt, {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      {unread && (
                        <span
                          className="shrink-0 self-center h-2 w-2 rounded-full bg-primary"
                          aria-label="Unread"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="px-5 py-3 border-t text-center">
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Showing {items.length} most recent
            </Badge>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
