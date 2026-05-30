'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createResourceAction,
  updateResourceAction,
  type CreateResourceInput,
  type UpdateResourceInput,
} from '@/lib/content/actions';
import { ResourcesView } from '@/components/content/ResourcesView';
import type {
  ResourceCategoryRow,
  ResourceRow,
  ResourceVisibility,
} from '@/lib/content/types';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-156-FIX1: ResourcesClient — admin list + create/edit modal
// =============================================================================
//
// Resources are URL bookmarks. Each row has a title, a URL (required), and
// an optional short description. Category is a single FK pick from the
// active admin-managed `resource_categories` list.
//
// Edit modal exposes the publish toggle; new resources are published by
// default. Unpublishing hides a row from the read surface without
// deleting the row (no deletes anywhere in the app).
// =============================================================================

interface FormState {
  mode: 'create' | { mode: 'edit'; id: string };
  categoryId: string;
  title: string;
  url: string;
  description: string;
  visibility: ResourceVisibility;
  tags: string[];
  tagDraft: string;
  isPublished: boolean;
}

function emptyForm(defaultCategoryId: string): FormState {
  return {
    mode: 'create',
    categoryId: defaultCategoryId,
    title: '',
    url: '',
    description: '',
    visibility: 'all',
    tags: [],
    tagDraft: '',
    isPublished: true,
  };
}

function formFromRow(row: ResourceRow): FormState {
  return {
    mode: { mode: 'edit', id: row.id },
    categoryId: row.categoryId,
    title: row.title,
    url: row.url,
    description: row.description ?? '',
    visibility: row.visibility,
    tags: [...row.tags],
    tagDraft: '',
    isPublished: row.isPublished,
  };
}

const VISIBILITY_LABEL: Record<ResourceVisibility, string> = {
  all: 'Everyone (captains + execs)',
  captains_only: 'Captains only',
  sales_execs_only: 'Sales execs only',
};

