"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  ALLOWED_BHKS,
  ALLOWED_CITIES,
  ALLOWED_INTERESTS,
  CITY_TO_STATE,
  customerRequestSchema,
  type AllowedCity,
  type CustomerRequestInput,
} from "@/lib/validators/customer-request";

import { LocationCard, type LocationCoords } from "./location-card";

// =============================================================================
// HVA-31: customer request form (public /request)
// =============================================================================
//
// Eight fields, ordered exactly per spec §1.2. Layout + styling carries from
// HVA-30 (shadcn primitives, --radius-input 12px on text inputs / select /
// textarea, --radius-modal 24px on the surrounding card). All form chrome
// from this file is M3 outlined; selected chip states use M3 primary fill.
//
// Validation strategy:
//   - mode: 'onBlur' so users see errors per-field as they leave the input
//     rather than typing-into-an-error-state. Submit attempt runs full
//     validation; on first error react-hook-form sets focus on the failing
//     field (built-in behaviour, plus we scroll the field into view manually
//     since iOS Safari can otherwise leave it under the soft keyboard).
//
// Phone field:
//   - Visible +91 prefix is a static adornment INSIDE the input border;
//     user types 10 digits. inputMode=numeric drives the mobile numeric pad.
//     The field's raw value is the 10-digit half — server stores
//     "+91"+digits at HVA-33 submit time.
//   - onChange strips everything except digits and clips to 10 chars so the
//     UI can't outpace the schema even mid-type.
//
// City → State auto-fill:
//   - On city change we set the state field via form.setValue and mark it
//     dirty + touched so blur-validation runs cleanly. State remains a
//     normal text input — user can edit the auto-filled value if they
//     prefer a non-default (e.g. "Other" city, or someone visiting from a
//     state we didn't pre-fill).
//
// Chip groups (BHK / Interest):
//   - shadcn ToggleGroup primitive wrapped with className overrides for the
//     M3 chip look: rounded-full, primary-coloured outline when off, primary
//     fill when on. BHK = type="single" (one-of-five). Interest = type=
//     "multiple" (at-least-one-of-four; "All" selectable independently —
//     no implicit-others-selected logic).
//
// SUBMIT:
//   - Placeholder. Validates client-side; on success fires a Sonner toast
//     pointing at HVA-33 and console.logs the payload in development so the
//     reviewer can sanity-check shape. NO Postgres write, NO token gen,
//     NO redirect — all three land in HVA-33 / HVA-35.
// =============================================================================

// =============================================================================
// HVA-34: Cloudflare Turnstile integration
// =============================================================================
//
// SCRIPT loaded from app/request/page.tsx via next/script (afterInteractive).
// WIDGET rendered here via explicit window.turnstile.render(...) — explicit
// rendering gives us the widget id back so cleanup on unmount, expiry, and
// re-render are all programmatic. Implicit rendering (the
// `<div class="cf-turnstile" />` data-attrs path) would also work but adds
// a global window.onTurnstileSuccess footgun.
//
// TOKEN handling:
//   - On success/error/expired callbacks we route into form.setValue so the
//     Zod schema (turnstileToken: string().min(1)) can gate submit.
//   - The submit button is disabled while the token is empty. Once present
//     the button enables; on expiry the widget auto-re-challenges and the
//     token clears until the user solves it again.
// =============================================================================

interface TurnstileGlobal {
  render(
    container: string | HTMLElement,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact" | "invisible";
      retry?: "auto" | "never";
    },
  ): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Reserved space for the Turnstile widget. Managed mode often renders
// invisibly; visible challenges occupy ~65px. Pinning min-height stops
// CLS when the challenge UI does appear.
const TURNSTILE_CONTAINER_CLASS = "min-h-[65px]";

// Chip className — applied to every ToggleGroupItem in BHK + Interest.
// Selected state hits via data-[state=on] and inherits from M3 primary.
const CHIP_CLASS = cn(
  "rounded-full border border-primary/40 bg-transparent text-primary",
  "h-10 px-4 text-sm font-medium",
  "hover:bg-primary/10 hover:text-primary",
  "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
  "data-[state=on]:border-primary",
  "transition-colors",
);

