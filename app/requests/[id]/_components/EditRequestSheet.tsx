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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { editRequestAction } from '../_actions/editRequest';

// =============================================================================
// HVA-159: EditRequestSheet — bottom sheet for request edit
// =============================================================================

const BHK_OPTIONS = ['1BHK', '2BHK', '3BHK', '4BHK', 'Others'] as const;

interface CityOption {
  id: string;
  name: string;
}

interface InitialRequest {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string;
  cityId: string;
  bhk: string;
  customerState: string | null;
  /** ISO string or null. Stored as timestamptz in DB; the form renders
   *  a datetime-local input that round-trips through ISO. */
  visitScheduledAt: string | null;
}

interface Props {
  request: InitialRequest;
  cities: CityOption[];
  onClose: () => void;
}

function digitsFromStorage(phoneStorage: string): string {
  return phoneStorage.replace(/\D/g, '').replace(/^91/, '');
}

// 2026-05-26 IST tz fix: .getHours()/.getMinutes() return server-local time,
// which is UTC inside Docker. Force IST by shifting the timestamp by
// +05:30 before slicing the ISO string. Symmetric on the reverse path —
// treat the naked datetime-local value as IST and add the +05:30 suffix
// before parsing.
const IST_OFFSET_MIN = 330;

function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000)
    .toISOString()
    .slice(0, 16);
}

function localToIso(local: string): string | null {
  if (!local) return null;
  const ms = Date.parse(`${local}:00.000+05:30`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function EditRequestSheet({ request, cities, onClose }: Props) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(request.customerName);
  const [phone, setPhone] = useState(digitsFromStorage(request.customerPhone));
  const [email, setEmail] = useState(request.customerEmail ?? '');
  const [address, setAddress] = useState(request.address);
  const [cityId, setCityId] = useState(request.cityId);
  const [bhk, setBhk] = useState<string>(request.bhk);
  const [customerState, setCustomerState] = useState(request.customerState ?? '');
  const [visitScheduledLocal, setVisitScheduledLocal] = useState(
    isoToLocal(request.visitScheduledAt),
  );

  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit() {
    if (busy) return;
    setSubmitting(true);
    setGeneralError(null);
    setFieldErrors({});
    try {
      const result = await editRequestAction({
        requestId: request.id,
        customerName: customerName.trim(),
        customerPhone: phone,
        customerEmail: email.trim() || null,
        address: address.trim(),
        cityId,
        bhk,
        customerState: customerState.trim() || null,
        visitScheduledAt: localToIso(visitScheduledLocal),
      });

      if (!result.ok) {
        setGeneralError(result.error ?? 'Save failed');
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        toast.error(result.error ?? 'Save failed');
        return;
      }
      toast.success(result.changed ? 'Request updated' : 'No changes');
      onClose();
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" className="max-h-[92svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit request</SheetTitle>
          <SheetDescription>
            Updates this request only. Linked contact is unchanged — edit
            the contact separately if needed.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-5">
          <FormRow label="Customer name" error={fieldErrors.customerName}>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value.slice(0, 255))}
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          <FormRow label="Phone" error={fieldErrors.customerPhone}>
            <div className="flex">
              <span className="inline-flex items-center px-3 h-11 rounded-l-md border border-r-0 bg-muted/40 text-sm text-muted-foreground select-none">
                +91
              </span>
              <Input
                type="tel"
                inputMode="numeric"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                disabled={busy}
                className="h-11 rounded-l-none font-mono"
              />
            </div>
          </FormRow>

          <FormRow label="Email" optional error={fieldErrors.customerEmail}>
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          <FormRow label="Address" error={fieldErrors.address}>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
              disabled={busy}
            />
          </FormRow>

          <FormRow label="City" error={fieldErrors.cityId}>
            <Select value={cityId} onValueChange={setCityId} disabled={busy}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
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

          <FormRow label="State" optional error={fieldErrors.customerState}>
            <Input
              value={customerState}
              onChange={(e) => setCustomerState(e.target.value.slice(0, 100))}
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          <FormRow label="BHK" error={fieldErrors.bhk}>
            <Select value={bhk} onValueChange={setBhk} disabled={busy}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BHK_OPTIONS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>

          <FormRow
            label="Visit scheduled at"
            optional
            error={fieldErrors.visitScheduledAt}
          >
            <Input
              type="datetime-local"
              value={visitScheduledLocal}
              onChange={(e) => setVisitScheduledLocal(e.target.value)}
              disabled={busy}
              className="h-11"
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
              'Save'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

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
