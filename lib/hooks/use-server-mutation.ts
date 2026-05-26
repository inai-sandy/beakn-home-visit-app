'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';

// =============================================================================
// HVA-149: useServerMutation — single hook for the "refresh-required" pattern
// =============================================================================
//
// Every server-action call site in the app needs the same three pieces:
//
//   1. A submitting flag so the button shows a spinner + can't be double-tapped
//   2. useTransition + router.refresh() so RSC data reloads after the write
//   3. A toast on error so users see what went wrong
//
// Forgetting #2 has caused the HVA-136 / HVA-143 / HVA-146 / HVA-60 walk-bug
// class — mutations succeeded server-side but the UI didn't refresh.
// This hook bundles all three so call sites only describe what to do on
// success.
//
// USAGE:
//   const { mutate, isPending } = useServerMutation(myAction, {
//     successMessage: 'Saved',
//   });
//   <Button onClick={() => mutate(input)} disabled={isPending}>Save</Button>
//
// CONTRACT:
//   - Action must return ActionResult-shaped { ok: true, data? } or
//     { ok: false, error: string }
//   - mutate() resolves to the data on success or null on error/throw
//   - On success: toast.success(opts.successMessage) if provided, then
//     router.refresh() inside a transition
//   - On error: toast.error(result.error) — call site does NOT need to
//     handle the toast itself
// =============================================================================

type ActionResult<T> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface ServerMutationOptions<T> {
  /** Optional toast.success text rendered after a successful mutation. */
  successMessage?: string;
  /** Called after a successful refresh — useful for closing a modal. */
  onSuccess?: (data: T | undefined) => void;
  /** Called when the action returns ok=false — useful for inline field
   *  errors. Toast.error still fires unless suppressErrorToast=true.
   *  The second arg carries `fieldErrors` when the action returns them
   *  (the {ok:false} shape can extend ActionResult with that key —
   *  callers must consume the field map themselves). */
  onError?: (
    error: string,
    fieldErrors?: Record<string, string>,
  ) => void;
  /** Skip the default toast.error. Set when the call site renders its
   *  own inline error UI. */
  suppressErrorToast?: boolean;
  /** Skip the post-success router.refresh(). Rare — only useful for
   *  fire-and-forget actions that don't change RSC data. */
  skipRefresh?: boolean;
}

export interface ServerMutation<TInput, TData> {
  mutate: (input: TInput) => Promise<TData | null>;
  isPending: boolean;
}

export function useServerMutation<TInput, TData = undefined>(
  action: (input: TInput) => Promise<ActionResult<TData>>,
  options: ServerMutationOptions<TData> = {},
): ServerMutation<TInput, TData> {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const mutate = useCallback(
    async (input: TInput): Promise<TData | null> => {
      if (submitting || isPending) return null;
      setSubmitting(true);
      try {
        const result = await action(input);
        if (!result.ok) {
          if (!options.suppressErrorToast) toast.error(result.error);
          const fieldErrors = (
            result as { fieldErrors?: Record<string, string> }
          ).fieldErrors;
          options.onError?.(result.error, fieldErrors);
          return null;
        }
        if (options.successMessage) toast.success(options.successMessage);
        const data = result.data;
        if (!options.skipRefresh) {
          startTransition(() => router.refresh());
        }
        options.onSuccess?.(data);
        return data ?? (null as TData | null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network error';
        if (!options.suppressErrorToast) toast.error(message);
        options.onError?.(message);
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [action, options, router, submitting, isPending],
  );

  return {
    mutate,
    isPending: submitting || isPending,
  };
}
