import { NextResponse, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';

import { log } from '@/lib/logger';

// Next.js 16 proxy.ts — the new convention for HTTP-layer request transforms
// (formerly middleware.ts). Runs on every request that matches `matcher`.
//
// HVA-21 scope: structured request log with correlation id + timing.
// HVA-25 will extend this with role-based routing — leave room.

const SKIP_PREFIXES = ['/_next/', '/static/', '/favicon.ico', '/icon-', '/apple-touch-icon'];
const MAX_UA_LEN = 200;

function shouldSkip(pathname: string): boolean {
  for (const p of SKIP_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

export function proxy(req: NextRequest): NextResponse {
  const pathname = req.nextUrl.pathname;

  if (shouldSkip(pathname)) {
    return NextResponse.next();
  }

  // Honour an incoming x-request-id (set upstream by Caddy or a client) or
  // mint a fresh one. Short enough to grep, long enough to be unique within
  // a single instance's lifetime.
  const requestId = req.headers.get('x-request-id') ?? nanoid(16);

  const ua = (req.headers.get('user-agent') ?? '').slice(0, MAX_UA_LEN);
  const startNs = process.hrtime.bigint();

  // Forward x-request-id into the downstream request so Server Components
  // and Route Handlers can read it via `headers().get('x-request-id')` and
  // correlate their own log lines with this request.
  const downstreamHeaders = new Headers(req.headers);
  downstreamHeaders.set('x-request-id', requestId);

  const res = NextResponse.next({ request: { headers: downstreamHeaders } });
  res.headers.set('x-request-id', requestId);

  // Best-effort timing — we don't see the response status here (proxy.ts runs
  // before route resolution), so log just request_start. Server Components /
  // Route Handlers log their own completion lines.
  const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  log.info(
    {
      requestId,
      method: req.method,
      path: pathname,
      query: req.nextUrl.search || undefined,
      ua,
      proxyMs: +durationMs.toFixed(3),
    },
    'request_start',
  );

  return res;
}

// Match everything except Next static assets and the public icon set.
// proxy.ts matchers use the same syntax as middleware.ts.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|apple-touch-icon|manifest.json|sw.js).*)'],
};
