"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

// Reads `?denied=1` from the URL and fires a Sonner toast, then strips the
// query param via router.replace() so a refresh doesn't re-toast and the
// URL stays clean. Used by every role-home page (/today,
// /captain/dashboard, /admin/dashboard) so they can show "Access denied"
// without server-side template flashing.
//
// proxy.ts (HVA-25) sets ?denied=1 when an authenticated user is bounced
// off a wrong-role path back to their own role home.
//
// Not wired into pages that don't exist yet — each role home page
// imports this hook when it's built.
export function useDeniedToast(): void {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    if (params.get("denied") !== "1") return;

    toast.error("Access denied", {
      description: "You don't have permission to view that page.",
    });

    const next = new URLSearchParams(params.toString());
    next.delete("denied");
    const qs = next.toString();
    const path = typeof window !== "undefined" ? window.location.pathname : "/";
    router.replace(qs ? `${path}?${qs}` : path);
  }, [params, router]);
}
