'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import type { CartplusCityRow } from '@/lib/admin/cartplus';

import { updateCartplusCityMappingAction } from '../actions';

// =============================================================================
// HVA-248 / HVA-248-FIX2: per-row card editor for cities ↔ CartPlus store_id
// =============================================================================

interface Props {
  rows: CartplusCityRow[];
}

export function CartplusCitiesClient({ rows }: Props) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <CityRowCard key={r.cityId} row={r} />
      ))}
    </ul>
  );
}

function CityRowCard({ row }: { row: CartplusCityRow }) {
  const [input, setInput] = useState<string>(
    row.cartplusStoreId === null ? '' : String(row.cartplusStoreId),
  );
  const { mutate, isPending } = useServerMutation(
    updateCartplusCityMappingAction,
    { successMessage: 'Saved' },
  );

  const trimmed = input.trim();
  const parsed = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
  const isInvalid =
    trimmed.length > 0 && (!Number.isFinite(parsed) || parsed! <= 0);
  const dirty = (parsed ?? null) !== row.cartplusStoreId;

  function onSave() {
    if (isInvalid) return;
    void mutate({
      cityId: row.cityId,
      cartplusStoreId: parsed,
    });
  }

  return (
    <li className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold tracking-tight">
              {row.cityName}
            </h3>
            {row.state ? (
              <Badge variant="outline" className="text-xs">
                {row.state}
              </Badge>
            ) : null}
            {row.cartplusStoreId === null ? (
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
          <p className="text-xs text-muted-foreground">
            Last webhook:{' '}
            {row.lastWebhookAt
              ? row.lastWebhookAt.toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })
              : 'Never'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            store.id
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
