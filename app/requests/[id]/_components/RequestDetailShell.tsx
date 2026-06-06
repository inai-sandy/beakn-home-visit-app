'use client';

import { useState, type ReactNode } from 'react';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

// =============================================================================
// HVA-243: tabs-based shell for /requests/[id]
// =============================================================================
//
// 4 tabs (Overview / Order / Activity / Admin), each rendered with server
// content passed in as a ReactNode child. The shell is a client component
// only because Radix Tabs needs interaction state — its children stay
// server-rendered.
//
// The "Order" tab is conditional: omitted for SUBMITTED / very-early
// stages where there's no quotation to talk about. The page decides
// whether to pass `order` content; if not, the tab is hidden.
//
// Decisions locked 2026-06-06 with Sandeep:
//   - Tab labels: Overview / Order / Activity / Admin
//   - Order tab shows read-only dispatch state for exec/captain too
//   - Primary next-action stays in a sticky header above the tabs
//     (rendered by the parent page, not by this shell)
// =============================================================================

export interface RequestDetailShellProps {
  /** Initial tab the user lands on. Server decides based on stage. */
  initialTab?: 'overview' | 'order' | 'activity' | 'admin';
  /** Banner content above tabs (terminal-state summary, waiting-for-approval). */
  banner?: ReactNode;
  overview: ReactNode;
  order?: ReactNode;
  activity: ReactNode;
  admin: ReactNode;
}

export function RequestDetailShell({
  initialTab = 'overview',
  banner,
  overview,
  order,
  activity,
  admin,
}: RequestDetailShellProps) {
  const [tab, setTab] = useState<string>(initialTab);

  return (
    <div className="space-y-4">
      {banner}
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="w-full grid grid-cols-4 h-10">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="order" disabled={!order}>
            Order
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="admin">Admin</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          {overview}
        </TabsContent>
        {order && (
          <TabsContent value="order" className="space-y-4">
            {order}
          </TabsContent>
        )}
        <TabsContent value="activity" className="space-y-4">
          {activity}
        </TabsContent>
        <TabsContent value="admin" className="space-y-4">
          {admin}
        </TabsContent>
      </Tabs>
    </div>
  );
}
