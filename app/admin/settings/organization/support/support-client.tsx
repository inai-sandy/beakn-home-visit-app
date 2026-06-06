'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// =============================================================================
// HVA-236 (HVA-235-FIX1): SupportUsersClient — list + Add / Edit / activate /
// deactivate / reset-password for the support team.
// =============================================================================

export interface SupportUserRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}

type ModalMode =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; user: SupportUserRow }
  | { kind: 'deactivate'; user: SupportUserRow }
  | { kind: 'activate'; user: SupportUserRow }
  | { kind: 'reset'; user: SupportUserRow }
  | { kind: 'tempPassword'; fullName: string; tempPassword: string };

interface Props {
  users: SupportUserRow[];
}

export function SupportUsersClient({ users }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalMode>({ kind: 'closed' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const searchLower = search.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (searchLower.length === 0) return true;
    return (
      u.fullName.toLowerCase().includes(searchLower) ||
      u.phone.toLowerCase().includes(searchLower) ||
      (u.email?.toLowerCase().includes(searchLower) ?? false)
    );
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Input
          type="search"
          placeholder="Search by name, phone, or email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="h-10 max-w-sm"
          aria-label="Search support users"
        />
        <Button onClick={() => setModal({ kind: 'add' })} className="h-10">
          <Icon name="person_add" size="sm" />
          <span>Add support user</span>
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
          <Icon
            name="support_agent"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            {users.length === 0
              ? 'No support team members yet. Click Add support user to get started.'
              : 'No support users match your search.'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Phone</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{u.fullName}</td>
                    <td className="px-3 py-2 font-mono">{u.phone}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {u.email ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {u.isActive ? (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700 bg-emerald-500/10">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-muted-foreground/30">
                          Inactive
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setModal({ kind: 'edit', user: u })}
                        className="h-8"
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setModal({ kind: 'reset', user: u })}
                        className="h-8"
                      >
                        Reset PW
                      </Button>
                      {u.isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setModal({ kind: 'deactivate', user: u })}
                          className="h-8 text-destructive"
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setModal({ kind: 'activate', user: u })}
                          className="h-8 text-emerald-700"
                        >
                          Activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {modal.kind === 'add' && (
        <AddOrEditDialog
          mode="add"
          onClose={() => setModal({ kind: 'closed' })}
          onTempPassword={(fullName, tempPassword) =>
            setModal({ kind: 'tempPassword', fullName, tempPassword })
          }
          onSuccess={() => router.refresh()}
        />
      )}
      {modal.kind === 'edit' && (
        <AddOrEditDialog
          mode="edit"
          existing={modal.user}
          onClose={() => setModal({ kind: 'closed' })}
          onSuccess={() => router.refresh()}
        />
      )}
      {modal.kind === 'deactivate' && (
        <ConfirmDialog
          title="Deactivate support user?"
          description={`${modal.user.fullName} won't be able to sign in. All their sessions are revoked. You can reactivate later.`}
          confirmLabel="Deactivate"
          destructive
          endpoint={`/api/admin/support/${modal.user.id}/deactivate`}
          onClose={() => setModal({ kind: 'closed' })}
          onSuccess={() => router.refresh()}
        />
      )}
      {modal.kind === 'activate' && (
        <ConfirmDialog
          title="Reactivate support user?"
          description={`${modal.user.fullName} will be able to sign in again with their existing password.`}
          confirmLabel="Activate"
          endpoint={`/api/admin/support/${modal.user.id}/activate`}
          onClose={() => setModal({ kind: 'closed' })}
          onSuccess={() => router.refresh()}
        />
      )}
      {modal.kind === 'reset' && (
        <ResetPasswordDialog
          user={modal.user}
          onClose={() => setModal({ kind: 'closed' })}
          onTempPassword={(fullName, tempPassword) =>
            setModal({ kind: 'tempPassword', fullName, tempPassword })
          }
          onSuccess={() => router.refresh()}
        />
      )}
      {modal.kind === 'tempPassword' && (
        <TempPasswordDialog
          fullName={modal.fullName}
          tempPassword={modal.tempPassword}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </div>
  );
}

// =============================================================================
// AddOrEditDialog
// =============================================================================

interface AddOrEditProps {
  mode: 'add' | 'edit';
  existing?: SupportUserRow;
  onClose: () => void;
  onTempPassword?: (fullName: string, tempPassword: string) => void;
  onSuccess: () => void;
}

function AddOrEditDialog({
  mode,
  existing,
  onClose,
  onTempPassword,
  onSuccess,
}: AddOrEditProps) {
  const [fullName, setFullName] = useState(existing?.fullName ?? '');
  const [phone, setPhone] = useState(
    existing?.phone ? existing.phone.replace('+91', '') : '',
  );
  const [email, setEmail] = useState(existing?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit() {
    if (busy) return;
    setGeneralError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const url =
        mode === 'add'
          ? '/api/admin/support'
          : `/api/admin/support/${existing!.id}`;
      const res = await fetch(url, {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        tempPassword?: string;
        user?: { fullName?: string };
      };
      if (!res.ok || !j.ok) {
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        setFieldErrors(j.fieldErrors ?? {});
        return;
      }
      onSuccess();
      onClose();
      if (mode === 'add' && j.tempPassword && onTempPassword) {
        onTempPassword(j.user?.fullName ?? fullName.trim(), j.tempPassword);
      } else {
        toast.success(mode === 'add' ? 'Support user created' : 'Updated');
      }
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? 'Add support user' : 'Edit support user'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? 'A temporary password is generated and shown once. The user must change it on first login.'
              : 'Update name, phone, or email. Role stays support.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="su-name">
              Full name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="su-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value.slice(0, 100))}
              disabled={busy}
              maxLength={100}
              className="h-11"
            />
            {fieldErrors.fullName && (
              <p className="text-xs text-destructive">{fieldErrors.fullName}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="su-phone">
              Phone (10 digits, +91 added automatically){' '}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="su-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
              }
              disabled={busy}
              className="h-11 font-mono"
              placeholder="98765 43210"
            />
            {fieldErrors.phone && (
              <p className="text-xs text-destructive">{fieldErrors.phone}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="su-email">
              Email <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="su-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.slice(0, 255))}
              disabled={busy}
              maxLength={255}
              className="h-11"
            />
            {fieldErrors.email && (
              <p className="text-xs text-destructive">{fieldErrors.email}</p>
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={busy}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : mode === 'add' ? (
              'Create'
            ) : (
              'Save changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// ConfirmDialog (deactivate / activate)
// =============================================================================

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  endpoint: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive,
  endpoint,
  onClose,
  onSuccess,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  async function onConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? `Request failed (${res.status})`);
        return;
      }
      toast.success('Done');
      onSuccess();
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// ResetPasswordDialog
// =============================================================================

interface ResetPasswordDialogProps {
  user: SupportUserRow;
  onClose: () => void;
  onTempPassword: (fullName: string, tempPassword: string) => void;
  onSuccess: () => void;
}

function ResetPasswordDialog({
  user,
  onClose,
  onTempPassword,
  onSuccess,
}: ResetPasswordDialogProps) {
  const [busy, setBusy] = useState(false);
  async function onConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${user.id}/reset-password`, {
        method: 'POST',
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        tempPassword?: string;
      };
      if (!res.ok || !j.ok || !j.tempPassword) {
        toast.error(j.error ?? `Request failed (${res.status})`);
        return;
      }
      onSuccess();
      onClose();
      onTempPassword(user.fullName, j.tempPassword);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Reset password?</DialogTitle>
          <DialogDescription>
            A new temporary password will be generated for {user.fullName}. All
            their sessions will be revoked. They must change the password on
            next sign-in.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : 'Reset password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// TempPasswordDialog — shown after create or reset
// =============================================================================

interface TempPasswordDialogProps {
  fullName: string;
  tempPassword: string;
  onClose: () => void;
}

function TempPasswordDialog({
  fullName,
  tempPassword,
  onClose,
}: TempPasswordDialogProps) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      toast.success('Password copied');
    } catch {
      toast.error('Copy failed — long-press to select instead');
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Temporary password for {fullName}</DialogTitle>
          <DialogDescription>
            Share this with the user out of band (WhatsApp / call). They must
            change it on first sign-in. This password is shown ONCE — once you
            close this dialog you can&apos;t retrieve it (you&apos;d have to
            reset).
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-4 font-mono text-lg text-center select-all">
          {tempPassword}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            <Icon name="content_copy" size="sm" />
            <span>Copy</span>
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
