'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { LeadRow } from './types';

// =============================================================================
// HVA-73 follow-up: contact-book row
// =============================================================================
//
// Compact horizontal row (~64dp tall):
//
//   [Avatar]  Name (ellipsis)            [chat] [mail] [phone]
//             City · Customer/Business
//
// Behaviour:
//   - Row body (avatar + text) navigates to /leads/[id]
//   - Action icons stop propagation; each is a real <a href> so the OS
//     handles the protocol (wa.me, mailto:, tel:)
//   - Converted leads: muted, chevron-right replaces the action cluster,
//     row navigates to /requests/[convertedRequestId] instead.
// =============================================================================

interface Props {
  lead: LeadRow;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function emailValid(e: string | null): e is string {
  if (e === null) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function LeadCard({ lead }: Props) {
  const router = useRouter();
  const converted = lead.convertedToRequestId !== null;
  const isBusiness = lead.type === 'Business';
  const phoneDigits = digitsOnly(lead.phone);
  const phoneOk = phoneDigits.length >= 10;
  const targetHref = converted
    ? `/requests/${lead.convertedToRequestId}`
    : `/leads/${lead.id}`;

  function onRowClick(e: MouseEvent<HTMLDivElement>) {
    // Stops accidental row-navigation when a tap lands on (or bubbles up
    // through) one of the right-edge action icons. Nested <a> elements
    // call e.stopPropagation in their own handlers below.
    if ((e.target as HTMLElement).closest('[data-lead-action]')) return;
    router.push(targetHref);
  }

  const typeLabel = isBusiness ? 'Business' : 'Customer';
  const typeDotClass = isBusiness ? 'bg-amber-500' : 'bg-teal-500';

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${lead.name}${converted ? ' — converted' : ''}`}
      onClick={onRowClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(targetHref);
        }
      }}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm cursor-pointer',
        'transition-colors hover:bg-accent/40 active:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        converted && 'opacity-70',
      )}
    >
      <LeadAvatar name={lead.name} aria-hidden />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-base font-semibold tracking-tight',
            converted && 'text-muted-foreground',
          )}
        >
          {lead.name}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="truncate">{lead.cityName}</span>
          <span aria-hidden>·</span>
          <span
            className={cn('size-1.5 rounded-full', typeDotClass)}
            aria-hidden
          />
          <span>{typeLabel}</span>
        </p>
      </div>

      {converted && lead.convertedToRequestId ? (
        <Icon
          name="chevron_right"
          size="sm"
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          {/* WhatsApp */}
          <a
            data-lead-action="whatsapp"
            href={phoneOk ? `https://wa.me/${phoneDigits}` : undefined}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`WhatsApp ${lead.name}`}
            aria-disabled={!phoneOk}
            onClick={(e) => {
              e.stopPropagation();
              if (!phoneOk) e.preventDefault();
            }}
            className={cn(
              'inline-flex items-center justify-center size-9 rounded-full',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              !phoneOk && 'opacity-40 pointer-events-none',
            )}
          >
            <Icon name="chat" size="sm" />
          </a>
          {/* Email */}
          <a
            data-lead-action="mail"
            href={emailValid(lead.email) ? `mailto:${lead.email}` : undefined}
            aria-label={
              emailValid(lead.email)
                ? `Email ${lead.name}`
                : `No email on file for ${lead.name}`
            }
            aria-disabled={!emailValid(lead.email)}
            onClick={(e) => {
              e.stopPropagation();
              if (!emailValid(lead.email)) e.preventDefault();
            }}
            className={cn(
              'inline-flex items-center justify-center size-9 rounded-full',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              !emailValid(lead.email) && 'opacity-40 pointer-events-none',
            )}
          >
            <Icon name="mail" size="sm" />
          </a>
          {/* Phone */}
          <a
            data-lead-action="phone"
            href={phoneOk ? `tel:${lead.phone}` : undefined}
            aria-label={`Call ${lead.name}`}
            aria-disabled={!phoneOk}
            onClick={(e) => {
              e.stopPropagation();
              if (!phoneOk) e.preventDefault();
            }}
            className={cn(
              'inline-flex items-center justify-center size-9 rounded-full',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              !phoneOk && 'opacity-40 pointer-events-none',
            )}
          >
            <Icon name="phone" size="sm" />
          </a>
        </div>
      )}

      {/* Hidden anchor for SSR-crawlable navigation target (assistive tech,
          link-context tools). The visual interaction goes through the
          row's onClick — this ensures a real <a> exists for the link
          relationship. */}
      <Link
        href={targetHref}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      >
        Open
      </Link>
    </div>
  );
}
