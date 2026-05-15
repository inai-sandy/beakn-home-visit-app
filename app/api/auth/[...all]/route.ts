import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

// Better-Auth's catch-all route handler. Every /api/auth/* request lands
// here and the BA SDK demultiplexes by path:
//   POST /api/auth/sign-in/phone-number  ← HVA-23 login form posts here
//   POST /api/auth/sign-out
//   GET  /api/auth/get-session
//   ...and the rest of the BA + phone-number-plugin surface.
export const { GET, POST } = toNextJsHandler(auth.handler);
