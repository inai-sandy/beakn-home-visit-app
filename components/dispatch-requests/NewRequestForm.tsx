'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createDispatchRequestAction } from '@/lib/dispatch-requests/actions';
import type { PickListOrder } from '@/lib/dispatch-requests/queries';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-342: the exec asks for stock off their own orders
// =============================================================================
//
// The screen that replaces the Assist form. There is no product field: every
// row here is a real line item on a real confirmed order, and the quantity
// box is capped at what that order still owes minus anything already asked
// for. An exec cannot express a request the order cannot back.
//
// Everything is pre-listed rather than searched. The exec opening this screen
// already knows which customer they are chasing, and on a phone a list they
// can scroll beats a picker they have to drive.
// =============================================================================

type Selection = Record<string, number>;

interface Props {
  orders: PickListOrder[];
}

const PRIORITIES = [
  { value: 'high', label: 'Urgent' },
  { value: 'medium', label: 'Normal' },
  { value: 'low', label: 'Whenever' },
] as const;

export function NewRequestForm({ orders }: Props) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection>({});
  const [priority, setPriority] =
    useState<(typeof PRIORITIES)[number]['value']>('medium');
  const [requiredByDate, setRequiredByDate] = useState('');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const availableById = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of orders) {
      for (const item of order.items) {
        map.set(item.lineItemId, item.quantityAvailable);
      }
    }
    return map;
  }, [orders]);

  const picked = Object.entries(selection).filter(([, qty]) => qty > 0);
  const totalUnits = picked.reduce((sum, [, qty]) => sum + qty, 0);
  const orderCount = orders.filter((o) =>
    o.items.some((i) => (selection[i.lineItemId] ?? 0) > 0),
  ).length;

  function toggle(lineItemId: string, defaultQty: number): void {
    setSelection((prev) => {
      const next = { ...prev };
      if ((next[lineItemId] ?? 0) > 0) {
        delete next[lineItemId];
      } else {
        next[lineItemId] = defaultQty;
      }
      return next;
    });
  }

  function setQty(lineItemId: string, raw: string): void {
    const max = availableById.get(lineItemId) ?? 0;
    const parsed = Number.parseInt(raw, 10);
    setSelection((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(parsed) || parsed <= 0) {
        // Empty box means "still selected, quantity not decided yet" rather
        // than an implicit deselect — clearing the field to retype should
        // not lose the tick.
        next[lineItemId] = 0;
        return next;
      }
      // Clamp rather than reject: typing 50 into a box that allows 5 should
      // land on 5, not throw an error the exec has to read and undo.
      next[lineItemId] = Math.min(parsed, max);
      return next;
    });
  }

  function onSubmit(): void {
    if (picked.length === 0) {
      toast.error('Pick at least one product');
      return;
    }
    const zero = picked.find(([, qty]) => qty <= 0);
    if (zero) {
      toast.error('Every ticked product needs a quantity');
      return;
    }

    startTransition(async () => {
      const result = await createDispatchRequestAction({
        items: picked.map(([lineItemId, qty]) => ({ lineItemId, qty })),
        priority,
        requiredByDate: requiredByDate || undefined,
        message: message.trim() || undefined,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Request sent to support');
      router.push(`/dispatch/requests/${result.data!.requestId}`);
      router.refresh();
    });
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Icon
          name="inventory_2"
          size="lg"
          className="text-muted-foreground"
          aria-hidden
        />
        <p className="mt-3 font-medium">Nothing to request</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every product on your confirmed orders has either shipped or is
          already on an open request.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {orders.map((order) => (
          <section
            key={order.requestId}
            className="rounded-lg border overflow-hidden"
          >
            <header className="bg-muted/40 px-4 py-3">
              <h2 className="font-medium leading-tight">
                {order.customerName}
              </h2>
              <p className="text-xs text-muted-foreground">{order.cityName}</p>
            </header>
            <ul className="divide-y">
              {order.items.map((item) => {
                const qty = selection[item.lineItemId];
                const isPicked = qty !== undefined;
                return (
                  <li key={item.lineItemId} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id={`pick-${item.lineItemId}`}
                        checked={isPicked}
                        onChange={() =>
                          toggle(item.lineItemId, item.quantityAvailable)
                        }
                        className="mt-1 size-4 shrink-0 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <Label
                          htmlFor={`pick-${item.lineItemId}`}
                          className="font-normal leading-snug cursor-pointer"
                        >
                          {item.productName}
                        </Label>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.quantityAvailable} of {item.quantityTotal} can
                          be requested
                          {item.quantityDispatched > 0 && (
                            <> · {item.quantityDispatched} already shipped</>
                          )}
                          {item.quantityReserved > 0 && (
                            <> · {item.quantityReserved} on an open request</>
                          )}
                        </p>
                      </div>
                      {isPicked && (
                        <div className="shrink-0">
                          <Label
                            htmlFor={`qty-${item.lineItemId}`}
                            className="sr-only"
                          >
                            Quantity of {item.productName}
                          </Label>
                          <Input
                            id={`qty-${item.lineItemId}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={item.quantityAvailable}
                            value={qty === 0 ? '' : qty}
                            onChange={(e) =>
                              setQty(item.lineItemId, e.target.value)
                            }
                            className={cn(
                              'w-20 text-center tabular-nums',
                              qty === 0 && 'border-destructive',
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <section className="rounded-lg border p-4 space-y-4">
        <div>
          <Label className="mb-2 block">How urgent is this?</Label>
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <Button
                key={p.value}
                type="button"
                variant={priority === p.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPriority(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="requiredBy">Needed by (optional)</Label>
          <Input
            id="requiredBy"
            type="date"
            value={requiredByDate}
            onChange={(e) => setRequiredByDate(e.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="message">Anything support should know?</Label>
          <Textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder="Optional"
          />
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {picked.length === 0
              ? 'Nothing picked yet'
              : `${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'} · ${orderCount} ${orderCount === 1 ? 'order' : 'orders'}`}
          </p>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isPending || picked.length === 0}
          >
            {isPending ? 'Sending…' : 'Send to support'}
          </Button>
        </div>
      </div>
    </div>
  );
}
