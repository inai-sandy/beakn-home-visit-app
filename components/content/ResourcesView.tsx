'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { filterResources } from '@/lib/resources/filter';
import type {
  ResourceCategoryRow,
  ResourceRow,
} from '@/lib/content/types';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-156-FIX2: ResourcesView — read surface with category + tag filters
// =============================================================================
//
// Filter UI:
//   * category dropdown
//   * text search (title / description / tags)
//   * tag chip row (multi-select — OR semantics; matches any selected tag)
//
// Per-row actions:
//   * Open — opens the URL in a new tab
//   * Share — Web Share API; copy-to-clipboard fallback on desktop
//
// Tag chip row is rendered only when there's at least one tag across all
// loaded resources, otherwise it's hidden (no UI noise on a tag-free dataset).
// =============================================================================

const ALL_CATEGORIES = '__all__';

interface Props {
  resources: ResourceRow[];
  categories: ResourceCategoryRow[];
  /** Optional per-card overlay rendered in the top-right corner. Admin
   *  uses this to surface an Edit icon-button so the admin list and the
   *  team's read surface share the same card shape. */
  renderRowOverlay?: (resource: ResourceRow) => ReactNode;
}

export function ResourcesView({
  resources,
  categories,
  renderRowOverlay,
}: Props) {
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources) {
      for (const t of r.tags) set.add(t.toLowerCase());
    }
    return Array.from(set).sort();
  }, [resources]);

  const filtered = useMemo(() => {
    return filterResources(resources, {
      categoryId:
        categoryFilter === ALL_CATEGORIES ? undefined : categoryFilter,
      tags: activeTags,
      search,
    });
  }, [resources, categoryFilter, search, activeTags]);

  function toggleTag(t: string) {
    setActiveTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  async function onShare(r: ResourceRow) {
    const shareData = {
      title: r.title,
      text: r.description ? `${r.title} — ${r.description}` : r.title,
      url: r.url,
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(r.url);
      toast.success('Link copied — paste into WhatsApp / Gmail');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  if (resources.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
        <Icon
          name="menu_book"
          size="lg"
          className="text-muted-foreground/60 mx-auto mb-3"
          aria-hidden
        />
        <h2 className="text-lg font-semibold tracking-tight">
          No resources yet
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Admin posts sales scripts, brochures, brand assets, and training
          material here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter + search controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="sm:w-48">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-11" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1">
          <Icon
            name="search"
            size="sm"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, description, tag"
            className="h-11 pl-9"
            aria-label="Search resources"
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label="Filter by tag"
        >
          {allTags.map((t) => {
            const active = activeTags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] tracking-wide transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card hover:bg-muted border-border text-foreground/80',
                )}
                aria-pressed={active}
              >
                #{t}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {filtered.length} of {resources.length} resource
        {resources.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No resources match the filter.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border bg-card p-4 shadow-sm space-y-3 relative"
            >
              {renderRowOverlay && (
                <div className="absolute top-3 right-3">
                  {renderRowOverlay(r)}
                </div>
              )}
              <div className="space-y-1.5 pr-10">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {r.categoryName}
                  </Badge>
                  {!r.isPublished && (
                    <Badge variant="outline" className="text-[10px]">
                      Unpublished
                    </Badge>
                  )}
                  {r.tags.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="text-[10px]"
                    >
                      #{t}
                    </Badge>
                  ))}
                </div>
                <p className="text-base font-semibold tracking-tight">
                  {r.title}
                </p>
                {r.description && (
                  <p className="text-sm text-foreground/80">{r.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {r.authorName ?? '—'} · updated{' '}
                  {r.updatedAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" asChild className="flex-1 h-11">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="open_in_new" size="sm" />
                    Open
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onShare(r)}
                  className="flex-1 h-11"
                >
                  <Icon name="share" size="sm" />
                  Share
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
