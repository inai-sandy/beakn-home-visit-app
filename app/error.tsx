'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

// HVA-98: branded per-segment error boundary. Server-side uncaught errors
// are caught by global-error.tsx and logged via pino there. Here we only
// have a browser context — console.error for the digest, branded UI for
// the user.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error.tsx]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="min-h-svh flex items-center justify-center bg-background px-6">
      <div className="max-w-sm w-full text-center space-y-5">
        <Image
          src="/icon-512x512.png"
          alt="Beakn"
          width={56}
          height={56}
          priority
          className="mx-auto rounded-xl"
        />
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Something went wrong
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            We hit a snag
          </h1>
          <p className="text-sm text-muted-foreground">
            Try again. If it keeps happening, head back home and we&apos;ll
            sort it out.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-muted-foreground/70">
              ref: {error.digest}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Button onClick={() => reset()} className="w-full h-11">
            Try again
          </Button>
          <Button asChild variant="outline" className="w-full h-11">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
