/*
 * Token persistence now separates superadmin bootstrap secrets from
 * service-scoped access tokens so the UI can manage renewable aliases and
 * service flags without exposing stored token hashes.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApiError } from '../../common/utils/api-error.js';
import { env } from '../../config/env.js';
import { ACCESS_TOKEN_SERVICE_FLAG_LIST, TOKEN_TYPES } from './admin-token.constants.js';

const STORE_VERSION = 2;
const MAX_ALIAS_LENGTH = 80;

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
    return { version: STORE_VERSION, tokens: [] };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: Number(parsed?.version) || 1,
      tokens: Array.isArray(parsed?.tokens) ? parsed.tokens : [],
    };
  } catch {
    return { version: STORE_VERSION, tokens: [] };
  }
};

const saveStore = (store) => {
  const filePath = resolveStorePath();
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
};

const hashToken = (token) =>
  createHash('sha256').update(`${env.adminTokenPepper}:${token}`).digest('hex');

const normalizeAliasValue = (alias) =>
  String(alias || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_ALIAS_LENGTH);

const ensureAlias = (alias, field = 'alias') => {
  const normalized = normalizeAliasValue(alias);
  if (!normalized) {
    throw new ApiError(400, 'INVALID_ALIAS', 'alias is required', {
      details: [{ field, issue: 'Provide a short alias for the token' }],
    });
  }

  return normalized;
};

const normalizeServiceFlags = (serviceFlags, { required = true, field = 'serviceFlags' } = {}) => {
  const normalizedFlags = Array.from(
    new Set(
      (Array.isArray(serviceFlags) ? serviceFlags : [])
        .map((flag) => String(flag || '').trim())
        .filter(Boolean),
    ),
  );

  if (required && normalizedFlags.length === 0) {
    throw new ApiError(
      400,
      'INVALID_SERVICE_FLAGS',
      'serviceFlags must contain at least one flag',
      {
        details: [{ field, issue: 'Select at least one enabled service' }],
      },
    );
  }

  const invalidFlags = normalizedFlags.filter(
    (flag) => !ACCESS_TOKEN_SERVICE_FLAG_LIST.includes(flag),
  );

  if (invalidFlags.length > 0) {
    throw new ApiError(400, 'INVALID_SERVICE_FLAGS', 'serviceFlags contain unsupported values', {
      details: invalidFlags.map((flag) => ({
        field,
        issue: `Unsupported service flag ${flag}`,
      })),
    });
  }

  return normalizedFlags;
};

const validateTtlSeconds = (ttlSeconds, field = 'ttl') => {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 365 * 24 * 60 * 60) {
    throw new ApiError(
      400,
      'INVALID_TTL',
      'ttl must be between 60 seconds and 365 days (inclusive)',
      {
        details: [{ field, issue: 'Use range 60s to 365d' }],
      },
    );
  }
};

const parseOptionalTtl = (rawTtl, field = 'ttl') => {
  if (rawTtl === undefined || rawTtl === null || String(rawTtl).trim() === '') {
    return null;
  }

  const ttlSeconds = parseDurationToSeconds(rawTtl);
  if (ttlSeconds === null) {
    throw new ApiError(400, 'INVALID_TTL', 'ttl must use format like 30m, 24h, or 30d', {
      details: [{ field, issue: 'Expected integer + unit (s|m|h|d)' }],
    });
  }

  validateTtlSeconds(ttlSeconds, field);
  return ttlSeconds;
};

const isExpired = (record) => {
  const expiresAtMs = Date.parse(record?.expiresAt || '');
  return Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : true;
};

const toLegacyAccessAlias = (record) => {
  const ownerId = String(record?.ownerId || '')
    .trim()
    .replace(/[-_]+/g, ' ');
  return normalizeAliasValue(ownerId) || 'Legacy access token';
};

const normalizeStoreRecord = (record = {}) => {
  const plainToken = String(record?.token || record?.plainToken || '').trim();
  const tokenHash =
    String(record?.tokenHash || '').trim() || (plainToken ? hashToken(plainToken) : '');
  const legacyRole = String(record?.role || '')
    .trim()
    .toLowerCase();
  const tokenType =
    record?.tokenType === TOKEN_TYPES.SUPERADMIN || legacyRole === TOKEN_TYPES.SUPERADMIN
      ? TOKEN_TYPES.SUPERADMIN
      : TOKEN_TYPES.ACCESS;

  const ttlSeconds = Number.parseInt(record?.ttlSeconds, 10);
  const serviceFlags =
    tokenType === TOKEN_TYPES.ACCESS
      ? normalizeServiceFlags(record?.serviceFlags, { required: false })
      : [];

  return {
    tokenId: String(record?.tokenId || randomUUID()),
    tokenType,
    alias:
      tokenType === TOKEN_TYPES.SUPERADMIN
        ? normalizeAliasValue(record?.alias || 'CLI superadmin') || 'CLI superadmin'
        : normalizeAliasValue(record?.alias || toLegacyAccessAlias(record)) || 'Access token',
    serviceFlags,
    ttlSeconds: Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 30 * 24 * 60 * 60,
    tokenHash,
    createdAt: record?.createdAt || new Date().toISOString(),
    expiresAt:
      record?.expiresAt ||
      new Date(
        Date.now() + (Number.isInteger(ttlSeconds) ? ttlSeconds : 30 * 24 * 60 * 60) * 1000,
      ).toISOString(),
    revokedAt: record?.revokedAt || null,
    revocationReason: record?.revocationReason || null,
    revokedByTokenId: record?.revokedByTokenId || null,
    renewedAt: record?.renewedAt || null,
    renewedByTokenId: record?.renewedByTokenId || null,
    extendedAt: record?.extendedAt || null,
    extendedByTokenId: record?.extendedByTokenId || null,
  };
};

/*
 * Legacy records and bootstrap plaintext tokens are normalized into the same
 * hashed store shape so older deployments can keep working after the token
 * model switches from admin-owner scope to alias plus service flags.
 */
