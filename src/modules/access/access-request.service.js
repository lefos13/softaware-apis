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

/*
 * Approval and rejection emails now use one branded template with clearer
 * bilingual copy so recipients can quickly understand the decision and next step.
 */
const renderEmailLayout = ({
  statusLabel,
  statusTone,
  heading,
  intro,
  summaryTitle,
  summaryHtml,
  tokenLabel = '',
  tokenValue = '',
  ttlLabel = '',
  ttlValue = '',
  reasonLabel = '',
  reasonValue = '',
  tokenIdLabel = '',
  tokenIdValue = '',
  footer,
}) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:#ffffff;border:1px solid #dbe5ef;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:22px 24px 0;">
              <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${statusTone};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;">
                ${escapeHtml(statusLabel)}
              </span>
              <h1 style="margin:14px 0 8px;font-size:23px;line-height:1.3;color:#0f172a;">
                ${escapeHtml(heading)}
              </h1>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#334155;">
                ${escapeHtml(intro)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px 0;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0f172a;">
                ${escapeHtml(summaryTitle)}
              </p>
              <ul style="margin:0;padding-left:18px;color:#334155;">
                ${summaryHtml}
              </ul>
            </td>
          </tr>
          ${
            tokenValue
              ? `
                <tr>
                  <td style="padding:16px 24px 0;">
                    <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0f172a;">
                      ${escapeHtml(tokenLabel)}
                    </p>
                    <p style="margin:0;padding:12px;border:1px solid #d0dae6;border-radius:12px;background:#f8fafc;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45;color:#0f172a;word-break:break-all;">
                      ${escapeHtml(tokenValue)}
                    </p>
                  </td>
                </tr>
              `
              : ''
          }
          ${
            tokenIdValue
              ? `
                <tr>
                  <td style="padding:16px 24px 0;">
                    <p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">
                      <strong style="color:#0f172a;">${escapeHtml(tokenIdLabel)}:</strong> ${escapeHtml(tokenIdValue)}
                    </p>
                  </td>
                </tr>
              `
              : ''
          }
          ${
            ttlValue
              ? `
                <tr>
                  <td style="padding:16px 24px 0;">
                    <p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">
                      <strong style="color:#0f172a;">${escapeHtml(ttlLabel)}:</strong> ${escapeHtml(ttlValue)}
                    </p>
                  </td>
                </tr>
              `
              : ''
          }
          ${
            reasonValue
              ? `
                <tr>
                  <td style="padding:16px 24px 0;">
                    <p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">
                      <strong style="color:#0f172a;">${escapeHtml(reasonLabel)}:</strong> ${escapeHtml(reasonValue)}
                    </p>
                  </td>
                </tr>
              `
              : ''
          }
          <tr>
            <td style="padding:16px 24px 24px;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">
                ${escapeHtml(footer)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
`;

const buildApprovalEmailText = ({ alias, token, tokenId, ttl, servicePolicies }) =>
  [
    'Hello,',
    `Great news. Your Softaware Tools request for "${alias}" was approved.`,
    '',
    'Token:',
    token,
    `Token id: ${tokenId}`,
    `Valid for: ${ttl}`,
    '',
    'Requested service limits:',
    buildPolicySummaryText(servicePolicies),
    '',
    'Keep this token private and use it from the Plans page when needed.',
    '',
    '---',
    'Γεια σας,',
    `Το αίτημα Softaware Tools για "${alias}" εγκρίθηκε.`,
    '',
    'Token:',
    token,
    `Token id: ${tokenId}`,
    `Διάρκεια: ${ttl}`,
    '',
    'Ζητούμενα όρια υπηρεσιών:',
    buildPolicySummaryText(servicePolicies),
    '',
    'Κρατήστε το token ιδιωτικό και χρησιμοποιήστε το από τη σελίδα Πλάνα όταν το χρειαστείτε.',
  ].join('\n');

const buildApprovalEmailHtml = ({ alias, token, tokenId, ttl, servicePolicies }) =>
  renderEmailLayout({
    statusLabel: 'Approved / Εγκρίθηκε',
    statusTone: '#0f766e',
    heading: `Your request for "${alias}" was approved.`,
    intro:
      'Your access is ready. Save the token below and keep it private. / Η πρόσβασή σας είναι έτοιμη. Αποθηκεύστε το token και κρατήστε το ιδιωτικό.',
    summaryTitle: 'Requested service limits / Ζητούμενα όρια υπηρεσιών',
    summaryHtml: buildPolicySummaryHtml(servicePolicies),
    tokenLabel: 'Token',
    tokenValue: token,
    tokenIdLabel: 'Token id / Αναγνωριστικό token',
    tokenIdValue: tokenId,
    ttlLabel: 'Valid for / Διάρκεια',
    ttlValue: ttl,
    footer:
      'Use this token in the Softaware Tools Plans page when you need paid access. / Χρησιμοποιήστε το token στη σελίδα Πλάνα του Softaware Tools όταν χρειάζεστε paid πρόσβαση.',
  });

const buildRejectionEmailText = ({ alias, reason, servicePolicies }) =>
  [
    'Hello,',
    `Your Softaware Tools request for "${alias}" was not approved this time.`,
    reason ? `Reason: ${reason}` : '',
    '',
    'Requested service limits:',
    buildPolicySummaryText(servicePolicies),
    '',
    'You can submit a new request any time from the Plans page.',
    '',
    '---',
    'Γεια σας,',
    `Το αίτημα Softaware Tools για "${alias}" δεν εγκρίθηκε αυτή τη φορά.`,
    reason ? `Αιτία: ${reason}` : '',
    '',
    'Ζητούμενα όρια υπηρεσιών:',
    buildPolicySummaryText(servicePolicies),
    '',
    'Μπορείτε να στείλετε νέο αίτημα οποιαδήποτε στιγμή από τη σελίδα Πλάνα.',
  ]
    .filter(Boolean)
    .join('\n');

const buildRejectionEmailHtml = ({ alias, reason, servicePolicies }) =>
  renderEmailLayout({
    statusLabel: 'Update / Ενημέρωση',
    statusTone: '#b45309',
    heading: `Update for your request "${alias}".`,
    intro:
      'This request was not approved yet. You can submit a new one at any time from the Plans page. / Αυτό το αίτημα δεν εγκρίθηκε ακόμη. Μπορείτε να στείλετε νέο οποιαδήποτε στιγμή από τη σελίδα Πλάνα.',
    summaryTitle: 'Requested service limits / Ζητούμενα όρια υπηρεσιών',
    summaryHtml: buildPolicySummaryHtml(servicePolicies),
    reasonLabel: 'Reason / Αιτία',
    reasonValue: reason,
    footer:
      'If your needs changed, send a new request with the updated service limits. / Αν οι ανάγκες σας άλλαξαν, στείλτε νέο αίτημα με τα σωστά όρια υπηρεσιών.',
  });

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
      subject: `Softaware Tools access approved for ${target.alias}`,
      text: buildApprovalEmailText({
        alias: target.alias,
        token: created.token,
        tokenId: created.record.tokenId,
        ttl,
        servicePolicies: target.servicePolicies,
      }),
      html: buildApprovalEmailHtml({
        alias: target.alias,
        token: created.token,
        tokenId: created.record.tokenId,
        ttl,
        servicePolicies: target.servicePolicies,
      }),
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
      subject: `Softaware Tools request update for ${target.alias}`,
      text: buildRejectionEmailText({
        alias: target.alias,
        reason: normalizedReason,
        servicePolicies: target.servicePolicies,
      }),
      html: buildRejectionEmailHtml({
        alias: target.alias,
        reason: normalizedReason,
        servicePolicies: target.servicePolicies,
      }),
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
