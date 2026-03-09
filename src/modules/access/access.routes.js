/*
 * Access routes give the frontend one contract for shared plan resolution and
 * self-service dashboard data before individual tools start processing files.
 */
import { Router } from 'express';
import { sendSuccess } from '../../common/utils/api-response.js';
import { requireTrustedClient } from '../../common/middleware/trusted-client.middleware.js';
import {
  ACCESS_PLAN_TYPES,
  ACCESS_SERVICE_KEY_LIST,
  FREE_ACCESS_SERVICE_POLICIES,
} from './access-policy.constants.js';
import { requireTokenDashboardAccess, resolveAccessCaller } from './access-plan.middleware.js';
import { buildPlanServicesSummary, listUsageHistory } from './access-usage.service.js';

const accessRouter = Router();

accessRouter.use(requireTrustedClient);

const parsePage = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const buildPlanPayload = (caller) => {
  const services = buildPlanServicesSummary({
    actorKey: caller.actorKey,
    planType: caller.planType,
    servicePolicies: caller.tokenRecord?.servicePolicies || {},
    usageCycleStartedAt: caller.usageCycleStartedAt,
    usageResetAt: caller.usageResetAt,
  });

  return {
    planType: caller.planType,
    token: caller.token,
    services,
    enabledServices:
      caller.planType === ACCESS_PLAN_TYPES.FREE
        ? ACCESS_SERVICE_KEY_LIST
        : services.filter((item) => item.enabled).map((item) => item.serviceKey),
    defaults: caller.planType === ACCESS_PLAN_TYPES.FREE ? FREE_ACCESS_SERVICE_POLICIES : null,
  };
};

accessRouter.get('/plan', (req, res, next) => {
  try {
    const caller = resolveAccessCaller(req);
    sendSuccess(res, req, {
      message:
        caller.planType === ACCESS_PLAN_TYPES.TOKEN
          ? 'Access token plan fetched successfully'
          : 'Free access plan fetched successfully',
      data: buildPlanPayload(caller),
    });
  } catch (error) {
    next(error);
  }
});

accessRouter.get('/dashboard', requireTokenDashboardAccess, (req, res, next) => {
  try {
    const caller = req.accessPlan;
    const page = parsePage(req.query.page, 1);
    const limit = Math.min(100, parsePage(req.query.limit, 20));
    const serviceKey = String(req.query.serviceKey || '').trim();
    const status = String(req.query.status || '').trim();
    const planPayload = buildPlanPayload(caller);
    const history = listUsageHistory({
      actorKey: caller.actorKey,
      serviceKey,
      status,
      page,
      limit,
    });

    sendSuccess(res, req, {
      message: 'Access dashboard fetched successfully',
      data: {
        token: caller.token,
        services: planPayload.services,
        history,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { accessRouter };
