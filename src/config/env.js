/*
 * Runtime configuration is validated in one place so modules consume typed,
 * safe values instead of reading process.env directly.
 */
import dotenv from 'dotenv';

/*
 * Production deploys need a distinct env file without changing application
 * code or PM2 commands, so config loading now prefers an explicit override and
 * otherwise switches between .env.production and .env by NODE_ENV.
 */
const dotenvPath =
  process.env.DOTENV_CONFIG_PATH ||
  ((process.env.NODE_ENV || 'development') === 'production' ? '.env.production' : '.env');

dotenv.config({ path: dotenvPath });

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

const asList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const port = asInt(process.env.PORT, 3000);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  /*
   * Binding host is explicit so LAN exposure can be enabled intentionally
   * through runtime config and kept consistent across start commands.
   */
  host: process.env.HOST || '0.0.0.0',
  port,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  corsOrigins: asList(process.env.CORS_ORIGIN),
  maxUploadFiles: asInt(process.env.MAX_UPLOAD_FILES, 20),
  maxFileSizeBytes: asInt(process.env.MAX_FILE_SIZE_MB, 25) * 1024 * 1024,
  maxTotalUploadBytes: asInt(process.env.MAX_TOTAL_UPLOAD_MB, 120) * 1024 * 1024,
  pdfExtractToDocxEnabled: asBool(process.env.PDF_EXTRACT_TO_DOCX_ENABLED, true),
  booksGreekEditorEnabled: asBool(process.env.BOOKS_GREEK_EDITOR_ENABLED, true),
  booksEditorTokenAuthEnabled:
    (process.env.NODE_ENV || 'development') === 'production'
      ? true
      : asBool(process.env.BOOKS_EDITOR_TOKEN_AUTH_ENABLED, true),
  /*
   * Runtime knobs below keep defensive middleware and admin token checks
   * configurable per deployment while remaining safe by default.
   */
  mutatingRateLimitEnabled: asBool(process.env.MUTATING_RATE_LIMIT_ENABLED, true),
  mutatingRateLimitPerMinute: asInt(process.env.MUTATING_RATE_LIMIT_PER_MINUTE, 5),
  adminTokenStoreFile: process.env.ADMIN_TOKEN_STORE_FILE || 'data/admin-tokens.json',
  adminTokenPepper: process.env.ADMIN_TOKEN_PEPPER || 'local-dev-admin-token-pepper',
  tokenRequestStoreFile: process.env.TOKEN_REQUEST_STORE_FILE || 'data/token-requests.json',
  tokenRequestDefaultTtl: process.env.TOKEN_REQUEST_DEFAULT_TTL || '30d',
  accessUsageStoreFile: process.env.ACCESS_USAGE_STORE_FILE || 'data/access-usage.sqlite',
  accessUsageHashSalt: process.env.ACCESS_USAGE_HASH_SALT || 'local-dev-access-usage-hash-salt',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: asInt(process.env.SMTP_PORT, 587),
  smtpSecure: asBool(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailProvider: process.env.EMAIL_PROVIDER || 'smtp',
  gmailUser: process.env.GMAIL_USER || '',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',
  gmailClientId: process.env.GMAIL_CLIENT_ID || '',
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || '',
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
  gmailAccessToken: process.env.GMAIL_ACCESS_TOKEN || '',
  emailFrom: process.env.EMAIL_FROM || '',
  emailReplyTo: process.env.EMAIL_REPLY_TO || '',
  trustedClientOrigins: asList(process.env.TRUSTED_CLIENT_ORIGINS),
  failureReportHashSalt: process.env.FAILURE_REPORT_HASH_SALT || 'local-dev-report-hash-salt',
  webhookBinTtlSeconds: asInt(process.env.WEBHOOK_BIN_TTL_SECONDS, 24 * 60 * 60),
  webhookBinMaxBins: asInt(process.env.WEBHOOK_BIN_MAX_BINS, 300),
  webhookBinMaxEntriesPerBin: asInt(process.env.WEBHOOK_BIN_MAX_ENTRIES_PER_BIN, 120),
  webhookBinMaxPayloadBytes: asInt(process.env.WEBHOOK_BIN_MAX_PAYLOAD_BYTES, 256 * 1024),
};
