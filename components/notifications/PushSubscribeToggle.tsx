'use client';

import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

// HVA-54: opt-in / opt-out control for browser push notifications.
//
// Lives at the top of the NotificationBell drawer so the affordance is
// discoverable the moment a user opens notifications. The 4-state UX:
//
//   unsupported  → render nothing (no browser PushManager / SW)
//   default      → "Enable" button — prompts the OS permission dialog
//   denied       → small explanatory line; cannot re-prompt without OS reset
//   granted      → "Disable" button — unsubscribes + deletes the row
//
// Subscription endpoint is sent to /api/push/subscribe (POST upsert /
// DELETE remove). The browser handles keypair generation; we just persist.

interface SubscriptionState {
  kind: 'unsupported' | 'default' | 'denied' | 'granted';
  endpoint: string | null;
}

function base64UrlToArrayBuffer(base64: string): ArrayBuffer {
  // Web Push VAPID public keys are base64url-encoded; PushManager wants
  // an ArrayBuffer (or BufferSource). TS rejects Uint8Array directly because
  // applicationServerKey's type narrows to plain ArrayBuffer (not
  // SharedArrayBuffer-compatible).
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buf;
}

export function PushSubscribeToggle() {
  const [state, setState] = useState<SubscriptionState>({
    kind: 'unsupported',
    endpoint: null,
  });
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
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) return;
      const perm = Notification.permission;
      if (sub) {
        setState({ kind: 'granted', endpoint: sub.endpoint });
      } else if (perm === 'denied') {
        setState({ kind: 'denied', endpoint: null });
      } else {
        setState({ kind: 'default', endpoint: null });
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

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
          setState({ kind: permission === 'denied' ? 'denied' : 'default', endpoint: null });
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
          // Roll back the browser subscription so we don't leak an
          // orphaned device-side registration.
          await subscription.unsubscribe();
          toast.error('Could not save subscription. Try again later.');
          return;
        }
        setState({ kind: 'granted', endpoint: json.endpoint });
        toast.success('Browser notifications enabled');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'subscribe_failed';
        toast.error(`Could not enable: ${msg}`);
      }
    });
  }

  async function onDisable() {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const endpoint = sub?.endpoint ?? state.endpoint;
        if (sub) await sub.unsubscribe();
        if (endpoint) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          });
        }
        setState({ kind: 'default', endpoint: null });
        toast.success('Browser notifications disabled');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unsubscribe_failed';
        toast.error(`Could not disable: ${msg}`);
      }
    });
  }

  if (state.kind === 'unsupported') return null;

  if (state.kind === 'denied') {
    return (
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
        <Icon name="notifications_off" size="xs" />
        Browser push blocked. Re-enable in site settings.
      </p>
    );
  }

  if (state.kind === 'granted') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDisable}
        disabled={isPending}
        className="h-7 px-2 text-xs"
      >
        <Icon name="notifications_active" size="xs" />
        Disable push
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onEnable}
      disabled={isPending}
      className="h-7 px-2 text-xs"
    >
      <Icon name="notifications_active" size="xs" />
      Enable push
    </Button>
  );
}
