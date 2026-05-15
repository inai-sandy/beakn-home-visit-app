"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

// Reads `?signedOut=1` from the URL and fires a Sonner success toast, then
// strips the query param via router.replace() so a refresh doesn't re-toast
// and the URL stays clean. Mirrors useDeniedToast (HVA-25) so the two flows
// stay symmetric.
//
// Set by HVA-28's logoutAction Server Action after it tears down the session
// and redirects here. Toast dismisses on next interaction or the default
// Sonner timeout — AC #4.
export function useSignedOutToast(): void {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (params.get("signedOut") !== "1") return;

    toast.success("You've been signed out", {
      description: "Sign in again to continue.",
    });

    const next = new URLSearchParams(params.toString());
    next.delete("signedOut");
    const qs = next.toString();
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    router.replace(qs ? `${path}?${qs}` : path);
  }, [params, router]);
}
