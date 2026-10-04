import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

// Local development shares one .env at the repository root.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env file: rely on the real environment (Docker, CI, hosting).
}

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  transpilePackages: ['@postwerk/core', '@postwerk/db', '@postwerk/providers'],
  poweredByHeader: false,
};

export default config;
