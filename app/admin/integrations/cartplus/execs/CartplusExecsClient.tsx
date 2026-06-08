'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import type { CartplusExecRow } from '@/lib/admin/cartplus';

import { updateCartplusExecMappingAction } from '../actions';

// =============================================================================
// HVA-248 / HVA-248-FIX2: per-row card editor for users ↔ CartPlus created_by.id
// =============================================================================

interface Props {
  rows: CartplusExecRow[];
}

export function CartplusExecsClient({ rows }: Props) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <ExecRowCard key={r.userId} row={r} />
      ))}
    </ul>
  );
}

function ExecRowCard({ row }: { row: CartplusExecRow }) {
  const [input, setInput] = useState<string>(
    row.portalExecId === null ? '' : String(row.portalExecId),
  );
  const { mutate, isPending } = useServerMutation(
    updateCartplusExecMappingAction,
    { successMessage: 'Saved' },
  );

  const trimmed = input.trim();
  const parsed = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
  const isInvalid =
    trimmed.length > 0 && (!Number.isFinite(parsed) || parsed! <= 0);
  const dirty = (parsed ?? null) !== row.portalExecId;

  function onSave() {
    if (isInvalid) return;
    void mutate({
      userId: row.userId,
      portalExecId: parsed,
    });
  }

  return (
    <li className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold tracking-tight">
              {row.fullName}
            </h3>
            <Badge variant="outline" className="text-xs">
              {row.role === 'sales_executive' ? 'Exec' : 'Captain'}
            </Badge>
            {row.portalExecId === null ? (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Unmapped
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
              >
                Mapped
              </Badge>
            )}
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="font-medium text-foreground/70">Phone</span>{' '}
              {row.phone}
            </div>
            <div>
              <span className="font-medium text-foreground/70">
                Last webhook
              </span>{' '}
              {row.lastWebhookAt
                ? row.lastWebhookAt.toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                  })
                : 'Never'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            CartPlus ID
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="—"
              disabled={isPending}
              className={`mt-1 w-32 ${isInvalid ? 'border-destructive' : ''}`}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending || isInvalid || !dirty}
            onClick={onSave}
            className="self-end"
          >
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </li>
  );
}
