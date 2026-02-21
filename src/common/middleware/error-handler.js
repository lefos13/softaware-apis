/**
 * Why this exists: centralized normalization ensures upload/parser/service
 * failures produce safe, predictable payloads the frontend can render directly.
 */
import multer from 'multer';
import { env } from '../../config/env.js';
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

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
    meta: buildResponseMeta(req, res),
  });
}

export function errorHandler(err, req, res, next) {
  void next;
  const normalized = normalizeError(err);
  const isUnexpectedError = normalized.statusCode >= 500 && normalized.isOperational !== true;

  const payload = {
    success: false,
    error: {
      code: normalized.code,
      message: isUnexpectedError ? 'Unexpected error occurred' : normalized.message,
    },
    meta: buildResponseMeta(req, res),
  };

  if (normalized.details?.length) {
    payload.error.details = normalized.details;
  }

  if (env.nodeEnv !== 'production' && normalized.stack) {
    payload.error.stack = normalized.stack;
  }

  res.status(normalized.statusCode).json(payload);
}
