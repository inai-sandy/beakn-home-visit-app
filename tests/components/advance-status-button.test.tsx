import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.mock factories are hoisted to the top of the file; the spies they
// reference must also be hoisted via vi.hoisted() (otherwise factory
// runs BEFORE the const refresh = vi.fn() declaration).
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

// The button transitively imports the calendar dialog, which imports
// 'use server' actions that pull in next/cache (a server-only module).
// In a browser test environment that chain blows up at import time, so
// stub the server-action module out.
vi.mock('@/lib/visit-schedule/actions', () => ({
  scheduleVisitAction: vi.fn(async () => ({ ok: true })),
}));

// next/cache pulls in node-only deps via the patch-fetch chain (__dirname
// etc). The component under test doesn't use revalidatePath itself; this
// just keeps the import tree resolvable in the browser.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { refresh, toastSuccess, toastError } = mocks;

import { AdvanceStatusButton } from '@/app/requests/[id]/advance-status-button';

// =============================================================================
// HVA-138: component-level coverage for advance-status-button.tsx
// =============================================================================
//
// Five contracts the button must satisfy (HVA-136 race fix):
//   1. One fetch per click — even under rapid double-click during in-flight POST
//   2. router.refresh fires exactly once on success
//   3. Submit button disabled while the POST is in flight
//   4. Button re-enables after a failed POST so the user can retry
//   5. (Modal cancel disabled — covered for the calendar dialog flow, not here)
// =============================================================================

const NEXT_STATUS = {
  id: 'stage-uuid-1234',
  code: 'VISIT_COMPLETED',
  name: 'Visit Completed',
};

beforeEach(() => {
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  // Browser-mode RTL doesn't auto-cleanup the way jsdom does; without
  // this each subsequent render leaves the previous button in the DOM
  // and screen.getByRole hits "multiple elements found".
  cleanup();
  vi.restoreAllMocks();
});

// Small helper: wait for an in-flight promise to settle without using
// fake timers (which userEvent in browser mode doesn't play well with).
const flush = () => new Promise((res) => setTimeout(res, 50));

describe('AdvanceStatusButton', () => {
  it('contract 1+2: one fetch + one router.refresh on a single success', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    render(
      <AdvanceStatusButton
        requestId="req-uuid-9999"
        nextStatus={NEXT_STATUS}
      />,
    );

    const btn = screen.getByRole('button', { name: /Move to Visit Completed/i });
    await user.click(btn);

    // Let async fetch resolve
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/requests/req-uuid-9999/status',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Moved to Visit Completed');
  });

  it('contract 1: rapid double-click triggers only one fetch (race fix)', async () => {
    const user = userEvent.setup();
    // Resolve fetch slowly so the second click lands while the first is in-flight.
    let resolveFetch: (r: Response) => void = () => {};
    const slowFetch = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(slowFetch);

    render(
      <AdvanceStatusButton
        requestId="req-uuid-9999"
        nextStatus={NEXT_STATUS}
      />,
    );

    const btn = screen.getByRole('button', { name: /Move to Visit Completed/i });
    // Two clicks back-to-back — should only fire one fetch.
    await user.click(btn);
    await user.click(btn);

    // Resolve the in-flight fetch
    resolveFetch(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('contract 3: button is disabled while POST is in flight', async () => {
    const user = userEvent.setup();
    let resolveFetch: (r: Response) => void = () => {};
    const slowFetch = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValue(slowFetch);

    render(
      <AdvanceStatusButton
        requestId="req-uuid-9999"
        nextStatus={NEXT_STATUS}
      />,
    );

    const btn = screen.getByRole('button', { name: /Move to Visit Completed/i });
    await user.click(btn);

    // While the fetch hangs, the button should be disabled + show Saving...
    const savingBtn = await screen.findByRole('button', { name: /Saving/i });
    expect(savingBtn).toBeDisabled();

    // Cleanup — resolve the fetch
    resolveFetch(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await flush();
  });

  it('contract 4: button re-enables after a failed POST + error toast fires', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: 'Bad transition' }),
        { status: 400 },
      ),
    );

    render(
      <AdvanceStatusButton
        requestId="req-uuid-9999"
        nextStatus={NEXT_STATUS}
      />,
    );

    const btn = screen.getByRole('button', { name: /Move to Visit Completed/i });
    await user.click(btn);
    await flush();

    expect(toastError).toHaveBeenCalledWith('Bad transition');
    // After failure, the button must re-enable so the user can retry
    const reEnabled = screen.getByRole('button', {
      name: /Move to Visit Completed/i,
    });
    expect(reEnabled).not.toBeDisabled();
    // router.refresh should NOT have been called on failure
    expect(refresh).not.toHaveBeenCalled();
  });
});
