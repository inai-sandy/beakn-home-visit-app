'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
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
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import { cn } from '@/lib/utils';
import { LEAD_BHK_VALUES } from '@/lib/validators/lead';

import { convertLeadToRequestAction } from '../_actions/convertLead';
import type { LeadRow } from './types';

// =============================================================================
// HVA-74: Lead → Request conversion sheet
// =============================================================================
//
// Bottom sheet that surfaces the lead's prefilled values (read-only
// summary at the top) and collects the remaining required fields:
//
//   - Address (always required — visit_requests.address NOT NULL)
//   - BHK (always required at conversion — visit_requests.bhk NOT NULL;
//     lead.bhk is nullable for Business leads, optional for Customer)
//
// On success → close sheet + router.push('/requests/[id]') so the exec
// lands on the new request and can immediately schedule the visit.
// =============================================================================

interface Props {
  lead: Pick<
    LeadRow,
    | 'id'
    | 'type'
    | 'name'
    | 'phone'
    | 'email'
    | 'cityName'
    | 'bhk'
    | 'firmName'
    | 'businessTypeName'
    | 'interest'
  >;
  onClose: () => void;
}

export function ConvertLeadSheet({ lead, onClose }: Props) {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [bhk, setBhk] = useState<string>(lead.bhk ?? '');
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { mutate, isPending: busy } = useServerMutation(
    convertLeadToRequestAction,
    {
      successMessage: 'Request created',
      onSuccess: (data) => {
        onClose();
        if (data?.requestId) router.push(`/requests/${data.requestId}`);
      },
      onError: (err, errs) => {
        setGeneralError(err);
        if (errs) setFieldErrors(errs);
      },
    },
  );

  function onSubmit() {
    if (busy) return;
    setGeneralError(null);
    setFieldErrors({});
    void mutate({
      leadId: lead.id,
      extra: {
        address: address.trim(),
        bhk: bhk as (typeof LEAD_BHK_VALUES)[number],
      },
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" className="max-h-[92svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Convert lead to request</SheetTitle>
          <SheetDescription>
            Fill in the missing details, then schedule the visit.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-5">
          {/* Read-only prefilled summary */}
          <section
            aria-label="Lead summary"
            className="rounded-2xl border bg-muted/30 p-4 space-y-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-semibold tracking-tight">{lead.name}</p>
              <Badge
                variant={lead.type === 'Business' ? 'default' : 'secondary'}
                className="text-[10px]"
              >
                {lead.type}
              </Badge>
            </div>
            {lead.type === 'Business' && lead.firmName && (
              <p className="text-xs text-muted-foreground">
                {lead.firmName}
                {lead.businessTypeName ? ` · ${lead.businessTypeName}` : ''}
              </p>
            )}
            <p className="text-xs">
              <span className="text-muted-foreground">Phone:</span>{' '}
              <span className="font-mono">{lead.phone}</span>
            </p>
            {lead.email && (
              <p className="text-xs">
                <span className="text-muted-foreground">Email:</span> {lead.email}
              </p>
            )}
            <p className="text-xs">
              <span className="text-muted-foreground">City:</span> {lead.cityName}
            </p>
            {lead.interest.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {lead.interest.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="convert-address" className="text-sm">
              Address
            </Label>
            <Textarea
              id="convert-address"
              value={address}
              onChange={(e) => setAddress(e.target.value.slice(0, 2000))}
              rows={3}
              maxLength={2000}
              placeholder="Customer's address for the visit"
              disabled={busy}
              className={cn(
                fieldErrors.address && 'border-destructive',
              )}
            />
            {fieldErrors.address && (
              <p className="text-xs text-destructive">{fieldErrors.address}</p>
            )}
          </div>

          {/* BHK */}
          <div className="space-y-2">
            <Label htmlFor="convert-bhk" className="text-sm">
              BHK
            </Label>
            <Select value={bhk} onValueChange={setBhk} disabled={busy}>
              <SelectTrigger
                id="convert-bhk"
                className={cn(
                  'h-11 w-full',
                  fieldErrors.bhk && 'border-destructive',
                )}
              >
                <SelectValue placeholder="Select a BHK option" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_BHK_VALUES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.bhk && (
              <p className="text-xs text-destructive">{fieldErrors.bhk}</p>
            )}
            {!lead.bhk && lead.type === 'Business' && (
              <p className="text-[11px] text-muted-foreground">
                Lead is a business contact — pick the customer&apos;s
                home BHK for the request.
              </p>
            )}
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

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={busy || address.trim().length < 10 || !bhk}
          >
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                Converting…
              </>
            ) : (
              <>
                <Icon name="event" size="sm" />
                Convert to Request
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
