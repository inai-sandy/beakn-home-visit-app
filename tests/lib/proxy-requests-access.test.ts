import { describe, expect, it } from 'vitest';

import { canAccess } from '@/proxy';

// =============================================================================
// HVA-336: the exec requests LIST is exec-only; the DETAIL route is shared
// =============================================================================
//
// `/requests` was in neither the exec allow-list nor any other branch, so it
// fell through to the catch-all `return true`. The proxy's role gate never
// fired for it, and the page's own redirect bounced captain and support to
// their home with no `?denied=1` — moved with no explanation, while every
// other cross-role refusal in the app raises "Access denied".
//
// The fix is deliberately an EXACT match. `/requests/<id>` is the shared
// request-detail route that captains and admins open constantly (HVA-321 is
// entirely about captains acting on it), so a `startsWith('/requests/')`
// would have traded a missing toast for a lockout. The second describe block
// exists to make that regression loud.
// =============================================================================

const EXEC = 'sales_executive';
const CAPTAIN = 'captain';
const SUPPORT = 'support';
const ADMIN = 'super_admin';

const DETAIL = '/requests/019f46cb-97e8-792c-8994-47ff0fb8ad3b';

describe('the exec requests list', () => {
  it('is reachable by the exec', () => {
    expect(canAccess('/requests', EXEC)).toBe(true);
  });

  it('is refused to captain and support, so the proxy adds ?denied=1', () => {
    expect(canAccess('/requests', CAPTAIN)).toBe(false);
    expect(canAccess('/requests', SUPPORT)).toBe(false);
  });

  it('stays open to super_admin, who is escape-hatched everywhere', () => {
    expect(canAccess('/requests', ADMIN)).toBe(true);
  });
});

describe('the shared request-detail route', () => {
  // If someone "tidies" the exact match into a prefix match, these fail.
  it('stays reachable by captain — HVA-321 is entirely about this page', () => {
    expect(canAccess(DETAIL, CAPTAIN)).toBe(true);
  });

  it('stays reachable by support and admin', () => {
    expect(canAccess(DETAIL, SUPPORT)).toBe(true);
    expect(canAccess(DETAIL, ADMIN)).toBe(true);
  });

  it('is still reachable by the exec', () => {
    expect(canAccess(DETAIL, EXEC)).toBe(true);
  });
});

describe('the neighbouring exec-only routes are unchanged', () => {
  it.each(['/today', '/dashboard', '/tasks', '/dispatch', '/tickets'])(
    '%s stays exec-only',
    (path) => {
      expect(canAccess(path, EXEC)).toBe(true);
      expect(canAccess(path, CAPTAIN)).toBe(false);
      expect(canAccess(path, SUPPORT)).toBe(false);
    },
  );
});
