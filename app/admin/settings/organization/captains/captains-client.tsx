"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// =============================================================================
// HVA-91: CaptainsClient — list rows + Add/Edit modal + per-row actions
// =============================================================================
//
// One client island so we can share modal state, fetch helpers, and the
// "show temp password once" sub-modal. Each captain row carries Edit,
// Reset Password, and Deactivate/Activate buttons.
//
// Cities are picked via checkboxes (max 2 enforced server-side AND in the
// UI). The server returns 400 with fieldErrors on conflicts.
//
// Temp password is shown ONCE in a dialog after create or reset. Closing
// the dialog drops it from React state; no localStorage, no caching.
// =============================================================================

interface CityLite {
  id: string;
  name: string;
}

interface CaptainRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  cities: CityLite[];
}

interface Props {
  captains: CaptainRow[];
  allCities: CityLite[];
  availableCities: CityLite[];
}

type ModalMode =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; captain: CaptainRow }
  | { kind: "deactivate"; captain: CaptainRow }
  | { kind: "reset"; captain: CaptainRow }
  | { kind: "tempPassword"; fullName: string; tempPassword: string };

export function CaptainsClient({ captains, allCities, availableCities }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalMode>({ kind: "closed" });

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setModal({ kind: "add" })}>
          <Icon name="add" size="sm" />
          <span>Add Captain</span>
        </Button>
      </div>

      {captains.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center text-sm text-muted-foreground">
          No captains yet. Click <strong>Add Captain</strong> to create one.
        </div>
      ) : (
        <ul className="space-y-3">
          {captains.map((c) => (
            <li
              key={c.id}
              className="rounded-3xl border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold tracking-tight">
                      {c.fullName}
                    </h3>
                    <Badge variant={c.isActive ? "secondary" : "outline"} className="text-[10px]">
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {c.cities.map((city) => (
                      <Badge key={city.id} variant="outline" className="text-[10px]">
                        {city.name}
                      </Badge>
                    ))}
                    {c.cities.length === 0 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        No cities
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    {c.phone} · {c.email}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setModal({ kind: "edit", captain: c })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setModal({ kind: "reset", captain: c })}>
                    Reset PW
                  </Button>
                  {c.isActive ? (
                    <Button size="sm" variant="outline" onClick={() => setModal({ kind: "deactivate", captain: c })}>
                      Deactivate
                    </Button>
                  ) : (
                    <ActivateButton captainId={c.id} onDone={() => router.refresh()} />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(modal.kind === "add" || modal.kind === "edit") && (
        <CaptainFormModal
          mode={modal.kind === "edit" ? { kind: "edit", captain: modal.captain } : { kind: "add" }}
          allCities={allCities}
          availableCities={availableCities}
          onClose={() => setModal({ kind: "closed" })}
          onSuccess={(result) => {
            router.refresh();
            if (result?.tempPassword) {
              setModal({
                kind: "tempPassword",
                fullName: result.fullName,
                tempPassword: result.tempPassword,
              });
            } else {
              setModal({ kind: "closed" });
            }
          }}
        />
      )}

      {modal.kind === "reset" && (
        <ResetConfirmModal
          target={{ id: modal.captain.id, fullName: modal.captain.fullName }}
          endpoint={`/api/admin/captains/${modal.captain.id}/reset-password`}
          onClose={() => setModal({ kind: "closed" })}
          onTempPassword={(tp) =>
            setModal({ kind: "tempPassword", fullName: modal.captain.fullName, tempPassword: tp })
          }
        />
      )}

      {modal.kind === "deactivate" && (
        <DeactivateConfirmModal
          captain={modal.captain}
          onClose={() => setModal({ kind: "closed" })}
          onDone={() => {
            router.refresh();
            setModal({ kind: "closed" });
          }}
        />
      )}

      {modal.kind === "tempPassword" && (
        <TempPasswordModal
          fullName={modal.fullName}
          tempPassword={modal.tempPassword}
          onClose={() => setModal({ kind: "closed" })}
        />
      )}
    </>
  );
}

// -- form modal -------------------------------------------------------------

function CaptainFormModal({
  mode,
  allCities,
  availableCities,
  onClose,
  onSuccess,
}: {
  mode: { kind: "add" } | { kind: "edit"; captain: CaptainRow };
  allCities: CityLite[];
  availableCities: CityLite[];
  onClose: () => void;
  onSuccess: (result: { fullName: string; tempPassword?: string }) => void;
}) {
  const editing = mode.kind === "edit";
  const initial = editing ? mode.captain : null;
  const initialCityIds = initial ? initial.cities.map((c) => c.id) : [];

  // For Edit, the picker is allowed to include cities CURRENTLY held by
  // this captain (they aren't in availableCities since they're not
  // "unassigned"). Union them in.
  const pickable = editing
    ? Array.from(
        new Map(
          [...availableCities, ...(initial?.cities ?? [])].map((c) => [c.id, c]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name))
    : availableCities;

  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(
    initial ? initial.phone.replace(/^\+91/, "") : "",
  );
  const [email, setEmail] = useState(initial?.email ?? "");
  const [cityIds, setCityIds] = useState<string[]>(initialCityIds);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  function toggleCity(id: string) {
    setCityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit() {
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);
    try {
      const url = editing
        ? `/api/admin/captains/${initial!.id}`
        : `/api/admin/captains`;
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone,
          email,
          cityIds,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        tempPassword?: string;
        user?: { id: string };
      };
      if (!res.ok || !j.ok) {
        setFieldErrors(j.fieldErrors ?? {});
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Save failed.");
        return;
      }
      toast.success(editing ? "Captain updated" : "Captain created");
      onSuccess({ fullName, tempPassword: j.tempPassword });
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "Network error");
      toast.error("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit captain" : "Add captain"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update captain details and city assignments."
              : "Captain receives a one-time temp password. Communicate verbally."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cap-name">Name</Label>
            <Input
              id="cap-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={submitting}
              className="h-12"
            />
            {fieldErrors.fullName && (
              <p className="text-xs text-destructive">{fieldErrors.fullName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cap-phone">Phone (+91)</Label>
            <div className="flex items-stretch h-12 rounded-input border border-input bg-background focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring">
              <span className="flex items-center px-3 text-sm text-muted-foreground border-r border-input bg-muted/40 rounded-l-input">
                +91
              </span>
              <Input
                id="cap-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                disabled={submitting}
                maxLength={10}
                className="border-0 rounded-l-none h-full focus-visible:ring-0 focus-visible:border-0"
              />
            </div>
            {fieldErrors.phone && (
              <p className="text-xs text-destructive">{fieldErrors.phone}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cap-email">Email</Label>
            <Input
              id="cap-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className="h-12"
            />
            {fieldErrors.email && (
              <p className="text-xs text-destructive">{fieldErrors.email}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Cities {editing ? "(0–2)" : "(1 or 2)"}</Label>
            <div className="space-y-1.5 rounded-input border border-input p-3 max-h-48 overflow-y-auto">
              {pickable.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No cities available. Other captains must be deactivated or have
                  their cities unassigned first.
                </p>
              ) : (
                pickable.map((city) => {
                  const checked = cityIds.includes(city.id);
                  const disabled =
                    !checked && cityIds.length >= 2;
                  return (
                    <label
                      key={city.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={submitting || disabled}
                        onChange={() => toggleCity(city.id)}
                      />
                      <span className={disabled ? "text-muted-foreground" : ""}>
                        {city.name}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            {/* Suppress unused-import warning */}
            <span className="hidden">{allCities.length}</span>
            {fieldErrors.cityIds && (
              <p className="text-xs text-destructive">{fieldErrors.cityIds}</p>
            )}
          </div>

          {generalError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
            >
              {generalError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : editing ? (
              "Save changes"
            ) : (
              "Create captain"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -- reset password confirm -------------------------------------------------

function ResetConfirmModal({
  target,
  endpoint,
  onClose,
  onTempPassword,
}: {
  target: { id: string; fullName: string };
  endpoint: string;
  onClose: () => void;
  onTempPassword: (tp: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tempPassword?: string;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.tempPassword) {
        toast.error(j.error ?? "Reset failed.");
        return;
      }
      toast.success("Temp password generated");
      onTempPassword(j.tempPassword);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Reset password for {target.fullName}?</DialogTitle>
          <DialogDescription>
            Generates a new temp password and revokes all their active sessions.
            They will be forced to set a new password on next login.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={submitting}>
            {submitting ? "Resetting…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -- deactivate confirm -----------------------------------------------------

function DeactivateConfirmModal({
  captain,
  onClose,
  onDone,
}: {
  captain: CaptainRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/captains/${captain.id}/deactivate`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        citiesUnassigned?: string[];
      };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? "Deactivation failed.");
        return;
      }
      const cities = j.citiesUnassigned ?? [];
      toast.success(
        cities.length > 0
          ? `Captain deactivated. ${cities.length} ${cities.length === 1 ? "city" : "cities"} unassigned: ${cities.join(", ")}. Reassign via another captain's Edit.`
          : "Captain deactivated.",
      );
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Deactivate {captain.fullName}?</DialogTitle>
          <DialogDescription>
            {captain.cities.length > 0
              ? `Their ${captain.cities.length === 1 ? "city" : "cities"} (${captain.cities.map((c) => c.name).join(", ")}) will be unassigned. You'll need to assign ${captain.cities.length === 1 ? "it" : "them"} to another captain via that captain's Edit. The user keeps their account history but cannot log in until reactivated.`
              : "User cannot log in until reactivated. Account history preserved."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting}>
            {submitting ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -- temp password (show once) ----------------------------------------------

function TempPasswordModal({
  fullName,
  tempPassword,
  onClose,
}: {
  fullName: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Long-press the password to select it.");
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Temp password for {fullName}</DialogTitle>
          <DialogDescription>
            Communicate this VERBALLY. Once you close this dialog, the password
            is gone — you&apos;ll have to reset to generate another.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl bg-muted/40 border p-4 text-center">
          <p className="font-mono text-2xl tracking-wider select-all">
            {tempPassword}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            <Icon name={copied ? "check" : "content_copy"} size="sm" />
            <span>{copied ? "Copied" : "Copy"}</span>
          </Button>
          <Button onClick={onClose}>I&apos;ve communicated it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -- inline activate button -------------------------------------------------

function ActivateButton({
  captainId,
  onDone,
}: {
  captainId: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  async function onClick() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/captains/${captainId}/activate`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? "Activation failed.");
        return;
      }
      toast.success("Captain activated");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={submitting}>
      {submitting ? "…" : "Activate"}
    </Button>
  );
}
