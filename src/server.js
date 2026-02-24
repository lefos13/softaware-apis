/**
 * Why this exists: dedicated startup/shutdown flow supports graceful process
 * termination and cleanly separates runtime concerns from app composition.
 */
import { app } from './app.js';
import { env } from './config/env.js';
import { inspectPdfExtractRuntimeDependencies } from './modules/pdf/pdf-extract.runtime.js';

const server = app.listen(env.port, () => {
  console.log(`[softaware-apis] listening on port ${env.port}`);

  if (env.pdfExtractToDocxEnabled) {
    const runtime = inspectPdfExtractRuntimeDependencies();

    if (!runtime.available) {
      const missing = runtime.missing.map((dependency) => dependency.command).join(', ');
      console.warn(
        `[softaware-apis] warning: PDF extract to DOCX is enabled but OCR dependencies are missing: ${missing}`,
      );
    }
  }
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
