/*
 * Admin routes now expose token management for superadmins and keep failure
 * reports behind the same control-plane credential instead of access tokens.
 */
import { Router } from 'express';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ApiError } from '../../common/utils/api-error.js';
import { sendSuccess } from '../../common/utils/api-response.js';
import { buildPlanServicesSummary } from '../access/access-usage.service.js';
import { requireSuperAdminToken } from './admin-auth.middleware.js';
import {
  createAccessToken,
  extendAccessToken,
  getAccessTokenRecordById,
  listAccessTokens,
  parseTokenTtl,
  resetAccessTokenUsage,
  renewAccessToken,
  revokeAccessToken,
  updateAccessToken,
} from './admin-token.service.js';

const adminRouter = Router();
const failureLogsDir = resolve(process.cwd(), 'logs', 'failures');
const reportFilePattern = /^[A-Za-z0-9._-]+\.json$/;

const parseLimit = (rawLimit) => {
  if (rawLimit === undefined) {
    return 100;
  }

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new ApiError(400, 'INVALID_INPUT', 'limit query must be an integer from 1 to 500', {
      details: [{ field: 'limit', issue: 'Use a numeric value between 1 and 500' }],
    });
  }

  return parsed;
};

const resolveSafeReportPath = (fileName) => {
  const normalized = basename(String(fileName || '').trim());

  if (!reportFilePattern.test(normalized)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid report file name', {
      details: [{ field: 'fileName', issue: 'Only .json report files are allowed' }],
    });
  }

  const filePath = resolve(failureLogsDir, normalized);
  if (!filePath.startsWith(failureLogsDir)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid report path', {
      details: [{ field: 'fileName', issue: 'Path traversal is not allowed' }],
    });
  }

  return { normalized, filePath };
};

const parseReportFile = (filePath) => {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const toSafeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
};

const toSafeArray = (value) => (Array.isArray(value) ? value : []);

const sanitizeFailureDetails = (details) =>
  toSafeArray(details)
    .slice(0, 40)
    .map((item) => ({
      field: String(item?.field || 'unknown'),
      issue: String(item?.issue || 'Invalid input'),
    }));

const sanitizeReportForAdmin = (report, fileName) => {
  const operation = toSafeObject(report?.operation);
  const requestContext = toSafeObject(report?.requestContext);
  const failure = toSafeObject(report?.failure);
  const queryKeys = Object.keys(toSafeObject(requestContext.query));
  const bodyKeys = Object.keys(toSafeObject(requestContext.body));
  const uploadedFiles = toSafeArray(requestContext.uploadedFiles);
  const uploadedBytes = uploadedFiles.reduce((sum, item) => {
    const size = Number(item?.sizeBytes);
    return sum + (Number.isFinite(size) ? size : 0);
  }, 0);

  return {
    fileName,
    reportType: String(report?.reportType || 'request-failure'),
    ownerId: String(report?.ownerId || 'public'),
    createdAt: report?.createdAt || null,
    requestId: report?.requestId || null,
    taskId: report?.taskId || null,
    operation: {
      method: operation.method || null,
      path: operation.path || null,
      intentTask: operation?.intent?.task || null,
    },
    requestContext: {
      queryKeys,
      bodyKeys,
      uploadedFileCount: uploadedFiles.length,
      uploadedBytes,
      mimeTypes: [...new Set(uploadedFiles.map((item) => String(item?.mimeType || 'unknown')))],
    },
    failure: {
      statusCode: Number.isInteger(failure.statusCode) ? failure.statusCode : null,
      code: failure.code || null,
      message: failure.message || null,
      details: sanitizeFailureDetails(failure.details),
      isUnexpectedError: failure.isUnexpectedError === true,
    },
  };
};

const parseTokenPayload = (body) => {
  return {
    alias: body?.alias,
    servicePolicies: body?.servicePolicies,
    ttlSeconds: parseTokenTtl(body?.ttl || '30d'),
  };
};

adminRouter.use(requireSuperAdminToken);

