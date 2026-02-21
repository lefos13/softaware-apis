/**
 * Why this exists: domain services throw a single operational error type with
 * status/code/details so middleware can emit frontend-friendly responses.
 */
export class ApiError extends Error {
  constructor(statusCode, code, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
  }
}
