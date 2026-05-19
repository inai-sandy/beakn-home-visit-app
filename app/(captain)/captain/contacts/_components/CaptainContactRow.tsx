'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { TeamContactRow } from '@/lib/captain/contacts-queries';

// =============================================================================
// HVA-73 PR 2: captain-contact row (mirror of exec LeadCard with captor tag)
// =============================================================================
//
// Same contact-book layout as the exec list, plus a small "captured by"
// line under the city · type chip. Tap row → /captain/contacts/[id].
// Action icons (WhatsApp / Email / Phone) carry the same wa.me / mailto
// / tel patterns so captains can reach customers without leaving the app.
// =============================================================================

interface Props {
  contact: TeamContactRow;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function emailValid(e: string | null): e is string {
  if (e === null) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function CaptainContactRow({ contact }: Props) {
  const router = useRouter();
  const converted = contact.convertedToRequestId !== null;
  const isBusiness = contact.type === 'Business';
  const phoneDigits = digitsOnly(contact.phone);
  const phoneOk = phoneDigits.length >= 10;
  const targetHref = `/captain/contacts/${contact.id}`;

  function onRowClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-contact-action]')) return;
    router.push(targetHref);
  }

  const typeLabel = isBusiness ? 'Business' : 'Customer';
  const typeDotClass = isBusiness ? 'bg-amber-500' : 'bg-teal-500';

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${contact.name}${converted ? ' — converted' : ''}`}
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
        converted && 'opacity-80',
      )}
    >
      <LeadAvatar name={contact.name} aria-hidden />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-base font-semibold tracking-tight',
            converted && 'text-muted-foreground',
          )}
        >
          {contact.name}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="truncate">{contact.cityName}</span>
          <span aria-hidden>·</span>
          <span
            className={cn('size-1.5 rounded-full', typeDotClass)}
            aria-hidden
          />
          <span>{typeLabel}</span>
          {converted && contact.requestCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                {contact.requestCount} request
                {contact.requestCount === 1 ? '' : 's'}
              </span>
            </>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          Captured by{' '}
          <span className="font-medium">{contact.capturedByName ?? '—'}</span>
        </p>
      </div>

      {converted ? (
        <Icon
          name="chevron_right"
          size="sm"
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <a
            data-contact-action="whatsapp"
            href={phoneOk ? `https://wa.me/${phoneDigits}` : undefined}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`WhatsApp ${contact.name}`}
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
          <a
            data-contact-action="mail"
            href={emailValid(contact.email) ? `mailto:${contact.email}` : undefined}
            aria-label={
              emailValid(contact.email)
                ? `Email ${contact.name}`
                : `No email on file for ${contact.name}`
            }
            aria-disabled={!emailValid(contact.email)}
            onClick={(e) => {
              e.stopPropagation();
              if (!emailValid(contact.email)) e.preventDefault();
            }}
            className={cn(
              'inline-flex items-center justify-center size-9 rounded-full',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              !emailValid(contact.email) && 'opacity-40 pointer-events-none',
            )}
          >
            <Icon name="mail" size="sm" />
          </a>
          <a
            data-contact-action="phone"
            href={phoneOk ? `tel:${contact.phone}` : undefined}
            aria-label={`Call ${contact.name}`}
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
    </div>
  );
}
