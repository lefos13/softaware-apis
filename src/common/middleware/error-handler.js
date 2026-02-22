/**
 * Why this exists: centralized normalization ensures upload/parser/service
 * failures produce safe payloads, task-state failures, and forensic reports.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import multer from 'multer';
import { env } from '../../config/env.js';
import { failTaskProgress } from '../services/task-progress-store.js';
import { buildResponseMeta } from '../utils/api-response.js';

const mapMulterError = (err) => {
  if (!(err instanceof multer.MulterError)) {
    return null;
  }

  const byCode = {
    LIMIT_FILE_SIZE: {
      statusCode: 413,
      code: 'FILE_TOO_LARGE',
      message: 'One or more files exceed the allowed upload size',
    },
    LIMIT_FILE_COUNT: {
      statusCode: 400,
      code: 'TOO_MANY_FILES',
      message: 'Too many files uploaded',
    },
    LIMIT_UNEXPECTED_FILE: {
      statusCode: 400,
      code: 'UNEXPECTED_FILE_FIELD',
      message: 'Unexpected upload field. Use "files" for uploads',
    },
  };

  return (
    byCode[err.code] || {
      statusCode: 400,
      code: 'UPLOAD_VALIDATION_ERROR',
      message: err.message || 'Upload request is invalid',
    }
  );
};

const normalizeError = (err) => {
  const uploadError = mapMulterError(err);
  if (uploadError) {
    return {
      ...uploadError,
      details: err.field ? [{ field: err.field, issue: 'Invalid upload field' }] : undefined,
    };
  }

  if (err instanceof SyntaxError && Object.hasOwn(err, 'body')) {
    return {
      statusCode: 400,
      code: 'INVALID_JSON',
      message: 'Request body contains invalid JSON',
    };
  }

  return {
    statusCode: err.statusCode || err.status || 500,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'Unexpected error occurred',
    details: err.details,
    isOperational: err.isOperational,
    stack: err.stack,
  };
};

const summarizeTaskIntent = (req) => {
  if (req.originalUrl?.startsWith('/api/pdf/merge')) {
    return {
      task: 'pdf_merge',
      expectedOutcome: 'Generate one merged PDF download from uploaded PDFs',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      mergePlanProvided: Boolean(req.body?.mergePlan),
    };
  }

  if (req.originalUrl?.startsWith('/api/image/compress')) {
    return {
      task: 'image_compress',
      expectedOutcome: 'Generate one ZIP containing compressed images',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      mode: req.body?.mode || 'balanced',
      advancedOptionsProvided: Boolean(req.body?.advancedOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/tasks/')) {
    const fromParams = req.params?.taskId;
    const fromPath = req.originalUrl.split('/').filter(Boolean).pop() || null;

    return {
      task: 'task_progress_lookup',
      expectedOutcome: 'Return current progress details for the requested task id',
      taskId: fromParams || fromPath,
    };
  }

  return {
    task: 'generic_api_request',
    expectedOutcome: 'Return successful API response for requested route',
  };
};

const safeQuerySnapshot = (query) => {
  if (!query || typeof query !== 'object') {
    return {};
  }

  return { ...query };
};

const safeBodySnapshot = (body) => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const allowedKeys = ['mode', 'mergePlan', 'advancedOptions'];
  const snapshot = {};

  allowedKeys.forEach((key) => {
    if (Object.hasOwn(body, key)) {
      const value = body[key];

      if (typeof value === 'string' && value.length > 600) {
        snapshot[key] = `${value.slice(0, 600)}...`;
      } else {
        snapshot[key] = value;
      }
    }
  });

  return snapshot;
};

const safeFilesSnapshot = (files) => {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.slice(0, 100).map((file) => ({
    fieldName: file.fieldname,
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  }));
};

const writeFailureReport = (req, meta, normalized, isUnexpectedError) => {
  try {
    const logDir = resolve(process.cwd(), 'logs', 'failures');
    mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const fileName = `${timestamp.replace(/[:.]/g, '-')}-${meta.requestId}.json`;
    const filePath = resolve(logDir, fileName);

    const report = {
      reportType: 'request-failure',
      createdAt: timestamp,
      requestId: meta.requestId,
      taskId: req.taskId || req.get('x-task-id') || null,
      operation: {
        method: req.method,
        path: req.originalUrl,
        intent: summarizeTaskIntent(req),
      },
      requestContext: {
        ip: req.ip,
        userAgent: req.get('user-agent') || null,
        query: safeQuerySnapshot(req.query),
        body: safeBodySnapshot(req.body),
        uploadedFiles: safeFilesSnapshot(req.files),
      },
      failure: {
        statusCode: normalized.statusCode,
        code: normalized.code,
        message: normalized.message,
        details: normalized.details || [],
        isUnexpectedError,
        stack: env.nodeEnv !== 'production' ? normalized.stack : undefined,
      },
    };

    writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch {
    // Logging must never break the API response path.
  }
};

export function notFoundHandler(req, res) {
  const meta = buildResponseMeta(req, res);
  const normalized = {
    statusCode: 404,
    code: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    details: undefined,
  };

  writeFailureReport(req, meta, normalized, false);

  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
    meta,
  });
}

export function errorHandler(err, req, res, next) {
  void next;
  const normalized = normalizeError(err);
  const isUnexpectedError = normalized.statusCode >= 500 && normalized.isOperational !== true;
  const meta = buildResponseMeta(req, res);

  if (req.taskId) {
    failTaskProgress(req.taskId, {
      code: normalized.code,
      message: normalized.message,
      step: 'Task failed',
    });
  }

  writeFailureReport(req, meta, normalized, isUnexpectedError);

  const payload = {
    success: false,
    error: {
      code: normalized.code,
      message: isUnexpectedError ? 'Unexpected error occurred' : normalized.message,
    },
    meta,
  };

  if (normalized.details?.length) {
    payload.error.details = normalized.details;
  }

  if (env.nodeEnv !== 'production' && normalized.stack) {
    payload.error.stack = normalized.stack;
  }

  res.status(normalized.statusCode).json(payload);
}
