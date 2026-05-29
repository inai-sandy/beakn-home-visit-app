'use client';

import { useEffect, useRef } from 'react';

import type { InAppNotificationRow } from '@/lib/notifications/in-app-queries';

// HVA-53: poll /api/notifications/poll for fresh activity. Visibility-gated
// so a backgrounded tab doesn't keep hammering the DB. Drawer-gated so we
// stop polling while the user is actively reading the drawer (the drawer
// content already shows what they need).
//
// Tick cadence is fixed at 30 s — fast enough that a captain who just
// assigned a request sees the exec ping within seconds of the next tick,
// slow enough that 100 active execs ≈ 3 polls/sec total on the DB.

const POLL_INTERVAL_MS = 30_000;

interface PollResponse {
  unreadCount: number;
  newItems: InAppNotificationRow[];
  cursor: string;
}

interface Args {
  initialCursor: string;
  drawerOpen: boolean;
  onTick: (response: PollResponse) => void;
}

export function useNotificationPoll({ initialCursor, drawerOpen, onTick }: Args) {
  // Keep the cursor in a ref so the tick closure always sees the latest value
  // without re-creating the interval on every poll. Same for the onTick
  // callback — useEffect deps shouldn't trigger re-bindings.
  const cursorRef = useRef(initialCursor);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  // Drawer state lives in a ref too so the running interval can early-return
  // without resetting itself when the drawer toggles.
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (drawerOpenRef.current) return;
      try {
        const res = await fetch(
          `/api/notifications/poll?since=${encodeURIComponent(cursorRef.current)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as PollResponse;
        if (cancelled) return;
        cursorRef.current = data.cursor;
        onTickRef.current(data);
      } catch {
        // Network failures + AbortError are non-fatal; the next tick retries.
      }
    }

    function startTimer() {
      if (timerId !== null) return;
      timerId = setInterval(poll, POLL_INTERVAL_MS);
    }

    function stopTimer() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopTimer();
      } else {
        // Immediate catch-up tick on tab focus so a returning user sees
        // anything that piled up while away — without waiting 30 s.
        poll();
        startTimer();
      }
    }

    startTimer();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      cancelled = true;
      stopTimer();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, []);
}
