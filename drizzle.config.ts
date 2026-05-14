import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set (expected in .env.local)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
