"use client";

import { useEffect } from "react";

// Registers /sw.js on window load. No-op when:
//  - serviceWorker isn't supported (older Safari, in-app webviews, ...)
//  - we're not on HTTPS (production is, dev on localhost is treated as secure)
//
// Updates flow naturally: when sw.js content changes, the next page load fetches
// the new file, the activate event prunes old caches, clients.claim() takes over.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Swallow: a failed registration shouldn't break the page.
          console.warn("[sw] registration failed:", err);
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
