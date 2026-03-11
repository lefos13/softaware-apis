/*
 * Token requests persist outside process memory so admins can review pending
 * approvals later and the same records can drive both API responses and email.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApiError } from '../../common/utils/api-error.js';
import { sendEmail } from '../../common/services/email.service.js';
import { env } from '../../config/env.js';
import {
  createAccessToken,
  parseTokenTtl,
  revokeAccessToken,
} from '../admin/admin-token.service.js';
import {
  ACCESS_SERVICE_KEY_LIST,
  ACCESS_TOKEN_SERVICE_POLICY_PRESETS,
  FREE_ACCESS_SERVICE_POLICIES,
} from './access-policy.constants.js';

const STORE_VERSION = 1;
const MAX_ALIAS_LENGTH = 80;
const MAX_EMAIL_LENGTH = 160;
const MAX_REASON_LENGTH = 240;

const resolveStorePath = () => resolve(process.cwd(), env.tokenRequestStoreFile);

const safeReadJson = (filePath) => {
  if (!existsSync(filePath)) {
    return { version: STORE_VERSION, requests: [] };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: Number(parsed?.version) || STORE_VERSION,
      requests: Array.isArray(parsed?.requests) ? parsed.requests : [],
    };
  } catch {
    return { version: STORE_VERSION, requests: [] };
  }
};

const saveStore = (store) => {
  const filePath = resolveStorePath();
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
};

const normalizeAlias = (alias) =>
  String(alias || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_ALIAS_LENGTH);

const ensureAlias = (alias) => {
  const normalized = normalizeAlias(alias);
  if (normalized) {
    return normalized;
  }

  throw new ApiError(400, 'INVALID_ALIAS', 'alias is required', {
    details: [{ field: 'alias', issue: 'Provide a short alias for the requested token' }],
  });
};

const normalizeEmail = (email) =>
  String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, MAX_EMAIL_LENGTH);

const ensureEmail = (email) => {
  const normalized = normalizeEmail(email);
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);

  if (isValid) {
    return normalized;
  }

  throw new ApiError(400, 'INVALID_EMAIL', 'A valid email is required', {
    details: [{ field: 'email', issue: 'Use a valid email address' }],
  });
};

const normalizeReason = (reason) =>
  String(reason || '')
    .trim()
    .slice(0, MAX_REASON_LENGTH);

const sanitizePolicy = (policy) => ({
  preset: String(policy?.preset || ''),
  kind: String(policy?.kind || 'unlimited'),
  requestsPerDay: Number.isInteger(policy?.requestsPerDay) ? policy.requestsPerDay : null,
  wordsTotal: Number.isInteger(policy?.wordsTotal) ? policy.wordsTotal : null,
});

const ensureRequestedPolicies = (rawPolicies) => {
  const input =
    rawPolicies && typeof rawPolicies === 'object' && !Array.isArray(rawPolicies)
      ? rawPolicies
      : {};
  const normalized = {};
  const details = [];

  Object.entries(input).forEach(([serviceKey, presetValue]) => {
    const normalizedServiceKey = String(serviceKey || '').trim();
    if (!normalizedServiceKey) {
      return;
    }

    if (!ACCESS_SERVICE_KEY_LIST.includes(normalizedServiceKey)) {
      details.push({
        field: 'servicePolicies',
        issue: `Unsupported service key ${normalizedServiceKey}`,
      });
      return;
    }

    const preset =
      typeof presetValue === 'object' && presetValue !== null
        ? String(presetValue.preset || '').trim()
        : String(presetValue || '').trim();
    const policy = ACCESS_TOKEN_SERVICE_POLICY_PRESETS[normalizedServiceKey]?.[preset];
    if (!policy) {
      details.push({
        field: `servicePolicies.${normalizedServiceKey}`,
        issue: `Unsupported preset ${preset || '(empty)'}`,
      });
      return;
    }

    normalized[normalizedServiceKey] = sanitizePolicy(policy);
  });

  if (details.length > 0) {
    throw new ApiError(400, 'INVALID_SERVICE_POLICIES', 'Requested servicePolicies are invalid', {
      details,
    });
  }

  if (Object.keys(normalized).length > 0) {
    return normalized;
  }

  throw new ApiError(
    400,
    'INVALID_SERVICE_POLICIES',
    'servicePolicies must contain at least one enabled service',
    {
      details: [{ field: 'servicePolicies', issue: 'Select at least one service preset' }],
    },
  );
};

const normalizeRequestRecord = (record = {}) => {
  const servicePolicies = ensureRequestedPolicies(record?.servicePolicies || {});
  const status = ['pending', 'approved', 'rejected'].includes(String(record?.status || ''))
    ? String(record.status)
    : 'pending';

  return {
    requestId: String(record?.requestId || randomUUID()),
    alias: ensureAlias(record?.alias),
    email: ensureEmail(record?.email),
    servicePolicies,
    createdAt: record?.createdAt || new Date().toISOString(),
    status,
    reviewedAt: record?.reviewedAt || null,
    reviewedByTokenId: record?.reviewedByTokenId || null,
    resolvedTokenId: record?.resolvedTokenId || null,
    rejectionReason: normalizeReason(record?.rejectionReason || ''),
    lastEmailError: record?.lastEmailError || null,
    lastEmailAttemptAt: record?.lastEmailAttemptAt || null,
  };
};

const normalizeStore = (store) => {
  let changed = Number(store?.version) !== STORE_VERSION;
  const requests = Array.isArray(store?.requests) ? store.requests : [];
  const normalizedRequests = requests.map((record) => {
    const normalized = normalizeRequestRecord(record);
    if (JSON.stringify(normalized) !== JSON.stringify(record)) {
      changed = true;
    }

    return normalized;
  });

  return {
    changed,
    store: {
      version: STORE_VERSION,
      requests: normalizedRequests,
    },
  };
};

const readStore = () => {
  const normalized = normalizeStore(safeReadJson(resolveStorePath()));
  if (normalized.changed) {
    saveStore(normalized.store);
  }

  return normalized.store;
};

const findRequestOrThrow = (store, requestId) => {
  const normalizedId = String(requestId || '').trim();
  const record = store.requests.find((item) => String(item?.requestId || '') === normalizedId);

  if (record) {
    return record;
  }

  throw new ApiError(404, 'TOKEN_REQUEST_NOT_FOUND', 'Token request was not found', {
    details: [{ field: 'requestId', issue: `Unknown token request ${normalizedId}` }],
  });
};

const assertPendingRequest = (record) => {
  if (record?.status === 'pending') {
    return;
  }

  throw new ApiError(
    409,
    'TOKEN_REQUEST_ALREADY_REVIEWED',
    'Token request has already been reviewed',
    {
      details: [
        { field: 'requestId', issue: `Request is already ${record?.status || 'processed'}` },
      ],
    },
  );
};

const toPublicRequestRecord = (record) => ({
  requestId: String(record?.requestId || ''),
  alias: String(record?.alias || ''),
  email: String(record?.email || ''),
  servicePolicies: Object.fromEntries(
    Object.entries(record?.servicePolicies || {}).map(([serviceKey, policy]) => [
      serviceKey,
      String(policy?.preset || ''),
    ]),
  ),
  createdAt: record?.createdAt || null,
  status: record?.status || 'pending',
  reviewedAt: record?.reviewedAt || null,
  reviewedByTokenId: record?.reviewedByTokenId || null,
  resolvedTokenId: record?.resolvedTokenId || null,
  rejectionReason: record?.rejectionReason || null,
  lastEmailError: record?.lastEmailError || null,
  lastEmailAttemptAt: record?.lastEmailAttemptAt || null,
});

const formatPolicyDescription = (serviceKey, policy) => {
  const safePolicy = sanitizePolicy(policy);
  const parts = [];

  if (Number.isInteger(safePolicy.requestsPerDay)) {
    parts.push(`${safePolicy.requestsPerDay} requests/day`);
  }

  if (Number.isInteger(safePolicy.wordsTotal)) {
    parts.push(`${safePolicy.wordsTotal} words total`);
  }

  return `${serviceKey}: ${safePolicy.preset}${parts.length ? ` (${parts.join(', ')})` : ''}`;
};

const escapeHtml = (value) =>
  String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const buildPolicySummaryText = (servicePolicies) =>
  Object.entries(servicePolicies || {})
    .map(([serviceKey, policy]) => `- ${formatPolicyDescription(serviceKey, policy)}`)
    .join('\n');

const buildPolicySummaryHtml = (servicePolicies) =>
  Object.entries(servicePolicies || {})
    .map(
      ([serviceKey, policy]) =>
        `<li>${escapeHtml(formatPolicyDescription(serviceKey, policy))}</li>`,
    )
    .join('');

const updateRequest = (requestId, updater) => {
  const store = readStore();
  const target = findRequestOrThrow(store, requestId);
  const nextRequests = store.requests.map((record) =>
    String(record?.requestId || '') === String(requestId || '').trim() ? updater(target) : record,
  );
  store.requests = nextRequests;
  saveStore(store);
  return toPublicRequestRecord(findRequestOrThrow(store, requestId));
};

export const buildAccessPlanCatalog = () => ({
  freePlan: {
    planType: 'free',
    services: ACCESS_SERVICE_KEY_LIST.map((serviceKey) => ({
      serviceKey,
      ...sanitizePolicy(FREE_ACCESS_SERVICE_POLICIES[serviceKey]),
    })),
  },
  paidPlans: ACCESS_SERVICE_KEY_LIST.map((serviceKey) => ({
    serviceKey,
    presets: Object.values(ACCESS_TOKEN_SERVICE_POLICY_PRESETS[serviceKey] || {}).map((policy) =>
      sanitizePolicy(policy),
    ),
  })),
  requestDefaults: {
    ttl: env.tokenRequestDefaultTtl,
  },
});

export const createTokenRequest = ({ alias, email, servicePolicies }) => {
  const record = normalizeRequestRecord({
    requestId: randomUUID(),
    alias,
    email,
    servicePolicies,
    createdAt: new Date().toISOString(),
    status: 'pending',
    reviewedAt: null,
    reviewedByTokenId: null,
    resolvedTokenId: null,
    rejectionReason: '',
    lastEmailError: null,
    lastEmailAttemptAt: null,
  });
  const store = readStore();
  store.requests.push(record);
  saveStore(store);
  return toPublicRequestRecord(record);
};

export const listTokenRequests = ({ status = '' } = {}) => {
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();
  const store = readStore();
  const requests = store.requests
    .filter((record) => (!normalizedStatus ? true : record.status === normalizedStatus))
    .sort((left, right) => {
      const leftPending = left.status === 'pending' ? 0 : 1;
      const rightPending = right.status === 'pending' ? 0 : 1;

      if (leftPending !== rightPending) {
        return leftPending - rightPending;
      }

      return (Date.parse(right.createdAt || '') || 0) - (Date.parse(left.createdAt || '') || 0);
    })
    .map((record) => toPublicRequestRecord(record));

  return {
    count: requests.length,
    pendingCount: store.requests.filter((record) => record.status === 'pending').length,
    requests,
  };
};

export const approveTokenRequest = async ({
  requestId,
  actorTokenId,
  ttl = env.tokenRequestDefaultTtl,
  createAccessTokenImpl = createAccessToken,
  revokeAccessTokenImpl = revokeAccessToken,
  sendEmailImpl = sendEmail,
}) => {
  const target = findRequestOrThrow(readStore(), requestId);
  assertPendingRequest(target);

  const ttlSeconds = parseTokenTtl(ttl);
  const created = createAccessTokenImpl({
    alias: target.alias,
    servicePolicies: toPublicRequestRecord(target).servicePolicies,
    ttlSeconds,
    actorTokenId,
  });

  try {
    await sendEmailImpl({
      to: target.email,
      subject: `Softaware Tools token approved for ${target.alias}`,
      text: [
        `Your token request for "${target.alias}" has been approved.`,
        '',
        `Token: ${created.token}`,
        `TTL: ${ttl}`,
        '',
        'Requested service limits:',
        buildPolicySummaryText(target.servicePolicies),
      ].join('\n'),
      html: [
        `<p>Your token request for <strong>${escapeHtml(target.alias)}</strong> has been approved.</p>`,
        `<p><strong>Token:</strong> <code>${escapeHtml(created.token)}</code></p>`,
        `<p><strong>TTL:</strong> ${escapeHtml(ttl)}</p>`,
        '<p><strong>Requested service limits:</strong></p>',
        `<ul>${buildPolicySummaryHtml(target.servicePolicies)}</ul>`,
      ].join(''),
    });
  } catch (error) {
    try {
      revokeAccessTokenImpl({ tokenId: created.record.tokenId, actorTokenId });
    } catch {
      // Ignore rollback failures so the original delivery error is returned.
    }

    updateRequest(requestId, (record) => ({
      ...record,
      lastEmailError: error instanceof Error ? error.message : 'Email delivery failed',
      lastEmailAttemptAt: new Date().toISOString(),
    }));
    throw error;
  }

  const approvedRequest = updateRequest(requestId, (record) => ({
    ...record,
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewedByTokenId: actorTokenId || null,
    resolvedTokenId: created.record.tokenId,
    rejectionReason: '',
    lastEmailError: null,
    lastEmailAttemptAt: new Date().toISOString(),
  }));

  return {
    request: approvedRequest,
    token: created.record,
  };
};

export const rejectTokenRequest = async ({
  requestId,
  actorTokenId,
  reason = '',
  sendEmailImpl = sendEmail,
}) => {
  const target = findRequestOrThrow(readStore(), requestId);
  assertPendingRequest(target);
  const normalizedReason = normalizeReason(reason);

  try {
    await sendEmailImpl({
      to: target.email,
      subject: `Softaware Tools token request update for ${target.alias}`,
      text: [
        `Your token request for "${target.alias}" was rejected.`,
        normalizedReason ? '' : '',
        normalizedReason ? `Reason: ${normalizedReason}` : '',
        '',
        'Requested service limits:',
        buildPolicySummaryText(target.servicePolicies),
      ]
        .filter(Boolean)
        .join('\n'),
      html: [
        `<p>Your token request for <strong>${escapeHtml(target.alias)}</strong> was rejected.</p>`,
        normalizedReason ? `<p><strong>Reason:</strong> ${escapeHtml(normalizedReason)}</p>` : '',
        '<p><strong>Requested service limits:</strong></p>',
        `<ul>${buildPolicySummaryHtml(target.servicePolicies)}</ul>`,
      ]
        .filter(Boolean)
        .join(''),
    });
  } catch (error) {
    updateRequest(requestId, (record) => ({
      ...record,
      lastEmailError: error instanceof Error ? error.message : 'Email delivery failed',
      lastEmailAttemptAt: new Date().toISOString(),
    }));
    throw error;
  }

  const rejectedRequest = updateRequest(requestId, (record) => ({
    ...record,
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedByTokenId: actorTokenId || null,
    resolvedTokenId: null,
    rejectionReason: normalizedReason,
    lastEmailError: null,
    lastEmailAttemptAt: new Date().toISOString(),
  }));

  return {
    request: rejectedRequest,
  };
};
