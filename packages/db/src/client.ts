import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;
/** The handle inside `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { close: () => client.end() });
}

const globalForDb = globalThis as unknown as { postwerkDb?: Database };

/** Process-wide connection pool (survives Next.js dev hot reloads). */
export function getDb(): Database {
  globalForDb.postwerkDb ??= createDb();
  return globalForDb.postwerkDb;
}