export function ResourcesClient({
  resources,
  categories,
}: {
  resources: ResourceRow[];
  /** All categories incl. inactive, for the dropdown. We list active ones
   *  for new resources; existing resources may reference inactive ones, so
   *  the dropdown shows everything but the inactive ones are visually marked. */
  categories: ResourceCategoryRow[];
}) {
  const router = useRouter();
  const activeCategories = categories.filter((c) => c.isActive);
  const defaultCategoryId = activeCategories[0]?.id ?? categories[0]?.id ?? '';

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(defaultCategoryId),
  );
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: mixed nav+mutation; HVA-149-cleanup TODO
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function openCreate() {
    setForm(emptyForm(defaultCategoryId));
    setOpen(true);
  }

  function openEdit(row: ResourceRow) {
    setForm(formFromRow(row));
    setOpen(true);
  }

  async function onSubmit() {
    if (busy) return;
    if (form.title.trim().length < 3) {
      toast.error('Title must be at least 3 characters');
      return;
    }
    if (form.url.trim().length === 0) {
      toast.error('URL is required');
      return;
    }
    if (!form.categoryId) {
      toast.error('Pick a category');
      return;
    }
    setSubmitting(true);
    try {
      const cleanedTags = Array.from(
        new Set(
          [...form.tags, form.tagDraft]
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
        ),
      );
      const result =
        form.mode === 'create'
          ? await createResourceAction({
              categoryId: form.categoryId,
              title: form.title.trim(),
              url: form.url.trim(),
              description: form.description.trim(),
              visibility: form.visibility,
              tags: cleanedTags,
            } satisfies CreateResourceInput)
          : await updateResourceAction({
              id: form.mode.id,
              categoryId: form.categoryId,
              title: form.title.trim(),
              url: form.url.trim(),
              description: form.description.trim(),
              visibility: form.visibility,
              tags: cleanedTags,
              isPublished: form.isPublished,
            } satisfies UpdateResourceInput);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(form.mode === 'create' ? 'Resource added' : 'Resource updated');
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  const noActiveCategories = activeCategories.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {resources.length} resource{resources.length === 1 ? '' : 's'}
        </p>
        <Button
          type="button"
          onClick={openCreate}
          disabled={noActiveCategories}
          title={
            noActiveCategories
              ? 'Add a category first before creating resources'
              : undefined
          }
        >
          <Icon name="add" size="sm" />
          Add resource
        </Button>
      </div>

      {noActiveCategories && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No active categories yet — go to{' '}
          <a
            href="/admin/settings/audit-content/categories"
            className="font-semibold underline"
          >
            Categories
          </a>{' '}
          and add one before creating resources.
        </p>
      )}

      {/* HVA-156-UI-unify: render the SAME ResourcesView the team sees on
          /resources + /captain/resources, with an overlay Edit icon-button
          per card (admin-only affordance). Admin still sees unpublished
          rows because the page query is loadAllResourcesForAdmin — the
          view component auto-shows the Unpublished badge. */}
      <ResourcesView
        resources={resources}
        categories={categories.filter((c) => c.isActive)}
        renderRowOverlay={(r) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full bg-background/80 backdrop-blur shadow-sm hover:bg-background"
            onClick={() => openEdit(r)}
            aria-label={`Edit ${r.title}`}
          >
            <Icon name="edit" size="sm" />
          </Button>
        )}
      />

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {form.mode === 'create' ? 'Add a resource' : 'Edit resource'}
            </DialogTitle>
            <DialogDescription>
              Resources are URL bookmarks. Sales execs and captains can open
              the link or share it with customers from their phone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resource-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, categoryId: v }))
                }
                disabled={busy}
              >
                <SelectTrigger id="resource-category" className="h-11">
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      disabled={!c.isActive && form.categoryId !== c.id}
                    >
                      {c.name}
                      {!c.isActive && (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                          inactive
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="resource-title"
                value={form.title}
                onChange={(e) =>
                  setForm((s) => ({ ...s, title: e.target.value.slice(0, 200) }))
                }
                maxLength={200}
                disabled={busy}
                className="h-11"
                placeholder="e.g. Q2 Brochure"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-url">
                URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="resource-url"
                type="url"
                value={form.url}
                onChange={(e) =>
                  setForm((s) => ({ ...s, url: e.target.value.slice(0, 2000) }))
                }
                maxLength={2000}
                disabled={busy}
                className="h-11"
                placeholder="https://drive.google.com/…"
              />
              <p className="text-[11px] text-muted-foreground">
                Paste a Google Drive / Dropbox / Notion / direct download link.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-description">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="resource-description"
                value={form.description}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    description: e.target.value.slice(0, 500),
                  }))
                }
                rows={3}
                maxLength={500}
                disabled={busy}
                placeholder="One-line context: PDF / 12 pages / use for premium customers"
              />
              <p
                className={cn(
                  'text-[11px]',
                  form.description.length >= 450
                    ? 'text-amber-600'
                    : 'text-muted-foreground',
                )}
              >
                {form.description.length} / 500
              </p>
            </div>

            <div className="space-y-2">
              <Label>Visibility</Label>
              <div className="flex flex-col gap-1.5">
                {(['all', 'captains_only', 'sales_execs_only'] as ResourceVisibility[]).map((v) => (
                  <label
                    key={v}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={v}
                      checked={form.visibility === v}
                      onChange={() =>
                        setForm((s) => ({ ...s, visibility: v }))
                      }
                      disabled={busy}
                    />
                    {VISIBILITY_LABEL[v]}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-tags">
                Tags <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="resource-tags"
                value={form.tagDraft}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    tagDraft: e.target.value.slice(0, 40),
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                    e.preventDefault();
                    const t = form.tagDraft.trim().toLowerCase();
                    if (t.length === 0) return;
                    setForm((s) => ({
                      ...s,
                      tags: Array.from(new Set([...s.tags, t])),
                      tagDraft: '',
                    }));
                  }
                }}
                maxLength={40}
                disabled={busy}
                className="h-11"
                placeholder="Type a tag and press Enter (e.g. 1bhk, premium)"
              />
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.tags.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="text-[10px] gap-1"
                    >
                      {t}
                      <button
                        type="button"
                        aria-label={`Remove tag ${t}`}
                        onClick={() =>
                          setForm((s) => ({
                            ...s,
                            tags: s.tags.filter((x) => x !== t),
                          }))
                        }
                        disabled={busy}
                        className="hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Free-form tags help execs filter on the read surface. Use
                short slugs like <code>1bhk</code>, <code>premium</code>.
                Tags are lowercased automatically.
              </p>
            </div>

            {form.mode !== 'create' && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                <Label
                  htmlFor="resource-published"
                  className="text-sm flex-1 cursor-pointer"
                >
                  Published — visible on the team's read surface
                </Label>
                <input
                  id="resource-published"
                  type="checkbox"
                  checked={form.isPublished}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, isPublished: e.target.checked }))
                  }
                  disabled={busy}
                  className="h-4 w-4"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit} disabled={busy}>
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Saving…
                </>
              ) : form.mode === 'create' ? (
                'Add resource'
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
