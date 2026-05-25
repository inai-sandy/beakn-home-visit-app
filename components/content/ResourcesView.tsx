'use client';

import { useMemo, useState } from 'react';
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
import type {
  ResourceCategoryRow,
  ResourceRow,
} from '@/lib/content/types';

// =============================================================================
// HVA-156-FIX1: ResourcesView — read surface shared by both portals
// =============================================================================
//
// Client component. Renders the flat list of published resources with a
// category-dropdown filter + title search box. Each row exposes:
//   - "Open" — opens the URL in a new tab (target=_blank, noopener+noreferrer)
//   - "Share" — Web Share API (native phone share sheet → WhatsApp / Gmail /
//      anything the user has installed); falls back to copy-link with a
//      toast on browsers that don't expose navigator.share
//
// Filtering + search run client-side over the loaded array. The volume is
// small enough (one admin posts a handful per week) that an in-memory
// filter is the right call — no server round-trips per keystroke.
// =============================================================================

const ALL_CATEGORIES = '__all__';

interface Props {
  resources: ResourceRow[];
  categories: ResourceCategoryRow[];
}

export function ResourcesView({ resources, categories }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (categoryFilter !== ALL_CATEGORIES && r.categoryId !== categoryFilter) {
        return false;
      }
      if (q.length === 0) return true;
      const haystack = `${r.title} ${r.description ?? ''} ${r.categoryName}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [resources, categoryFilter, search]);

  async function onShare(r: ResourceRow) {
    const shareData = {
      title: r.title,
      text: r.description ? `${r.title} — ${r.description}` : r.title,
      url: r.url,
    };
    // Web Share API: opens the OS-native share sheet (WhatsApp, Gmail, etc.)
    // when supported. Mobile browsers on iOS + Android Chrome all expose it.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // AbortError is fired when the user dismisses the sheet — that's
        // not an error worth surfacing. Anything else falls through to the
        // copy-link fallback.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    // Fallback: copy to clipboard + toast.
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
          <Select
            value={categoryFilter}
            onValueChange={setCategoryFilter}
          >
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
            placeholder="Search by title or description"
            className="h-11 pl-9"
            aria-label="Search resources"
          />
        </div>
      </div>

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
              className="rounded-2xl border bg-card p-4 shadow-sm space-y-3"
            >
              <div className="space-y-1.5">
                <Badge
                  variant="secondary"
                  className="text-[10px] uppercase tracking-wide"
                >
                  {r.categoryName}
                </Badge>
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
                <Button
                  type="button"
                  asChild
                  className="flex-1 h-11"
                >
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