adminRouter.get('/reports', (req, res, next) => {
  try {
    if (!existsSync(failureLogsDir)) {
      sendSuccess(res, req, {
        message: 'Failure reports fetched successfully',
        data: {
          count: 0,
          reports: [],
          viewerRole: 'superadmin',
        },
      });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const files = readdirSync(failureLogsDir)
      .filter((name) => reportFilePattern.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 1200);

    const reports = files.slice(0, limit).map((fileName) => {
      const filePath = resolve(failureLogsDir, fileName);
      const report = parseReportFile(filePath);
      const sanitized = sanitizeReportForAdmin(report, fileName);

      return {
        fileName: sanitized.fileName,
        reportType: sanitized.reportType,
        ownerId: sanitized.ownerId,
        createdAt: sanitized.createdAt,
        requestId: sanitized.requestId,
        taskId: sanitized.taskId,
        statusCode: sanitized.failure.statusCode,
        errorCode: sanitized.failure.code,
        message: sanitized.failure.message,
        method: sanitized.operation.method,
        path: sanitized.operation.path,
        intentTask: sanitized.operation.intentTask,
      };
    });

    sendSuccess(res, req, {
      message: 'Failure reports fetched successfully',
      data: {
        count: reports.length,
        reports,
        viewerRole: 'superadmin',
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/reports/:fileName', (req, res, next) => {
  try {
    const { normalized, filePath } = resolveSafeReportPath(req.params.fileName);

    if (!existsSync(filePath)) {
      throw new ApiError(404, 'REPORT_NOT_FOUND', `Report file "${normalized}" was not found`, {
        details: [{ field: 'fileName', issue: 'No report exists with this file name' }],
      });
    }

    const report = parseReportFile(filePath);

    sendSuccess(res, req, {
      message: 'Failure report fetched successfully',
      data: {
        fileName: normalized,
        report: sanitizeReportForAdmin(report, normalized),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/tokens', (req, res, next) => {
  try {
    const tokenData = listAccessTokens();
    const tokens = tokenData.tokens.map((tokenItem) => {
      const tokenRecord = getAccessTokenRecordById(tokenItem.tokenId);
      return {
        ...tokenItem,
        usageSummary: buildPlanServicesSummary({
          actorKey: tokenItem.tokenId,
          planType: 'token',
          servicePolicies: tokenRecord.servicePolicies,
          usageCycleStartedAt: tokenRecord.usageCycleStartedAt,
          usageResetAt: tokenRecord.usageResetAt,
        }).filter((serviceItem) => serviceItem.enabled),
      };
    });

    sendSuccess(res, req, {
      message: 'Access tokens fetched successfully',
      data: {
        ...tokenData,
        tokens,
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/tokens', (req, res, next) => {
  try {
    const payload = parseTokenPayload(req.body);
    const result = createAccessToken({
      ...payload,
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      statusCode: 201,
      message: 'Access token created successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/tokens/:tokenId', (req, res, next) => {
  try {
    const record = updateAccessToken({
      tokenId: req.params.tokenId,
      alias: req.body?.alias,
      servicePolicies: req.body?.servicePolicies,
    });

    sendSuccess(res, req, {
      message: 'Access token updated successfully',
      data: { record },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/tokens/:tokenId/revoke', (req, res, next) => {
  try {
    const record = revokeAccessToken({
      tokenId: req.params.tokenId,
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      message: 'Access token revoked successfully',
      data: { record },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/tokens/:tokenId/renew', (req, res, next) => {
  try {
    const ttlSeconds = parseTokenTtl(req.body?.ttl || '30d');
    const result = renewAccessToken({
      tokenId: req.params.tokenId,
      ttlSeconds,
      servicePolicies: req.body?.servicePolicies,
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      message: 'Access token renewed successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/tokens/:tokenId/extend', (req, res, next) => {
  try {
    const ttlSeconds = parseTokenTtl(req.body?.ttl || '30d');
    const record = extendAccessToken({
      tokenId: req.params.tokenId,
      ttlSeconds,
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      message: 'Access token extended successfully',
      data: { record },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/tokens/:tokenId/reset-usage', (req, res, next) => {
  try {
    const record = resetAccessTokenUsage({
      tokenId: req.params.tokenId,
    });

    sendSuccess(res, req, {
      message: 'Access token usage reset successfully',
      data: { record },
    });
  } catch (error) {
    next(error);
  }
});

export { adminRouter };
