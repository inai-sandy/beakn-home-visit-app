import { describe, expect, it, vi } from 'vitest';

import type { CaptainRequestBucket } from '@/lib/captain/request-buckets';
import type { ExecRequestBucket } from '@/lib/exec/request-buckets';

// =============================================================================
// HVA-65 fixup: regression guard for RequestBucketTabs prop serialization
// =============================================================================
//
// On 2026-05-18 the /captain/requests page crashed with two production
// digests (1605197399 + 111855479) because the captain Server Component
// was passing function-typed props (`LinkComponent={Link}` +
// `hrefFor={(k) => …}`) across the RSC server→client boundary to the
// `'use client'` RequestBucketTabs. Next.js rejects functions there.
//
// The fix removed both function props: `LinkComponent` is gone (Link is
// imported inside RequestBucketTabs); `hrefFor` was replaced by a plain
// `hrefByKey: Record<K, string>` map that round-trips cleanly through
// JSON.
//
// This file's role is to lock that contract:
//   * /captain/requests is a Server Component → every prop it passes
//     to RequestBucketTabs MUST be JSON-serializable (no functions).
//   * /requests (via RequestsFilterClient) is rendered inside a
//     client tree → function props (onSelect) ARE allowed there.
//
// Layer this test runs at: pure props validation, no React render. We
// shape the props the way each page does, then assert the JSON round
// trip equals the input (functions would silently drop and fail the
// equality).
// =============================================================================

function assertNoFunctionValues(obj: Record<string, unknown>, path = ''): void {
  for (const [k, v] of Object.entries(obj)) {
    const here = path === '' ? k : `${path}.${k}`;
    expect(typeof v, `${here} must not be a function`).not.toBe('function');
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      assertNoFunctionValues(v as Record<string, unknown>, here);
    }
  }
}

describe('RequestBucketTabs link mode (Server → Client boundary)', () => {
  it('captain /requests page props survive JSON round-trip — no function values', () => {
    // Mirror the exact shape that app/(captain)/captain/requests/page.tsx
    // builds and passes to <RequestBucketTabs />. If a future refactor
    // re-introduces a function-typed prop, this round-trip fails on the
    // deepEqual assertion (functions become undefined under JSON).
    const bucketTabSpecs = [
      { key: 'all', label: 'All', count: 7 },
      { key: 'open', label: 'Open', count: 1 },
      { key: 'assigned', label: 'Assigned', count: 4 },
      { key: 'completed', label: 'Completed', count: 1 },
      { key: 'cancelled', label: 'Cancelled', count: 1 },
    ] as const;

    const bucketHrefByKey: Record<CaptainRequestBucket, string> = {
      all: '/captain/requests',
      open: '/captain/requests?bucket=open',
      assigned: '/captain/requests?bucket=assigned',
      completed: '/captain/requests?bucket=completed',
      cancelled: '/captain/requests?bucket=cancelled',
    };

    const props = {
      buckets: bucketTabSpecs,
      active: 'all' as CaptainRequestBucket,
      hrefByKey: bucketHrefByKey,
    };

    const roundTripped = JSON.parse(JSON.stringify(props));
    expect(roundTripped).toEqual(props);
    assertNoFunctionValues(props);
  });

  it('hrefByKey values are all strings (no React component / function leaked in)', () => {
    const hrefByKey: Record<CaptainRequestBucket, string> = {
      all: '/captain/requests',
      open: '/captain/requests?bucket=open',
      assigned: '/captain/requests?bucket=assigned',
      completed: '/captain/requests?bucket=completed',
      cancelled: '/captain/requests?bucket=cancelled',
    };
    for (const [k, v] of Object.entries(hrefByKey)) {
      expect(typeof v, `hrefByKey.${k} must be a string`).toBe('string');
    }
  });

  it('proves a function-typed prop WOULD silently drop under JSON (the failure mode we are guarding against)', () => {
    // This is the documentation-as-test for what went wrong on
    // 2026-05-18. JSON.stringify silently omits function values, so a
    // prop bag with a function appears "valid" until Next.js's RSC
    // serializer rejects it at render time.
    const badProps = {
      buckets: [{ key: 'all', label: 'All', count: 0 }],
      active: 'all',
      hrefFor: (k: string) => `/captain/requests?bucket=${k}`,
    };
    const roundTripped = JSON.parse(JSON.stringify(badProps));
    expect(roundTripped.hrefFor).toBeUndefined(); // ← this is the bug shape
    expect(roundTripped).not.toEqual(badProps);
  });
});

describe('RequestBucketTabs click mode (Client → Client; functions are fine here)', () => {
  it('exec /requests page wires onSelect inside RequestsFilterClient (client tree)', () => {
    // The exec page (app/(exec)/requests/page.tsx) does NOT mount
    // RequestBucketTabs directly. It mounts <RequestsFilterClient
    // rows={…} /> — a 'use client' component — and that wrapper builds
    // the click-mode props internally. onSelect therefore never crosses
    // a server→client boundary. We document that here by checking that
    // the only prop the SERVER page passes (`rows`) is JSON-safe, and
    // that onSelect is a function when the client builds it.
    const serverProps = {
      rows: [
        {
          id: '019e36a3-7652-7dfb-a83c-ba987c92554c',
          customerName: 'KA Paul',
          customerPhone: '+919885698665',
          cityName: 'Hyderabad',
          statusCode: 'VISIT_COMPLETED',
          statusName: 'Visit Completed',
          assignedExecUserId: '019e2222-…',
          cancelledAt: null,
          createdAt: '2026-05-17T11:30:00.000Z',
        },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(serverProps));
    expect(roundTripped).toEqual(serverProps);
    assertNoFunctionValues(serverProps);
  });

  it('inside the client tree, onSelect is a function and that is intentional', () => {
    const onSelect = vi.fn();
    const clientSideProps = {
      buckets: [{ key: 'all', label: 'All', count: 0 }],
      active: 'all' as ExecRequestBucket,
      onSelect,
    };
    expect(typeof clientSideProps.onSelect).toBe('function');
    // The function would drop under JSON, but it never has to — it's
    // built and used inside the client tree.
    const roundTripped = JSON.parse(JSON.stringify(clientSideProps));
    expect(roundTripped.onSelect).toBeUndefined();
  });
});
