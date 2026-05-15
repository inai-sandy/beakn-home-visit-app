import { NextResponse, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';

import { auth } from '@/lib/auth';
import { log } from '@/lib/logger';

// =============================================================================
// proxy.ts — Next.js 16 HTTP-layer transform (the renamed middleware.ts).
// =============================================================================
//
// HVA-21 layer (kept):
//   - Generate or honour x-request-id (nanoid 16) per request.
//   - Forward into downstream request headers so Server Components can read
//     it via `headers().get('x-request-id')` and correlate their logs.
//   - Echo on response. Emit one `request_start` pino line per dynamic request.
//
// HVA-25 layer (new):
//   - Session-aware route protection.
//   - Anonymous + protected route → 307 to /login?next=<original>.
//   - Authenticated + /login or /forgot-password → 307 to role home.
//   - Authenticated + mustChangePassword + path != /set-password → 307 to
//     /set-password. Takes precedence over wrong-role redirect so a sales-exec
//     hitting /admin/dashboard mid-first-login gets bounced once, not twice.
//   - Authenticated + wrong-role path → 307 to own role home with ?denied=1.
//   - super_admin has full access (decision documented; revisit if HVA-?? hardens).
//
// RUNTIME: Next.js 16 pins `proxy.ts` to the Node.js runtime by default —
// declaring `export const runtime` here is a build error. Good news: that
// means `auth.api.getSession` (Drizzle + postgres-js + scrypt) just works.
// Cost: ~1 DB query per dynamic request because BA's cookieCache is off
// (locked in HVA-24 for real-time role / lockout / audit). If page render
// volume gets uncomfortable, re-enable BA's cookieCache with a short TTL as
// a future hardening pass; not in HVA-25's scope.

// =============================================================================
// Route classification
// =============================================================================

// Skipped entirely (no logging, no auth check). Static assets + manifest + SW.
const SKIP_PREFIXES = [
  '/_next/',
  '/static/',
  '/favicon.ico',
  '/icon-',
  '/apple-touch-icon',
  '/manifest.json',
  '/sw.js',
  '/beakn-logo-master.png',
];

// Logged + request_id stamped, but no auth-redirect logic (responses come from
// the underlying handler verbatim). API routes that need auth do it themselves
// via lib/auth-server.ts.
//
// HVA-99 (security gate): /dev/* routes are exempted from auth-redirect ONLY
// in non-production environments. On production NODE_ENV='production' so the
// array drops the entry and proxy.ts default-denies every /dev/* path,
// bouncing anonymous callers to /login. Rationale (verbatim from HVA-99):
// /dev/audit-health was writing 2 audit_log rows per anonymous GET, plus
// /dev/config-health was dumping full config snapshot. Forensic + info
// disclosure neutralised by gating at the proxy rather than per-page.
// Local dev / `pnpm dev` (NODE_ENV='development') and Docker build steps
// (NODE_ENV unset or test-ish) keep the prior keep-it-convenient behaviour.
const NO_AUTH_PREFIXES = [
  '/api/auth/', // Better-Auth's own surface — never redirect it
  '/api/health', // Docker HEALTHCHECK + monitoring; must stay public
  '/api/customer-request', // HVA-34: public visit-request submission endpoint
  ...(process.env.NODE_ENV !== 'production'
    ? ['/dev/'] // developer smoke routes — dev/test only; see HVA-99
    : []),
];

// Public page routes (no session required). Authenticated users hitting
// /login or /forgot-password are still redirected to their role home below.
const PUBLIC_PAGE_ROUTES = new Set<string>([
  '/',
  '/login',
  '/forgot-password',
]);
const PUBLIC_PAGE_PREFIXES = [
  '/request', // customer visit-request form (HVA-30+)
  '/track/', // customer tracking page (HVA-1.5)
];

const ROLE_HOME: Record<string, string> = {
  sales_executive: '/today',
  captain: '/captain/dashboard',
  super_admin: '/admin/dashboard',
};

const MAX_UA_LEN = 200;

function isSkipped(pathname: string): boolean {
  for (const p of SKIP_PREFIXES) if (pathname.startsWith(p)) return true;
  return false;
}

function isNoAuth(pathname: string): boolean {
  for (const p of NO_AUTH_PREFIXES) if (pathname.startsWith(p)) return true;
  return false;
}

function isPublicPage(pathname: string): boolean {
  if (PUBLIC_PAGE_ROUTES.has(pathname)) return true;
  for (const p of PUBLIC_PAGE_PREFIXES) if (pathname.startsWith(p)) return true;
  return false;
}

/**
 * Returns true iff `role` may visit `pathname`. super_admin has access to
 * every role-prefixed area (decision documented above).
 */
function canAccess(pathname: string, role: string): boolean {
  // HVA-99 (production default-deny for /dev/*). The NO_AUTH_PREFIXES guard
  // above only governs the unauthenticated path; once a session exists the
  // super_admin escape hatch below would otherwise let signed-in admins
  // through to /dev/audit-health & friends. Block that explicitly: on
  // production, /dev/* is unreachable for every role.
  if (
    pathname.startsWith('/dev/') &&
    process.env.NODE_ENV === 'production'
  ) {
    return false;
  }
  if (role === 'super_admin') return true;
  if (pathname === '/today' || pathname.startsWith('/today/')) {
    return role === 'sales_executive';
  }
  if (pathname.startsWith('/captain/')) return role === 'captain';
  if (pathname.startsWith('/admin/')) return role === 'super_admin';
  // /set-password is accessible to any authenticated user (gated by
  // mustChangePassword check above this in the flow).
  if (pathname === '/set-password') return true;
  // Unknown path under an authenticated branch — let it 404 in Next.
  return true;
}

// =============================================================================
// Entry point
// =============================================================================

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname;
  if (isSkipped(pathname)) return NextResponse.next();

  // -------------------------------------------------------------------------
  // HVA-21 layer: request_id + request_start log.
  // -------------------------------------------------------------------------
  const requestId = req.headers.get('x-request-id') ?? nanoid(16);
  const ua = (req.headers.get('user-agent') ?? '').slice(0, MAX_UA_LEN);
  const startNs = process.hrtime.bigint();
  const downstreamHeaders = new Headers(req.headers);
  downstreamHeaders.set('x-request-id', requestId);

  function emitRequestStartLog(extra: Record<string, unknown> = {}): void {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    log.info(
      {
        requestId,
        method: req.method,
        path: pathname,
        query: req.nextUrl.search || undefined,
        ua,
        proxyMs: +durationMs.toFixed(3),
        ...extra,
      },
      'request_start',
    );
  }

  function withRequestIdHeaders(res: NextResponse): NextResponse {
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // -------------------------------------------------------------------------
  // HVA-25 layer: session-aware routing.
  // -------------------------------------------------------------------------

  // API routes (BA, health, dev) pass through without auth checks. Logged.
  if (isNoAuth(pathname)) {
    emitRequestStartLog();
    return withRequestIdHeaders(
      NextResponse.next({ request: { headers: downstreamHeaders } }),
    );
  }

  // Resolve session once. ~1 DB query under current cookieCache config.
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch (err) {
    // If BA's DB read fails, treat as unauthenticated — the resulting
    // redirect to /login is the safest fallback (and surfaces the DB issue).
    log.error(
      {
        requestId,
        path: pathname,
        err: err instanceof Error ? err : String(err),
      },
      'proxy_get_session_failed',
    );
  }

  const user = session?.user as
    | { role?: string; mustChangePassword?: boolean }
    | undefined;
  const role = user?.role;
  const mustChange = Boolean(user?.mustChangePassword);

  // 1. Public page routes. Authenticated users hitting /login or
  //    /forgot-password get bounced to their role home so they can't
  //    re-enter the auth flow by mistake.
  if (isPublicPage(pathname)) {
    if (session && (pathname === '/login' || pathname === '/forgot-password')) {
      const target = mustChange
        ? '/set-password'
        : (role && ROLE_HOME[role]) || '/';
      emitRequestStartLog({ redirectedTo: target, reason: 'authed_visiting_login' });
      return withRequestIdHeaders(
        NextResponse.redirect(new URL(target, req.url), 307),
      );
    }
    emitRequestStartLog();
    return withRequestIdHeaders(
      NextResponse.next({ request: { headers: downstreamHeaders } }),
    );
  }

  // 2. From here on, every route requires a session.
  if (!session) {
    const next = pathname + (req.nextUrl.search || '');
    const target = `/login?next=${encodeURIComponent(next)}`;
    emitRequestStartLog({ redirectedTo: '/login', reason: 'unauthenticated' });
    return withRequestIdHeaders(
      NextResponse.redirect(new URL(target, req.url), 307),
    );
  }

  // 3. First-login pin. Takes precedence over wrong-role so the user gets
  //    a single redirect, not two.
  if (mustChange && pathname !== '/set-password') {
    emitRequestStartLog({
      redirectedTo: '/set-password',
      reason: 'must_change_password',
    });
    return withRequestIdHeaders(
      NextResponse.redirect(new URL('/set-password', req.url), 307),
    );
  }

  // 4. Role-based access control.
  if (role && !canAccess(pathname, role)) {
    const home = ROLE_HOME[role] ?? '/';
    const target = `${home}?denied=1`;
    emitRequestStartLog({
      redirectedTo: home,
      role,
      reason: 'wrong_role',
    });
    return withRequestIdHeaders(
      NextResponse.redirect(new URL(target, req.url), 307),
    );
  }

  // 5. Authenticated + allowed.
  emitRequestStartLog({ role });
  return withRequestIdHeaders(
    NextResponse.next({ request: { headers: downstreamHeaders } }),
  );
}

// proxy.ts matchers use the same syntax as middleware.ts.
// Static-asset prefixes are also pre-filtered by `isSkipped`, but the matcher
// exclusion saves the proxy invocation entirely.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon-|apple-touch-icon|manifest.json|sw.js|beakn-logo-master.png).*)',
  ],
};
