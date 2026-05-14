"use client";

import { useEffect, useState } from "react";

// Add-to-Home-Screen prompt UI.
//
// Chrome / Android / desktop Chrome: fires `beforeinstallprompt` when the
// browser would otherwise show its mini-infobar. We stash the event, render
// our own banner, and `prompt()` on user tap.
//
// iOS Safari: does NOT fire `beforeinstallprompt` at all (and does NOT support
// the navigator prompt API). Users must use Share → Add to Home Screen. We
// detect iOS standalone-mode and show an instructions hint instead. Real
// dedicated Settings UI lands in a later issue; this is the minimum Phase 1
// surface.
//
// Dismiss = respect for 7 days (localStorage timestamp).

const DISMISS_KEY = "beakn:pwa-install-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

function isRecentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    const ts = Number(v);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // Chrome/Android use display-mode media query; iOS Safari exposes navigator.standalone.
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed
    if (isRecentlyDismissed()) return;

    if (isIos()) {
      setIosHint(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // localStorage may be unavailable (Safari private mode); ignore.
    }
    setEvent(null);
    setIosHint(false);
  };

  const install = async () => {
    if (!event) return;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "dismissed") {
      dismiss();
    } else {
      setEvent(null);
    }
  };

  if (!event && !iosHint) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Beakn"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-4 shadow-lg flex items-center gap-3"
    >
      <div className="flex-1 text-sm">
        {iosHint ? (
          <>
            <p className="font-medium">Install Beakn on your home screen</p>
            <p className="text-muted-foreground text-xs mt-1">
              Tap <span aria-hidden>⎙</span> Share → <em>Add to Home Screen</em> in Safari.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">Install Beakn for quick access</p>
            <p className="text-muted-foreground text-xs mt-1">
              Add to your home screen — opens in a standalone window.
            </p>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {!iosHint && (
          <button
            type="button"
            onClick={install}
            className="rounded-md bg-primary text-primary-foreground text-xs px-3 py-1.5 font-medium"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md text-xs px-3 py-1.5 text-muted-foreground"
        >
          {iosHint ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
}
