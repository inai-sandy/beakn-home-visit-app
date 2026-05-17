import { redirect } from 'next/navigation';

// =============================================================================
// HVA-123: redirect / → /request
// =============================================================================
//
// `/` was the unmodified create-next-app scaffold (Next.js logo, "To get
// started edit page.tsx", Deploy Now / Documentation buttons) from the
// initial repo commit. Customers reach /request directly via QR codes /
// WhatsApp links; staff reach /login then bounce to a role home. No
// production flow lands on /, but anyone typing the bare domain would
// see the scaffold.
//
// HVA-30 was supposed to alias the customer form at /, but only /request
// was actually built. Rather than dual-maintain two routes for the same
// form, redirect / → /request. `redirect()` from next/navigation throws
// a NEXT_REDIRECT that Next.js intercepts and emits as a 307 response.
// =============================================================================

export default function HomePage(): never {
  redirect('/request');
}
