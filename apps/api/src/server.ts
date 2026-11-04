import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './database/health.js';
import { warmUp, warmUpEnabled } from './services/warmup.service.js';

const app = createApp();
const server: Server = app.listen(env.port, env.host, () => {
  console.info(`Checkout Guardian API listening on ${env.host}:${env.port}`);
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
