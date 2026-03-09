/*
 * SQLite-backed usage storage keeps quota enforcement, owner dashboards, and
 * action history consistent across process restarts and concurrent requests.
 * Billing keys let related requests share one quota charge when the client
 * needs a follow-up call to visualize the same underlying service output.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApiError } from '../../common/utils/api-error.js';
import { env } from '../../config/env.js';
import {
  ACCESS_PLAN_TYPES,
  ACCESS_SERVICE_KEY_LIST,
  DAILY_RESET_TIMEZONE,
  FREE_ACCESS_SERVICE_POLICIES,
  HISTORY_RETENTION_DAYS,
  clonePolicy,
  getUtcDayWindow,
} from './access-policy.constants.js';

const dbPath = resolve(process.cwd(), env.accessUsageStoreFile);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_key TEXT NOT NULL,
    service_key TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    request_id TEXT,
    task_id TEXT,
    billing_key TEXT,
    status TEXT NOT NULL,
    consumed_requests INTEGER NOT NULL DEFAULT 0,
    consumed_words INTEGER NOT NULL DEFAULT 0,
    remaining_snapshot_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS usage_events_actor_service_created_idx
    ON usage_events (actor_key, service_key, created_at DESC);

  CREATE INDEX IF NOT EXISTS usage_events_actor_created_idx
    ON usage_events (actor_key, created_at DESC);

  CREATE INDEX IF NOT EXISTS usage_events_status_created_idx
    ON usage_events (status, created_at DESC);
`);

/*
 * Existing runtime databases are migrated in place so quota fixes work across
 * restarts without forcing local or production data resets.
 */
