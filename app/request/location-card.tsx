"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-32: optional GPS-coordinate share card (top of /request form)
// =============================================================================
//
// PLACEMENT: persistent card at the TOP of the form container, ABOVE the
// Name field. Always visible from page load. Does NOT auto-trigger
// getCurrentPosition (would surface an OS-level permission prompt before the
// user has expressed any intent — hostile UX). User opts in by tapping the
// Share button.
//
// FOUR STATES (transition logic in handlers below):
//   A "prompt"     — headline + body + Share button + dismiss-X
//   B "granted"    — confirmation chip + dismiss-X (button replaced)
//   C "denied"     — guidance copy + dismiss-X (no button, no re-prompt)
//   D "dismissed"  — nothing rendered. sessionStorage flag persisted.
//
// PERMISSION FLOW:
//   On mount:
//     1. sessionStorage flag set? → state D, render nothing.
//     2. navigator.permissions.query({ name: 'geolocation' }) where
//        supported. 'granted' → silent getCurrentPosition + state B.
//        'denied' → state C. 'prompt' → state A.
//     3. Permissions API unavailable (older Safari) → fall back to
//        state A; the OS dialog will fire when the user taps Share.
//   On Share tap (only in state A):
//     getCurrentPosition(success, error, {enableHighAccuracy: true,
//     timeout: 10000, maximumAge: 0}).
//       success → state B + form coords.
//       error.code === 1 (PERMISSION_DENIED) → state C.
//       error.code === 2 (POSITION_UNAVAILABLE) | 3 (TIMEOUT) → toast,
//       stay in state A.
//
// NO AUDIT LOG WRITE. Customer is anonymous; audit_log is for staff
// actions only (HVA-18 contract). Location provenance lives on the
// request row itself in HVA-33 (presence of coords + timestamp).
// =============================================================================

const DISMISS_KEY = "beakn:request:geo-dismissed";

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface LocationCardProps {
  /**
   * Called whenever coords are obtained (state B). Parent should lift them
   * into form state via form.setValue. Cleared coords are not currently
   * supported — once shared, they stay shared for the page life (the
   * dismiss-X just hides the card; it doesn't unshare).
   */
  onShare: (coords: LocationCoords) => void;
}

type CardState = "loading" | "prompt" | "granted" | "denied" | "dismissed";

// Synchronous, SSR-safe initial state determination. We can check
// sessionStorage during useState lazy init on the client (window exists);
// on the server we return 'loading' and the effect resolves once mounted.
// This avoids a flash of the prompt UI for already-dismissed visitors.
function getInitialState(): CardState {
  if (typeof window === "undefined") return "loading";
  try {
    if (window.sessionStorage.getItem(DISMISS_KEY) === "1") return "dismissed";
  } catch {
    // Storage blocked — fall through to the loading state and let the
    // effect drive normal Permissions-API decisioning.
  }
  return "loading";
}

export function LocationCard({ onShare }: LocationCardProps) {
  // 'loading' is the SSR + first-client-render default. It produces no
  // visible card content (the entire return is null) so we don't flash
  // the prompt for half a frame before the permission-state check resolves.
  const [state, setState] = useState<CardState>(getInitialState);
  const [working, setWorking] = useState(false);

  const handleSuccess = useCallback(
    (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;
      onShare({ latitude, longitude, accuracy });
      setState("granted");
      setWorking(false);
    },
    [onShare],
  );

  const handleError = useCallback((err: GeolocationPositionError) => {
    setWorking(false);
    if (err.code === 1) {
      // PERMISSION_DENIED — user said no in the OS dialog (or it was
      // pre-denied at the browser-settings level).
      setState("denied");
      return;
    }
    // POSITION_UNAVAILABLE (2) or TIMEOUT (3) — recoverable on a future
    // tap. Stay in prompt state so the user can try again.
    toast.error("Couldn't get your location", {
      description: "You can continue without it.",
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 'dismissed' is already settled by the useState init path; if we're
    // anywhere other than 'loading', the user (or a previous async resolve)
    // has already decided and we shouldn't re-probe.
    if (state !== "loading") return;

    // Permissions API probe. Cleanly handle the three states. Older Safari
    // either omits navigator.permissions entirely or returns a rejected
    // promise — fall back to the prompt state in both cases.
    const perms = (navigator as Navigator & {
      permissions?: { query: (q: { name: PermissionName }) => Promise<PermissionStatus> };
    }).permissions;
    if (!perms || typeof perms.query !== "function") {
      // Single, unavoidable sync-setState-in-effect: there's no SSR-safe
      // way to know navigator.permissions exists until after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("prompt");
      return;
    }

    let cancelled = false;
    perms
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        if (status.state === "granted") {
          // Already granted — silently fetch coords once, no UI flash.
          navigator.geolocation.getCurrentPosition(
            handleSuccess,
            handleError,
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
          );
        } else if (status.state === "denied") {
          setState("denied");
        } else {
          setState("prompt");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("prompt");
      });

    return () => {
      cancelled = true;
    };
  }, [state, handleSuccess, handleError]);

  const onShareClick = useCallback(() => {
    if (state !== "prompt" || working) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation not supported on this device", {
        description: "You can continue without it.",
      });
      return;
    }
    setWorking(true);
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });
  }, [state, working, handleSuccess, handleError]);

  const onDismiss = useCallback(() => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Best-effort — if storage is blocked the dismissal won't persist
      // through a refresh, but the card still goes away this render.
    }
    setState("dismissed");
  }, []);

  // SSR + first-render guard, plus session-dismissal.
  if (state === "loading" || state === "dismissed") return null;

  return (
    <div
      role="region"
      aria-label="Share your location"
      className="relative rounded-2xl bg-muted/50 border border-border/50 p-4 pr-12"
    >
      {/* Dismiss-X — 44dp tap target (h-11 w-11), top-right corner */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss location prompt"
        className="absolute top-1 right-1 h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
      >
        <Icon name="close" size="sm" />
      </button>

      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">
          Share your location
        </p>
        <p className="text-xs text-muted-foreground">
          Helps our team plan the visit. Optional.
        </p>
      </div>

      <div className="mt-3">
        {state === "prompt" && (
          <Button
            type="button"
            variant="outline"
            onClick={onShareClick}
            disabled={working}
            className="h-10 px-4 text-sm"
          >
            {working ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Sharing…</span>
              </>
            ) : (
              <>
                <Icon name="my_location" size="sm" />
                <span>Share location</span>
              </>
            )}
          </Button>
        )}

        {state === "granted" && (
          <div
            role="status"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            <Icon
              name="check_circle"
              size="sm"
              fill
              className="text-primary"
            />
            <span>Location shared</span>
          </div>
        )}

        {state === "denied" && (
          <p className="text-xs text-muted-foreground">
            Location sharing is blocked. Enable it in your browser settings
            to use this.
          </p>
        )}
      </div>
    </div>
  );
}
