'use client';

import { useRouter } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

// HVA-191: universal back navigation. Replaces hardcoded `Link href={ROLE_HOME[role]}`
// and `Link href="/specific/list"` patterns that always sent the user to the same
// destination regardless of where they came from. `router.back()` honors the actual
// browser history; `fallback` covers the no-history case (deep link, fresh tab).

type BackButtonProps = {
  fallback: string;
  ariaLabel?: string;
  iconSize?: ComponentProps<typeof Icon>['size'];
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
  children?: ReactNode;
};

export function BackButton({
  fallback,
  ariaLabel = 'Back',
  iconSize = 'sm',
  variant = 'ghost',
  size = 'icon-sm',
  className,
  children,
}: BackButtonProps) {
  const router = useRouter();

  function onClick() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallback);
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <Icon name="arrow_back" size={iconSize} />
      {children}
    </Button>
  );
}
