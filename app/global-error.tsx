"use client";

import { useEffect } from "react";

// Root-level error boundary. Fires when an error escapes the per-segment
// error.tsx — typically from a server component failure or a layout crash.
// Must be a Client Component and must render its own <html>/<body>.
//
// global-error.tsx runs ON THE CLIENT side. The server-side pino log for a
// thrown error happens earlier, during the server render — it's caught by
// Next.js's internal error handler and forwarded into stdout/stderr where
// docker logs sees it. This file is the user-facing fallback UI; client log
// here is just a backup signal for browser-visible failures.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error.tsx]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center p-8 font-mono text-sm">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold mb-2">Application error</h1>
          <p className="text-muted-foreground text-xs mb-4">
            {error.digest ? `digest: ${error.digest}` : "fatal client error"}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
