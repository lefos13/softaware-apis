/**
 * Why this exists: shared response metadata keeps frontend troubleshooting
 * consistent across both success and error paths.
 */
import { randomUUID } from 'node:crypto';

export function buildResponseMeta(req, res) {
  const headerRequestId = req.get('x-request-id');
  const requestId = req.requestId || headerRequestId || randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  return {
    requestId,
    timestamp: new Date().toISOString(),
  };
}

export function sendSuccess(res, req, { statusCode = 200, message, data = {} }) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta: buildResponseMeta(req, res),
  });
}
