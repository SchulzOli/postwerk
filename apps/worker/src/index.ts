import { runPublishCycle } from '@postwerk/core';
import { getDb } from '@postwerk/db';

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 10_000);
const db = getDb();
let stopping = false;
let wake: (() => void) | undefined;

async function loop() {
  console.log(`postwerk worker started (polling every ${intervalMs / 1000}s)`);
  while (!stopping) {
    try {
      const processed = await runPublishCycle(db);
      if (processed > 0) console.log(`published ${processed} target(s)`);
    } catch (error) {
      console.error('publish cycle failed', error);
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, intervalMs);
    });
  }
  await db.close();
  console.log('postwerk worker stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

await loop();
