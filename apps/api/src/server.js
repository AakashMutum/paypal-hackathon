import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './database/health.js';

const server = createApp().listen(env.port, env.host, () => {
    console.info(`Checkout Guardian API listening on ${env.host}:${env.port}`);
});

async function shutdown(signal) {
    console.info(`Received ${signal}; shutting down`);
    server.close(async () => {
        await closeDatabase();
        process.exit(0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
