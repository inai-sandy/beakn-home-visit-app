import { describe, expect, it } from 'vitest';

import {
  deriveRequestStatus,
  isSettled,
  summariseGroups,
} from '@/lib/dispatch-requests/status';

// HVA-342: the header status is derived from the order groups, never set by
// hand. These pin the derivation, which is the part that decides whether a
// request the exec is still waiting on can disappear from a queue.

describe('isSettled', () => {
  it('treats approved and rejected as finished', () => {
    expect(isSettled('approved')).toBe(true);
    expect(isSettled('rejected')).toBe(true);
  });

  it('does NOT treat a hold as finished', () => {
    // A hold is support saying "not yet". Counting it as settled would close
    // the request and drop it out of the queue while somebody is still owed
    // an answer — the exec would stop chasing and the customer would wait.
    expect(isSettled('held')).toBe(false);
    expect(isSettled('pending')).toBe(false);
  });
});

describe('deriveRequestStatus', () => {
  it('is open while anything is undecided', () => {
    expect(deriveRequestStatus(['approved', 'pending'])).toBe('open');
  });

  it('is open while anything is held', () => {
    expect(deriveRequestStatus(['approved', 'held'])).toBe('open');
  });

  it('closes only when every order is approved or rejected', () => {
    expect(deriveRequestStatus(['approved', 'rejected'])).toBe('closed');
    expect(deriveRequestStatus(['approved'])).toBe('closed');
  });

  it('leaves an empty request open rather than closing it', () => {
    // A request with no groups is a data problem. Closing it would hide it.
    expect(deriveRequestStatus([])).toBe('open');
  });
});

describe('summariseGroups', () => {
  it('leads with what is still waiting on somebody', () => {
    expect(summariseGroups(['approved', 'pending', 'held'])).toBe(
      '1 waiting · 1 on hold · 1 dispatched',
    );
  });

  it('reads sensibly when everything is done', () => {
    expect(summariseGroups(['approved', 'approved'])).toBe('2 dispatched');
  });

  it('has something to say about an empty request', () => {
    expect(summariseGroups([])).toBe('Nothing requested');
  });
});
