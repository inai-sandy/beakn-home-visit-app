'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

// 2026-05-30: first-time prompt banner asking the user to enable Web Push.
//
// Shown ONCE per browser, at the top of authenticated layouts. Hides when:
//   - The user grants permission (subscription succeeds)
//   - The user clicks "Not now" (localStorage flag set)
//   - The browser already returned 'denied' (we can't re-prompt)
//   - The browser doesn't support PushManager / Notifications / Service Worker
//
// Designed to be non-intrusive: no modal, no overlay. Just a slim banner
// the user can ignore. Once dismissed, we never show it again on this
// browser unless localStorage is cleared.

const DISMISS_KEY = 'beakn.pushPromptDismissed';

type State =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'show' };

function base64UrlToArrayBuffer(base64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buf;
}

export function PushPromptBanner() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        setState({ kind: 'hidden' });
        return;
      }
      // If the user already dismissed, never show again on this browser.
      try {
        if (window.localStorage.getItem(DISMISS_KEY) === '1') {
          setState({ kind: 'hidden' });
          return;
        }
      } catch {
        // localStorage blocked (private mode + Safari sometimes). Still
        // try to render — the user can hit Not now to dismiss inline.
      }
      const perm = Notification.permission;
      if (perm !== 'default') {
        // Already granted or denied — no point prompting.
        setState({ kind: 'hidden' });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) return;
      if (sub) {
        // Already subscribed (probably via the bell). Don't prompt.
        setState({ kind: 'hidden' });
        return;
      }
      setState({ kind: 'show' });
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Ignore — banner just won't re-suppress next reload.
    }
    setState({ kind: 'hidden' });
  }

  async function onEnable() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      toast.error('Server is missing VAPID public key. Tell an admin.');
      return;
    }
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          // Treat denied + 'default' (closed without granting) as dismissals.
          dismiss();
          if (permission === 'denied') {
            toast.error("Push permission denied. You can re-enable from the browser's site settings.");
          }
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToArrayBuffer(publicKey),
        });
        const json = subscription.toJSON() as {
          endpoint: string;
          keys?: { p256dh?: string; auth?: string };
        };
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          await subscription.unsubscribe();
          toast.error('Push subscription returned an incomplete payload.');
          return;
        }
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          }),
        });
        if (!res.ok) {
          await subscription.unsubscribe();
          toast.error('Could not save subscription. Try again later.');
          return;
        }
        toast.success('Browser notifications enabled');
        // Dismiss so we never re-show on this browser even if the user
        // later unsubscribes from the bell drawer.
        dismiss();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'subscribe_failed';
        toast.error(`Could not enable: ${msg}`);
      }
    });
  }

  if (state.kind !== 'show') return null;

  return (
    <div
      role="region"
      aria-label="Enable push notifications"
      className="border-b bg-primary/5 px-4 sm:px-6 py-3"
    >
      <div className="mx-auto max-w-5xl flex items-center gap-3">
        <Icon
          name="notifications_active"
          size="sm"
          className="text-primary shrink-0"
          aria-hidden
        />
        <p className="text-sm flex-1 min-w-0">
          Get alerted on your device when something needs your attention —
          even with the app closed.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={dismiss}
            disabled={isPending}
            className="h-8 px-3 text-xs"
          >
            Not now
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onEnable}
            disabled={isPending}
            className="h-8 px-3 text-xs"
          >
            Enable push
          </Button>
        </div>
      </div>
    </div>
  );
}
