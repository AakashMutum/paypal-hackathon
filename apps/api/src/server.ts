import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './database/health.js';
import { warmUp, warmUpEnabled } from './services/warmup.service.js';
import { seedDemoMerchants } from './services/registry/registry.service.js';

const app = createApp();
const server: Server = app.listen(env.port, env.host, () => {
  console.info(`Checkout Guardian API listening on ${env.host}:${env.port}`);
  if (env.databaseUrl) {
    // DEMO_SEED=true fills an empty merchant_records table with the invented demo merchants.
    seedDemoMerchants()
      .then((result) => {
        if (result.reason === 'seeded') console.info(`Demo seed: inserted ${result.seeded} merchants`);
      })
      .catch((error: unknown) => {
        console.warn(`Demo seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
  }
  if (warmUpEnabled()) {
    // Not awaited: the server already accepts requests while this runs.
    void warmUp().then((report) => {
      const failed = report.steps.filter((step) => !step.ok).map((step) => step.name);
      console.info(`Warm-up finished in ${report.ms} ms${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`);
    });
  }
});

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}; shutting down`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { server };
