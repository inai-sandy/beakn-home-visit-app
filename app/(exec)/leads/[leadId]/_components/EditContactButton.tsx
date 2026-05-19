'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { EditContactSheet } from '../../_components/EditContactSheet';
import type {
  BusinessTypeOption,
  CityOption,
} from '../../_components/types';

// =============================================================================
// HVA-159: pencil-button client wrapper for the contact-detail header
// =============================================================================
//
// Owns the open-state for EditContactSheet. The page-level visibility
// check (canExecEditContact) lives server-side; this client island just
// mounts the sheet on demand.
// =============================================================================

interface Props {
  contact: {
    id: string;
    type: 'Customer' | 'Business' | string;
    name: string;
    firmName: string | null;
    phone: string;
    email: string | null;
    cityId: string;
    bhk: string | null;
    interest: string[];
    businessTypeId: string | null;
    notes: string | null;
  };
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
}

export function EditContactButton({ contact, cities, businessTypes }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Edit contact"
      >
        <Icon name="edit" size="sm" />
        Edit
      </Button>
      {open && (
        <EditContactSheet
          contact={contact}
          cities={cities}
          businessTypes={businessTypes}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
