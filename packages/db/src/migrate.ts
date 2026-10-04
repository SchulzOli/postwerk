import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(url?: string, folder = migrationsFolder): Promise<void> {
  const db = createDb(url);
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runMigrations();
  console.log('Migrations applied.');
}