const normalizeStoreTokens = (store) => {
  let changed = Number(store?.version) !== STORE_VERSION;

  const tokens = Array.isArray(store?.tokens) ? store.tokens : [];
  const normalizedTokens = tokens.map((record) => {
    const normalized = normalizeStoreRecord(record);
    if (JSON.stringify(record) !== JSON.stringify(normalized)) {
      changed = true;
    }

    return normalized;
  });

  return {
    changed,
    store: {
      version: STORE_VERSION,
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

const findTokenRecordOrThrow = (store, tokenId) => {
  const normalizedTokenId = String(tokenId || '').trim();
  const record = store.tokens.find((item) => String(item?.tokenId || '') === normalizedTokenId);

  if (!record) {
    throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token was not found', {
      details: [{ field: 'tokenId', issue: `Unknown token id ${normalizedTokenId}` }],
    });
  }

  return record;
};

const assertAccessTokenRecord = (record, field = 'tokenId') => {
  if (record?.tokenType !== TOKEN_TYPES.ACCESS) {
    throw new ApiError(400, 'TOKEN_NOT_EDITABLE', 'Only access tokens can be managed from the UI', {
      details: [{ field, issue: 'Superadmin tokens are created only through the CLI' }],
    });
  }
};

const buildPlainToken = () => `sat_${randomBytes(32).toString('hex')}`;

/*
 * Public token metadata includes alias, service flags, lifecycle markers, and
 * current-state booleans while continuing to omit hashes and plaintext values.
 */
const toPublicTokenRecord = (record) => ({
  tokenId: String(record?.tokenId || ''),
  tokenType: String(record?.tokenType || TOKEN_TYPES.ACCESS),
  alias: normalizeAliasValue(record?.alias || ''),
  serviceFlags:
    record?.tokenType === TOKEN_TYPES.ACCESS
      ? normalizeServiceFlags(record?.serviceFlags, { required: false })
      : [],
  createdAt: record?.createdAt || null,
  expiresAt: record?.expiresAt || null,
  revokedAt: record?.revokedAt || null,
  revocationReason: record?.revocationReason || null,
  revokedByTokenId: record?.revokedByTokenId || null,
  renewedAt: record?.renewedAt || null,
  renewedByTokenId: record?.renewedByTokenId || null,
  extendedAt: record?.extendedAt || null,
  extendedByTokenId: record?.extendedByTokenId || null,
  isExpired: isExpired(record),
  isRevoked: Boolean(record?.revokedAt),
  isActive: !record?.revokedAt && !isExpired(record),
});

export const parseTokenTtl = (rawTtl) => {
  const ttlSeconds = parseOptionalTtl(rawTtl, 'ttl');
  if (ttlSeconds === null) {
    throw new ApiError(400, 'INVALID_TTL', 'ttl must use format like 30m, 24h, or 30d', {
      details: [{ field: 'ttl', issue: 'Expected integer + unit (s|m|h|d)' }],
    });
  }

  return ttlSeconds;
};

export const createSuperAdminToken = ({ alias, ttlSeconds }) => {
  const normalizedAlias = normalizeAliasValue(alias || 'CLI superadmin') || 'CLI superadmin';
  validateTtlSeconds(ttlSeconds);

  const tokenId = randomUUID();
  const token = buildPlainToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const store = readStore();
  store.tokens.push({
    tokenId,
    tokenType: TOKEN_TYPES.SUPERADMIN,
    alias: normalizedAlias,
    serviceFlags: [],
    ttlSeconds,
    tokenHash: hashToken(token),
    createdAt,
    expiresAt,
    revokedAt: null,
    revocationReason: null,
    revokedByTokenId: null,
    renewedAt: null,
    renewedByTokenId: null,
    extendedAt: null,
    extendedByTokenId: null,
  });
  saveStore(store);

  return {
    tokenId,
    tokenType: TOKEN_TYPES.SUPERADMIN,
    alias: normalizedAlias,
    createdAt,
    expiresAt,
    token,
  };
};

export const createAccessToken = ({ alias, serviceFlags, ttlSeconds, actorTokenId }) => {
  const normalizedAlias = ensureAlias(alias);
  const normalizedFlags = normalizeServiceFlags(serviceFlags);
  validateTtlSeconds(ttlSeconds);

  const tokenId = randomUUID();
  const token = buildPlainToken();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const store = readStore();
  const record = {
    tokenId,
    tokenType: TOKEN_TYPES.ACCESS,
    alias: normalizedAlias,
    serviceFlags: normalizedFlags,
    ttlSeconds,
    tokenHash: hashToken(token),
    createdAt,
    expiresAt,
    revokedAt: null,
    revocationReason: null,
    revokedByTokenId: null,
    renewedAt: null,
    renewedByTokenId: actorTokenId || null,
    extendedAt: null,
    extendedByTokenId: null,
  };
  store.tokens.push(record);
  saveStore(store);

  return {
    token,
    record: toPublicTokenRecord(record),
  };
};

export const updateAccessToken = ({ tokenId, alias, serviceFlags }) => {
  const normalizedAlias = ensureAlias(alias);
  const normalizedFlags = normalizeServiceFlags(serviceFlags);
  const store = readStore();

  const nextTokens = store.tokens.map((record) => {
    if (String(record?.tokenId || '') !== String(tokenId || '').trim()) {
      return record;
    }

    assertAccessTokenRecord(record);
    return {
      ...record,
      alias: normalizedAlias,
      serviceFlags: normalizedFlags,
    };
  });

  findTokenRecordOrThrow({ tokens: nextTokens }, tokenId);
  store.tokens = nextTokens;
  saveStore(store);

  return toPublicTokenRecord(findTokenRecordOrThrow(store, tokenId));
};

export const revokeAccessToken = ({ tokenId, actorTokenId }) => {
  const store = readStore();
  const target = findTokenRecordOrThrow(store, tokenId);
  assertAccessTokenRecord(target);

  if (target.revokedAt) {
    return toPublicTokenRecord(target);
  }

  const revokedAt = new Date().toISOString();
  store.tokens = store.tokens.map((record) =>
    String(record?.tokenId || '') === String(tokenId || '').trim()
      ? {
          ...record,
          revokedAt,
          revocationReason: 'superadmin_revoke_selected',
          revokedByTokenId: actorTokenId || null,
        }
      : record,
  );
  saveStore(store);

  return toPublicTokenRecord(findTokenRecordOrThrow(store, tokenId));
};

export const renewAccessToken = ({ tokenId, actorTokenId, ttlSeconds = null }) => {
  const store = readStore();
  const target = findTokenRecordOrThrow(store, tokenId);
  assertAccessTokenRecord(target);

  if (!target.revokedAt && !isExpired(target)) {
    throw new ApiError(
      409,
      'TOKEN_NOT_RENEWABLE',
      'Only revoked or expired access tokens can be renewed',
      {
        details: [{ field: 'tokenId', issue: 'Revoke or let the token expire before renewing it' }],
      },
    );
  }

  const storedTtlSeconds = Number(target?.ttlSeconds);
  const nextTtlSeconds =
    ttlSeconds ??
    (Number.isInteger(storedTtlSeconds) && storedTtlSeconds > 0
      ? storedTtlSeconds
      : 30 * 24 * 60 * 60);
  validateTtlSeconds(nextTtlSeconds);

  const token = buildPlainToken();
  const renewedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + nextTtlSeconds * 1000).toISOString();

  store.tokens = store.tokens.map((record) =>
    String(record?.tokenId || '') === String(tokenId || '').trim()
      ? {
          ...record,
          tokenHash: hashToken(token),
          ttlSeconds: nextTtlSeconds,
          expiresAt,
          revokedAt: null,
          revocationReason: null,
          revokedByTokenId: null,
          renewedAt,
          renewedByTokenId: actorTokenId || null,
        }
      : record,
  );
  saveStore(store);

  return {
    token,
    record: toPublicTokenRecord(findTokenRecordOrThrow(store, tokenId)),
  };
};

