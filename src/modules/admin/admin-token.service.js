/*
 * Token persistence is file-backed with hashed values so admin access can
 * survive restarts while keeping plaintext tokens out of stored state.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApiError } from '../../common/utils/api-error.js';
import { env } from '../../config/env.js';

const ALLOWED_ROLES = new Set(['admin', 'superadmin']);

const parseDurationToSeconds = (rawValue) => {
  const value = String(rawValue || '')
    .trim()
    .toLowerCase();
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isInteger(amount) || amount < 1) {
    return null;
  }

  const unit = match[2];
  if (unit === 's') {
    return amount;
  }
  if (unit === 'm') {
    return amount * 60;
  }
  if (unit === 'h') {
    return amount * 60 * 60;
  }

  return amount * 24 * 60 * 60;
};

const resolveStorePath = () => resolve(process.cwd(), env.adminTokenStoreFile);

const safeReadJson = (filePath) => {
  if (!existsSync(filePath)) {
    return { version: 1, tokens: [] };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const tokens = Array.isArray(parsed?.tokens) ? parsed.tokens : [];
    return {
      version: 1,
      tokens,
    };
  } catch {
    return { version: 1, tokens: [] };
  }
};

/*
 * Plaintext bootstrap entries are converted into the stored hash format so
 * manually seeded local tokens keep working without leaving secrets on disk.
 */
const normalizeStoreTokens = (store) => {
  let changed = false;

  const tokens = Array.isArray(store?.tokens) ? store.tokens : [];
  const normalizedTokens = tokens.map((record) => {
    const plainToken = String(record?.token || record?.plainToken || '').trim();
    if (!plainToken || String(record?.tokenHash || '').trim()) {
      return record;
    }

    changed = true;
    // eslint-disable-next-line no-unused-vars
    const { token, plainToken: legacyPlainToken, ...rest } = record;

    return {
      ...rest,
      tokenHash: hashToken(plainToken),
    };
  });

  return {
    changed,
    store: {
      version: 1,
      tokens: normalizedTokens,
    },
  };
};

const readStore = () => {
  const normalized = normalizeStoreTokens(safeReadJson(resolveStorePath()));
  if (normalized.changed) {
    saveStore(normalized.store);
  }

  return normalized.store;
};

const saveStore = (store) => {
  const filePath = resolveStorePath();
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
};

const hashToken = (token) => {
  return createHash('sha256').update(`${env.adminTokenPepper}:${token}`).digest('hex');
};

const normalizeOwnerId = (ownerId) => {
  const normalized = String(ownerId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'public';
};

const isExpired = (record) => {
  const expiresAtMs = Date.parse(record?.expiresAt || '');
  return Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : true;
};

const validateRole = (role) => {
  const normalizedRole = String(role || '')
    .trim()
    .toLowerCase();
  if (!ALLOWED_ROLES.has(normalizedRole)) {
    throw new ApiError(400, 'INVALID_ROLE', 'role must be one of admin or superadmin', {
      details: [{ field: 'role', issue: 'Use "admin" or "superadmin"' }],
    });
  }

  return normalizedRole;
};

const validateTtlSeconds = (ttlSeconds) => {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 365 * 24 * 60 * 60) {
    throw new ApiError(
      400,
      'INVALID_TTL',
      'ttl must be between 60 seconds and 365 days (inclusive)',
      {
        details: [{ field: 'ttl', issue: 'Use range 60s to 365d' }],
      },
    );
  }
};

/*
 * Superadmin token management must expose token metadata without leaking raw
 * secrets or stored hashes back to the client.
 */
const toPublicTokenRecord = (record, currentTokenId) => {
  return {
    tokenId: String(record?.tokenId || ''),
    role: String(record?.role || 'admin'),
    ownerId: String(record?.ownerId || 'public'),
    createdAt: record?.createdAt || null,
    expiresAt: record?.expiresAt || null,
    revokedAt: record?.revokedAt || null,
    revocationReason: record?.revocationReason || null,
    revokedByTokenId: record?.revokedByTokenId || null,
    isCurrent: String(record?.tokenId || '') === String(currentTokenId || ''),
    isExpired: isExpired(record),
    isActive: !record?.revokedAt && !isExpired(record),
  };
};

export const parseTokenTtl = (rawTtl) => {
  const ttlSeconds = parseDurationToSeconds(rawTtl);
  if (ttlSeconds === null) {
    throw new ApiError(400, 'INVALID_TTL', 'ttl must use format like 30m, 24h, or 30d', {
      details: [{ field: 'ttl', issue: 'Expected integer + unit (s|m|h|d)' }],
    });
  }

  validateTtlSeconds(ttlSeconds);
  return ttlSeconds;
};

