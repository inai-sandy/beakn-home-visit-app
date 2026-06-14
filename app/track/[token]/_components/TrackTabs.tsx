'use client';

import { useState, type ReactNode } from 'react';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

// =============================================================================
// HVA-286: customer-facing tabs for /track
// =============================================================================
//
// Sandeep 2026-06-14: the public tracking link should show Status, Order
// details, and Payment details + history (with room for a future Razorpay
// "Pay online" button) — organised as tabs so it's easy to scan.
//
// Client component only because Radix Tabs needs interaction state; the
// three tab contents stay server-rendered and are passed in as children.
// Lands on Status (what customers check most); support tickets live inside
// the Status content.
// =============================================================================

export interface TrackTabsProps {
  status: ReactNode;
  order: ReactNode;
  payments: ReactNode;
}

export function TrackTabs({ status, order, payments }: TrackTabsProps) {
  const [tab, setTab] = useState<string>('status');

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <TabsList className="w-full grid grid-cols-3 h-11">
        <TabsTrigger value="status">Status</TabsTrigger>
        <TabsTrigger value="order">Order</TabsTrigger>
        <TabsTrigger value="payments">Payments</TabsTrigger>
      </TabsList>
      <TabsContent value="status" className="space-y-8">
        {status}
      </TabsContent>
      <TabsContent value="order" className="space-y-6">
        {order}
      </TabsContent>
      <TabsContent value="payments" className="space-y-6">
        {payments}
      </TabsContent>
    </Tabs>
  );
}
