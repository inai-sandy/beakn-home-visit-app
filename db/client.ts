import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// postgres-js has built-in pooling. Reuse the client across Next.js hot reloads
// in dev so we don't exhaust connections on every file change.
declare global {
  // eslint-disable-next-line no-var
  var __beakn_pg__: ReturnType<typeof postgres> | undefined;
}

const client =
  globalThis.__beakn_pg__ ??
  postgres(process.env.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__beakn_pg__ = client;
}

export const db = drizzle(client, { schema, casing: 'snake_case' });
export { schema };
