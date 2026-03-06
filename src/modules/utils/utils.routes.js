/*
 * Utility endpoints expose small, low-cost tools (checksum and webhook bin)
 * behind the same validation and response envelope used by other modules.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { ApiError } from '../../common/utils/api-error.js';
import { sendSuccess } from '../../common/utils/api-response.js';
import { env } from '../../config/env.js';
import {
  appendWebhookBinRequest,
  createWebhookBin,
  getWebhookBinRequests,
} from './webhook-bin.store.js';

const utilsRouter = Router();

const checksumUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: env.maxFileSizeBytes,
  },
});

const parseOptionalJsonObject = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  return null;
};

utilsRouter.post('/checksum', checksumUpload.single('file'), (req, res, next) => {
  try {
    const file = req.file;
    if (!file || !file.buffer?.length) {
      throw new ApiError(400, 'INVALID_INPUT', 'Upload one file in field "file"', {
        details: [{ field: 'file', issue: 'A single file is required' }],
      });
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    sendSuccess(res, req, {
      message: 'Checksum computed successfully',
      data: {
        sha256,
        sizeBytes: file.size,
        fileName: file.originalname || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

utilsRouter.post('/webhook-bin', (req, res, next) => {
  try {
    const ttlSeconds = Number.parseInt(req.body?.ttlSeconds, 10);
    const created = createWebhookBin({
      ttlSeconds: Number.isInteger(ttlSeconds) ? ttlSeconds : undefined,
    });

    sendSuccess(res, req, {
      statusCode: 201,
      message: 'Webhook bin created successfully',
      data: created,
    });
  } catch (error) {
    next(error);
  }
});

utilsRouter.post('/webhook-bin/:id', (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      throw new ApiError(400, 'INVALID_INPUT', 'webhook bin id is required', {
        details: [{ field: 'id', issue: 'Missing webhook bin id path parameter' }],
      });
    }

    const secret = String(req.get('x-bin-secret') || '').trim();
    const contentLength = Number.parseInt(req.get('content-length') || '0', 10);
    if (Number.isInteger(contentLength) && contentLength > env.webhookBinMaxPayloadBytes) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Webhook bin payload exceeds configured limit', {
        details: [
          {
            field: 'content-length',
            issue: `Payload must be <= ${env.webhookBinMaxPayloadBytes} bytes`,
          },
        ],
      });
    }

    const bodySnapshot = parseOptionalJsonObject(req.body) || {
      rawType: typeof req.body,
      rawValue:
        typeof req.body === 'string' && req.body.length > 800
          ? `${req.body.slice(0, 800)}...`
          : (req.body ?? null),
    };

    const entry = {
      receivedAt: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      query: req.query || {},
      body: bodySnapshot,
      headers: {
        'content-type': req.get('content-type') || null,
        'user-agent': req.get('user-agent') || null,
      },
    };

    const stored = appendWebhookBinRequest({
      id,
      secret,
      entry,
    });

    sendSuccess(res, req, {
      message: 'Webhook request stored successfully',
      data: {
        id,
        storedEntries: stored.storedEntries,
        expiresAt: stored.expiresAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

utilsRouter.get('/webhook-bin/:id', (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      throw new ApiError(400, 'INVALID_INPUT', 'webhook bin id is required', {
        details: [{ field: 'id', issue: 'Missing webhook bin id path parameter' }],
      });
    }

    const secret = String(req.get('x-bin-secret') || '').trim();
    const data = getWebhookBinRequests({
      id,
      secret,
      limit: req.query?.limit,
    });

    sendSuccess(res, req, {
      message: 'Webhook bin fetched successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
});

export { utilsRouter };
