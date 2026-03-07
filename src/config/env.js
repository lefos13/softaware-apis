/**
 * Why this exists: all runtime configuration is validated in one place so
 * modules consume typed, safe values instead of reading process.env directly.
 */
import dotenv from 'dotenv';

dotenv.config();

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const asBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const port = asInt(process.env.PORT, 3000);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  maxUploadFiles: asInt(process.env.MAX_UPLOAD_FILES, 20),
  maxFileSizeBytes: asInt(process.env.MAX_FILE_SIZE_MB, 25) * 1024 * 1024,
  maxTotalUploadBytes: asInt(process.env.MAX_TOTAL_UPLOAD_MB, 120) * 1024 * 1024,
  pdfExtractToDocxEnabled: asBool(process.env.PDF_EXTRACT_TO_DOCX_ENABLED, true),
  booksGreekEditorEnabled: asBool(process.env.BOOKS_GREEK_EDITOR_ENABLED, true),
  /*
   * Runtime knobs below keep defensive middleware and admin token checks
   * configurable per deployment while remaining safe by default.
   */
  mutatingRateLimitEnabled: asBool(process.env.MUTATING_RATE_LIMIT_ENABLED, true),
  mutatingRateLimitPerMinute: asInt(process.env.MUTATING_RATE_LIMIT_PER_MINUTE, 5),
  adminTokenStoreFile: process.env.ADMIN_TOKEN_STORE_FILE || 'data/admin-tokens.json',
  adminTokenPepper: process.env.ADMIN_TOKEN_PEPPER || 'local-dev-admin-token-pepper',
  failureReportHashSalt: process.env.FAILURE_REPORT_HASH_SALT || 'local-dev-report-hash-salt',
  webhookBinTtlSeconds: asInt(process.env.WEBHOOK_BIN_TTL_SECONDS, 24 * 60 * 60),
  webhookBinMaxBins: asInt(process.env.WEBHOOK_BIN_MAX_BINS, 300),
  webhookBinMaxEntriesPerBin: asInt(process.env.WEBHOOK_BIN_MAX_ENTRIES_PER_BIN, 120),
  webhookBinMaxPayloadBytes: asInt(process.env.WEBHOOK_BIN_MAX_PAYLOAD_BYTES, 256 * 1024),
};
