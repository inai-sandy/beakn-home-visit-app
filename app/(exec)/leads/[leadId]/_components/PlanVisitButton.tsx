'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { ConvertLeadSheet } from '../../_components/ConvertLeadSheet';
import type { LeadRow } from '../../_components/types';

// =============================================================================
// HVA-73 follow-up: "Plan a Visit" launch button on lead detail
// =============================================================================
//
// Thin wrapper around the existing ConvertLeadSheet — kept as its own
// component so the detail page server-renders fine (button is the only
// island, sheet mounts on demand).
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
  /** "Plan a Visit" (default) or "Plan Another Visit" (HVA-73 PR 1). */
  label?: string;
}

export function PlanVisitButton({ lead, label = 'Plan a Visit' }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Icon name="event" size="xs" />
        {label}
      </Button>
      {open && <ConvertLeadSheet lead={lead} onClose={() => setOpen(false)} />}
    </>
  );
}
