'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import {
  createAssistRequestAction,
  updateAssistRequestAction,
} from '@/lib/assist/actions';
import type { LinkableVisitRequestOption } from '@/lib/assist/queries';
import {
  ASSIST_PRIORITY_LABELS,
  ASSIST_TYPE_LABELS,
  type AssistPriority,
  type AssistType,
} from '@/lib/assist/types';
import { cn } from '@/lib/utils';

// HVA-199: shared form for /assist/new + /assist/[id]/edit.
//
// Accordion-shaped: each assist type is a collapsible section. v1 has one
// type (material_request). Future types add as additional sections; tapping
// a section header selects that type for submission.

interface InitialItem {
  productName: string;
  quantity: number;
}

interface InitialValues {
  type: AssistType;
  items: InitialItem[];
  orderNumber: string;
  dispatchByDate: string;
  priority: AssistPriority;
  message: string;
  linkedVisitRequestId: string | null;
}

interface Props {
  mode: 'create' | 'edit';
  assistId?: string;
  linkableVisitRequests: LinkableVisitRequestOption[];
  initial: InitialValues;
}

const ALL_TYPES: readonly AssistType[] = ['material_request'];
const ALL_PRIORITIES: readonly AssistPriority[] = ['high', 'medium', 'low'];

interface DraftItem {
  productName: string;
  quantity: string; // string in form state so empty doesn't NaN
}

