/*
 * Mutating-request throttling is isolated in one middleware so global
 * request caps stay predictable without affecting health/read-only traffic.
 */
import { ApiError } from '../utils/api-error.js';
import { env } from '../../config/env.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WINDOW_MS = 60 * 1000;
const counters = new Map();

const cleanupExpiredCounters = () => {
  const now = Date.now();

  for (const [key, state] of counters.entries()) {
    if (state.windowStartMs + WINDOW_MS <= now) {
      counters.delete(key);
    }
  }
};

const cleanupTimer = setInterval(cleanupExpiredCounters, 15 * 1000);
cleanupTimer.unref();

const buildKey = (req) => {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return ip || 'unknown';
};

export const mutatingRateLimitMiddleware = (req, res, next) => {
  if (!env.mutatingRateLimitEnabled || !MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const key = buildKey(req);
  const now = Date.now();
  const limit = Math.max(1, env.mutatingRateLimitPerMinute);

  let state = counters.get(key);
  if (!state || state.windowStartMs + WINDOW_MS <= now) {
    state = { count: 0, windowStartMs: now };
  }

  state.count += 1;
  counters.set(key, state);

  const resetAfterMs = Math.max(0, state.windowStartMs + WINDOW_MS - now);
  const remaining = Math.max(0, limit - state.count);

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAfterMs / 1000)));

  if (state.count > limit) {
    const retryAfterSeconds = Math.ceil(resetAfterMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));

    next(
      new ApiError(
        429,
        'RATE_LIMIT_EXCEEDED',
        `Too many requests from this IP. Try again in ${retryAfterSeconds} seconds.`,
        {
          details: [
            {
              field: 'ip',
              issue: `Limit is ${limit} mutating requests per minute`,
            },
            {
              field: 'retryAfterSeconds',
              issue: String(retryAfterSeconds),
            },
          ],
        },
      ),
    );
    return;
  }

  next();
};
