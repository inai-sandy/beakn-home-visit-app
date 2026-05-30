'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Icon } from '@/components/ui/icon';
import { setNotificationPreferenceAction } from '@/lib/notifications/preferences';
import type { PreferenceChannel } from '@/lib/notifications/preferences';
import { cn } from '@/lib/utils';

// 2026-05-30: per-row toggle for /profile/notifications. Optimistic update;
// server settles via setNotificationPreferenceAction.

interface Props {
  eventType: string;
  channel: PreferenceChannel;
  initialEnabled: boolean;
  label: string;
}

const CHANNEL_LABEL: Record<PreferenceChannel, string> = {
  in_app: 'In-app',
  push: 'Browser push',
  email: 'Email',
};

const CHANNEL_ICON: Record<PreferenceChannel, string> = {
  in_app: 'notifications',
  push: 'notifications_active',
  email: 'mail',
};

export function NotificationPreferenceRow({
  eventType,
  channel,
  initialEnabled,
  label,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  function onToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await setNotificationPreferenceAction({
        eventType,
        channel,
        enabled: next,
      });
      if (!result.ok) {
        setEnabled(!next);
        toast.error('Could not update preference');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPending}
      className={cn(
        'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-card text-left transition-colors',
        'hover:bg-accent/40',
        !enabled && 'opacity-70',
      )}
      aria-pressed={enabled}
      aria-label={`${label} via ${CHANNEL_LABEL[channel]}, ${enabled ? 'enabled' : 'disabled'}`}
    >
      <span className="inline-flex items-center gap-3 min-w-0">
        <Icon
          name={CHANNEL_ICON[channel]}
          size="sm"
          className={enabled ? 'text-primary' : 'text-muted-foreground'}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate">{label}</span>
          <span className="block text-xs text-muted-foreground">
            {CHANNEL_LABEL[channel]}
          </span>
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 inline-flex items-center h-6 w-11 rounded-full transition-colors',
          enabled ? 'bg-primary' : 'bg-muted',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'h-5 w-5 rounded-full bg-background shadow transition-transform',
            enabled ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
