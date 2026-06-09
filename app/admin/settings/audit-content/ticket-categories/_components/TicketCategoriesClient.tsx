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
import type { TicketCategoryRow } from '@/lib/support-tickets/category-queries';

import {
  createTicketCategoryAction,
  updateTicketCategoryAction,
} from '../actions';

// =============================================================================
// HVA-256-FIX2: admin CRUD UI — mirrors announcement-categories pattern
// =============================================================================
//
// Dialog-based create + edit (NOT in-line editing). Row: tight one-line
// card with Edit button on the right. Code field locked on edit so
// downstream code-side branches (refund auto-close) keep working.
// =============================================================================

type FormState = {
  mode: 'create' | { mode: 'edit'; id: string; code: string };
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
};

function emptyForm(suggestedOrder: number): FormState {
  return {
    mode: 'create',
    code: '',
    name: '',
    displayOrder: suggestedOrder,
    isActive: true,
  };
}

function formFromRow(row: TicketCategoryRow): FormState {
  return {
    mode: { mode: 'edit', id: row.id, code: row.code },
    code: row.code,
    name: row.name,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
  };
}

export function TicketCategoriesClient({
  categories,
}: {
  categories: TicketCategoryRow[];
}) {
  const router = useRouter();
  const existingCodes = new Set(categories.map((c) => c.code));
  const nextOrder =
    categories.length === 0
      ? 10
      : Math.max(...categories.map((c) => c.displayOrder)) + 10;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(nextOrder));
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- router refresh
  const [, startTransition] = useTransition();

  const busy = submitting;

  function openCreate() {
    setForm(emptyForm(nextOrder));
    setOpen(true);
  }
  function openEdit(row: TicketCategoryRow) {
    setForm(formFromRow(row));
    setOpen(true);
  }

  async function onSubmit() {
    if (busy) return;
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    if (form.mode === 'create') {
      const codeValid = /^[a-z][a-z0-9_]*$/.test(form.code);
      if (!codeValid) {
        toast.error('Code must be lowercase letters/digits/underscores, starting with a letter');
        return;
      }
      if (existingCodes.has(form.code)) {
        toast.error('Code already exists');
        return;
      }
    }
    setSubmitting(true);
    try {
      const res =
        form.mode === 'create'
          ? await createTicketCategoryAction({
              code: form.code.trim(),
              name: trimmedName,
              displayOrder: form.displayOrder,
            })
          : await updateTicketCategoryAction({
              id: form.mode.id,
              name: trimmedName,
              displayOrder: form.displayOrder,
              isActive: form.isActive,
            });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        form.mode === 'create' ? 'Category added' : 'Category updated',
      );
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
            name="help_center"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No categories yet. Add the first one so customers can pick from it
            when raising a ticket.
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
                  Code: <code className="font-mono">{c.code}</code> · Display
                  order: {c.displayOrder}
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
              Categories appear in the customer's dropdown on{' '}
              <code>/track/[token]</code> when they raise a support ticket.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ticket-cat-code">
                Code{' '}
                {form.mode === 'create' ? (
                  <span className="text-destructive">*</span>
                ) : (
                  <span className="text-muted-foreground text-xs font-normal">
                    (locked)
                  </span>
                )}
              </Label>
              <Input
                id="ticket-cat-code"
                value={form.code}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    code: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, '')
                      .slice(0, 64),
                  }))
                }
                disabled={busy || form.mode !== 'create'}
                className="h-11 font-mono"
                placeholder="e.g. partial_refund"
                maxLength={64}
              />
              <p className="text-[11px] text-muted-foreground">
                {form.mode === 'create'
                  ? 'Lowercase letters, digits, underscores. Stays fixed after creation.'
                  : 'Code cannot change. Downstream logic (refund auto-close) reads by code.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticket-cat-name">
                Display name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ticket-cat-name"
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value.slice(0, 100) }))
                }
                maxLength={100}
                disabled={busy}
                className="h-11"
                placeholder="e.g. Partial refund"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticket-cat-sort">Display order</Label>
              <Input
                id="ticket-cat-sort"
                type="number"
                min={0}
                max={9999}
                value={form.displayOrder}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    displayOrder: Number(e.target.value) || 0,
                  }))
                }
                disabled={busy}
                className="h-11"
              />
              <p className="text-[11px] text-muted-foreground">
                Lower values appear first in the customer's dropdown.
              </p>
            </div>

            {form.mode !== 'create' && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                <Label
                  htmlFor="ticket-cat-active"
                  className="text-sm flex-1 cursor-pointer"
                >
                  Active — shown in /track dropdown for new tickets
                </Label>
                <input
                  id="ticket-cat-active"
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