const ensureUsageEventsColumn = (columnName, definition) => {
  const columns = db.prepare(`PRAGMA table_info(usage_events)`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE usage_events ADD COLUMN ${columnName} ${definition}`);
};

ensureUsageEventsColumn('billing_key', 'TEXT');

/*
 * The billing-key index must be created after any in-place schema upgrade,
 * otherwise older SQLite files fail startup before the new column exists.
 */
db.exec(`
  CREATE INDEX IF NOT EXISTS usage_events_actor_service_billing_idx
    ON usage_events (actor_key, service_key, billing_key, created_at DESC);
`);

/*
 * Older books runs billed both apply and preview-report calls separately.
 * This repair zeros only preview-report charges that share the same task id as
 * a successful books apply event, which restores remaining quota on upgrade.
 */
const repairLegacyBooksPreviewChargesStatement = db.prepare(`
  UPDATE usage_events
  SET
    consumed_requests = 0,
    consumed_words = 0
  WHERE operation_name = 'books_greek_editor_preview_report'
    AND status = 'success'
    AND consumed_words > 0
    AND COALESCE(task_id, '') <> ''
    AND EXISTS (
      SELECT 1
      FROM usage_events AS apply_event
      WHERE apply_event.actor_key = usage_events.actor_key
        AND apply_event.service_key = usage_events.service_key
        AND apply_event.task_id = usage_events.task_id
        AND apply_event.status = 'success'
        AND apply_event.operation_name = 'books_greek_editor_apply'
    )
`);

repairLegacyBooksPreviewChargesStatement.run();

const pruneOldEventsStatement = db.prepare(`
  DELETE FROM usage_events
  WHERE created_at < @cutoffAt
`);

const insertUsageEventStatement = db.prepare(`
  INSERT INTO usage_events (
    created_at,
    actor_type,
    actor_key,
    service_key,
    operation_name,
    plan_type,
    request_id,
    task_id,
    billing_key,
    status,
    consumed_requests,
    consumed_words,
    remaining_snapshot_json,
    metadata_json
  ) VALUES (
    @createdAt,
    @actorType,
    @actorKey,
    @serviceKey,
    @operationName,
    @planType,
    @requestId,
    @taskId,
    @billingKey,
    @status,
    @consumedRequests,
    @consumedWords,
    @remainingSnapshotJson,
    @metadataJson
  )
`);

const usageSummaryStatements = {
  daily: db.prepare(`
    SELECT
      COALESCE(SUM(consumed_requests), 0) AS totalRequests,
      COALESCE(SUM(consumed_words), 0) AS totalWords
    FROM usage_events
    WHERE actor_key = @actorKey
      AND service_key = @serviceKey
      AND status = 'success'
      AND created_at >= @startAt
      AND created_at < @endAt
  `),
  since: db.prepare(`
    SELECT
      COALESCE(SUM(consumed_requests), 0) AS totalRequests,
      COALESCE(SUM(consumed_words), 0) AS totalWords
    FROM usage_events
    WHERE actor_key = @actorKey
      AND service_key = @serviceKey
      AND status = 'success'
      AND created_at >= @startAt
  `),
  historyCount: db.prepare(`
    SELECT COUNT(*) AS total
    FROM usage_events
    WHERE actor_key = @actorKey
      AND (@serviceKey = '' OR service_key = @serviceKey)
      AND (@status = '' OR status = @status)
      AND created_at >= @startAt
  `),
  historyPage: db.prepare(`
    SELECT
      event_id AS eventId,
      created_at AS createdAt,
      service_key AS serviceKey,
      operation_name AS operationName,
      plan_type AS planType,
      request_id AS requestId,
      task_id AS taskId,
      billing_key AS billingKey,
      status,
      consumed_requests AS consumedRequests,
      consumed_words AS consumedWords,
      remaining_snapshot_json AS remainingSnapshotJson,
      metadata_json AS metadataJson
    FROM usage_events
    WHERE actor_key = @actorKey
      AND (@serviceKey = '' OR service_key = @serviceKey)
      AND (@status = '' OR status = @status)
      AND created_at >= @startAt
    ORDER BY created_at DESC, event_id DESC
    LIMIT @limit OFFSET @offset
  `),
  billingLookup: db.prepare(`
    SELECT
      consumed_requests AS consumedRequests,
      consumed_words AS consumedWords
    FROM usage_events
    WHERE actor_key = @actorKey
      AND service_key = @serviceKey
      AND billing_key = @billingKey
      AND status = 'success'
    ORDER BY created_at ASC, event_id ASC
    LIMIT 1
  `),
};

const parseJsonObject = (value) => {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const hashActorKey = (rawValue) =>
  createHash('sha256')
    .update(`${env.accessUsageHashSalt}:${String(rawValue || '')}`)
    .digest('hex');

const resolveRetentionCutoff = () => {
  const cutoffMs = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
};

export const pruneUsageHistory = () => {
  pruneOldEventsStatement.run({ cutoffAt: resolveRetentionCutoff() });
};

export const resolveHashedIpActorKey = (value) => `free:${hashActorKey(value)}`;

const sanitizeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const safe = {};
  Object.entries(metadata)
    .slice(0, 20)
    .forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined) {
        safe[key] = null;
        return;
      }

      if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
        safe[key] = rawValue;
        return;
      }

      if (Array.isArray(rawValue)) {
        safe[key] = rawValue.slice(0, 10).map((item) => String(item).slice(0, 120));
        return;
      }

      safe[key] = String(rawValue).slice(0, 220);
    });

  return safe;
};

const resolveUsageAnchor = (primaryValue, secondaryValue) => {
  const primaryMs = Date.parse(primaryValue || '');
  const secondaryMs = Date.parse(secondaryValue || '');

  if (Number.isFinite(primaryMs) && Number.isFinite(secondaryMs)) {
    return primaryMs >= secondaryMs ? primaryValue : secondaryValue;
  }

  if (Number.isFinite(primaryMs)) {
    return primaryValue;
  }

  if (Number.isFinite(secondaryMs)) {
    return secondaryValue;
  }

  return null;
};

export const buildServiceQuotaSnapshot = ({
  serviceKey,
  servicePolicy,
  usage,
  usageCycleStartedAt,
  usageResetAt = null,
  now = new Date(),
}) => {
  const policy = clonePolicy(servicePolicy);
  const dayWindow = getUtcDayWindow(now);
  const dailyUsedRequests = Number(usage?.dailyRequests || 0);
  const cycleUsedWords = Number(usage?.cycleWords || 0);
  const wordResetAnchor = resolveUsageAnchor(usageCycleStartedAt, usageResetAt);
  const snapshot = {
    serviceKey,
    policy,
    requests: {
      used: dailyUsedRequests,
      remaining: null,
      limit: null,
      resetAt: dayWindow.endAt,
      timezone: DAILY_RESET_TIMEZONE,
    },
    words: {
      used: cycleUsedWords,
      remaining: null,
      limit: null,
      resetAt: wordResetAnchor,
    },
  };

  if (Number.isInteger(policy?.requestsPerDay)) {
    snapshot.requests.limit = policy.requestsPerDay;
    snapshot.requests.remaining = Math.max(0, policy.requestsPerDay - dailyUsedRequests);
  }

  if (Number.isInteger(policy?.wordsTotal)) {
    snapshot.words.limit = policy.wordsTotal;
    snapshot.words.remaining = Math.max(0, policy.wordsTotal - cycleUsedWords);
  }

  if (policy?.kind === 'unlimited') {
    snapshot.requests.resetAt = dayWindow.endAt;
  }

  return snapshot;
};

export const getUsageTotals = ({
  actorKey,
  serviceKey,
  usageCycleStartedAt = new Date(0).toISOString(),
  usageResetAt = null,
  now = new Date(),
}) => {
  const dayWindow = getUtcDayWindow(now);
  const effectiveDailyStartAt =
    resolveUsageAnchor(dayWindow.startAt, usageResetAt) || dayWindow.startAt;
  const effectiveCycleStartAt =
    resolveUsageAnchor(usageCycleStartedAt || new Date(0).toISOString(), usageResetAt) ||
    new Date(0).toISOString();
  const daily = usageSummaryStatements.daily.get({
    actorKey,
    serviceKey,
    startAt: effectiveDailyStartAt,
    endAt: dayWindow.endAt,
  });
  const cycle = usageSummaryStatements.since.get({
    actorKey,
    serviceKey,
    startAt: effectiveCycleStartAt,
  });

  return {
    dailyRequests: Number(daily?.totalRequests || 0),
    dailyWords: Number(daily?.totalWords || 0),
    cycleRequests: Number(cycle?.totalRequests || 0),
    cycleWords: Number(cycle?.totalWords || 0),
  };
};

export const buildPlanServicesSummary = ({
  actorKey,
  planType,
  servicePolicies,
  usageCycleStartedAt = null,
  usageResetAt = null,
  now = new Date(),
}) =>
  ACCESS_SERVICE_KEY_LIST.map((serviceKey) => {
    const policy =
      planType === ACCESS_PLAN_TYPES.FREE
        ? FREE_ACCESS_SERVICE_POLICIES[serviceKey]
        : servicePolicies?.[serviceKey] || null;
    const usage = getUsageTotals({
      actorKey,
      serviceKey,
      usageCycleStartedAt,
      usageResetAt,
      now,
    });
    const quota = buildServiceQuotaSnapshot({
      serviceKey,
      servicePolicy: policy,
      usage,
      usageCycleStartedAt,
      usageResetAt,
      now,
    });

    return {
      serviceKey,
      enabled: Boolean(policy),
      policy,
      usage,
      quota,
    };
  });

export const assertServiceQuota = ({
  actorKey,
  serviceKey,
  servicePolicy,
  usageCycleStartedAt = null,
  usageResetAt = null,
  incomingRequests = 0,
  incomingWords = 0,
  billingKey = '',
  now = new Date(),
}) => {
  const policy = servicePolicy;
  if (!policy) {
    throw new ApiError(403, 'SERVICE_FORBIDDEN', 'Requested service is not enabled for this plan', {
      details: [{ field: 'x-service-token', issue: `Requested service ${serviceKey} is disabled` }],
    });
  }

  if (policy.kind === 'unlimited') {
    return buildServiceQuotaSnapshot({
      serviceKey,
      servicePolicy: policy,
      usage: getUsageTotals({ actorKey, serviceKey, usageCycleStartedAt, usageResetAt, now }),
      usageCycleStartedAt,
      usageResetAt,
      now,
    });
  }

  const usage = getUsageTotals({ actorKey, serviceKey, usageCycleStartedAt, usageResetAt, now });
  const existingCharge =
    billingKey && typeof billingKey === 'string'
      ? usageSummaryStatements.billingLookup.get({
          actorKey,
          serviceKey,
          billingKey,
        })
      : null;
  const billableRequests = existingCharge ? 0 : Math.max(0, incomingRequests);
  const billableWords = existingCharge ? 0 : Math.max(0, incomingWords);
  const nextDailyRequests = usage.dailyRequests + billableRequests;
  const nextCycleWords = usage.cycleWords + billableWords;

  if (Number.isInteger(policy.requestsPerDay) && nextDailyRequests > policy.requestsPerDay) {
    throw new ApiError(429, 'SERVICE_QUOTA_EXCEEDED', 'Daily service usage limit reached', {
      details: [
        {
          field: serviceKey,
          issue: `Daily limit is ${policy.requestsPerDay} successful requests`,
        },
      ],
    });
  }

  if (Number.isInteger(policy.wordsTotal) && nextCycleWords > policy.wordsTotal) {
    throw new ApiError(429, 'SERVICE_QUOTA_EXCEEDED', 'Word limit reached for this service plan', {
      details: [
        {
          field: serviceKey,
          issue: `Word limit is ${policy.wordsTotal} processed words`,
        },
      ],
    });
  }

  return buildServiceQuotaSnapshot({
    serviceKey,
    servicePolicy: policy,
    usage,
    usageCycleStartedAt,
    usageResetAt,
    now,
  });
};

export const resolveExistingUsageCharge = ({ actorKey, serviceKey, billingKey }) => {
  if (!billingKey) {
    return null;
  }

  const row = usageSummaryStatements.billingLookup.get({
    actorKey,
    serviceKey,
    billingKey,
  });

  return row
    ? {
        consumedRequests: Number(row.consumedRequests || 0),
        consumedWords: Number(row.consumedWords || 0),
      }
    : null;
};

export const recordUsageEvent = ({
  actorType,
  actorKey,
  serviceKey,
  operationName,
  planType,
  requestId = '',
  taskId = '',
  billingKey = '',
  status,
  consumedRequests = 0,
  consumedWords = 0,
  remainingSnapshot = {},
  metadata = {},
}) => {
  pruneUsageHistory();

  insertUsageEventStatement.run({
    createdAt: new Date().toISOString(),
    actorType,
    actorKey,
    serviceKey,
    operationName,
    planType,
    requestId: requestId || null,
    taskId: taskId || null,
    billingKey: billingKey || null,
    status,
    consumedRequests: Math.max(0, Number(consumedRequests) || 0),
    consumedWords: Math.max(0, Number(consumedWords) || 0),
    remainingSnapshotJson: JSON.stringify(remainingSnapshot || {}),
    metadataJson: JSON.stringify(sanitizeMetadata(metadata)),
  });
};

export const listUsageHistory = ({
  actorKey,
  serviceKey = '',
  status = '',
  page = 1,
  limit = 20,
}) => {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const startAt = resolveRetentionCutoff();
  const total = Number(
    usageSummaryStatements.historyCount.get({
      actorKey,
      serviceKey,
      status,
      startAt,
    })?.total || 0,
  );
  const rows = usageSummaryStatements.historyPage.all({
    actorKey,
    serviceKey,
    status,
    startAt,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
  });

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    count: rows.length,
    total,
    items: rows.map((row) => ({
      eventId: row.eventId,
      createdAt: row.createdAt,
      serviceKey: row.serviceKey,
      operationName: row.operationName,
      planType: row.planType,
      requestId: row.requestId,
      taskId: row.taskId,
      billingKey: row.billingKey || '',
      status: row.status,
      consumedRequests: Number(row.consumedRequests || 0),
      consumedWords: Number(row.consumedWords || 0),
      remaining: parseJsonObject(row.remainingSnapshotJson),
      metadata: parseJsonObject(row.metadataJson),
    })),
  };
};
