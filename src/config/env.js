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

const port = asInt(process.env.PORT, 3000);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  maxUploadFiles: asInt(process.env.MAX_UPLOAD_FILES, 20),
  maxFileSizeBytes: asInt(process.env.MAX_FILE_SIZE_MB, 25) * 1024 * 1024,
  maxTotalUploadBytes: asInt(process.env.MAX_TOTAL_UPLOAD_MB, 120) * 1024 * 1024,
};
