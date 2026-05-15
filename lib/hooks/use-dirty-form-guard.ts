"use client";

import { useEffect } from "react";

// =============================================================================
// HVA-29: dirty-form navigation guard
// =============================================================================
//
// Two attack surfaces to defend against losing unsaved input:
//
//   1. BROWSER-LEVEL navigation — refresh, tab close, hardware back gesture,
//      browser address-bar navigation. Hooked via `beforeunload`. Modern
//      browsers (Chrome / Firefox / Safari) ignore the returned string and
//      show their OWN built-in confirmation prompt; we just need to call
//      `preventDefault()` to opt in. Mobile Safari and embedded WebViews
//      tend to ignore this entirely — best-effort only.
//
//   2. IN-APP `<Link>` clicks — Next 16's App Router drives these without
//      firing `beforeunload`. We attach a capture-phase click listener that
//      finds the closest `<a href>` and intercepts it with a synchronous
//      `window.confirm`. If the user cancels, we `preventDefault` and
//      `stopPropagation` before Next's router gets the event.
//
// NOT GUARDED (acceptable limitations for the /dev host; revisit when this
// lifts into Profile in HVA-76):
//   - Programmatic `router.push` calls. The action's own success path uses
//     `router.refresh()` which is also unguarded; that's fine because the
//     guard is only active while the form is DIRTY, and a successful
//     submission resets the form (isDirty -> false) before refresh fires.
//   - The browser BACK button. `popstate` doesn't go through `beforeunload`
//     in Next's App Router. Guarding it requires pushing a dummy history
//     entry on mount and intercepting — feels heavy for this scope. The
//     `beforeunload` covers refresh/close, which is the more common loss
//     vector.
//
// USAGE:
//   const { isDirty } = form.formState;
//   useDirtyFormGuard(isDirty);
// =============================================================================

const CONFIRM_MESSAGE = "You have unsaved changes. Leave anyway?";

export function useDirtyFormGuard(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers honour the returned string; modern ones ignore it
      // but require `preventDefault` (above) to show the built-in prompt.
      event.returnValue = CONFIRM_MESSAGE;
      return CONFIRM_MESSAGE;
    };

    const handleClick = (event: MouseEvent) => {
      // Ignore clicks with modifier keys (cmd/ctrl/middle-click) — those
      // open in a new tab and don't navigate this page away.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
        return;
      }

      const target = (event.target as HTMLElement | null)?.closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!target) return;

      // External targets (target=_blank, download attribute) don't lose state.
      if (target.target && target.target !== "_self") return;
      if (target.hasAttribute("download")) return;

      // Same-page anchors (#section) don't navigate away.
      const href = target.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;

      const proceed = window.confirm(CONFIRM_MESSAGE);
      if (!proceed) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, { capture: true });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, [isDirty]);
}
