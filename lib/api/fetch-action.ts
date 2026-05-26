// =============================================================================
// 2026-05-26: fetch → ActionResult adapter for useServerMutation
// =============================================================================
//
// useServerMutation expects an `(input) => Promise<ActionResult<T>>` shape.
// Many callsites in the app still hit API routes via raw fetch() and
// hand-roll the busy / refresh / toast quadruplet. Wrapping those routes
// through this helper lets them drop into useServerMutation alongside
// every other migrated mutation site without rewriting the route handler.
//
// The helper:
//   - composes a URL from `urlFor(input)` so each modal can use the
//     same wrapped action even when the route path embeds an id
//   - serializes the input as JSON (the existing route handlers all
//     parse req.json()); pass `bodyFor` to override
//   - normalises the response: HTTP error or `{ ok: false }` payload
//     collapse to an ActionResult error with `message ?? error ?? status`
//   - never throws — useServerMutation already wraps in try/catch, but
//     the explicit `ok: false` keeps the path readable
//
// Field-level error pass-through: the existing routes return
// `{ ok: false, error, message?, fieldErrors? }`. The hook now consumes
// fieldErrors via the onError(error, fieldErrors) second arg (added in
// PR6), so inline per-field errors keep working for any modal that
// surfaces them.
// =============================================================================

type ActionResult<T> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface FetchActionOptions<TInput, TData> {
  urlFor: (input: TInput) => string;
  method?: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Override the request body. Default: JSON.stringify(input). Return
   *  `null` for "no body" (DELETE without payload). */
  bodyFor?: (input: TInput) => BodyInit | null;
  /** Override the success message extraction. Default: returns the
   *  whole JSON payload as data. */
  dataFor?: (json: unknown) => TData | undefined;
}

export function createFetchAction<TInput, TData = unknown>(
  options: FetchActionOptions<TInput, TData>,
): (input: TInput) => Promise<ActionResult<TData>> {
  const method = options.method ?? 'POST';

  return async (input) => {
    try {
      const url = options.urlFor(input);
      const body = options.bodyFor
        ? options.bodyFor(input)
        : input === undefined || input === null
          ? null
          : JSON.stringify(input);
      const res = await fetch(url, {
        method,
        headers: body === null ? undefined : { 'Content-Type': 'application/json' },
        body: body ?? undefined,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        fieldErrors?: Record<string, string>;
        [k: string]: unknown;
      };
      if (!res.ok || json.ok === false) {
        return {
          ok: false,
          error:
            json.message ??
            json.error ??
            `Request failed (${res.status}).`,
          fieldErrors: json.fieldErrors,
        };
      }
      const data = options.dataFor ? options.dataFor(json) : (json as TData);
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? `Network error: ${err.message}` : 'Network error',
      };
    }
  };
}
