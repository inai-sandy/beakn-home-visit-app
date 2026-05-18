'use client';

import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { ConvertLeadSheet } from './ConvertLeadSheet';
import type {
  BusinessTypeOption,
  CityOption,
  LeadRow,
} from './types';

// =============================================================================
// HVA-73: per-lead card
// =============================================================================
//
// Shows name + type badge + city + phone tel link + relative captured-time.
// For unconverted leads: "Plan a Visit" CTA → opens ConvertLeadSheet.
// For converted leads: subtle "Converted" badge + Link to the request.
//
// Card is intentionally compact; the conversion sheet contains the
// full form. Tap the card body itself? No — the conversion sheet is
// the only action, and a stray body-tap shouldn't open it. Explicit
// button only.
// =============================================================================

interface Props {
  lead: LeadRow;
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
}

export function LeadCard({ lead, cities, businessTypes }: Props) {
  const [convertOpen, setConvertOpen] = useState(false);
  const converted = lead.convertedToRequestId !== null;
  const capturedAt = new Date(lead.createdAt);
  const isBusiness = lead.type === 'Business';

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold tracking-tight truncate">
              {lead.name}
            </h3>
            <Badge
              variant={isBusiness ? 'default' : 'secondary'}
              className="text-[10px]"
            >
              {lead.type}
            </Badge>
            {converted && (
              <Badge variant="outline" className="text-[10px]">
                <Icon name="check_circle" size="xs" className="mr-1" />
                Converted
              </Badge>
            )}
          </div>
          {isBusiness && lead.firmName && (
            <p className="text-xs text-muted-foreground truncate">
              {lead.firmName}
              {lead.businessTypeName ? ` · ${lead.businessTypeName}` : ''}
            </p>
          )}
          {!isBusiness && lead.bhk && (
            <p className="text-xs text-muted-foreground">{lead.bhk}</p>
          )}
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {lead.cityName}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <a
          href={`tel:${lead.phone}`}
          className="inline-flex items-center gap-1 font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          aria-label={`Call ${lead.name} at ${lead.phone}`}
        >
          <Icon name="phone" size="xs" />
          {lead.phone}
        </a>
        <span className="text-muted-foreground" title={lead.createdAt}>
          {formatDistanceToNow(capturedAt, { addSuffix: true })}
        </span>
      </div>

      {lead.interest.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lead.interest.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {lead.notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {lead.notes}
        </p>
      )}

      <div className="flex justify-end pt-1">
        {converted && lead.convertedToRequestId ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/requests/${lead.convertedToRequestId}`}>
              <Icon name="arrow_forward" size="xs" />
              View request
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => setConvertOpen(true)}
          >
            <Icon name="event" size="xs" />
            Plan a Visit
          </Button>
        )}
      </div>

      {convertOpen && (
        <ConvertLeadSheet
          lead={lead}
          cities={cities}
          businessTypes={businessTypes}
          onClose={() => setConvertOpen(false)}
        />
      )}
    </div>
  );
}
