"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { loginSchema, type LoginInput } from "@/lib/validators/auth";

import { ForgotPasswordModal } from "./forgot-password-modal";

// Throttle: 5 submit attempts per rolling 60s. Belt-and-braces; the real
// rate limit lives server-side in Better-Auth (HVA-24).
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;

// Better-Auth phone-number plugin endpoint. Exact path is locked when HVA-24
// lands; until then this URL likely 404s — we catch it explicitly below so
// the user sees a clean "backend not yet wired" message instead of a crash.
const SIGN_IN_URL = "/api/auth/sign-in/phone-number";

const ROLE_HOME: Record<string, string> = {
  sales_executive: "/today",
  captain: "/captain/dashboard",
  super_admin: "/admin/dashboard",
};

// Sanitise the ?next= query param into a same-origin destination. proxy.ts
// (HVA-25) sets it when an unauthenticated user is bounced off a protected
// route; we honour it here AFTER successful sign-in. Defensive checks:
//   - must be relative (no scheme, no double-slash → no external redirect)
//   - must start with "/"
//   - must not target /login or /forgot-password (would re-enter the auth flow)
// On any failure we silently fall back to role home — better to land somewhere
// safe than to crash the page.
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.startsWith("/login") || raw.startsWith("/forgot-password")) return null;
  return raw;
}

interface LoginFormProps {
  /** Resolved by the parent server component from the config table. Empty
   *  string is "not configured" — the Forgot Password modal handles the
   *  fallback copy and hides the Call Admin button in that case. */
  adminPhone: string;
}

export function LoginForm({ adminPhone }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = safeNextPath(params.get("next"));
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [attempts, setAttempts] = useState<number[]>([]);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "", rememberMe: true },
    mode: "onTouched",
  });

  async function onSubmit(values: LoginInput) {
    setError(null);

    // Client-side throttle (rolling window).
    const now = Date.now();
    const recent = attempts.filter((t) => now - t < ATTEMPT_WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      setError("Too many attempts. Wait a minute and try again.");
      return;
    }
    setAttempts([...recent, now]);

    setSubmitting(true);
    try {
      const res = await fetch(SIGN_IN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          // Better-Auth phone-number plugin expects an E.164 phone string.
          // We prepend +91 here (the form only collects 10 digits).
          phoneNumber: `+91${values.phone}`,
          password: values.password,
          rememberMe: values.rememberMe,
        }),
      });

      if (res.status === 404) {
        // HVA-24 hasn't shipped — graceful stub message so the page is
        // usable end-to-end during development.
        setError(
          "Sign-in backend is not yet wired (HVA-24). The form works; submission will succeed once the auth route lands.",
        );
        return;
      }

      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => ({ message: "Sign-in failed" }))) as {
          message?: string;
        };
        setError(body.message ?? `Sign-in failed (${res.status})`);
        return;
      }

      const session = (await res.json().catch(() => ({}))) as {
        user?: { role?: string };
      };
      const role = session.user?.role;
      // HVA-25: honour ?next= if proxy.ts set it; otherwise fall to role home.
      const destination = nextParam ?? (role ? ROLE_HOME[role] ?? "/" : "/");
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Unexpected network error.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* Phone — 10-digit input with +91 prefix adornment */}
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="phone">Mobile number</FormLabel>
              <FormControl>
                <div className="flex items-stretch rounded-md border border-input bg-background focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring transition-all">
                  <span
                    aria-hidden="true"
                    className="flex items-center px-3 text-sm text-muted-foreground border-r border-input bg-muted/50 rounded-l-md"
                  >
                    +91
                  </span>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    maxLength={10}
                    aria-describedby="phone-help"
                    disabled={submitting}
                    {...field}
                    onChange={(e) =>
                      field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    className="border-0 rounded-l-none focus-visible:ring-0 focus-visible:border-0"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Password with eye toggle */}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="password">Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    disabled={submitting}
                    {...field}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={submitting}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
                  >
                    <Icon name={showPassword ? "visibility_off" : "visibility"} size="sm" />
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Remember me — Switch (UI/UX §Auth: default ON) */}
        <FormField
          control={form.control}
          name="rememberMe"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-md">
              <FormLabel
                htmlFor="rememberMe"
                className="text-sm font-normal cursor-pointer"
              >
                Keep me signed in
              </FormLabel>
              <FormControl>
                <Switch
                  id="rememberMe"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={submitting}
                  aria-label="Keep me signed in"
                />
              </FormControl>
            </FormItem>
          )}
        />

        {/* Inline error */}
        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
          >
            {error}
          </div>
        )}

        {/* Filled primary Sign In button — 56dp mobile (h-14), 48dp desktop (sm:h-12) */}
        <Button
          type="submit"
          disabled={submitting}
          className="w-full h-14 sm:h-12 text-base font-medium"
        >
          {submitting ? (
            <>
              <Icon name="progress_activity" size="sm" className="animate-spin" />
              <span>Signing in…</span>
            </>
          ) : (
            "Sign in"
          )}
        </Button>

        {/* Forgot password link — opens Call-Admin modal placeholder */}
        <div className="text-center">
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            disabled={submitting}
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            Forgot password?
          </button>
        </div>
      </form>

      <ForgotPasswordModal
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        adminPhone={adminPhone}
      />
    </Form>
  );
}