export const extendAccessToken = ({ tokenId, ttlSeconds, actorTokenId }) => {
  validateTtlSeconds(ttlSeconds);

  const store = readStore();
  const target = findTokenRecordOrThrow(store, tokenId);
  assertAccessTokenRecord(target);

  if (target.revokedAt) {
    throw new ApiError(
      409,
      'TOKEN_NOT_EXTENDABLE',
      'Revoked access tokens must be renewed instead of extended',
      {
        details: [{ field: 'tokenId', issue: 'Renew the token to mint a new usable secret' }],
      },
    );
  }

  const currentExpiryMs = Date.parse(target?.expiresAt || '');
  const baseMs = Number.isFinite(currentExpiryMs)
    ? Math.max(currentExpiryMs, Date.now())
    : Date.now();
  const extendedAt = new Date().toISOString();
  const expiresAt = new Date(baseMs + ttlSeconds * 1000).toISOString();

  store.tokens = store.tokens.map((record) =>
    String(record?.tokenId || '') === String(tokenId || '').trim()
      ? {
          ...record,
          expiresAt,
          extendedAt,
          extendedByTokenId: actorTokenId || null,
        }
      : record,
  );
  saveStore(store);

  return toPublicTokenRecord(findTokenRecordOrThrow(store, tokenId));
};

export const listAccessTokens = () => {
  const store = readStore();
  const tokens = store.tokens
    .filter((record) => record?.tokenType === TOKEN_TYPES.ACCESS)
    .map((record) => toPublicTokenRecord(record))
    .sort((left, right) => {
      const leftCreatedAt = Date.parse(left.createdAt || '') || 0;
      const rightCreatedAt = Date.parse(right.createdAt || '') || 0;
      return rightCreatedAt - leftCreatedAt;
    });

  return {
    count: tokens.length,
    tokens,
    availableServiceFlags: ACCESS_TOKEN_SERVICE_FLAG_LIST,
  };
};

export const resolveStoredToken = (plainToken) => {
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

      return { status: 'active', record };
    }
  }

  return null;
};
