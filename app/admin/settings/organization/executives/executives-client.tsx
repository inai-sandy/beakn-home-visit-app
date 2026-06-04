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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// HVA-92: ExecutivesClient — list rows + Add/Edit + per-row actions
// Same patterns as CaptainsClient (HVA-91). No city picker on exec form —
// city derives from captain (design decision). Captain dropdown filters
// inactive captains client-side AND server-side.

interface CaptainLite {
  id: string;
  fullName: string;
}

interface ExecRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  captainUserId: string;
  captainName: string;
  // BUG 8 (2026-06-03): each exec belongs to ONE city. NULL only on
  // legacy rows whose captain owned multiple cities at backfill time —
  // the admin should re-edit those.
  cityId: string | null;
  cityName: string | null;
  cities: string[];
}

interface CityLite {
  id: string;
  name: string;
  captainUserId: string | null;
}

interface Props {
  executives: ExecRow[];
  activeCaptains: CaptainLite[];
  allCities: CityLite[];
}

type ModalMode =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; exec: ExecRow }
  | { kind: "deactivate"; exec: ExecRow }
  | { kind: "reset"; exec: ExecRow }
  | { kind: "tempPassword"; fullName: string; tempPassword: string };

export function ExecutivesClient({
  executives,
  activeCaptains,
  allCities,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalMode>({ kind: "closed" });
  const [filterCaptainId, setFilterCaptainId] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const searchLower = search.trim().toLowerCase();
  const filtered = executives.filter((e) => {
    if (filterCaptainId !== "__all__" && e.captainUserId !== filterCaptainId) {
      return false;
    }
    if (searchLower.length === 0) return true;
    return (
      e.fullName.toLowerCase().includes(searchLower) ||
      e.phone.toLowerCase().includes(searchLower) ||
      (e.email?.toLowerCase().includes(searchLower) ?? false) ||
      e.captainName.toLowerCase().includes(searchLower) ||
      (e.cityName?.toLowerCase().includes(searchLower) ?? false)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const paged = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="search"
            inputMode="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search name, phone, email, city…"
            className="h-9 w-64"
            aria-label="Search executives"
          />
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Filter
          </Label>
          <Select
            value={filterCaptainId}
            onValueChange={(v) => {
              setFilterCaptainId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 rounded-input w-full sm:min-w-48 sm:w-auto">
              <SelectValue placeholder="All captains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All captains</SelectItem>
              {activeCaptains.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setModal({ kind: "add" })}>
          <Icon name="add" size="sm" />
          <span>Add Sales Executive</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center text-sm text-muted-foreground">
          {executives.length === 0 ? (
            <>
              No executives yet. Click <strong>Add Sales Executive</strong> to
              create one.
            </>
          ) : (
            "No executives match this filter."
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {paged.map((e) => (
            <li key={e.id} className="rounded-3xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold tracking-tight">
                      {e.fullName}
                    </h3>
                    <Badge variant={e.isActive ? "secondary" : "outline"} className="text-[10px]">
                      {e.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      Captain: {e.captainName}
                    </Badge>
                    {e.cities.map((city) => (
                      <Badge key={city} variant="outline" className="text-[10px]">
                        {city}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    {e.phone} · {e.email}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setModal({ kind: "edit", exec: e })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setModal({ kind: "reset", exec: e })}>
                    Reset PW
                  </Button>
                  {e.isActive ? (
                    <Button size="sm" variant="outline" onClick={() => setModal({ kind: "deactivate", exec: e })}>
                      Deactivate
                    </Button>
                  ) : (
                    <ActivateButton execId={e.id} onDone={() => router.refresh()} />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3 mt-4"
        >
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              Prev
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums self-center">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}

      {(modal.kind === "add" || modal.kind === "edit") && (
        <ExecFormModal
          mode={modal.kind === "edit" ? { kind: "edit", exec: modal.exec } : { kind: "add" }}
          activeCaptains={activeCaptains}
          allCities={allCities}
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
          target={{ id: modal.exec.id, fullName: modal.exec.fullName }}
          endpoint={`/api/admin/executives/${modal.exec.id}/reset-password`}
          onClose={() => setModal({ kind: "closed" })}
          onTempPassword={(tp) =>
            setModal({ kind: "tempPassword", fullName: modal.exec.fullName, tempPassword: tp })
          }
        />
      )}

      {modal.kind === "deactivate" && (
        <DeactivateConfirmModal
          exec={modal.exec}
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

function ExecFormModal({
  mode,
  activeCaptains,
  allCities,
  onClose,
  onSuccess,
}: {
  mode: { kind: "add" } | { kind: "edit"; exec: ExecRow };
  activeCaptains: CaptainLite[];
  allCities: CityLite[];
  onClose: () => void;
  onSuccess: (result: { fullName: string; tempPassword?: string }) => void;
}) {
  const editing = mode.kind === "edit";
  const initial = editing ? mode.exec : null;

  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(
    initial ? initial.phone.replace(/^\+91/, "") : "",
  );
  const [email, setEmail] = useState(initial?.email ?? "");
  const [captainUserId, setCaptainUserId] = useState(
    initial?.captainUserId ?? "",
  );
  const [cityId, setCityId] = useState<string>(initial?.cityId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // BUG 8 (2026-06-03): city dropdown is filtered to the chosen
  // captain's owned cities. When the captain changes, reset cityId so
  // an old (now-invalid-for-this-captain) selection can't slip through.
  const captainCities = allCities.filter(
    (c) => captainUserId !== "" && c.captainUserId === captainUserId,
  );

  async function onSubmit() {
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);
    try {
      const url = editing
        ? `/api/admin/executives/${initial!.id}`
        : `/api/admin/executives`;
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, email, captainUserId, cityId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        tempPassword?: string;
      };
      if (!res.ok || !j.ok) {
        setFieldErrors(j.fieldErrors ?? {});
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Save failed.");
        return;
      }
      toast.success(editing ? "Executive updated" : "Executive created");
      onSuccess({ fullName, tempPassword: j.tempPassword });
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
          <DialogTitle>{editing ? "Edit executive" : "Add executive"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update executive details and captain assignment."
              : "Executive receives a one-time temp password. Communicate verbally."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="exec-name">Name</Label>
            <Input
              id="exec-name"
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
            <Label htmlFor="exec-phone">Phone (+91)</Label>
            <div className="flex items-stretch h-12 rounded-input border border-input bg-background focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring">
              <span className="flex items-center px-3 text-sm text-muted-foreground border-r border-input bg-muted/40 rounded-l-input">
                +91
              </span>
              <Input
                id="exec-phone"
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
            <Label htmlFor="exec-email">Email</Label>
            <Input
              id="exec-email"
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
            <Label htmlFor="exec-captain">Assigned Captain</Label>
            <Select
              value={captainUserId || undefined}
              onValueChange={(v) => {
                setCaptainUserId(v);
                // Reset city when captain changes — old selection may
                // not belong to the new captain.
                setCityId("");
              }}
              disabled={submitting || activeCaptains.length === 0}
            >
              <SelectTrigger id="exec-captain" className="h-12 w-full rounded-input">
                <SelectValue
                  placeholder={
                    activeCaptains.length === 0
                      ? "No active captains. Add one first."
                      : "Select a captain"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {activeCaptains.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.captainUserId && (
              <p className="text-xs text-destructive">{fieldErrors.captainUserId}</p>
            )}
          </div>

          {/* BUG 8 (2026-06-03): exec belongs to ONE city. Filtered to
              the chosen captain's cities. Required field. */}
          <div className="space-y-2">
            <Label htmlFor="exec-city">City</Label>
            <Select
              value={cityId || undefined}
              onValueChange={setCityId}
              disabled={
                submitting || captainUserId === "" || captainCities.length === 0
              }
            >
              <SelectTrigger id="exec-city" className="h-12 w-full rounded-input">
                <SelectValue
                  placeholder={
                    captainUserId === ""
                      ? "Pick a captain first"
                      : captainCities.length === 0
                        ? "This captain has no cities yet"
                        : "Select a city"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {captainCities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.cityId && (
              <p className="text-xs text-destructive">{fieldErrors.cityId}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Sales executives belong to exactly one city. Visible only in
              that city&apos;s admin metrics.
            </p>
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
          <Button
            onClick={onSubmit}
            disabled={submitting || !captainUserId || !cityId}
          >
            {submitting ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : editing ? (
              "Save changes"
            ) : (
              "Create executive"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

function DeactivateConfirmModal({
  exec,
  onClose,
  onDone,
}: {
  exec: ExecRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  async function confirm() {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/admin/executives/${exec.id}/deactivate`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        // 409 = open requests; show inline so admin can fix without closing
        // the dialog.
        setServerError(j.error ?? "Deactivation failed.");
        return;
      }
      toast.success("Executive deactivated");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Deactivate {exec.fullName}?</DialogTitle>
          <DialogDescription>
            Blocks login. Account history preserved. If they have open assigned
            requests, you&apos;ll need to reassign or close those first.
          </DialogDescription>
        </DialogHeader>
        {serverError && (
          <div
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
          >
            {serverError}
          </div>
        )}
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
      toast.error("Could not copy. Long-press to select.");
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Temp password for {fullName}</DialogTitle>
          <DialogDescription>
            Communicate this VERBALLY. Once you close this dialog the password
            is gone — reset to generate another.
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

function ActivateButton({
  execId,
  onDone,
}: {
  execId: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  async function onClick() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/executives/${execId}/activate`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? "Activation failed.");
        return;
      }
      toast.success("Executive activated");
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
