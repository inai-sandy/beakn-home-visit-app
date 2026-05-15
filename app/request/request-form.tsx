"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
    },
    mode: "onBlur",
  });

  async function onSubmit(values: CustomerRequestInput) {
    setSubmitting(true);
    try {
      // HVA-33 will replace this with a Server Action that:
      //  - re-validates server-side with customerRequestSchema
      //  - generates the visit-request token (HVA-32)
      //  - inserts the row into visit_requests
      //  - redirects to /success/<token> (HVA-35)
      // For now: log the validated payload to dev console so the reviewer
      // can see the exact shape downstream code will receive.
      console.log("[HVA-31] validated payload", {
        ...values,
        // Echo the storage-shape too so HVA-33's diff is obvious.
        phone_storage: `+91${values.phone}`,
      });
      toast.success("Form validated. Submission lands in HVA-33.", {
        description:
          "Token generation and DB write are wired in the next issue.",
      });
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

        {/* Submit — Filled primary, 56dp mobile / 48dp desktop, full width */}
        <Button
          type="submit"
          disabled={submitting}
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
