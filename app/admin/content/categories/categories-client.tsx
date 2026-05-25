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
  createResourceCategoryAction,
  updateResourceCategoryAction,
  type CreateResourceCategoryInput,
  type UpdateResourceCategoryInput,
} from '@/lib/content/actions';
import type { ResourceCategoryRow } from '@/lib/content/types';

// =============================================================================
// HVA-156-FIX1: CategoriesClient — admin CRUD for resource_categories
// =============================================================================
//
// No deletes per the architectural lock — admin toggles `is_active=false`
// to hide a category from new uploads + the read-surface filter dropdown.
// Existing resources keep their FK reference (the row stays visible to
// admin with an "Inactive" badge).
// =============================================================================

interface FormState {
  mode: 'create' | { mode: 'edit'; id: string };
  name: string;
  sortOrder: number;
  isActive: boolean;
}

function emptyForm(suggestedSortOrder: number): FormState {
  return {
    mode: 'create',
    name: '',
    sortOrder: suggestedSortOrder,
    isActive: true,
  };
}

function formFromRow(row: ResourceCategoryRow): FormState {
  return {
    mode: { mode: 'edit', id: row.id },
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

export function CategoriesClient({
  categories,
}: {
  categories: ResourceCategoryRow[];
}) {
  const router = useRouter();
  const nextSort =
    categories.length === 0
      ? 10
      : Math.max(...categories.map((c) => c.sortOrder)) + 10;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(nextSort));
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function openCreate() {
    setForm(emptyForm(nextSort));
    setOpen(true);
  }

  function openEdit(row: ResourceCategoryRow) {
    setForm(formFromRow(row));
    setOpen(true);
  }

  async function onSubmit() {
    if (busy) return;
    if (form.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    setSubmitting(true);
    try {
      const result =
        form.mode === 'create'
          ? await createResourceCategoryAction({
              name: form.name.trim(),
              sortOrder: form.sortOrder,
            } satisfies CreateResourceCategoryInput)
          : await updateResourceCategoryAction({
              id: form.mode.id,
              name: form.name.trim(),
              sortOrder: form.sortOrder,
              isActive: form.isActive,
            } satisfies UpdateResourceCategoryInput);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(form.mode === 'create' ? 'Category added' : 'Category updated');
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
        </p>
        <Button type="button" onClick={openCreate}>
          <Icon name="add" size="sm" />
          Add category
        </Button>
      </div>

      {categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <Icon
            name="label"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No categories yet. Add the first one so resources can be filed
            under it.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {categories.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border bg-card p-4 shadow-sm flex items-center gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-base font-semibold tracking-tight">
                    {c.name}
                  </p>
                  {!c.isActive && (
                    <Badge variant="outline" className="text-[10px]">
                      Inactive
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Slug: {c.slug} · Sort order: {c.sortOrder}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openEdit(c)}
              >
                <Icon name="edit" size="xs" />
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.mode === 'create' ? 'Add a category' : 'Edit category'}
            </DialogTitle>
            <DialogDescription>
              Categories appear in the filter dropdown on the team's
              Resources page.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value.slice(0, 80) }))
                }
                maxLength={80}
                disabled={busy}
                className="h-11"
                placeholder="e.g. Customer testimonials"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cat-sort">Sort order</Label>
              <Input
                id="cat-sort"
                type="number"
                min={0}
                max={9999}
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    sortOrder: Number(e.target.value) || 0,
                  }))
                }
                disabled={busy}
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground">
                Lower values appear first in the filter dropdown.
              </p>
            </div>

            {form.mode !== 'create' && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                <Label
                  htmlFor="cat-active"
                  className="text-sm flex-1 cursor-pointer"
                >
                  Active — shown in filter + new-resource dropdowns
                </Label>
                <input
                  id="cat-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, isActive: e.target.checked }))
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
                'Add category'
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
