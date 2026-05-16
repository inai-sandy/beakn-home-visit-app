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
// HVA-110: CitiesClient — list rows + captain_routing_email edit modal
// =============================================================================
//
// Mirrors the HVA-91 captains-client.tsx pattern: server provides rows as a
// prop, this client island owns the modal state. Only one row action: Edit
// (Other row's button is disabled with a tooltip — submissions there route
// to super_admins by design).
// =============================================================================

interface CityRow {
  id: string;
  name: string;
  state: string | null;
  captainUserId: string | null;
  captainName: string | null;
  captainIsActive: boolean | null;
  captainRoutingEmail: string | null;
  isActive: boolean;
}

interface Props {
  cities: CityRow[];
}

type ModalMode =
  | { kind: "closed" }
  | { kind: "edit"; city: CityRow };

export function CitiesClient({ cities }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalMode>({ kind: "closed" });

  return (
    <>
      <ul className="space-y-3">
        {cities.map((c) => {
          const isOther = c.name === "Other";
          return (
            <li key={c.id} className="rounded-3xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold tracking-tight">
                      {c.name}
                    </h3>
                    {c.state && (
                      <Badge variant="outline" className="text-[10px]">
                        {c.state}
                      </Badge>
                    )}
                    {isOther && (
                      <Badge variant="outline" className="text-[10px]">
                        Catch-all
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="text-muted-foreground/70">Captain: </span>
                    {c.captainName ? (
                      <>
                        <span className="font-medium text-foreground">
                          {c.captainName}
                        </span>
                        {c.captainIsActive === false && (
                          <span className="ml-1 text-amber-700">(inactive)</span>
                        )}
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </p>
                  <p className="text-xs">
                    <span className="text-muted-foreground/70">
                      Routing email:{" "}
                    </span>
                    {isOther ? (
                      <span className="text-muted-foreground italic">
                        n/a — routes to super_admins by design
                      </span>
                    ) : c.captainRoutingEmail ? (
                      <span className="font-mono">{c.captainRoutingEmail}</span>
                    ) : (
                      <span className="text-amber-700 italic">
                        not set — submissions route to super_admins as [UNROUTED]
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isOther}
                    onClick={() => !isOther && setModal({ kind: "edit", city: c })}
                    title={
                      isOther
                        ? "Other-city submissions route to super_admins by design"
                        : "Edit routing email"
                    }
                  >
                    Edit
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {modal.kind === "edit" && (
        <EditRoutingEmailModal
          city={modal.city}
          onClose={() => setModal({ kind: "closed" })}
          onSuccess={() => {
            router.refresh();
            setModal({ kind: "closed" });
          }}
        />
      )}
    </>
  );
}

function EditRoutingEmailModal({
  city,
  onClose,
  onSuccess,
}: {
  city: CityRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState(city.captainRoutingEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function onSubmit() {
    setSubmitting(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const res = await fetch(`/api/admin/cities/${city.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captainRoutingEmail: value.trim() === "" ? null : value.trim(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        changed?: boolean;
      };
      if (!res.ok || !j.ok) {
        setFieldError(j.fieldErrors?.captainRoutingEmail ?? null);
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Update failed.");
        return;
      }
      toast.success(
        j.changed === false
          ? "No changes — routing email unchanged."
          : value.trim() === ""
            ? `${city.name} routing email cleared — falls back to [UNROUTED].`
            : `${city.name} routing email updated.`,
      );
      onSuccess();
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Edit {city.name} routing email</DialogTitle>
          <DialogDescription>
            New customer requests for {city.name} will be emailed to this address.
            Leave blank to fall back to the super_admin [UNROUTED] inbox.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="city-routing-email">Captain routing email</Label>
          <Input
            id="city-routing-email"
            type="email"
            placeholder="captain@example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            className="h-12"
            autoFocus
          />
          {fieldError && (
            <p className="text-xs text-destructive">{fieldError}</p>
          )}
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
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
