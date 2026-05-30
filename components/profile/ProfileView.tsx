import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { ProfileData } from '@/lib/profile/queries';

import { LogoutCard } from './LogoutCard';
import { ThemeChips } from './ThemeChips';

// HVA-76: shared profile shell used by exec, captain (and later admin).
// Six sections per UI/UX §18; sub-flows that already shipped link out
// (notification settings, change password) instead of re-implementing.

const ROLE_LABELS: Record<string, string> = {
  sales_executive: 'Sales executive',
  captain: 'Captain',
  super_admin: 'Super admin',
};

interface Props {
  profile: ProfileData;
  /** Build-time commit SHA + ISO date baked by scripts/deploy.sh. Passed
   *  in by the consumer page so the server component remains pure. */
  appVersion: { commitSha: string; buildDate: string };
}

export function ProfileView({ profile, appVersion }: Props) {
  const roleLabel = ROLE_LABELS[profile.role] ?? profile.role;

  return (
    <div className="space-y-4">
      {/* 1. Account Info */}
      <section className="rounded-2xl border bg-card p-5 space-y-4">
        <header className="flex items-center gap-2">
          <Icon name="person" size="sm" className="text-primary" />
          <h2 className="text-base font-semibold tracking-tight">Account</h2>
        </header>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Name
            </dt>
            <dd className="font-medium">{profile.fullName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Role
            </dt>
            <dd>
              <Badge variant="secondary" className="font-medium">
                {roleLabel}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Phone (login)
            </dt>
            <dd className="font-medium tabular-nums">{profile.phone}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Email
            </dt>
            <dd className="font-medium truncate">
              {profile.email ?? (
                <span className="text-muted-foreground italic">Not set</span>
              )}
            </dd>
          </div>
        </dl>
        <ScopeFooter scope={profile.scope} />
      </section>

      {/* 2. Theme */}
      <section className="rounded-2xl border bg-card p-5 space-y-3">
        <header className="flex items-center gap-2">
          <Icon name="palette" size="sm" className="text-primary" />
          <h2 className="text-base font-semibold tracking-tight">Theme</h2>
        </header>
        <p className="text-sm text-muted-foreground">
          Choose how Beakn looks on this device.
        </p>
        <ThemeChips />
      </section>

      {/* 3. Notifications → /profile/notifications */}
      <Link
        href="/profile/notifications"
        className="block rounded-2xl border bg-card p-5 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Icon name="notifications" size="sm" className="text-primary" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                Notification settings
              </h2>
              <p className="text-xs text-muted-foreground">
                Choose which alerts reach you, by channel.
              </p>
            </div>
          </div>
          <Icon name="chevron_right" size="sm" className="text-muted-foreground" />
        </div>
      </Link>

      {/* 4. Change password → /profile/change-password */}
      <Link
        href="/profile/change-password"
        className="block rounded-2xl border bg-card p-5 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Icon name="lock" size="sm" className="text-primary" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                Change password
              </h2>
              <p className="text-xs text-muted-foreground">
                Update the password you use to sign in.
              </p>
            </div>
          </div>
          <Icon name="chevron_right" size="sm" className="text-muted-foreground" />
        </div>
      </Link>

      {/* 5. App version */}
      <section className="rounded-2xl border bg-card p-5 space-y-1">
        <header className="flex items-center gap-2">
          <Icon name="info" size="sm" className="text-muted-foreground" />
          <h2 className="text-sm font-medium text-muted-foreground">
            App version
          </h2>
        </header>
        <p className="text-sm tabular-nums">
          <span className="font-medium">{appVersion.commitSha}</span>
          {' · '}
          <span className="text-muted-foreground">
            {formatBuildDate(appVersion.buildDate)}
          </span>
        </p>
      </section>

      {/* 6. Logout */}
      <LogoutCard />
    </div>
  );
}

function ScopeFooter({ scope }: { scope: ProfileData['scope'] }) {
  if (scope.type === 'super_admin') {
    return (
      <div className="pt-3 border-t text-xs text-muted-foreground">
        Scope: <span className="font-medium text-foreground">Global</span>
      </div>
    );
  }
  if (scope.type === 'captain') {
    return (
      <div className="pt-3 border-t space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Manages cities
        </p>
        {scope.cities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {scope.cities.map((c) => (
              <Badge key={c.id} variant="secondary" className="font-medium">
                {c.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No cities assigned yet
          </p>
        )}
      </div>
    );
  }
  // exec
  return (
    <div className="pt-3 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Captain
        </p>
        <p className="font-medium">
          {scope.captainName ?? (
            <span className="text-muted-foreground italic">Unassigned</span>
          )}
        </p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Cities
        </p>
        {scope.cities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {scope.cities.map((c) => (
              <Badge key={c.id} variant="secondary" className="font-medium">
                {c.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground italic">No cities yet</p>
        )}
      </div>
    </div>
  );
}

function formatBuildDate(iso: string): string {
  // Best-effort. Anything we can't parse falls back to the raw string so
  // dev builds (`NEXT_PUBLIC_BUILD_DATE=dev`) still render cleanly.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
