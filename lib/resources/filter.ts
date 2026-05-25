import type { ResourceRow } from '@/lib/content/types';

// =============================================================================
// HVA-156-FIX2 + HVA-121: client-side filter + search for the Resources
// read surface
// =============================================================================
//
// The dataset is small (admin posts a handful per week) and the UI lives
// in a client component (Web Share API requires it), so the read query
// pulls every visible resource and the filter / search runs in memory.
//
// Filter semantics:
//   * categoryId: undefined → all categories pass; otherwise exact match
//   * tagFilter: empty / undefined → all rows pass; otherwise row must
//     contain at least one of the requested tags (OR semantics; matches
//     the chip-multi-select UX)
//   * search: case-insensitive substring match against title +
//     description + tags joined.
// =============================================================================

export interface ResourceFilter {
  categoryId?: string;
  tags?: string[];
  search?: string;
}

export function filterResources(
  rows: ResourceRow[],
  filter: ResourceFilter,
): ResourceRow[] {
  const query = (filter.search ?? '').trim().toLowerCase();
  const tagSet =
    filter.tags && filter.tags.length > 0
      ? new Set(filter.tags.map((t) => t.toLowerCase()))
      : null;
  const categoryId = filter.categoryId;

  return rows.filter((r) => {
    if (categoryId && r.categoryId !== categoryId) return false;
    if (tagSet) {
      const hasOverlap = r.tags.some((t) => tagSet.has(t.toLowerCase()));
      if (!hasOverlap) return false;
    }
    if (query.length > 0) {
      const haystack = `${r.title} ${r.description ?? ''} ${r.tags.join(' ')} ${r.categoryName}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
