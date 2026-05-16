import { log } from '@/lib/logger';

// =============================================================================
// HVA-42: in-process event dispatcher for lifecycle notifications
// =============================================================================
//
// Why this exists (and why it's intentionally tiny):
//
// HVA-48 will ship a config-driven notification engine (channel preferences,
// per-channel retry, rate limiting, dedupe). Until then we still need a
// way to fire emails on request submission WITHOUT putting hardcoded
// `sendEmail()` calls inside `/api/customer-request/route.ts`. The thing
// we want HVA-48 to refactor is a registry of handlers — not a sprawl of
// inline send calls in HTTP routes. So this file establishes the event
// surface today; HVA-48 swaps the handler-registry implementation under it.
//
// API:
//   on('request.submitted', async (ctx) => { ... })
//     Register a handler. Multiple subscribers per event are allowed and
//     are invoked in parallel via Promise.allSettled — one handler's
//     failure does not affect siblings.
//
//   emit('request.submitted', ctx)
//     Schedules every registered handler to run on the next tick via
//     setImmediate. The call returns synchronously — the HTTP caller's
//     response is not delayed by handler execution.
//
// Handler error policy: caught + logged; never bubbles. Handlers are
// expected to be defensive themselves (see lib/email.ts which never
// throws) — this layer is the last-resort guard.
//
// IDEMPOTENCY OF SUBSCRIBE: handlers register themselves at module load
// time. Next.js can re-evaluate modules during hot-reload (dev) and
// instance-warming (prod cold-start), which could otherwise lead to
// duplicate-fire. The `subscribed` set keyed by the handler function
// reference deduplicates: registering the exact same function twice is
// a no-op, even when the module is reloaded.
//
// SCOPE: in-process only. Cross-process / cross-instance fan-out is HVA-48's
// problem. Phase 1 runs as a single container so in-process is sufficient.
// =============================================================================

const eventsLog = log.child({ component: 'events' });

// =============================================================================
// Typed event map
// =============================================================================
//
// Adding a new event:
//   1. Add a key + payload type to `AppEvents` below.
//   2. Handlers automatically get the right payload type via `on()`.
//   3. `emit()` rejects payloads that don't match.

export interface AppEvents {
  /**
   * Fired after a customer's visit request has been written to the database
   * and audit-logged. Carries enough context for any handler (email,
   * WhatsApp, Discord) to render its own notification without re-querying.
   */
  'request.submitted': {
    requestId: string;
    trackingToken: string;
    customerName: string;
    /** Storage form: '+91' + 10 digits. */
    customerPhone: string;
    customerEmail: string | null;
    address: string;
    /** Resolved city UUID — primary key the handler joins against. */
    cityId: string;
    /** City name as the customer chose it. Convenience for log/log search. */
    cityName: string;
    /** Optional state field the customer filled in (free-text). */
    customerState: string | null;
    /** DB-form BHK ('1BHK', '2BHK', etc.) — no space. */
    bhk: string;
    interest: unknown;
    /** ISO 8601 timestamp of submission. */
    submittedAt: string;
    /** Forwarded for log correlation; not embedded in email body. */
    requestIdHeader?: string;
  };
}

type EventName = keyof AppEvents;
type Handler<E extends EventName> = (payload: AppEvents[E]) => Promise<void> | void;

const handlers: { [E in EventName]?: Set<Handler<E>> } = {};

export function on<E extends EventName>(event: E, handler: Handler<E>): void {
  const bucket = handlers[event];
  if (bucket) {
    bucket.add(handler);
    return;
  }
  handlers[event] = new Set([handler]) as (typeof handlers)[E];
}

export function emit<E extends EventName>(event: E, payload: AppEvents[E]): void {
  const bucket = handlers[event];
  if (!bucket || bucket.size === 0) {
    eventsLog.warn({ event }, 'event_no_subscribers');
    return;
  }

  // setImmediate, not process.nextTick: nextTick runs before any pending I/O
  // and could pile up if many emits land in one turn. setImmediate puts the
  // work after pending I/O completes — the HTTP response goes out first,
  // handlers run after.
  setImmediate(async () => {
    const results = await Promise.allSettled(
      Array.from(bucket).map(async (h) => {
        try {
          await h(payload as AppEvents[EventName]);
        } catch (err) {
          eventsLog.error(
            {
              event,
              err: err instanceof Error ? err.message : String(err),
            },
            'event_handler_threw',
          );
        }
      }),
    );
    const rejected = results.filter((r) => r.status === 'rejected').length;
    if (rejected > 0) {
      eventsLog.error({ event, rejected }, 'event_handlers_some_failed');
    }
  });
}
