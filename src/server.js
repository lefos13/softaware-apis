/**
 * Why this exists: dedicated startup/shutdown flow supports graceful process
 * termination and cleanly separates runtime concerns from app composition.
 */
import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, () => {
  console.log(`[softaware-apis] listening on port ${env.port}`);
});

function shutdown(signal) {
  console.log(`[softaware-apis] received ${signal}, shutting down`);
  server.close((error) => {
    if (error) {
      console.error('[softaware-apis] graceful shutdown failed', error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
