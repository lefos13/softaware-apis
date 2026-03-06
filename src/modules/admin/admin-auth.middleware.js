/*
 * Admin route protection is centralized to keep token validation, role checks,
 * and request-scoped auth context identical across all admin endpoints.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { resolveAdminToken } from './admin-token.service.js';

export const requireAdminToken = (req, _res, next) => {
  const token = String(req.get('x-admin-token') || '').trim();
  if (!token) {
    next(
      new ApiError(401, 'ADMIN_AUTH_REQUIRED', 'Admin token is required for this endpoint', {
        details: [{ field: 'x-admin-token', issue: 'Missing admin token header' }],
      }),
    );
    return;
  }

  const resolved = resolveAdminToken(token);
  if (!resolved) {
    next(
      new ApiError(403, 'ADMIN_AUTH_INVALID', 'Admin token is invalid', {
        details: [{ field: 'x-admin-token', issue: 'Token does not match any active admin token' }],
      }),
    );
    return;
  }

  /*
   * Stored token hashes can look like valid secrets in local JSON files, so
   * this branch points callers back to the one-time plaintext token value.
   */
  if (resolved.status === 'hashed_input') {
    next(
      new ApiError(403, 'ADMIN_AUTH_INVALID', 'Admin token is invalid', {
        details: [
          {
            field: 'x-admin-token',
            issue: 'Stored token hash was provided; use the plain token emitted by the CLI',
          },
        ],
      }),
    );
    return;
  }

  if (resolved.status === 'expired') {
    next(
      new ApiError(403, 'ADMIN_TOKEN_EXPIRED', 'Admin token has expired', {
        details: [{ field: 'x-admin-token', issue: 'Token lifetime ended' }],
      }),
    );
    return;
  }

  if (resolved.status === 'revoked') {
    next(
      new ApiError(403, 'ADMIN_TOKEN_REVOKED', 'Admin token has been revoked', {
        details: [{ field: 'x-admin-token', issue: 'Token is no longer active' }],
      }),
    );
    return;
  }

  req.adminAuth = {
    tokenId: resolved.record.tokenId,
    role: resolved.record.role,
    ownerId: resolved.record.ownerId,
    expiresAt: resolved.record.expiresAt,
  };

  next();
};

export const requireSuperAdminToken = (req, _res, next) => {
  if (req.adminAuth?.role !== 'superadmin') {
    next(
      new ApiError(403, 'ADMIN_FORBIDDEN', 'Superadmin token is required for this endpoint', {
        details: [{ field: 'x-admin-token', issue: 'Token role must be superadmin' }],
      }),
    );
    return;
  }

  next();
};
