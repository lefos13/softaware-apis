/*
 * Token-aware middleware now distinguishes superadmin control-plane access
 * from service-token checks so admin routes and editor routes enforce the
 * correct header and capability without duplicating validation branches.
 */
import { ApiError } from '../../common/utils/api-error.js';
import { TOKEN_TYPES } from './admin-token.constants.js';
import { resolveStoredToken } from './admin-token.service.js';

const assertResolvedTokenUsable = (resolved, headerName, contextLabel) => {
  if (!resolved) {
    throw new ApiError(403, `${contextLabel}_AUTH_INVALID`, `${contextLabel} token is invalid`, {
      details: [{ field: headerName, issue: 'Token does not match any active token' }],
    });
  }

  if (resolved.status === 'hashed_input') {
    throw new ApiError(403, `${contextLabel}_AUTH_INVALID`, `${contextLabel} token is invalid`, {
      details: [
        {
          field: headerName,
          issue:
            'Stored token hash was provided; use the plaintext token emitted on create or renew',
        },
      ],
    });
  }

  if (resolved.status === 'expired') {
    throw new ApiError(403, `${contextLabel}_TOKEN_EXPIRED`, `${contextLabel} token has expired`, {
      details: [{ field: headerName, issue: 'Token lifetime ended' }],
    });
  }

  if (resolved.status === 'revoked') {
    throw new ApiError(
      403,
      `${contextLabel}_TOKEN_REVOKED`,
      `${contextLabel} token has been revoked`,
      {
        details: [{ field: headerName, issue: 'Token is no longer active' }],
      },
    );
  }
};

export const requireSuperAdminToken = (req, _res, next) => {
  try {
    const headerName = 'x-admin-token';
    const token = String(req.get(headerName) || '').trim();
    if (!token) {
      throw new ApiError(
        401,
        'ADMIN_AUTH_REQUIRED',
        'Superadmin token is required for this endpoint',
        {
          details: [{ field: headerName, issue: 'Missing superadmin token header' }],
        },
      );
    }

    const resolved = resolveStoredToken(token);
    assertResolvedTokenUsable(resolved, headerName, 'ADMIN');

    if (resolved.record.tokenType !== TOKEN_TYPES.SUPERADMIN) {
      throw new ApiError(403, 'ADMIN_FORBIDDEN', 'Superadmin token is required for this endpoint', {
        details: [{ field: headerName, issue: 'Access tokens cannot call admin endpoints' }],
      });
    }

    req.adminAuth = {
      tokenId: resolved.record.tokenId,
      tokenType: resolved.record.tokenType,
      alias: resolved.record.alias,
      expiresAt: resolved.record.expiresAt,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireServiceTokenAccess = (requiredServiceFlag) => (req, _res, next) => {
  try {
    const headerName = 'x-service-token';
    const token = String(req.get(headerName) || '').trim();
    if (!token) {
      throw new ApiError(
        401,
        'SERVICE_TOKEN_REQUIRED',
        'Service token is required for this endpoint',
        {
          details: [{ field: headerName, issue: 'Missing service token header' }],
        },
      );
    }

    const resolved = resolveStoredToken(token);
    assertResolvedTokenUsable(resolved, headerName, 'SERVICE');

    if (resolved.record.tokenType !== TOKEN_TYPES.ACCESS) {
      throw new ApiError(
        403,
        'SERVICE_TOKEN_INVALID',
        'Service token is invalid for this endpoint',
        {
          details: [
            {
              field: headerName,
              issue: 'Superadmin tokens cannot be used as editor access tokens',
            },
          ],
        },
      );
    }

    const serviceFlags = Array.isArray(resolved.record.serviceFlags)
      ? resolved.record.serviceFlags
      : [];
    if (!serviceFlags.includes(requiredServiceFlag)) {
      throw new ApiError(403, 'SERVICE_FORBIDDEN', 'Service token does not allow this API', {
        details: [{ field: headerName, issue: `Token must include ${requiredServiceFlag}` }],
      });
    }

    req.serviceAuth = {
      tokenId: resolved.record.tokenId,
      tokenType: resolved.record.tokenType,
      alias: resolved.record.alias,
      serviceFlags,
      expiresAt: resolved.record.expiresAt,
    };

    next();
  } catch (error) {
    next(error);
  }
};
