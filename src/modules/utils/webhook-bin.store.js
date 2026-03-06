/*
 * Webhook bins stay in memory with TTL and bounded buffers so the feature
 * remains lightweight while still useful for short-lived request inspection.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from '../../common/utils/api-error.js';
import { env } from '../../config/env.js';

const bins = new Map();

const hashSecret = (secret) => {
  return createHash('sha256').update(`bin:${secret}`).digest('hex');
};

const sanitizeTtlSeconds = (value) => {
  const ttl = Number.parseInt(value, 10);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 7 * 24 * 60 * 60) {
    return env.webhookBinTtlSeconds;
  }

  return ttl;
};

const cleanupExpiredBins = () => {
  const now = Date.now();

  for (const [id, bin] of bins.entries()) {
    if (Date.parse(bin.expiresAt) <= now) {
      bins.delete(id);
    }
  }
};

const cleanupTimer = setInterval(cleanupExpiredBins, 60 * 1000);
cleanupTimer.unref();

const resolveBin = (id) => {
  const bin = bins.get(id);
  if (!bin) {
    throw new ApiError(404, 'WEBHOOK_BIN_NOT_FOUND', 'Webhook bin was not found', {
      details: [{ field: 'id', issue: 'Create a bin first' }],
    });
  }

  if (Date.parse(bin.expiresAt) <= Date.now()) {
    bins.delete(id);
    throw new ApiError(410, 'WEBHOOK_BIN_EXPIRED', 'Webhook bin has expired', {
      details: [{ field: 'id', issue: 'Create a new bin' }],
    });
  }

  return bin;
};

export const createWebhookBin = ({ ttlSeconds }) => {
  cleanupExpiredBins();

  if (bins.size >= env.webhookBinMaxBins) {
    throw new ApiError(429, 'WEBHOOK_BIN_CAPACITY_REACHED', 'Webhook bin capacity reached', {
      details: [
        {
          field: 'maxBins',
          issue: `Maximum active bins is ${env.webhookBinMaxBins}`,
        },
      ],
    });
  }

  const id = randomBytes(12).toString('hex');
  const secret = randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();
  const safeTtlSeconds = sanitizeTtlSeconds(ttlSeconds);
  const expiresAt = new Date(Date.now() + safeTtlSeconds * 1000).toISOString();

  bins.set(id, {
    id,
    secretHash: hashSecret(secret),
    createdAt,
    expiresAt,
    requests: [],
  });

  return {
    id,
    secret,
    createdAt,
    expiresAt,
    ttlSeconds: safeTtlSeconds,
  };
};

export const assertWebhookBinSecret = ({ id, secret }) => {
  const bin = resolveBin(id);
  const candidate = hashSecret(String(secret || ''));

  if (!secret || candidate !== bin.secretHash) {
    throw new ApiError(403, 'WEBHOOK_BIN_SECRET_INVALID', 'Webhook bin secret is invalid', {
      details: [{ field: 'x-bin-secret', issue: 'Provide the secret returned at bin creation' }],
    });
  }

  return bin;
};

export const appendWebhookBinRequest = ({ id, secret, entry }) => {
  const bin = assertWebhookBinSecret({ id, secret });

  bin.requests.push(entry);
  if (bin.requests.length > env.webhookBinMaxEntriesPerBin) {
    bin.requests.splice(0, bin.requests.length - env.webhookBinMaxEntriesPerBin);
  }

  return {
    storedEntries: bin.requests.length,
    expiresAt: bin.expiresAt,
  };
};

export const getWebhookBinRequests = ({ id, secret, limit }) => {
  const bin = assertWebhookBinSecret({ id, secret });
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, env.webhookBinMaxEntriesPerBin)
      : env.webhookBinMaxEntriesPerBin;

  const requests = bin.requests.slice(-safeLimit).reverse();
  return {
    id: bin.id,
    createdAt: bin.createdAt,
    expiresAt: bin.expiresAt,
    count: requests.length,
    requests,
  };
};
