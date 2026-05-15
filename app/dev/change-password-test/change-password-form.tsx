"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useDirtyFormGuard } from "@/lib/hooks/use-dirty-form-guard";
import { cn } from "@/lib/utils";
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/lib/validators/auth";

import { changePasswordAction } from "./actions";

// =============================================================================
// HVA-29: Change-Password form (Profile-screen target, dev-route host)
// =============================================================================
//
// Lives at /dev/change-password-test/ until HVA-76 ships the Profile screen.
// When that lands, lift this component + the action + the page into Profile
// and delete the /dev host. No logic in this file references the /dev path.
//
// Behaviour mirrors HVA-26's set-password-form:
//   - react-hook-form + zodResolver + mode: 'onChange' for real-time errors
//   - per-field show/hide eye toggle
//   - live "requirements met" checklist for the new password
//   - submit button disabled until all client-side checks pass
//
// Differences from HVA-26:
//   - One extra field (currentPassword) at the top with its own eye toggle.
//   - "Passwords match" requirement compares new vs confirm, same as before.
//   - Extra requirement: "different from current password" — block trivial
//     reuse of the same password.
//   - Server-side errors come back as either a generic `error` (shown as a
//     banner above the submit) or a `fieldError: 'currentPassword'` (shown
//     under the Current Password input, since "incorrect current pwd" is
//     the only field-level failure the server reports).
//   - On success: Sonner toast + form reset (resetting also clears isDirty
//     so the navigation guard releases its locks before the soft refresh).
// =============================================================================

interface Requirement {
  key: string;
  label: string;
  test: (currentPwd: string, newPwd: string, confirmPwd: string) => boolean;
}

const REQUIREMENTS: Requirement[] = [
  {
    key: "length",
    label: "At least 8 characters",
    test: (_c, n) => n.length >= 8,
  },
  {
    key: "digit",
    label: "Contains a digit",
    test: (_c, n) => /[0-9]/.test(n),
  },
  {
    key: "letter",
    label: "Contains a letter",
    test: (_c, n) => /[a-zA-Z]/.test(n),
  },
  {
    key: "match",
    label: "Passwords match",
    test: (_c, n, conf) => n.length > 0 && n === conf,
  },
  {
    key: "different",
    label: "Different from current password",
    test: (c, n) => n.length > 0 && c.length > 0 && c !== n,
  },
];

export function ChangePasswordForm() {
  const router = useRouter();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    mode: "onChange",
  });

  // HVA-29 AC #4: block accidental nav away from a dirty form. Hook is a no-op
  // when isDirty=false; flips on as soon as the user types anything; flips
  // back off after a successful submit (form.reset() below).
  useDirtyFormGuard(form.formState.isDirty);

  const currentPassword = form.watch("currentPassword");
  const newPassword = form.watch("newPassword");
  const confirmPassword = form.watch("confirmPassword");
  const requirementsMet = REQUIREMENTS.every((r) =>
    r.test(currentPassword, newPassword, confirmPassword),
  );

  async function onSubmit(values: ChangePasswordInput) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await changePasswordAction(values);
      if (!result.ok) {
        if (result.fieldError === "currentPassword") {
          form.setError("currentPassword", { message: result.error });
        } else {
          setError(result.error);
        }
        return;
      }
      toast.success("Password updated", {
        description:
          result.otherSessionsRevoked > 0
            ? `Signed out of ${result.otherSessionsRevoked} other ${result.otherSessionsRevoked === 1 ? "device" : "devices"}.`
            : "Your password has been changed.",
      });
      form.reset({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      // Soft refresh so server-fetched session info on the page updates.
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? `Server error: ${err.message}` : "Unexpected error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Current Password */}
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="currentPassword">Current password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    id="currentPassword"
                    type={showCurrent ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    disabled={submitting}
                    {...field}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowCurrent((v) => !v)}
                    aria-label={showCurrent ? "Hide password" : "Show password"}
                    aria-pressed={showCurrent}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    <Icon
                      name={showCurrent ? "visibility_off" : "visibility"}
                      size="sm"
                    />
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                    type={showNew ? "text" : "password"}
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
                    aria-label={showNew ? "Hide password" : "Show password"}
                    aria-pressed={showNew}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    <Icon
                      name={showNew ? "visibility_off" : "visibility"}
                      size="sm"
                    />
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Confirm New Password */}
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="confirmPassword">
                Confirm new password
              </FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirm ? "text" : "password"}
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
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    aria-pressed={showConfirm}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    <Icon
                      name={showConfirm ? "visibility_off" : "visibility"}
                      size="sm"
                    />
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
            const met = req.test(currentPassword, newPassword, confirmPassword);
            return (
              <li key={req.key} className="flex items-center gap-2">
                <Icon
                  name={met ? "check_circle" : "radio_button_unchecked"}
                  size="xs"
                  className={cn(
                    met ? "text-primary" : "text-muted-foreground/50",
                  )}
                  fill={met}
                />
                <span
                  className={cn(
                    met ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {req.label}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Generic server-side error banner (only for non-field errors) */}
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
              <span>Updating password…</span>
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </form>
    </Form>
  );
}
