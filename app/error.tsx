"use client";

import { useEffect } from "react";

// Per-segment error boundary for client-rendered errors. Server-side
// uncaught errors are caught by global-error.tsx and logged via pino there.
// Here we only have a browser context, so log to console and offer reset.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error.tsx]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
      <p className="text-muted-foreground text-xs mb-4">
        {error.digest ? `digest: ${error.digest}` : "client-side error"}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
      >
        Try again
      </button>
    </main>
  );
}
