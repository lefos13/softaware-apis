/*
 * Report endpoints enforce token-based scope controls and return a sanitized
 * diagnostics view that avoids exposing sensitive request context values.
 */
import { Router } from 'express';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ApiError } from '../../common/utils/api-error.js';
import { sendSuccess } from '../../common/utils/api-response.js';
import { requireAdminToken, requireSuperAdminToken } from './admin-auth.middleware.js';
import {
  invalidateAllAdminTokens,
  listAdminTokens,
  revokeAdminTokens,
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

const toSafeArray = (value) => {
  return Array.isArray(value) ? value : [];
};

const sanitizeFailureDetails = (details) => {
  return toSafeArray(details)
    .slice(0, 40)
    .map((item) => ({
      field: String(item?.field || 'unknown'),
      issue: String(item?.issue || 'Invalid input'),
    }));
};

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

const canAccessReport = (adminAuth, report) => {
  if (adminAuth?.role === 'superadmin') {
    return true;
  }

  return String(report?.ownerId || 'public') === String(adminAuth?.ownerId || 'public');
};

adminRouter.use(requireAdminToken);

adminRouter.get('/reports', (req, res, next) => {
  try {
    if (!existsSync(failureLogsDir)) {
      sendSuccess(res, req, {
        message: 'Failure reports fetched successfully',
        data: {
          count: 0,
          reports: [],
        },
      });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const files = readdirSync(failureLogsDir)
      .filter((name) => reportFilePattern.test(name))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 1200);

    const reports = [];

    for (const fileName of files) {
      const filePath = resolve(failureLogsDir, fileName);
      const report = parseReportFile(filePath);

      if (!canAccessReport(req.adminAuth, report)) {
        continue;
      }

      const sanitized = sanitizeReportForAdmin(report, fileName);
      reports.push({
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
      });

      if (reports.length >= limit) {
        break;
      }
    }

    sendSuccess(res, req, {
      message: 'Failure reports fetched successfully',
      data: {
        count: reports.length,
        reports,
        viewerRole: req.adminAuth?.role || 'admin',
        viewerOwnerId: req.adminAuth?.ownerId || 'public',
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
    if (!canAccessReport(req.adminAuth, report)) {
      throw new ApiError(403, 'ADMIN_FORBIDDEN', 'Report is outside your token scope', {
        details: [{ field: 'ownerId', issue: 'Token owner does not match report owner scope' }],
      });
    }

    const sanitized = sanitizeReportForAdmin(report, normalized);

    sendSuccess(res, req, {
      message: 'Failure report fetched successfully',
      data: {
        fileName: normalized,
        report: sanitized,
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/tokens', requireSuperAdminToken, (req, res, next) => {
  try {
    const result = listAdminTokens({
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      message: 'Admin tokens fetched successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/*
 * Bulk token revocation keeps superadmin session control granular so one or
 * many compromised admin sessions can be removed without a full reset.
 */
adminRouter.post('/tokens/revoke', requireSuperAdminToken, (req, res, next) => {
  try {
    const result = revokeAdminTokens({
      tokenIds: req.body?.tokenIds,
      reason: 'superadmin_revoke_selected',
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      message: 'Selected admin tokens revoked successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/tokens/invalidate-all', requireSuperAdminToken, (req, res, next) => {
  try {
    const result = invalidateAllAdminTokens({
      reason: 'superadmin_invalidate_all',
      actorTokenId: req.adminAuth?.tokenId || null,
    });

    sendSuccess(res, req, {
      message: 'All admin tokens invalidated successfully',
      data: {
        invalidated: result.invalidated,
        revokedAt: result.revokedAt,
        invalidatedByTokenId: req.adminAuth?.tokenId || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { adminRouter };
