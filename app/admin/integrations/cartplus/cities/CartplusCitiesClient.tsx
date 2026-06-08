'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import type { CartplusCityRow } from '@/lib/admin/cartplus';

import { updateCartplusCityMappingAction } from '../actions';

// =============================================================================
// HVA-248: per-row inline editor for cities ↔ CartPlus store_id
// =============================================================================

interface Props {
  rows: CartplusCityRow[];
}

export function CartplusCitiesClient({ rows }: Props) {
  return (
    <div className="rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left">City</th>
            <th className="px-4 py-2 text-left">State</th>
            <th className="px-4 py-2 text-left">CartPlus store ID</th>
            <th className="px-4 py-2 text-left">Last webhook</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <CityRow key={r.cityId} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CityRow({ row }: { row: CartplusCityRow }) {
  const [input, setInput] = useState<string>(
    row.cartplusStoreId === null ? '' : String(row.cartplusStoreId),
  );
  const { mutate, isPending } = useServerMutation(
    updateCartplusCityMappingAction,
    { successMessage: 'Saved' },
  );

  const trimmed = input.trim();
  const parsed = trimmed.length === 0 ? null : Number.parseInt(trimmed, 10);
  const isInvalid = trimmed.length > 0 && (!Number.isFinite(parsed) || parsed! <= 0);
  const dirty = (parsed ?? null) !== row.cartplusStoreId;

  function onSave() {
    if (isInvalid) return;
    void mutate({
      cityId: row.cityId,
      cartplusStoreId: parsed,
    });
  }

  return (
    <tr className="border-t">
      <td className="px-4 py-3 font-medium">{row.cityName}</td>
      <td className="px-4 py-3 text-muted-foreground">{row.state ?? '—'}</td>
      <td className="px-4 py-3">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="—"
          disabled={isPending}
          className={`w-32 ${isInvalid ? 'border-destructive' : ''}`}
        />
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {row.lastWebhookAt
          ? row.lastWebhookAt.toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })
          : 'Never'}
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || isInvalid || !dirty}
          onClick={onSave}
        >
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </td>
    </tr>
  );
}
