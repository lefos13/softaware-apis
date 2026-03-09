/*
 * Access-plan middleware resolves paid tokens versus free IP plans once per
 * request so every service route can share the same quota and audit behavior.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { TOKEN_TYPES } from '../admin/admin-token.constants.js';
import { resolveStoredToken, toPublicTokenRecord } from '../admin/admin-token.service.js';
import { ACCESS_PLAN_TYPES, FREE_ACCESS_SERVICE_POLICIES } from './access-policy.constants.js';
import {
  assertServiceQuota,
  buildServiceQuotaSnapshot,
  getUsageTotals,
  recordUsageEvent,
  resolveExistingUsageCharge,
  resolveHashedIpActorKey,
} from './access-usage.service.js';

const SERVICE_TOKEN_HEADER = 'x-service-token';

const assertResolvedTokenUsable = (resolved, headerName) => {
  if (!resolved) {
    throw new ApiError(403, 'SERVICE_TOKEN_INVALID', 'Service token is invalid', {
      details: [{ field: headerName, issue: 'Token does not match any active access token' }],
    });
  }

  if (resolved.status === 'hashed_input') {
    throw new ApiError(403, 'SERVICE_TOKEN_INVALID', 'Service token is invalid', {
      details: [
        {
          field: headerName,
          issue:
            'Stored token hash was provided; use the plaintext token emitted on create or renew',
        },
      ],
    });
  }

  if (resolved.status === 'expired') {
    throw new ApiError(403, 'SERVICE_TOKEN_EXPIRED', 'Service token has expired', {
      details: [{ field: headerName, issue: 'Token lifetime ended' }],
    });
  }

  if (resolved.status === 'revoked') {
    throw new ApiError(403, 'SERVICE_TOKEN_REVOKED', 'Service token has been revoked', {
      details: [{ field: headerName, issue: 'Token is no longer active' }],
    });
  }
};

const resolveRequestIp = (req) => {
  const forwarded = String(req.get('x-forwarded-for') || '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean);

  return forwarded || String(req.ip || req.socket?.remoteAddress || 'unknown').trim() || 'unknown';
};

export const resolveAccessCaller = (req, { requireToken = false } = {}) => {
  const providedToken = String(req.get(SERVICE_TOKEN_HEADER) || '').trim();

  if (providedToken) {
    const resolved = resolveStoredToken(providedToken);
    assertResolvedTokenUsable(resolved, SERVICE_TOKEN_HEADER);

    if (resolved.record.tokenType !== TOKEN_TYPES.ACCESS) {
      throw new ApiError(
        403,
        'SERVICE_TOKEN_INVALID',
        'Service token is invalid for this endpoint',
        {
          details: [
            {
              field: SERVICE_TOKEN_HEADER,
              issue: 'Superadmin tokens cannot be used as access tokens',
            },
          ],
        },
      );
    }

    return {
      actorType: ACCESS_PLAN_TYPES.TOKEN,
      actorKey: String(resolved.record.tokenId),
      planType: ACCESS_PLAN_TYPES.TOKEN,
      token: toPublicTokenRecord(resolved.record),
      tokenRecord: resolved.record,
      usageCycleStartedAt: resolved.record.usageCycleStartedAt || resolved.record.createdAt || null,
      usageResetAt: resolved.record.usageResetAt || null,
    };
  }

  if (requireToken) {
    throw new ApiError(
      401,
      'SERVICE_TOKEN_REQUIRED',
      'Service token is required for this endpoint',
      {
        details: [{ field: SERVICE_TOKEN_HEADER, issue: 'Missing service token header' }],
      },
    );
  }

  return {
    actorType: ACCESS_PLAN_TYPES.FREE,
    actorKey: resolveHashedIpActorKey(resolveRequestIp(req)),
    planType: ACCESS_PLAN_TYPES.FREE,
    token: null,
    tokenRecord: null,
    usageCycleStartedAt: null,
    usageResetAt: null,
  };
};

/*
 * Route middleware preflights the relevant quota and records the eventual
 * response outcome with one compact usage snapshot for dashboard reporting.
 */
export const resolveServiceAccessPlan =
  (serviceKey, operationName, options = {}) =>
  (req, res, next) => {
    try {
      const caller = resolveAccessCaller(req);
      const billingKey = String(options.billingKeyResolver?.(req) || '').trim();
      const servicePolicy =
        caller.planType === ACCESS_PLAN_TYPES.TOKEN
          ? caller.tokenRecord?.servicePolicies?.[serviceKey] || null
          : FREE_ACCESS_SERVICE_POLICIES[serviceKey] || null;

      const quota = assertServiceQuota({
        actorKey: caller.actorKey,
        serviceKey,
        servicePolicy,
        usageCycleStartedAt: caller.usageCycleStartedAt,
        usageResetAt: caller.usageResetAt,
        incomingRequests: 1,
        incomingWords: 0,
        billingKey,
      });

      req.accessPlan = {
        ...caller,
        serviceKey,
        operationName,
        servicePolicy,
        quota,
        billingKey,
      };
      req.accessUsage = {
        consumedRequests: 1,
        consumedWords: 0,
        metadata: {},
      };

      res.once('finish', () => {
        if (!req.accessPlan) {
          return;
        }

        const status = res.statusCode >= 400 ? 'failed' : 'success';
        const requestedConsumption =
          status === 'success'
            ? {
                consumedRequests: Number(req.accessUsage?.consumedRequests || 0),
                consumedWords: Number(req.accessUsage?.consumedWords || 0),
              }
            : { consumedRequests: 0, consumedWords: 0 };
        const existingCharge =
          status === 'success'
            ? resolveExistingUsageCharge({
                actorKey: req.accessPlan.actorKey,
                serviceKey,
                billingKey: req.accessPlan.billingKey,
              })
            : null;
        const consumedRequests = existingCharge ? 0 : requestedConsumption.consumedRequests;
        const consumedWords = existingCharge ? 0 : requestedConsumption.consumedWords;
        const usageAfter = getUsageTotals({
          actorKey: req.accessPlan.actorKey,
          serviceKey,
          usageCycleStartedAt: req.accessPlan.usageCycleStartedAt,
          usageResetAt: req.accessPlan.usageResetAt,
        });
        const adjustedUsage = {
          ...usageAfter,
          dailyRequests: usageAfter.dailyRequests + consumedRequests,
          dailyWords: usageAfter.dailyWords + consumedWords,
          cycleRequests: usageAfter.cycleRequests + consumedRequests,
          cycleWords: usageAfter.cycleWords + consumedWords,
        };
        const remainingSnapshot = buildServiceQuotaSnapshot({
          serviceKey,
          servicePolicy,
          usage: adjustedUsage,
          usageCycleStartedAt: req.accessPlan.usageCycleStartedAt,
          usageResetAt: req.accessPlan.usageResetAt,
        });

        recordUsageEvent({
          actorType: req.accessPlan.actorType,
          actorKey: req.accessPlan.actorKey,
          serviceKey,
          operationName,
          planType: req.accessPlan.planType,
          requestId: req.requestId,
          taskId: req.taskId,
          billingKey: req.accessPlan.billingKey,
          status,
          consumedRequests,
          consumedWords,
          remainingSnapshot,
          metadata: {
            ...(req.accessUsage?.metadata || {}),
            usageBundled: Boolean(existingCharge),
          },
        });
      });

      next();
    } catch (error) {
      next(error);
    }
  };

export const requireTokenDashboardAccess = (req, _res, next) => {
  try {
    req.accessPlan = resolveAccessCaller(req, { requireToken: true });
    next();
  } catch (error) {
    next(error);
  }
};
