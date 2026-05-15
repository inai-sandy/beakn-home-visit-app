export const dynamic = "force-dynamic";

// =============================================================================
// HVA-78: Captain Dashboard landing — shell-only placeholder
// =============================================================================
//
// Full two-column dashboard with team-aggregate + today's-work columns lands
// in HVA-80. This page exists so the post-login redirect for captains
// (ROLE_HOME.captain → '/captain/dashboard') has a destination wrapped by
// the (captain) shell.
//
// (Replaces app/captain/dashboard/page.tsx — which lived outside the route
// group and rendered a flat JSON dump. The shell now provides the sidebar
// + topbar; this page only renders the in-content area.)
// =============================================================================

export default function CaptainDashboardPage() {
  return (
    <div className="p-8 space-y-3 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Captain Dashboard
      </h1>
      <p className="text-sm text-muted-foreground">
        Full UI coming in HVA-80. You&apos;re seeing this placeholder because
        login routed you here.
      </p>
    </div>
  );
}
