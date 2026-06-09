'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import type { TicketCategoryRow } from '@/lib/support-tickets/category-queries';
import { cn } from '@/lib/utils';

import {
  createTicketCategoryAction,
  updateTicketCategoryAction,
} from '../actions';

// =============================================================================
// HVA-256-FIX1: admin CRUD UI for ticket categories
// =============================================================================

interface Props {
  categories: TicketCategoryRow[];
}

export function TicketCategoriesClient({ categories }: Props) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {categories.length} categor
          {categories.length === 1 ? 'y' : 'ies'} configured
        </p>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <Icon name="add" size="xs" />
          Add category
        </Button>
      </div>

      <ul className="space-y-3">
        {categories.map((c) => (
          <CategoryRow key={c.id} row={c} />
        ))}
        {adding ? (
          <AddCategoryRow
            existingCodes={new Set(categories.map((c) => c.code))}
            nextDisplayOrder={
              categories.length === 0
                ? 10
                : Math.max(...categories.map((c) => c.displayOrder)) + 10
            }
            onDone={() => setAdding(false)}
          />
        ) : null}
      </ul>
    </div>
  );
}

function CategoryRow({ row }: { row: TicketCategoryRow }) {
  const [name, setName] = useState(row.name);
  const [displayOrder, setDisplayOrder] = useState(String(row.displayOrder));
  const [isActive, setIsActive] = useState(row.isActive);

  const { mutate, isPending } = useServerMutation(
    updateTicketCategoryAction,
    { successMessage: 'Updated' },
  );

  const dirty =
    name !== row.name ||
    Number.parseInt(displayOrder, 10) !== row.displayOrder ||
    isActive !== row.isActive;

  function onSave() {
    const parsedOrder = Number.parseInt(displayOrder, 10);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) return;
    void mutate({
      id: row.id,
      name: name.trim(),
      displayOrder: parsedOrder,
      isActive,
    });
  }

  return (
    <li className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono font-semibold">{row.code}</code>
            {row.isActive ? (
              <Badge
                variant="outline"
                className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
              >
                Active
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Inactive
              </Badge>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">
                Display name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                maxLength={100}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Display order
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                disabled={isPending}
                className="mt-1 w-24"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIsActive(!isActive)}
                disabled={isPending}
              >
                {isActive ? 'Active' : 'Inactive'}
              </Button>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={isPending || !dirty}
          className="self-end"
        >
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </li>
  );
}

function AddCategoryRow({
  existingCodes,
  nextDisplayOrder,
  onDone,
}: {
  existingCodes: Set<string>;
  nextDisplayOrder: number;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [displayOrder, setDisplayOrder] = useState(String(nextDisplayOrder));

  const { mutate, isPending } = useServerMutation(createTicketCategoryAction, {
    successMessage: 'Category created',
    onSuccess: () => onDone(),
  });

  const codeValid = /^[a-z][a-z0-9_]*$/.test(code) && !existingCodes.has(code);
  const ready = codeValid && name.trim().length > 0 && displayOrder.length > 0;

  function onCreate() {
    if (!ready) return;
    const parsedOrder = Number.parseInt(displayOrder, 10);
    if (!Number.isFinite(parsedOrder) || parsedOrder < 0) return;
    void mutate({
      code: code.trim(),
      name: name.trim(),
      displayOrder: parsedOrder,
    });
  }

  return (
    <li className="rounded-3xl border-2 border-dashed border-primary/40 bg-primary/5 p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            New category
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">
                Code (immutable)
              </label>
              <Input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
                disabled={isPending}
                placeholder="e.g. refund_partial"
                maxLength={64}
                className={cn(
                  'mt-1 font-mono',
                  code && !codeValid ? 'border-destructive' : '',
                )}
              />
              {code && existingCodes.has(code) ? (
                <p className="text-[11px] text-destructive mt-1">
                  Already exists
                </p>
              ) : null}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Display name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                placeholder="e.g. Partial refund"
                maxLength={100}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Display order
              </label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                disabled={isPending}
                className="mt-1 w-24"
              />
            </div>
          </div>
        </div>
        <div className="flex items-end gap-2 self-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDone}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={onCreate} disabled={isPending || !ready}>
            {isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </li>
  );
}