export const createAdminToken = ({ role, ownerId, ttlSeconds }) => {
  const normalizedRole = validateRole(role);
  validateTtlSeconds(ttlSeconds);

  const tokenId = randomUUID();
  const plainToken = `sat_${randomBytes(32).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const store = readStore();
  store.tokens.push({
    tokenId,
    role: normalizedRole,
    ownerId: normalizeOwnerId(ownerId),
    tokenHash: hashToken(plainToken),
    createdAt,
    expiresAt,
    revokedAt: null,
  });
  saveStore(store);

  return {
    tokenId,
    role: normalizedRole,
    ownerId: normalizeOwnerId(ownerId),
    createdAt,
    expiresAt,
    token: plainToken,
  };
};

export const resolveAdminToken = (plainToken) => {
  if (!plainToken) {
    return null;
  }

  const store = readStore();
  const candidateHash = Buffer.from(hashToken(plainToken));

  for (const record of store.tokens) {
    const storedHashValue = String(record?.tokenHash || '');
    const storedHash = Buffer.from(storedHashValue);
    if (storedHash.length !== candidateHash.length) {
      continue;
    }

    if (storedHashValue === plainToken) {
      return { status: 'hashed_input', record };
    }

    if (timingSafeEqual(storedHash, candidateHash)) {
      if (record.revokedAt) {
        return { status: 'revoked', record };
      }

      if (isExpired(record)) {
        return { status: 'expired', record };
      }

      return {
        status: 'active',
        record,
      };
    }
  }

  return null;
};

export const invalidateAllAdminTokens = ({ reason, actorTokenId }) => {
  const store = readStore();
  const now = new Date().toISOString();
  let invalidated = 0;

  store.tokens = store.tokens.map((record) => {
    if (record.revokedAt) {
      return record;
    }

    invalidated += 1;
    return {
      ...record,
      revokedAt: now,
      revocationReason: reason || 'superadmin_invalidate_all',
      revokedByTokenId: actorTokenId || null,
    };
  });

  saveStore(store);

  return {
    invalidated,
    revokedAt: now,
  };
};

export const listAdminTokens = ({ actorTokenId }) => {
  const store = readStore();
  const tokens = store.tokens
    .map((record) => toPublicTokenRecord(record, actorTokenId))
    .sort((a, b) => {
      const aCreatedAt = Date.parse(a.createdAt || '') || 0;
      const bCreatedAt = Date.parse(b.createdAt || '') || 0;
      return bCreatedAt - aCreatedAt;
    });

  return {
    count: tokens.length,
    tokens,
    currentTokenId: actorTokenId || null,
  };
};

/*
 * Bulk revocation is id-based so a superadmin can remove selected sessions,
 * including their own, without exposing hashes or plaintext tokens to the UI.
 */
export const revokeAdminTokens = ({ tokenIds, reason, actorTokenId }) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(tokenIds) ? tokenIds : [])
        .map((tokenId) => String(tokenId || '').trim())
        .filter(Boolean),
    ),
  );

  if (normalizedIds.length === 0) {
    throw new ApiError(400, 'INVALID_INPUT', 'tokenIds must contain at least one token id', {
      details: [{ field: 'tokenIds', issue: 'Provide one or more token ids to revoke' }],
    });
  }

  const store = readStore();
  const existingTokenIds = new Set(store.tokens.map((record) => String(record?.tokenId || '')));
  const missingTokenIds = normalizedIds.filter((tokenId) => !existingTokenIds.has(tokenId));

  if (missingTokenIds.length > 0) {
    throw new ApiError(404, 'ADMIN_TOKEN_NOT_FOUND', 'One or more admin tokens were not found', {
      details: missingTokenIds.map((tokenId) => ({
        field: 'tokenIds',
        issue: `Unknown token id ${tokenId}`,
      })),
    });
  }

  const now = new Date().toISOString();
  let revoked = 0;

  store.tokens = store.tokens.map((record) => {
    const tokenId = String(record?.tokenId || '');
    if (!normalizedIds.includes(tokenId) || record?.revokedAt) {
      return record;
    }

    revoked += 1;
    return {
      ...record,
      revokedAt: now,
      revocationReason: reason || 'superadmin_revoke_selected',
      revokedByTokenId: actorTokenId || null,
    };
  });

  saveStore(store);

  return {
    requested: normalizedIds.length,
    revoked,
    revokedAt: now,
    revokedTokenIds: normalizedIds,
    revokedCurrentToken: normalizedIds.includes(String(actorTokenId || '')),
  };
};
