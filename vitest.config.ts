import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile('.env');
} catch {
  // CI passes TEST_DATABASE_URL directly.
}

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    env: {
      ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    },
    // Integration tests share one database.
    fileParallelism: false,
  },
});
