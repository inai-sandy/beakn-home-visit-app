'use client';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-73 follow-up: 3 large quick-action buttons on the lead detail page
// =============================================================================

interface Props {
  name: string;
  phone: string;
  email: string | null;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function emailValid(e: string | null): e is string {
  if (e === null) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function LeadQuickActions({ name, phone, email }: Props) {
  const phoneDigits = digitsOnly(phone);
  const phoneOk = phoneDigits.length >= 10;
  const emailOk = emailValid(email);

  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Quick actions">
      <ActionButton
        href={phoneOk ? `https://wa.me/${phoneDigits}` : undefined}
        target="_blank"
        rel="noreferrer noopener"
        icon="chat"
        label="WhatsApp"
        ariaLabel={`WhatsApp ${name}`}
        disabled={!phoneOk}
      />
      <ActionButton
        href={emailOk ? `mailto:${email}` : undefined}
        icon="mail"
        label="Email"
        ariaLabel={emailOk ? `Email ${name}` : 'No email on file'}
        disabled={!emailOk}
      />
      <ActionButton
        href={phoneOk ? `tel:${phone}` : undefined}
        icon="phone"
        label="Call"
        ariaLabel={`Call ${name}`}
        disabled={!phoneOk}
      />
    </div>
  );
}

function ActionButton({
  href,
  icon,
  label,
  ariaLabel,
  disabled,
  target,
  rel,
}: {
  href: string | undefined;
  icon: string;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  target?: string;
  rel?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1 h-16 rounded-xl border bg-card text-foreground',
        'hover:bg-accent active:bg-accent/80 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      <Icon name={icon} size="md" />
      <span className="text-xs font-medium">{label}</span>
    </a>
  );
}
