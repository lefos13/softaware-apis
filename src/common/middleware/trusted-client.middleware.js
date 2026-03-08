/*
 * Public service routes stay open in non-production, while production can
 * restrict browser access to configured client origins instead of tokens.
 */
import { ApiError } from '../utils/api-error.js';
import { env } from '../../config/env.js';

const normalizeOrigin = (value) =>
  String(value || '')
    .trim()
    .replace(/\/$/, '');

const resolveRequestOrigin = (req) => {
  const originHeader = normalizeOrigin(req.get('origin'));
  if (originHeader) {
    return originHeader;
  }

  const referer = String(req.get('referer') || '').trim();
  if (!referer) {
    return '';
  }

  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return '';
  }
};

export const requireTrustedClient = (req, _res, next) => {
  try {
    if (env.nodeEnv !== 'production') {
      next();
      return;
    }

    if (env.trustedClientOrigins.length === 0) {
      throw new ApiError(
        503,
        'CLIENT_GUARD_MISCONFIGURED',
        'Trusted client guard is not configured for production',
        {
          details: [
            {
              field: 'TRUSTED_CLIENT_ORIGINS',
              issue: 'Configure one or more allowed client origins for production access',
            },
          ],
        },
      );
    }

    const requestOrigin = resolveRequestOrigin(req);
    if (!requestOrigin || !env.trustedClientOrigins.includes(requestOrigin)) {
      throw new ApiError(403, 'CLIENT_FORBIDDEN', 'This client is not allowed to call the API', {
        details: [
          {
            field: 'origin',
            issue: 'Request origin is not in the trusted client allowlist',
          },
        ],
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};
