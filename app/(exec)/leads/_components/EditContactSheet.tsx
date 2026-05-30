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
import { ALLOWED_INTERESTS } from '@/lib/validators/customer-request';
import { LEAD_BHK_VALUES } from '@/lib/validators/lead';

import { editContactAction } from '../_actions/editContact';
import type { BusinessTypeOption, CityOption } from './types';

// =============================================================================
// HVA-159: EditContactSheet — bottom sheet for contact edit
// =============================================================================
//
// Mirrors AddLeadSheet structurally — same form-row pattern, same
// useState-driven state, same server-action plumbing. Mounted from the
// lead detail page header behind a pencil button gated by
// canExecEditContact server-side.
//
// Type (Customer | Business) is intentionally NOT in the editable set —
// switching it cross-contaminates BHK ⇄ firm/businessTypeId. Edit flows
// for a different shape happen via re-capture.
// =============================================================================

interface InitialContact {
  id: string;
  type: 'Customer' | 'Business' | string;
  name: string;
  firmName: string | null;
  phone: string; // storage form (+91...)
  email: string | null;
  cityId: string;
  bhk: string | null;
  interest: string[];
  businessTypeId: string | null;
  notes: string | null;
}

interface Props {
  contact: InitialContact;
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
  onClose: () => void;
}

function digitsFromStorage(phoneStorage: string): string {
  // Storage form is '+91' + 10 digits; strip the prefix for the form.
  return phoneStorage.replace(/\D/g, '').replace(/^91/, '');
}

export function EditContactSheet({
  contact,
  cities,
  businessTypes,
  onClose,
}: Props) {
  const router = useRouter();
  const isBusiness = contact.type === 'Business';

  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(digitsFromStorage(contact.phone));
  const [email, setEmail] = useState(contact.email ?? '');
  const [cityId, setCityId] = useState(contact.cityId);
  const [interest, setInterest] = useState<string[]>(contact.interest);
  const [bhk, setBhk] = useState<string>(contact.bhk ?? '');
  const [firmName, setFirmName] = useState(contact.firmName ?? '');
  const [businessTypeId, setBusinessTypeId] = useState<string>(
    contact.businessTypeId ?? '',
  );
  const [notes, setNotes] = useState(contact.notes ?? '');

  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: predates useServerMutation; HVA-149-cleanup TODO
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [collision, setCollision] = useState<string | null>(null);

  function toggleInterest(tag: string) {
    setInterest((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function onSubmit() {
    if (busy) return;
    setSubmitting(true);
    setGeneralError(null);
    setFieldErrors({});
    setCollision(null);
    try {
      const result = await editContactAction({
        contactId: contact.id,
        name: name.trim(),
        firmName: isBusiness ? firmName.trim() || null : null,
        phone,
        email: email.trim() || null,
        cityId,
        bhk: !isBusiness && bhk ? bhk : null,
        interest,
        businessTypeId: isBusiness ? businessTypeId || null : null,
        notes: notes.trim() || null,
      });

      if (!result.ok) {
        setGeneralError(result.error ?? 'Save failed');
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        if (result.collisionContactId) setCollision(result.collisionContactId);
        toast.error(result.error ?? 'Save failed');
        return;
      }

      toast.success(result.changed ? 'Contact updated' : 'No changes');
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
          <SheetTitle>Edit contact</SheetTitle>
          <SheetDescription>
            Updates apply to this contact only. Linked requests keep their
            own customer snapshots.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-5">
          <FormRow label="Name" required error={fieldErrors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 100))}
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          <FormRow label="Phone" required error={fieldErrors.phone}>
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
            {collision && (
              <p className="text-[11px] text-muted-foreground pt-1">
                <span
                  aria-disabled
                  className="underline opacity-60 cursor-not-allowed"
                  title="Merge flow lands in HVA-165"
                >
                  Merge (coming soon)
                </span>
              </p>
            )}
          </FormRow>

          <FormRow label="Email" optional error={fieldErrors.email}>
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="h-11"
            />
          </FormRow>

          <FormRow label="City" required error={fieldErrors.cityId}>
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

          <FormRow label="Interests" error={fieldErrors.interest}>
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

          {!isBusiness && (
            <FormRow label="BHK" optional error={fieldErrors.bhk}>
              <Select value={bhk} onValueChange={setBhk} disabled={busy}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="—" />
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

          {isBusiness && (
            <>
              <FormRow
                label="Firm name"
                required
                error={fieldErrors.firmName}
              >
                <Input
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value.slice(0, 100))}
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

          <FormRow label="Notes" optional error={fieldErrors.notes}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
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
