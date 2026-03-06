/**
 * Why this exists: centralized normalization ensures upload/parser/service
 * failures produce safe payloads, task-state failures, and forensic reports.
 */
import { createHash } from 'node:crypto';
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

  if (req.originalUrl?.startsWith('/api/pdf/split')) {
    return {
      task: 'pdf_split',
      expectedOutcome: 'Generate one ZIP containing split PDF outputs',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      mode: req.body?.mode || null,
      splitOptionsProvided: Boolean(req.body?.splitOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/pdf/extract-to-docx')) {
    return {
      task: 'pdf_extract_docx',
      expectedOutcome: 'Generate one DOCX with extracted native and OCR text from uploaded PDF',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      extractOptionsProvided: Boolean(req.body?.extractOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/pdf/watermark')) {
    return {
      task: 'pdf_watermark',
      expectedOutcome: 'Generate one PDF with watermark text/image overlays',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      watermarkOptionsProvided: Boolean(req.body?.watermarkOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/pdf/page-numbers')) {
    return {
      task: 'pdf_page_numbers',
      expectedOutcome: 'Generate one PDF with page numbers or Bates numbering',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      pageNumberOptionsProvided: Boolean(req.body?.pageNumberOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/pdf/edit-pages')) {
    return {
      task: 'pdf_edit_pages',
      expectedOutcome: 'Generate one PDF with edited page order/rotation/selection',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      editPlanProvided: Boolean(req.body?.editPlan),
    };
  }

  if (req.originalUrl?.startsWith('/api/pdf/extract-text')) {
    return {
      task: 'pdf_extract_text',
      expectedOutcome: 'Generate TXT or ZIP output with extracted PDF text',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      textExtractOptionsProvided: Boolean(req.body?.textExtractOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/pdf/from-images')) {
    return {
      task: 'pdf_from_images',
      expectedOutcome: 'Generate one PDF where each uploaded image becomes a page',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
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

  if (req.originalUrl?.startsWith('/api/image/convert-preview')) {
    return {
      task: 'image_convert_preview',
      expectedOutcome: 'Generate one converted image preview',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      targetFormat: req.body?.targetFormat || null,
      conversionOptionsProvided: Boolean(req.body?.conversionOptions),
    };
  }

  if (req.originalUrl?.startsWith('/api/image/convert')) {
    return {
      task: 'image_convert',
      expectedOutcome: 'Generate one ZIP containing converted images',
      fileCount: Array.isArray(req.files) ? req.files.length : 0,
      targetFormat: req.body?.targetFormat || null,
      conversionOptionsProvided: Boolean(req.body?.conversionOptions),
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

  if (req.originalUrl?.startsWith('/api/utils/checksum')) {
    return {
      task: 'utils_checksum',
      expectedOutcome: 'Return SHA-256 hash and size for one uploaded file',
      fileCount: req.file ? 1 : 0,
    };
  }

  if (req.originalUrl?.startsWith('/api/utils/webhook-bin')) {
    return {
      task: 'utils_webhook_bin',
      expectedOutcome: 'Create or inspect a temporary webhook request bin',
      method: req.method,
    };
  }

  return {
    task: 'generic_api_request',
    expectedOutcome: 'Return successful API response for requested route',
  };
};

/*
 * Report snapshots are sanitized at write-time so admin diagnostics remain
 * useful without leaking raw credentials, PII, or large user payloads.
 */
const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[-_]?key|session)/i;

const sanitizeScalar = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  const text = String(value);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
};

const sanitizeValue = (value, depth = 0) => {
  if (depth > 4) {
    return '[truncated-depth]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out = {};
    const entries = Object.entries(value).slice(0, 50);
    for (const [key, nestedValue] of entries) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeValue(nestedValue, depth + 1);
      }
    }

    return out;
  }

  return sanitizeScalar(value);
};

const hashIp = (rawIp) => {
  const ip = String(rawIp || '').trim();
  if (!ip) {
    return null;
  }

  return createHash('sha256')
    .update(`${env.failureReportHashSalt}:${ip}`)
    .digest('hex')
    .slice(0, 18);
};

const resolveReportOwnerId = (req) => {
  if (req.adminAuth?.ownerId) {
    return String(req.adminAuth.ownerId);
  }

  const ownerIdFromHeader = String(req.get('x-owner-id') || '')
    .trim()
    .toLowerCase();
  if (!ownerIdFromHeader) {
    return 'public';
  }

  return ownerIdFromHeader
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
};

const safeQuerySnapshot = (query) => {
  if (!query || typeof query !== 'object') {
    return {};
  }

  return sanitizeValue(query);
};

const safeBodySnapshot = (body) => {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const allowedKeys = [
    'mode',
    'mergePlan',
    'splitOptions',
    'extractOptions',
    'watermarkOptions',
    'pageNumberOptions',
    'editPlan',
    'textExtractOptions',
    'advancedOptions',
    'targetFormat',
    'conversionOptions',
    'ttlSeconds',
  ];
  const snapshot = {};

  allowedKeys.forEach((key) => {
    if (Object.hasOwn(body, key)) {
      const value = body[key];

      snapshot[key] = sanitizeValue(value);
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
    mimeType: file.mimetype,
    sizeBytes: file.size,
    extension: String(file.originalname || '')
      .toLowerCase()
      .split('.')
      .pop(),
  }));
};

const safeSingleFileSnapshot = (file) => {
  if (!file || typeof file !== 'object') {
    return [];
  }

  return [
    {
      fieldName: file.fieldname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      extension: String(file.originalname || '')
        .toLowerCase()
        .split('.')
        .pop(),
    },
  ];
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
      ownerId: resolveReportOwnerId(req),
      operation: {
        method: req.method,
        path: req.originalUrl,
        intent: summarizeTaskIntent(req),
      },
      requestContext: {
        ipHash: hashIp(req.ip),
        userAgent: null,
        query: safeQuerySnapshot(req.query),
        body: safeBodySnapshot(req.body),
        uploadedFiles: [...safeFilesSnapshot(req.files), ...safeSingleFileSnapshot(req.file)],
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
