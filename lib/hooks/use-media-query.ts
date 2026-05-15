"use client";

import { useEffect, useState } from "react";

// Small SSR-safe media-query hook. Returns false on the server (and during the
// first render) so SSR markup matches a desktop layout by default; flips to the
// real value once the client matchMedia is available. For modals that only mount
// on user interaction (post-hydration), the initial-false default is invisible
// — by the time the user clicks the trigger, the effect has run.
//
// Usage:
//   const isDesktop = useMediaQuery("(min-width: 768px)");
//   return isDesktop ? <Dialog .../> : <Sheet .../>;
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
