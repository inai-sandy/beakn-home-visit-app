'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { AddLeadSheet } from './AddLeadSheet';
import type { BusinessTypeOption, CityOption } from './types';

// =============================================================================
// HVA-73: floating Add Lead FAB
// =============================================================================
//
// Fixed bottom-right corner. Mobile: `bottom-20` lifts it above the
// exec bottom-nav (h-16). Desktop: `lg:bottom-6`. Same positioning
// shape as the today-loop AddTaskFab (HVA-58/60) — kept consistent so
// users see the same primary action affordance on every exec page.
// =============================================================================

interface Props {
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
}

export function AddLeadFab({ cities, businessTypes }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed bottom-20 right-4 z-30 h-14 w-14 rounded-full shadow-lg lg:bottom-6"
        aria-label="Add lead"
      >
        <Icon name="add" size="md" />
      </Button>
      {open && (
        <AddLeadSheet
          cities={cities}
          businessTypes={businessTypes}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
