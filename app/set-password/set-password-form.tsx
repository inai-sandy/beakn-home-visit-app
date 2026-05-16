'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { setPasswordSchema, type SetPasswordInput } from '@/lib/validators/auth';
import { cn } from '@/lib/utils';

import { setPasswordAction } from './actions';

interface Requirement {
  key: string;
  label: string;
  test: (newPassword: string, confirmPassword: string) => boolean;
}

const REQUIREMENTS: Requirement[] = [
  { key: 'length', label: 'At least 8 characters', test: (n) => n.length >= 8 },
  { key: 'digit', label: 'Contains a digit', test: (n) => /[0-9]/.test(n) },
  { key: 'letter', label: 'Contains a letter', test: (n) => /[a-zA-Z]/.test(n) },
  {
    key: 'match',
    label: 'Passwords match',
    test: (n, c) => n.length > 0 && n === c,
  },
];

export function SetPasswordForm() {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
    mode: 'onChange',
  });

  // Watch values for the live-requirement checklist.
  const newPassword = form.watch('newPassword');
  const confirmPassword = form.watch('confirmPassword');
  const requirementsMet = REQUIREMENTS.every((r) => r.test(newPassword, confirmPassword));

  async function onSubmit(values: SetPasswordInput) {
    setError(null);
    setSubmitting(true);
    try {
      // HVA-114: the action `redirect()`s on success — it throws a
      // NEXT_REDIRECT error that Next.js's Server Action runtime
      // intercepts. If the action returns, it's a validation failure.
      const result = await setPasswordAction(values);
      if (!result.ok) {
        setError(result.error);
      }
    } catch (err) {
      // Re-throw NEXT_REDIRECT so Next.js can do its navigation.
      // Swallowing it would leave the user stuck on /set-password,
      // which is exactly the bug HVA-114 closed.
      if (
        err &&
        typeof err === 'object' &&
        'digest' in err &&
        typeof (err as { digest: unknown }).digest === 'string' &&
        ((err as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
          (err as { digest: string }).digest === 'NEXT_REDIRECT')
      ) {
        throw err;
      }
      setError(err instanceof Error ? `Server error: ${err.message}` : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* New Password */}
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="newPassword">New password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    disabled={submitting}
                    {...field}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowNew((v) => !v)}
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                    aria-pressed={showNew}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    <Icon name={showNew ? 'visibility_off' : 'visibility'} size="sm" />
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Confirm Password */}
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="confirmPassword">Confirm password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    disabled={submitting}
                    {...field}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    aria-pressed={showConfirm}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    <Icon name={showConfirm ? 'visibility_off' : 'visibility'} size="sm" />
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Live requirements checklist */}
        <ul className="space-y-1.5 text-xs">
          {REQUIREMENTS.map((req) => {
            const met = req.test(newPassword, confirmPassword);
            return (
              <li key={req.key} className="flex items-center gap-2">
                <Icon
                  name={met ? 'check_circle' : 'radio_button_unchecked'}
                  size="xs"
                  className={cn(met ? 'text-primary' : 'text-muted-foreground/50')}
                  fill={met}
                />
                <span className={cn(met ? 'text-foreground' : 'text-muted-foreground')}>
                  {req.label}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Inline error (from server action) */}
        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
          >
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={submitting || !requirementsMet}
          className="w-full h-14 sm:h-12 text-base font-medium"
        >
          {submitting ? (
            <>
              <Icon name="progress_activity" size="sm" className="animate-spin" />
              <span>Setting password…</span>
            </>
          ) : (
            'Set password'
          )}
        </Button>
      </form>
    </Form>
  );
}
