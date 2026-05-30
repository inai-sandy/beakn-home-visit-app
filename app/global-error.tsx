'use client';

import { useEffect } from 'react';

// HVA-98: branded root-level error boundary. Fires when an error escapes
// per-segment error.tsx — typically a server-component failure or a layout
// crash. Must render its own <html>/<body> (no access to root layout's
// ThemeProvider or fonts here), so the visual is intentionally minimal but
// branded with the inline Beakn mark.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error.tsx]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          background: '#fafafa',
          color: '#111',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '24rem', width: '100%', textAlign: 'center' }}>
          {/* Plain <img> so we don't depend on next/image (which can fail in
              this fallback if the asset pipeline is what's broken). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-512x512.png"
            alt="Beakn"
            width={56}
            height={56}
            style={{ borderRadius: 12, margin: '0 auto 1.25rem' }}
          />
          <p
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#6b7280',
              margin: '0 0 0.5rem',
            }}
          >
            Application error
          </p>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              margin: '0 0 0.5rem',
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: '#6b7280',
              margin: '0 0 1.25rem',
            }}
          >
            We hit a fatal error. Try again. If it keeps happening, please let
            our team know.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                color: '#9ca3af',
                margin: '0 0 1.25rem',
              }}
            >
              ref: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              width: '100%',
              padding: '0.625rem 1rem',
              borderRadius: 8,
              background: '#0F766E',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
