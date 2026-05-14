import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

// postgres-js has built-in pooling. Reuse the client across Next.js hot reloads
// in dev (and across page-data-collection passes in `next build`) so we don't
// exhaust connections.
declare global {
  // eslint-disable-next-line no-var
  var __beakn_pg__: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __beakn_db__: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function initDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (globalThis.__beakn_db__) return globalThis.__beakn_db__;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  const client =
    globalThis.__beakn_pg__ ??
    postgres(process.env.DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  globalThis.__beakn_pg__ = client;
  const instance = drizzle(client, { schema, casing: 'snake_case' });
  globalThis.__beakn_db__ = instance;
  return instance;
}

// Lazy proxy: db.<method>(...) initialises the real Drizzle instance on first
// access. Importing this module is a no-op so `next build`'s page-data
// collection pass works without DATABASE_URL set.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(initDb() as object, prop, receiver);
  },
});

export { schema };
