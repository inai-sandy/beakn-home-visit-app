'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// HVA-76: System / Light / Dark chip selector. next-themes already wired
// in the root layout (attribute="class", defaultTheme="system"), so the
// hook does both localStorage persistence and the `.dark` class toggle —
// nothing else to wire here.

type ThemeChoice = 'system' | 'light' | 'dark';

const CHOICES: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'desktop_windows' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
];

export function ThemeChips() {
  const { theme, setTheme } = useTheme();
  // next-themes resolves on the client; before mount the value is undefined,
  // which would briefly flash the wrong active chip. Gate the render so the
  // selected chip is always correct.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const active = (mounted ? theme : 'system') as ThemeChoice;

  return (
    <div
      className="flex gap-2"
      role="radiogroup"
      aria-label="Color theme"
    >
      {CHOICES.map((choice) => {
        const selected = active === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(choice.value)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors',
              selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card hover:bg-muted',
            )}
          >
            <Icon name={choice.icon} size="xs" />
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
