import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

type PingRow = { ok: number; database: string; now: string };
type CountRow = { n: number };
type UuidRow = { v7: string };

export default async function DbHealthPage() {
  const ping = await db.execute<PingRow>(
    sql`SELECT 1 AS ok, current_database() AS database, now()::text AS now`,
  );
  const tableCount = await db.execute<CountRow>(
    sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'`,
  );
  const v7 = await db.execute<UuidRow>(sql`SELECT uuid_generate_v7()::text AS v7`);

  const payload = {
    ping: ping[0],
    publicTableCount: tableCount[0]?.n,
    sampleUuidV7: v7[0]?.v7,
  };

  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="text-lg font-semibold mb-4">DB Health</h1>
      <pre className="bg-muted p-4 rounded-md">{JSON.stringify(payload, null, 2)}</pre>
    </main>
  );
}