export function RequestForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CustomerRequestInput>({
    resolver: zodResolver(customerRequestSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      // Cast: empty string isn't part of the city enum, but the Select
      // trigger needs an "uninitialised" value to render its placeholder.
      // The zod resolver catches the missing value on submit.
      city: "" as unknown as AllowedCity,
      state: "",
      bhk: "" as unknown as CustomerRequestInput["bhk"],
      interest: [],
      // HVA-32: optional GPS coords. Left undefined unless the user opts in
      // via LocationCard; submission never blocks on missing values.
      latitude: undefined,
      longitude: undefined,
      accuracy: undefined,
      // HVA-34: Turnstile token; populated by the widget's success callback.
      turnstileToken: "",
    },
    mode: "onBlur",
  });

  // HVA-34: explicit Turnstile render. The script (loaded in page.tsx) sets
  // window.turnstile asynchronously, so we poll with a short interval until
  // it's available. Once rendered, the success/error/expired callbacks route
  // straight into form state — submit button gates on the token's presence.
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!TURNSTILE_SITE_KEY) {
      // Mis-configured env. Don't fail silently — surface to the dev
      // console; the submit button will still be disabled because the
      // token field is empty.
      console.warn(
        "[HVA-34] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set. Widget will not render.",
      );
      return;
    }

    let cancelled = false;

    const renderWidget = () => {
      if (cancelled) return;
      const ts = window.turnstile;
      const container = turnstileContainerRef.current;
      if (!ts || !container) return;
      if (turnstileWidgetIdRef.current) return; // already rendered

      turnstileWidgetIdRef.current = ts.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        // 'flexible' lets Cloudflare pick visible vs invisible per risk.
        size: "flexible",
        retry: "auto",
        callback: (token) => {
          form.setValue("turnstileToken", token, { shouldValidate: true });
        },
        "error-callback": () => {
          form.setValue("turnstileToken", "", { shouldValidate: true });
        },
        "expired-callback": () => {
          form.setValue("turnstileToken", "", { shouldValidate: true });
        },
        "timeout-callback": () => {
          form.setValue("turnstileToken", "", { shouldValidate: true });
        },
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      // Poll for the script to finish loading. Cloudflare's script
      // doesn't expose an onload event we can hook into reliably.
      const t = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(t);
          renderWidget();
        }
      }, 100);
      // Safety: give up polling after 15s so a Cloudflare outage doesn't
      // leak intervals forever.
      const stopT = window.setTimeout(() => {
        window.clearInterval(t);
      }, 15_000);
      return () => {
        cancelled = true;
        window.clearInterval(t);
        window.clearTimeout(stopT);
        if (turnstileWidgetIdRef.current && window.turnstile) {
          window.turnstile.remove(turnstileWidgetIdRef.current);
          turnstileWidgetIdRef.current = null;
        }
      };
    }

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
    // form is stable from useForm — referencing it doesn't need to retrigger
    // the effect. We only re-render the widget if the component mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // HVA-32: lift coords from LocationCard into form state. Stored at full
  // browser precision — never rounded — so HVA-33 can persist the exact
  // device-reported lat/lng/accuracy onto the request row.
  const handleLocationShared = (coords: LocationCoords) => {
    form.setValue("latitude", coords.latitude, { shouldDirty: true });
    form.setValue("longitude", coords.longitude, { shouldDirty: true });
    form.setValue("accuracy", coords.accuracy, { shouldDirty: true });
  };

  async function onSubmit(values: CustomerRequestInput) {
    setSubmitting(true);
    try {
      // HVA-34: POST to /api/customer-request (anti-spam shell + stub
      // success). HVA-33 replaces the server-side stub with the real
      // visit_requests insert + token generation + redirect-target
      // response; the request shape on this side stays the same.
      const res = await fetch("/api/customer-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      // 429: rate limit hit. Show the server-supplied error message,
      // since the cooldown window is policy-driven.
      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "Too many requests, try again in an hour.");
        return;
      }

      // 400: server-side Zod or Turnstile rejection. If field-level
      // errors are returned, surface them on the form. Otherwise show
      // a generic toast.
      if (res.status === 400) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          fieldErrors?: Record<string, string>;
        };
        if (j.fieldErrors && Object.keys(j.fieldErrors).length > 0) {
          for (const [field, message] of Object.entries(j.fieldErrors)) {
            form.setError(field as keyof CustomerRequestInput, { message });
          }
          // Clear the Turnstile token so the widget re-challenges; some
          // 400s (turnstile-failed) imply the token is no longer valid.
          form.setValue("turnstileToken", "", { shouldValidate: true });
          if (window.turnstile && turnstileWidgetIdRef.current) {
            window.turnstile.reset(turnstileWidgetIdRef.current);
          }
          toast.error(j.error ?? "Some fields are invalid.");
          return;
        }
        // Generic 400 (likely Turnstile verification fail) — reset widget.
        form.setValue("turnstileToken", "", { shouldValidate: true });
        if (window.turnstile && turnstileWidgetIdRef.current) {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        }
        toast.error(
          j.error ?? "Verification failed. Please retry the challenge.",
        );
        return;
      }

      if (!res.ok) {
        toast.error("Service temporarily unavailable. Please try again.");
        return;
      }

      // 200 — HVA-33: server inserted the row and returned the
      // tracking token. Two shapes:
      //   { ok: true, trackingToken } — fresh submission.
      //   { ok: true, duplicate: true, existingTrackingToken } —
      //     phone-duplicate soft block; redirect to the ORIGINAL
      //     confirmation so the customer recovers their token.
      // In both cases the destination is /submitted/<token>; the
      // success screen is the user-facing confirmation. No toast on
      // the happy path — the page transition is the feedback.
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        trackingToken?: string;
        duplicate?: boolean;
        existingTrackingToken?: string;
      };
      const token = j.duplicate ? j.existingTrackingToken : j.trackingToken;
      if (!token) {
        toast.error("Submission succeeded but no token was returned.");
        return;
      }
      router.push(`/submitted/${token}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Network error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
        noValidate
      >
        {/* HVA-32: optional location share. Renders above Name; the card
            internally returns null when dismissed (sessionStorage flag) so
            the layout closes up cleanly. Coords are lifted into form state
            via handleLocationShared. */}
        <LocationCard onShare={handleLocationShared} />

        {/* 1. Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="name">Name</FormLabel>
              <FormControl>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your full name"
                  disabled={submitting}
                  className="h-12"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 2. Phone — +91 adornment + 10-digit input */}
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="phone">Phone</FormLabel>
              <FormControl>
                <div className="flex items-stretch h-12 rounded-input border border-input bg-background focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring transition-all">
                  <span
                    aria-hidden="true"
                    className="flex items-center px-3 text-sm text-muted-foreground border-r border-input bg-muted/40 rounded-l-input select-none"
                  >
                    +91
                  </span>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    maxLength={10}
                    disabled={submitting}
                    {...field}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value.replace(/\D/g, "").slice(0, 10),
                      )
                    }
                    className="border-0 rounded-l-none focus-visible:ring-0 focus-visible:border-0 h-full"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 3. Email */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="email">Email</FormLabel>
              <FormControl>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled={submitting}
                  className="h-12"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 4. Address — textarea, 3 rows default */}
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="address">Address</FormLabel>
              <FormControl>
                <Textarea
                  id="address"
                  rows={3}
                  autoComplete="street-address"
                  placeholder="Flat / building / street / locality"
                  disabled={submitting}
                  className="rounded-input"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 5. City — Select; on change → set State default */}
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="city">City</FormLabel>
              <Select
                value={field.value || undefined}
                onValueChange={(v) => {
                  const next = v as AllowedCity;
                  field.onChange(next);
                  // Auto-fill state. Mark touched so blur-validation has a
                  // signal to act on if the user later clears the value.
                  const defaultState = CITY_TO_STATE[next] ?? "";
                  form.setValue("state", defaultState, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  });
                }}
                disabled={submitting}
              >
                <FormControl>
                  <SelectTrigger
                    id="city"
                    className="h-12 w-full rounded-input"
                  >
                    <SelectValue placeholder="Select a city" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ALLOWED_CITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 6. State — auto-filled but editable */}
        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="state">State</FormLabel>
              <FormControl>
                <Input
                  id="state"
                  type="text"
                  autoComplete="address-level1"
                  placeholder="State"
                  disabled={submitting}
                  className="h-12"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 7. BHK — single-select chip group */}
        <FormField
          control={form.control}
          name="bhk"
          render={({ field }) => (
            <FormItem>
              <FormLabel>BHK</FormLabel>
              <FormControl>
                <ToggleGroup
                  type="single"
                  value={field.value || ""}
                  onValueChange={(v) => {
                    if (!v) return; // ignore deselect on the active chip
                    field.onChange(v);
                  }}
                  className="flex-wrap justify-start gap-2 w-full"
                  disabled={submitting}
                >
                  {ALLOWED_BHKS.map((opt) => (
                    <ToggleGroupItem
                      key={opt}
                      value={opt}
                      aria-label={`BHK ${opt}`}
                      className={CHIP_CLASS}
                    >
                      {opt}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* 8. Interest — multi-select chip group */}
        <FormField
          control={form.control}
          name="interest"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Interest</FormLabel>
              <FormControl>
                <ToggleGroup
                  type="multiple"
                  value={field.value ?? []}
                  onValueChange={(v) => field.onChange(v)}
                  className="flex-wrap justify-start gap-2 w-full"
                  disabled={submitting}
                >
                  {ALLOWED_INTERESTS.map((opt) => (
                    <ToggleGroupItem
                      key={opt}
                      value={opt}
                      aria-label={`Interest ${opt}`}
                      className={CHIP_CLASS}
                    >
                      {opt}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* HVA-34: Cloudflare Turnstile widget. Rendered via the explicit
            API in the useEffect above. min-h reserves space so a visible
            challenge doesn't shift layout when it appears. */}
        <div className={TURNSTILE_CONTAINER_CLASS}>
          <div ref={turnstileContainerRef} data-slot="turnstile-container" />
        </div>

        {/* Submit — Filled primary, 56dp mobile / 48dp desktop, full width.
            HVA-34: disabled until the Turnstile widget produces a token
            (form.watch('turnstileToken') is empty until success-callback
            fires). */}
        <Button
          type="submit"
          disabled={submitting || !form.watch("turnstileToken")}
          className="w-full h-14 sm:h-12 text-base font-medium"
        >
          {submitting ? (
            <>
              <Icon
                name="progress_activity"
                size="sm"
                className="animate-spin"
              />
              <span>Submitting…</span>
            </>
          ) : (
            "Submit"
          )}
        </Button>
      </form>
    </Form>
  );
}
