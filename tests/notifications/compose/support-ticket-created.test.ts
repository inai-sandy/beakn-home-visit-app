import { describe, expect, it } from 'vitest';

import {
  composeSupportTicketCreatedInApp,
  type SupportTicketCreatedContext,
} from '@/lib/notifications/compose/support-ticket-events';

// =============================================================================
// customer.support_ticket_created composer — new vs reopened copy
// =============================================================================
//
// The reopen route (app/api/customer/support-tickets/[id]/reopen/route.ts)
// re-fires this SAME event with reopened:true. The composer must prefix the
// title so an exec/captain can tell a reopen apart from a brand-new ticket.

function baseCtx(): SupportTicketCreatedContext {
  return {
    ticketId: '019e34b6-990e-7721-af09-28647753bb14',
    requestId: '019e34b6-1111-7721-af09-28647753bb14',
    customerName: 'Sandeep',
    category: 'complaint',
    subject: 'The mount is loose after installation.',
  };
}

describe('composeSupportTicketCreatedInApp', () => {
  it('new ticket: title is prefixed "New …"', () => {
    const b = composeSupportTicketCreatedInApp(baseCtx());
    expect(b.title).toBe('New complaint from Sandeep');
  });

  it('reopened ticket: title is prefixed "Reopened …"', () => {
    const b = composeSupportTicketCreatedInApp({ ...baseCtx(), reopened: true });
    expect(b.title).toBe('Reopened complaint from Sandeep');
  });

  it('reopened:false behaves like a new ticket', () => {
    const b = composeSupportTicketCreatedInApp({ ...baseCtx(), reopened: false });
    expect(b.title).toBe('New complaint from Sandeep');
  });

  it('reopen flag does not change body or linkUrl', () => {
    const neu = composeSupportTicketCreatedInApp(baseCtx());
    const reopened = composeSupportTicketCreatedInApp({
      ...baseCtx(),
      reopened: true,
    });
    expect(reopened.body).toBe(neu.body);
    expect(reopened.linkUrl).toBe(neu.linkUrl);
    expect(reopened.linkUrl).toBe(
      '/requests/019e34b6-1111-7721-af09-28647753bb14',
    );
  });
});
