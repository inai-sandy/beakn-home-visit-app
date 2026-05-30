'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Icon } from '@/components/ui/icon';

// HVA-56: Top-of-viewport banner when the browser reports offline.
// Auto-disappears on reconnect + fires a reconnect toast so the user
// knows their next action will sync.

export function OfflineBanner() {
  // Default to true (online). If the user loads the page already offline,
  // the effect below flips it on mount via the initial navigator.onLine read.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      toast.success('Back online', {
        description: 'Your next actions will go through normally.',
        duration: 3000,
      });
    }
    function handleOffline() {
      setOnline(false);
    }

    // Sync initial state in case the page loaded already offline.
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      setOnline(navigator.onLine);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-100"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-center gap-2 text-sm">
        <Icon name="wifi_off" size="sm" />
        <p className="min-w-0 truncate">
          You're offline. Some actions will sync when you reconnect.
        </p>
      </div>
    </div>
  );
}
