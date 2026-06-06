'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { formatInrFromPaise, rupeesStringToPaise } from '@/lib/money';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import { cn } from '@/lib/utils';

import {
  addLineItemAction,
  updateLineItemAction,
  type LineItemRow,
} from './_actions/lineItems';

// =============================================================================
// HVA-234 (HVA-231 Phase 1.0): Line items section on /requests/[id]
// =============================================================================
//
// Renders a table of line items below the quotation block. Each item:
//   product / SKU / qty / unit price / line total / GST / priority /
//   target date / actions.
//
// Add + edit via modal dialog. No delete (HVA-wide no-deletes rule;
// editing qty to 0 is rejected by the validator). Edit + add use the
// existing useServerMutation hook to surface inline errors + auto
// router.refresh on success.
//
// The component is a CLIENT island within the otherwise-server
// CollectionSection — wrapping just this slice keeps the rest of the
// request detail page on the server.
// =============================================================================

const PRIORITY_LABEL: Record<'low' | 'med' | 'high', string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

const PRIORITY_TONE: Record<'low' | 'med' | 'high', string> = {
  low: 'bg-muted text-muted-foreground',
  med: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  high: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
};

interface Props {
  quotationId: string;
  items: LineItemRow[];
  canEdit: boolean;
}

export function LineItemsSection({ quotationId, items, canEdit }: Props) {
  const [editing, setEditing] = useState<LineItemRow | null>(null);
  const [adding, setAdding] = useState(false);

  // Running total from current items (visible immediately even before a
  // refresh fires). The server-side quotation total is the source of
  // truth elsewhere on the page; this is a derived display number.
  const lineTotal = items.reduce((sum, i) => sum + i.lineTotalPaise, 0);

  if (items.length === 0 && !canEdit) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Line items{' '}
          {items.length > 0 && (
            <span className="font-normal text-muted-foreground/80">
              ({items.length})
            </span>
          )}
        </h3>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdding(true)}
            className="h-9"
          >
            <Icon name="add" size="xs" />
            <span>Add item</span>
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No line items recorded yet.{' '}
          {canEdit && 'Tap Add item to break the quotation into products.'}
        </p>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Product</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                  <th className="text-right px-3 py-2 font-medium">Unit ₹</th>
                  <th className="text-right px-3 py-2 font-medium">Line ₹</th>
                  <th className="text-left px-3 py-2 font-medium">Priority</th>
                  <th className="text-left px-3 py-2 font-medium">By</th>
                  {canEdit && <th className="px-3 py-2" aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.productName}</div>
                      {item.productSku && (
                        <div className="text-[11px] font-mono text-muted-foreground">
                          {item.productSku}
                        </div>
                      )}
                      {item.notes && (
                        <div className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap">
                          {item.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatInrFromPaise(item.unitPricePaise)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">
                      {formatInrFromPaise(item.lineTotalPaise)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          PRIORITY_TONE[item.priority],
                        )}
                      >
                        {PRIORITY_LABEL[item.priority]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {item.targetDispatchDate ?? '—'}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(item)}
                          aria-label={`Edit ${item.productName}`}
                          className="h-8 px-2"
                        >
                          <Icon name="edit" size="xs" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/20">
                  <td
                    colSpan={3}
                    className="px-3 py-2 text-right text-xs font-medium text-muted-foreground"
                  >
                    Items total
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {formatInrFromPaise(lineTotal)}
                  </td>
                  <td colSpan={canEdit ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {adding && (
        <LineItemDialog
          mode="add"
          quotationId={quotationId}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <LineItemDialog
          mode="edit"
          quotationId={quotationId}
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// LineItemDialog — shared between add + edit modes
// =============================================================================

interface DialogProps {
  mode: 'add' | 'edit';
  quotationId: string;
  existing?: LineItemRow;
  onClose: () => void;
}

function LineItemDialog({ mode, quotationId, existing, onClose }: DialogProps) {
  const router = useRouter();
  const [productName, setProductName] = useState(existing?.productName ?? '');
  const [productSku, setProductSku] = useState(existing?.productSku ?? '');
  const [quantity, setQuantity] = useState<string>(
    existing ? String(existing.quantity) : '',
  );
  const [unitPriceInput, setUnitPriceInput] = useState<string>(
    existing ? (existing.unitPricePaise / 100).toString() : '',
  );
  const [gstPercent, setGstPercent] = useState<string>(
    existing?.gstPercent ?? '',
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [priority, setPriority] = useState<'low' | 'med' | 'high'>(
    existing?.priority ?? 'med',
  );
  const [targetDispatchDate, setTargetDispatchDate] = useState<string>(
    existing?.targetDispatchDate ?? '',
  );
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const qty = useMemo(() => Number.parseInt(quantity, 10), [quantity]);
  const unitPaise = useMemo(
    () => rupeesStringToPaise(unitPriceInput),
    [unitPriceInput],
  );
  const lineTotalPaise = useMemo(() => {
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (unitPaise === null) return null;
    return qty * unitPaise;
  }, [qty, unitPaise]);

  const addMutation = useServerMutation(addLineItemAction, {
    successMessage: 'Item added',
    onSuccess: () => {
      router.refresh();
      onClose();
    },
    onError: (err, errs) => {
      setGeneralError(err);
      if (errs) setFieldErrors(errs);
    },
    suppressErrorToast: true,
  });

  const updateMutation = useServerMutation(updateLineItemAction, {
    successMessage: 'Item updated',
    onSuccess: () => {
      router.refresh();
      onClose();
    },
    onError: (err, errs) => {
      setGeneralError(err);
      if (errs) setFieldErrors(errs);
    },
    suppressErrorToast: true,
  });

  const busy = addMutation.isPending || updateMutation.isPending;
  const canSubmit =
    !busy &&
    productName.trim().length > 0 &&
    Number.isFinite(qty) &&
    qty > 0 &&
    unitPaise !== null &&
    unitPaise >= 0;

  function onSubmit() {
    if (!canSubmit || unitPaise === null) return;
    setGeneralError(null);
    setFieldErrors({});

    const gstAsNumber = gstPercent.trim() === '' ? undefined : Number(gstPercent);

    if (mode === 'add') {
      void addMutation.mutate({
        quotationId,
        productName: productName.trim(),
        productSku: productSku.trim() || undefined,
        quantity: qty,
        unitPricePaise: unitPaise,
        gstPercent: gstAsNumber,
        notes: notes.trim() || undefined,
        priority,
        targetDispatchDate:
          targetDispatchDate.trim() === '' ? undefined : targetDispatchDate,
      });
      return;
    }

    if (!existing) return;
    void updateMutation.mutate({
      itemId: existing.id,
      productName: productName.trim(),
      productSku: productSku.trim() || undefined,
      quantity: qty,
      unitPricePaise: unitPaise,
      gstPercent: gstAsNumber,
      notes: notes.trim() || undefined,
      priority,
      targetDispatchDate:
        targetDispatchDate.trim() === '' ? undefined : targetDispatchDate,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Add line item' : 'Edit line item'}
          </DialogTitle>
          <DialogDescription>
            Break the quotation into products. Line total updates as you
            type.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="li-name" className="text-sm">
              Product name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="li-name"
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value.slice(0, 255))}
              disabled={busy}
              maxLength={255}
              className="h-11"
              placeholder="e.g. Kitchen Light S2 Warm White"
            />
            {fieldErrors.productName && (
              <p className="text-xs text-destructive">{fieldErrors.productName}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="li-sku" className="text-sm">
                SKU <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="li-sku"
                type="text"
                value={productSku}
                onChange={(e) => setProductSku(e.target.value.slice(0, 128))}
                disabled={busy}
                maxLength={128}
                className="h-11 font-mono"
                placeholder="KL-S2-WW"
              />
              {fieldErrors.productSku && (
                <p className="text-xs text-destructive">{fieldErrors.productSku}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="li-qty" className="text-sm">
                Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                id="li-qty"
                type="number"
                inputMode="numeric"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={busy}
                className="h-11 font-mono"
              />
              {fieldErrors.quantity && (
                <p className="text-xs text-destructive">{fieldErrors.quantity}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="li-unit" className="text-sm">
                Unit price (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="li-unit"
                type="text"
                inputMode="decimal"
                value={unitPriceInput}
                onChange={(e) => setUnitPriceInput(e.target.value)}
                disabled={busy}
                className="h-11 font-mono"
                placeholder="e.g. 2500"
              />
              {fieldErrors.unitPricePaise && (
                <p className="text-xs text-destructive">{fieldErrors.unitPricePaise}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="li-gst" className="text-sm">
                GST % <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="li-gst"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                disabled={busy}
                className="h-11 font-mono"
                placeholder="18"
              />
            </div>
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Line total:</span>{' '}
            <span className="font-mono font-semibold">
              {lineTotalPaise !== null
                ? formatInrFromPaise(lineTotalPaise)
                : '—'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="li-priority" className="text-sm">
                Priority
              </Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as typeof priority)}
                disabled={busy}
              >
                <SelectTrigger id="li-priority" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="med">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="li-target" className="text-sm">
                Target dispatch date{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="li-target"
                type="date"
                value={targetDispatchDate}
                onChange={(e) => setTargetDispatchDate(e.target.value)}
                disabled={busy}
                className="h-11"
              />
              {fieldErrors.targetDispatchDate && (
                <p className="text-xs text-destructive">
                  {fieldErrors.targetDispatchDate}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="li-notes" className="text-sm">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="li-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              disabled={busy}
              maxLength={2000}
              rows={2}
              className="resize-none"
              placeholder="Special instructions or variants…"
            />
          </div>

          {generalError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
            >
              {generalError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : mode === 'add' ? (
              'Add item'
            ) : (
              'Save changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// `toast` is intentionally unused here — the dialog uses inline error
// surfacing (generalError + fieldErrors) instead of toasts. Keeping the
// import behind a no-op reference makes future "show toast on success"
// follow-ups trivial without a re-import.
void toast;
