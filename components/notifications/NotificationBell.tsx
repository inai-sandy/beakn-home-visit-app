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
  unreadCount,
  initialNotifications,
  triggerClassName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(initialNotifications);
  const [isPending, startTransition] = useTransition();

  function onItemClick(item: InAppNotificationRow) {
    // Optimistically mark this item read in the local list so the dot
    // disappears immediately. The Server Action settles the DB; we revalidate
    // the layout after so the bell badge refreshes.
    if (item.readAt === null) {
      setItems((prev) =>
        prev.map((r) =>
          r.id === item.id ? { ...r, readAt: new Date() } : r,
        ),
      );
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
