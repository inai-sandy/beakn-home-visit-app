import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';

// Run on the Node runtime so postgres-js works; Edge can't open TCP sockets.
export const runtime = 'nodejs';
// Always execute at request time — no caching of health state.
export const dynamic = 'force-dynamic';

export async function GET() {
  const timestamp = new Date().toISOString();
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json(
      { status: 'ok', db: 'connected', timestamp },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { status: 'degraded', db: 'unreachable', error: message, timestamp },
      { status: 503 },
    );
  }
}
