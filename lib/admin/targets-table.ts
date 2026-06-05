import {
  loadAllExecTargetProgress,
  loadMonthlyTargetPaise,
  type ExecTargetProgress,
  type TargetMonthWindow,
} from '@/lib/exec/target-progress';
import { loadAdminExecWarningRoster } from '@/lib/warnings/queries';
import { HARD_WARNING_FIRE_THRESHOLD } from '@/lib/warnings/metrics';

// =============================================================================
// HVA-229: unified team targets table (server-side loader)
// =============================================================================
//
// Merges three sources into one row per exec for /admin/targets:
//
//   - lib/exec/target-progress (orders / revenue / combined ratio)
//   - lib/warnings (active soft + hard counts)
//   - sales_executives + users (captain + city for filtering)
//
// All the filtering, sorting, and pagination happens server-side here
// — the page component just renders the result. Search runs across
// exec name + captain name + city name (case-insensitive substring).
//
// Filters:
//   - q          → free-text search
//   - captainId  → exact match on captain user_id
//   - cityName   → exact match on the single city assigned to the exec
//   - status     → 'none' | 'has_soft' | 'has_hard' | 'fire' | 'all'
//
// Sort: 'combined' (default desc) | 'name' | 'orders' | 'revenue'
//       | 'softActive' | 'hardActive'.
//
// Pagination: page (1-based), pageSize (default 20).
// =============================================================================

export interface TargetsTableRow {
  execUserId: string;
  execName: string;
  captainUserId: string | null;
  captainName: string | null;
  cityName: string | null;
  targetPaise: number;
  ordersPaise: number;
  revenuePaise: number;
  ordersRatio: number;
  revenueRatio: number;
  combinedRatio: number;
  softActive: number;
  hardActive: number;
  fireFlag: boolean;
}

export type TargetsTableSort =
  | 'combined'
  | 'name'
  | 'orders'
  | 'revenue'
  | 'softActive'
  | 'hardActive';

export type WarningStatusFilter =
  | 'all'
  | 'none'
  | 'has_soft'
  | 'has_hard'
  | 'fire';

export interface TargetsTableArgs {
  window: TargetMonthWindow;
  q?: string;
  captainId?: string;
  cityName?: string;
  status?: WarningStatusFilter;
  sort?: TargetsTableSort;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface TargetsTableResult {
  rows: TargetsTableRow[];
  totalRows: number;
  totalPages: number;
  page: number;
  pageSize: number;
  /** Distinct (captainUserId, captainName) tuples across the unfiltered
   *  exec set — drives the captain filter dropdown. */
  captainFacets: Array<{ id: string; name: string }>;
  /** Distinct city names across the unfiltered exec set. */
  cityFacets: string[];
  /** Aggregate counts (across the FILTERED set, not just this page) for
   *  the small header callouts. */
  aggregate: {
    totalOrdersPaise: number;
    totalRevenuePaise: number;
    totalTargetPaise: number;
    totalSoft: number;
    totalHard: number;
    fireCount: number;
  };
}

export const DEFAULT_PAGE_SIZE = 20;

function ratiosToCombined(p: ExecTargetProgress): number {
  return p.combinedRatio;
}

export async function loadTargetsTable(
  args: TargetsTableArgs,
): Promise<TargetsTableResult> {
  const monthlyTargetPaise = await loadMonthlyTargetPaise();
  const [targetRows, warningRoster] = await Promise.all([
    loadAllExecTargetProgress(args.window, monthlyTargetPaise),
    loadAdminExecWarningRoster(),
  ]);

  const warningByExec = new Map(
    warningRoster.map((w) => [w.execUserId, w]),
  );

  // 1. Build the full merged set (one row per exec).
  const merged: TargetsTableRow[] = targetRows.map((t) => {
    const w = warningByExec.get(t.execUserId);
    const softActive = w?.softActive ?? 0;
    const hardActive = w?.hardActive ?? 0;
    return {
      execUserId: t.execUserId,
      execName: t.fullName,
      captainUserId: w?.captainUserId ?? null,
      captainName: w?.captainName ?? null,
      cityName: t.cityNames[0] ?? null,
      targetPaise: t.targetPaise,
      ordersPaise: t.ordersPaise,
      revenuePaise: t.revenuePaise,
      ordersRatio: t.ordersRatio,
      revenueRatio: t.revenueRatio,
      combinedRatio: ratiosToCombined(t),
      softActive,
      hardActive,
      fireFlag: hardActive >= HARD_WARNING_FIRE_THRESHOLD,
    };
  });

  // 2. Facet values come from the UNFILTERED set so the dropdowns
  // don't shrink as the user narrows the view.
  const captainFacets = Array.from(
    new Map(
      merged
        .filter((r) => r.captainUserId && r.captainName)
        .map((r) => [
          r.captainUserId!,
          { id: r.captainUserId!, name: r.captainName! },
        ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const cityFacets = Array.from(
    new Set(
      merged.map((r) => r.cityName).filter((x): x is string => !!x),
    ),
  ).sort((a, b) => a.localeCompare(b));

  // 3. Apply filters.
  const qLower = args.q?.trim().toLowerCase() ?? '';
  let filtered = merged;
  if (qLower.length > 0) {
    filtered = filtered.filter((r) => {
      const hay = `${r.execName} ${r.captainName ?? ''} ${r.cityName ?? ''}`.toLowerCase();
      return hay.includes(qLower);
    });
  }
  if (args.captainId) {
    filtered = filtered.filter((r) => r.captainUserId === args.captainId);
  }
  if (args.cityName) {
    filtered = filtered.filter((r) => r.cityName === args.cityName);
  }
  if (args.status && args.status !== 'all') {
    filtered = filtered.filter((r) => {
      if (args.status === 'none') return r.softActive === 0 && r.hardActive === 0;
      if (args.status === 'has_soft') return r.softActive > 0;
      if (args.status === 'has_hard') return r.hardActive > 0;
      if (args.status === 'fire') return r.fireFlag;
      return true;
    });
  }

  // 4. Aggregate over the filtered set.
  const aggregate = filtered.reduce(
    (acc, r) => {
      acc.totalOrdersPaise += r.ordersPaise;
      acc.totalRevenuePaise += r.revenuePaise;
      acc.totalTargetPaise += r.targetPaise;
      acc.totalSoft += r.softActive;
      acc.totalHard += r.hardActive;
      if (r.fireFlag) acc.fireCount += 1;
      return acc;
    },
    {
      totalOrdersPaise: 0,
      totalRevenuePaise: 0,
      totalTargetPaise: 0,
      totalSoft: 0,
      totalHard: 0,
      fireCount: 0,
    },
  );

  // 5. Sort.
  const sortKey = args.sort ?? 'combined';
  const dir = args.direction ?? (sortKey === 'name' ? 'asc' : 'desc');
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') {
      cmp = a.execName.localeCompare(b.execName);
    } else if (sortKey === 'orders') {
      cmp = a.ordersRatio - b.ordersRatio;
    } else if (sortKey === 'revenue') {
      cmp = a.revenueRatio - b.revenueRatio;
    } else if (sortKey === 'softActive') {
      cmp = a.softActive - b.softActive;
    } else if (sortKey === 'hardActive') {
      cmp = a.hardActive - b.hardActive;
    } else {
      cmp = a.combinedRatio - b.combinedRatio;
    }
    return dir === 'asc' ? cmp : -cmp;
  });

  // 6. Paginate.
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, args.page ?? 1);
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize);

  return {
    rows,
    totalRows,
    totalPages,
    page: clampedPage,
    pageSize,
    captainFacets,
    cityFacets,
    aggregate,
  };
}
