import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

// HVA-98: branded 404 page. Replaces Next.js's default unstyled 404.
// Clicking "Go home" hits `/`, which proxy.ts then routes to the
// authenticated user's role home or to /login if unauthenticated.

export const metadata: Metadata = {
  title: 'Page not found — Beakn',
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
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
            404
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or has been
            moved. Check the URL or head back home.
          </p>
        </div>
        <Button asChild className="w-full h-11">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}