export function AssistForm({ mode, assistId, linkableVisitRequests, initial }: Props) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<AssistType>(initial.type);
  const [items, setItems] = useState<DraftItem[]>(
    initial.items.length > 0
      ? initial.items.map((i) => ({
          productName: i.productName,
          quantity: String(i.quantity),
        }))
      : [{ productName: '', quantity: '' }],
  );
  const [orderNumber, setOrderNumber] = useState(initial.orderNumber);
  const [dispatchByDate, setDispatchByDate] = useState(initial.dispatchByDate);
  const [priority, setPriority] = useState<AssistPriority>(initial.priority);
  const [message, setMessage] = useState(initial.message);
  const [linkedVisitRequestId, setLinkedVisitRequestId] = useState<string>(
    initial.linkedVisitRequestId ?? 'none',
  );
  const [isPending, startTransition] = useTransition();

  function addItem() {
    setItems((prev) => [...prev, { productName: '', quantity: '' }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function onSubmit() {
    // Compose payload. Empty rows are dropped silently (nothing-mandatory
    // rule); rows with text but missing quantity → toast error so the user
    // doesn't blindly submit incomplete data.
    const composedItems: { productName: string; quantity: number }[] = [];
    for (const draft of items) {
      const trimmedName = draft.productName.trim();
      const trimmedQty = draft.quantity.trim();
      if (trimmedName.length === 0 && trimmedQty.length === 0) continue;
      if (trimmedName.length === 0) {
        toast.error('Product rows need a name');
        return;
      }
      const qty = Number.parseInt(trimmedQty, 10);
      if (!Number.isInteger(qty) || qty <= 0) {
        toast.error(`Row "${trimmedName}" needs a positive integer quantity`);
        return;
      }
      composedItems.push({ productName: trimmedName, quantity: qty });
    }

    const payload = {
      items: composedItems,
      orderNumber: orderNumber.trim() === '' ? null : orderNumber.trim(),
      dispatchByDate:
        dispatchByDate.trim() === '' ? null : dispatchByDate.trim(),
      priority,
      message: message.trim() === '' ? null : message.trim(),
      linkedVisitRequestId:
        linkedVisitRequestId === 'none' ? null : linkedVisitRequestId,
    };

    startTransition(async () => {
      const result =
        mode === 'create'
          ? await createAssistRequestAction(payload)
          : await updateAssistRequestAction({
              assistId: assistId!,
              ...payload,
            });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        mode === 'create' ? 'Assist submitted' : 'Assist updated',
      );
      if (mode === 'create' && 'data' in result) {
        const createdId = (result.data as { id?: string } | undefined)?.id;
        if (typeof createdId === 'string') {
          router.push(`/assist/${createdId}`);
        } else {
          router.push('/assist');
        }
      } else {
        router.push(`/assist/${assistId}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      {ALL_TYPES.map((type) => {
        const open = selectedType === type;
        return (
          <section key={type} className="rounded-3xl border bg-card shadow-sm">
            <button
              type="button"
              onClick={() => setSelectedType(type)}
              aria-expanded={open}
              className={cn(
                'w-full flex items-center justify-between gap-3 px-5 py-4',
                open && 'border-b',
              )}
            >
              <span className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
                <Icon name="support_agent" size="sm" className="text-primary" />
                {ASSIST_TYPE_LABELS[type]}
              </span>
              <Icon
                name={open ? 'expand_less' : 'expand_more'}
                size="sm"
                className="text-muted-foreground"
              />
            </button>
            {open && type === 'material_request' && (
              <div className="p-5 space-y-5">
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Products</legend>
                  {items.map((item, i) => (
                    <div key={i} className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label htmlFor={`product-${i}`} className="text-xs text-muted-foreground">
                          Product name
                        </Label>
                        <Input
                          id={`product-${i}`}
                          value={item.productName}
                          onChange={(e) =>
                            updateItem(i, { productName: e.target.value })
                          }
                          placeholder="e.g. Smart plug"
                          className="h-11"
                        />
                      </div>
                      <div className="w-28">
                        <Label htmlFor={`qty-${i}`} className="text-xs text-muted-foreground">
                          Quantity
                        </Label>
                        <Input
                          id={`qty-${i}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(i, { quantity: e.target.value })
                          }
                          placeholder="2"
                          className="h-11"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(i)}
                        disabled={items.length === 1}
                        aria-label={`Remove product row ${i + 1}`}
                        className="h-11 w-11 shrink-0"
                      >
                        <Icon name="close" size="sm" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addItem}
                    className="h-9"
                  >
                    <Icon name="add" size="xs" />
                    Add product
                  </Button>
                </fieldset>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="order-number" className="text-xs text-muted-foreground">
                      Order number
                    </Label>
                    <Input
                      id="order-number"
                      value={orderNumber}
                      onChange={(e) => setOrderNumber(e.target.value)}
                      placeholder="e.g. ORD-12345"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dispatch-by" className="text-xs text-muted-foreground">
                      Dispatch by
                    </Label>
                    <Input
                      id="dispatch-by"
                      type="date"
                      value={dispatchByDate}
                      onChange={(e) => setDispatchByDate(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>

                <fieldset>
                  <legend className="text-xs text-muted-foreground mb-1.5">Priority</legend>
                  <div className="flex gap-2">
                    {ALL_PRIORITIES.map((p) => {
                      const active = priority === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          aria-pressed={active}
                          className={cn(
                            'flex-1 inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-sm transition-colors',
                            active
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card hover:bg-muted',
                          )}
                        >
                          {ASSIST_PRIORITY_LABELS[p]}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="space-y-1">
                  <Label htmlFor="customer-link" className="text-xs text-muted-foreground">
                    Link to a customer (optional)
                  </Label>
                  <Select
                    value={linkedVisitRequestId}
                    onValueChange={(v) => setLinkedVisitRequestId(v)}
                  >
                    <SelectTrigger id="customer-link" className="h-11">
                      <SelectValue placeholder="No customer linked" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No customer linked</SelectItem>
                      {linkableVisitRequests.map((vr) => (
                        <SelectItem key={vr.id} value={vr.id}>
                          {vr.customerName} — {vr.cityName} ({vr.stageName})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="message" className="text-xs text-muted-foreground">
                    Message (optional)
                  </Label>
                  <textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Add context, urgency notes, etc."
                    rows={3}
                    maxLength={2000}
                    className="w-full rounded-md border bg-background p-3 text-sm"
                  />
                </div>
              </div>
            )}
          </section>
        );
      })}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
          className="h-11 px-5"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="h-11 px-5"
        >
          {isPending
            ? mode === 'create' ? 'Submitting…' : 'Saving…'
            : mode === 'create' ? 'Submit assist' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
