import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import type { FirstTimeSetupStatus } from '@/lib/admin/dashboard-queries';

// HVA-88: pinned banner shown until cities + captains + execs all exist.

interface Props {
  status: FirstTimeSetupStatus;
}

export function FirstTimeSetupBanner({ status }: Props) {
  if (status.ready) return null;

  const steps: Array<{ label: string; href: string; done: boolean }> = [
    {
      label: 'Add cities',
      href: '/admin/settings/organization/cities',
      done: status.hasCities,
    },
    {
      label: 'Assign captains',
      href: '/admin/settings/organization/captains',
      done: status.hasCaptains,
    },
    {
      label: 'Assign sales executives',
      href: '/admin/settings/organization/executives',
      done: status.hasExecs,
    },
  ];

  return (
    <section
      aria-label="First-time setup"
      className="rounded-3xl border border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20 p-5 shadow-sm space-y-3"
    >
      <div className="flex items-center gap-2">
        <Icon name="rocket_launch" size="sm" className="text-amber-600" />
        <h2 className="text-base font-semibold tracking-tight">
          First-time setup
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Finish these three steps to unlock the rest of the admin surface.
        This banner disappears automatically once all are complete.
      </p>
      <ol className="space-y-1 text-sm">
        {steps.map((s, i) => (
          <li key={s.href} className="flex items-center gap-2">
            <Icon
              name={s.done ? 'check_circle' : 'radio_button_unchecked'}
              size="sm"
              className={s.done ? 'text-emerald-600' : 'text-muted-foreground'}
            />
            <span className={s.done ? 'text-muted-foreground line-through' : ''}>
              {i + 1}.{' '}
              {s.done ? (
                s.label
              ) : (
                <Link className="underline-offset-2 hover:underline" href={s.href}>
                  {s.label}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
