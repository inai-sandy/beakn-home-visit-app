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
import {
  RESOURCE_CATEGORY_LABELS,
  type ResourceCategory,
  type ResourceRow,
} from '@/lib/content/types';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-156: ResourcesClient — admin list + create/edit modal
// =============================================================================

const CATEGORY_OPTIONS: ResourceCategory[] = [
  'sales_scripts',
  'pricing',
  'brand_assets',
  'training',
  'other',
];

interface FormState {
  mode: 'create' | { mode: 'edit'; id: string };
  category: ResourceCategory;
  title: string;
  body: string;
  isPublished: boolean;
}

function emptyForm(): FormState {
  return {
    mode: 'create',
    category: 'sales_scripts',
    title: '',
    body: '',
    isPublished: true,
  };
}

function formFromRow(row: ResourceRow): FormState {
  return {
    mode: { mode: 'edit', id: row.id },
    category: row.category,
    title: row.title,
    body: row.body,
    isPublished: row.isPublished,
  };
}

export function ResourcesClient({ resources }: { resources: ResourceRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function openCreate() {
    setForm(emptyForm());
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
    if (form.body.trim().length < 1) {
      toast.error('Body cannot be empty');
      return;
    }
    setSubmitting(true);
    try {
      const result =
        form.mode === 'create'
          ? await createResourceAction({
              category: form.category,
              title: form.title.trim(),
              body: form.body.trim(),
            } satisfies CreateResourceInput)
          : await updateResourceAction({
              id: form.mode.id,
              category: form.category,
              title: form.title.trim(),
              body: form.body.trim(),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {resources.length} resource{resources.length === 1 ? '' : 's'}
        </p>
        <Button type="button" onClick={openCreate}>
          <Icon name="add" size="sm" />
          Add resource
        </Button>
      </div>

      {resources.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <Icon
            name="menu_book"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No resources yet. Add the first one to make it visible to the team.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {resources.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border bg-card p-4 shadow-sm flex items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {RESOURCE_CATEGORY_LABELS[r.category]}
                  </Badge>
                  {!r.isPublished && (
                    <Badge variant="outline" className="text-[10px]">
                      Unpublished
                    </Badge>
                  )}
                </div>
                <p className="text-base font-semibold tracking-tight">
                  {r.title}
                </p>
                <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-2">
                  {r.body}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {r.authorName ?? '—'} · updated{' '}
                  {r.updatedAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openEdit(r)}
              >
                <Icon name="edit" size="xs" />
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {form.mode === 'create' ? 'Add a resource' : 'Edit resource'}
            </DialogTitle>
            <DialogDescription>
              Visible to every captain and executive when published.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resource-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, category: v as ResourceCategory }))
                }
                disabled={busy}
              >
                <SelectTrigger id="resource-category" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {RESOURCE_CATEGORY_LABELS[c]}
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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource-body">
                Body <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="resource-body"
                value={form.body}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    body: e.target.value.slice(0, 20_000),
                  }))
                }
                rows={8}
                maxLength={20_000}
                disabled={busy}
              />
              <p
                className={cn(
                  'text-[11px]',
                  form.body.length >= 19_500
                    ? 'text-amber-600'
                    : 'text-muted-foreground',
                )}
              >
                {form.body.length} / 20000
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
