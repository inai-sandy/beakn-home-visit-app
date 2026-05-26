// =============================================================================
// HVA-153: pagination helpers shared across the list surfaces
// =============================================================================
//
// Three list pages (/captain/requests, /captain/contacts, /leads) move
// to server-side LIMIT/OFFSET pagination in this ticket. The helpers
// below centralise:
//
//   - parsing `?page=` from searchParams (with clamping + sane defaults)
//   - computing `from / to / totalPages` for the page-status line
//   - building list URLs with filter overrides and "reset to page 1" on
//     any filter change
//
// Page size is fixed at 10 per Sandeep's universal UX policy (2026-05-26):
// every list page paginates with 10 rows per page. If a future ticket
// needs an override it lands as a `?size=` param driven by the same parser.
// =============================================================================

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

export interface PageRange {
  /** 1-indexed page number, clamped into [1, totalPages]. */
  page: number;
  totalPages: number;
  /** 1-indexed inclusive row position of the first row on this page. 0 if total=0. */
  from: number;
  /** 1-indexed inclusive row position of the last row on this page. 0 if total=0. */
  to: number;
  /** SQL OFFSET for this page (0-indexed). */
  offset: number;
  pageSize: number;
  total: number;
}

export function parsePage(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return n;
}

export function parsePageSize(raw: unknown): number {
  if (typeof raw !== 'string') return DEFAULT_PAGE_SIZE;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_PAGE_SIZE;
  if (n > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return n;
}

export function computePageRange(input: {
  total: number;
  page: number;
  pageSize?: number;
}): PageRange {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const total = Math.max(0, input.total);
  const totalPages = total === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const offset = (page - 1) * pageSize;
  const from = total === 0 ? 0 : offset + 1;
  const to = total === 0 ? 0 : Math.min(offset + pageSize, total);
  return { page, totalPages, from, to, offset, pageSize, total };
}

// =============================================================================
// URL composition
// =============================================================================
//
// The captain bucket tabs and the page nav both need to build URLs that
// preserve the current filter state and override a subset of keys.
// `buildListUrl` is the lone helper.
//
// Semantics (D8 from the bundle):
//   - "Any non-page filter change resets page = 1." Implemented as:
//     if `override` contains *anything* other than `page`, drop the
//     current `page` from the output. If the only override is `page`,
//     keep all other params.
//   - Null / undefined / empty-string overrides REMOVE the param.
//
// The function returns a path string suitable for `router.push(...)` or
// `<Link href=...>`. Always starts with `pathname`.
// =============================================================================

type FilterValue = string | number | null | undefined;

export interface ListFilterOverrides {
  q?: FilterValue;
  type?: FilterValue;
  exec?: FilterValue;
  city?: FilterValue;
  bucket?: FilterValue;
  page?: FilterValue;
}

function isEmpty(v: FilterValue): boolean {
  return v === null || v === undefined || v === '';
}

export function buildListUrl(
  pathname: string,
  current: URLSearchParams | Record<string, string | string[] | undefined>,
  overrides: ListFilterOverrides,
): string {
  const next = new URLSearchParams();

  // Seed from `current`. Accept both URLSearchParams (from
  // `useSearchParams()`) and a plain Record (from Next's `searchParams`
  // prop on a server component).
  if (current instanceof URLSearchParams) {
    current.forEach((v, k) => next.set(k, v));
  } else {
    for (const [k, v] of Object.entries(current)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        if (v[0] != null) next.set(k, v[0]);
      } else {
        next.set(k, v);
      }
    }
  }

  // Reset-page-on-filter-change rule.
  const overrideKeys = Object.keys(overrides) as (keyof ListFilterOverrides)[];
  const hasNonPageOverride = overrideKeys.some((k) => k !== 'page');
  if (hasNonPageOverride && overrides.page === undefined) {
    next.delete('page');
  }

  // Apply overrides. Empty → delete; non-empty → set.
  for (const key of overrideKeys) {
    const v = overrides[key];
    if (isEmpty(v)) {
      next.delete(key);
    } else {
      next.set(key, String(v));
    }
  }

  // Drop the default-1 page so URLs stay clean ("?page=1" is noise).
  if (next.get('page') === '1') next.delete('page');

  const qs = next.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
}
