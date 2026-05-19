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
}

export function PlanVisitButton({ lead }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="w-full"
      >
        <Icon name="event" size="sm" />
        Plan a Visit
      </Button>
      {open && <ConvertLeadSheet lead={lead} onClose={() => setOpen(false)} />}
    </>
  );
}
