'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { EditRequestSheet } from './EditRequestSheet';

// =============================================================================
// HVA-159: pencil-button wrapper for the request-detail header
// =============================================================================

interface Props {
  request: {
    id: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    address: string;
    cityId: string;
    bhk: string;
    customerState: string | null;
    visitScheduledAt: string | null;
  };
  cities: Array<{ id: string; name: string }>;
}

export function EditRequestButton({ request, cities }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Edit request"
        className="h-11 w-11 shrink-0"
      >
        <Icon name="edit" size="sm" />
      </Button>
      {open && (
        <EditRequestSheet
          request={request}
          cities={cities}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
