'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { useServerMutation } from '@/lib/hooks/use-server-mutation';

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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ALLOWED_INTERESTS } from '@/lib/validators/customer-request';
import { LEAD_BHK_VALUES } from '@/lib/validators/lead';

import { addLeadAction } from '../_actions/addLead';
import type { BusinessTypeOption, CityOption } from './types';

// =============================================================================
// HVA-73: Add Lead bottom sheet
// =============================================================================
//
// Uses native form state (useState) rather than react-hook-form — the form
// is small (≤9 fields, mostly chips/dropdowns), and the server action
// returns per-field error messages we surface inline. Keeps the bundle
// lighter and the validation seam single-source (server is authoritative).
//
// Phone: collected as 10 digits (Indian mobile). Server prepends '+91'.
// =============================================================================

/** HVA-150 opt-in optimistic Add Lead contract. Parent owns the list +
 *  the optimistic state; this sheet only fires events. */
export interface AddLeadOptimisticHandlers {
  onAdd: (insert: {
    id: string;
    type: 'Customer' | 'Business';
    name: string;
    phone: string;
    cityId: string;
    cityName: string | null;
  }) => void;
  onReconcile: (tempId: string, serverLeadId: string) => void;
  onRemove: (tempId: string) => void;
}

interface Props {
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
  onClose: () => void;
  /** HVA-150 opt-in: when provided, sheet inserts a pending row in the
   *  parent leads list, closes immediately, and reconciles on result. */
  optimistic?: AddLeadOptimisticHandlers;
}

export function AddLeadSheet({ cities, businessTypes, onClose, optimistic }: Props) {
  const [type, setType] = useState<'Customer' | 'Business'>('Customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cityId, setCityId] = useState<string>('');
  const [interest, setInterest] = useState<string[]>([]);
  const [bhk, setBhk] = useState<string>('');
  const [firmName, setFirmName] = useState('');
  const [businessTypeId, setBusinessTypeId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // HVA-150: in optimistic mode the parent owns row state, so closing
  // happens immediately on submit. We still let useServerMutation handle
  // the refresh + toast, but skip its onSuccess close (we close earlier).
  const { mutate, isPending: busy } = useServerMutation(addLeadAction, {
    successMessage: 'Lead added',
    onSuccess: () => {
      if (!optimistic) onClose();
    },
    onError: (err, errs) => {
      setGeneralError(err);
      if (errs) setFieldErrors(errs);
    },
    // In optimistic mode we surface the toast manually so we can also
    // remove the pending row from the parent list at the same moment.
    suppressErrorToast: Boolean(optimistic),
  });

  function toggleInterest(tag: string) {
    setInterest((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function onSubmit() {
    if (busy) return;
    setGeneralError(null);
    setFieldErrors({});
    const trimmedName = name.trim();
    const payload =
      type === 'Customer'
        ? {
            type: 'Customer' as const,
            name: trimmedName,
            phone,
            email: email.trim() || undefined,
            cityId,
            interest: interest as (typeof ALLOWED_INTERESTS)[number][],
            bhk: bhk ? (bhk as (typeof LEAD_BHK_VALUES)[number]) : undefined,
            notes: notes.trim() || undefined,
          }
        : {
            type: 'Business' as const,
            name: trimmedName,
            phone,
            email: email.trim() || undefined,
            cityId,
            interest: interest as (typeof ALLOWED_INTERESTS)[number][],
            firmName: firmName.trim(),
            businessTypeId,
            notes: notes.trim() || undefined,
          };

    if (optimistic) {
      const tempId = `lead-temp-${
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      }`;
      const cityName = cities.find((c) => c.id === cityId)?.name ?? null;
      optimistic.onAdd({
        id: tempId,
        type,
        name: trimmedName,
        phone: `+91${phone}`,
        cityId,
        cityName,
      });
      onClose();
      const result = await mutate(payload);
      if (result === null) {
        optimistic.onRemove(tempId);
        toast.error('Could not add lead. Please retry.');
        return;
      }
      optimistic.onReconcile(tempId, result.leadId);
      return;
    }
    void mutate(payload);
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" className="max-h-[92svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add a lead</SheetTitle>
          <SheetDescription>
            Customer or business — capture the basics, refine later.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-5">
          {/* Type toggle */}
          <div className="space-y-2">
            <Label className="text-sm">Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={type === 'Customer' ? 'default' : 'outline'}
                onClick={() => setType('Customer')}
                disabled={busy}
                className="h-11"
              >
                Customer
              </Button>
              <Button
                type="button"
                variant={type === 'Business' ? 'default' : 'outline'}
                onClick={() => setType('Business')}
                disabled={busy}
                className="h-11"
              >
                Business
              </Button>
            </div>
          </div>

          {/* Name */}
          <FormRow label="Name" required error={fieldErrors.name}>
            <Input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 100))}
              placeholder="Full name"
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          {/* Phone */}
          <FormRow label="Phone" required error={fieldErrors.phone}>
            <div className="flex">
              <span className="inline-flex items-center px-3 h-11 rounded-l-md border border-r-0 bg-muted/40 text-sm text-muted-foreground select-none">
                +91
              </span>
              <Input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                placeholder="10-digit mobile"
                disabled={busy}
                className="h-11 rounded-l-none font-mono"
              />
            </div>
          </FormRow>

          {/* Email */}
          <FormRow
            label="Email"
            optional
            error={fieldErrors.email}
          >
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="optional@example.com"
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          {/* City */}
          <FormRow label="City" required error={fieldErrors.cityId}>
            <Select value={cityId} onValueChange={setCityId} disabled={busy}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder="Select a city" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          {/* Interests */}
          <FormRow label="Interests" required error={fieldErrors.interest}>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_INTERESTS.map((tag) => {
                const active = interest.includes(tag);
                return (
                  <Button
                    key={tag}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => toggleInterest(tag)}
                    disabled={busy}
                    className="rounded-full"
                  >
                    {tag}
                  </Button>
                );
              })}
            </div>
          </FormRow>

          {/* Customer-only: BHK */}
          {type === 'Customer' && (
            <FormRow label="BHK" optional error={fieldErrors.bhk}>
              <Select value={bhk} onValueChange={setBhk} disabled={busy}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_BHK_VALUES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
          )}

          {/* Business-only: Firm name + Business type */}
          {type === 'Business' && (
            <>
              <FormRow
                label="Firm name"
                required
                error={fieldErrors.firmName}
              >
                <Input
                  type="text"
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value.slice(0, 100))}
                  placeholder="e.g. Studio Architects"
                  disabled={busy}
                  className="h-11"
                />
              </FormRow>
              <FormRow
                label="Business type"
                required
                error={fieldErrors.businessTypeId}
              >
                <Select
                  value={businessTypeId}
                  onValueChange={setBusinessTypeId}
                  disabled={busy}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {businessTypes.map((bt) => (
                      <SelectItem key={bt.id} value={bt.id}>
                        {bt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            </>
          )}

          {/* Notes */}
          <FormRow label="Notes" optional error={fieldErrors.notes}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
              placeholder="Anything to remember…"
              disabled={busy}
            />
          </FormRow>

          {generalError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
            >
              {generalError}
            </div>
          )}
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={busy}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                Saving…
              </>
            ) : (
              'Add lead'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Local helper to keep the form rows visually consistent + reduce repetition.
function FormRow({
  label,
  required = false,
  optional = false,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {optional && (
          <span className="text-muted-foreground"> (optional)</span>
        )}
      </Label>
      <div className={cn(error && '[&_input]:border-destructive [&_button]:border-destructive')}>
        {children}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
