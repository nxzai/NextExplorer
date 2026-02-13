/**
 * Base Application Error class
 * All custom errors should extend this class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Distinguishes operational errors from programmer errors
    this.timestamp = new Date().toISOString();

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    const json = {
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
    };
    if (this.code) json.code = this.code;
    return json;
  }
}

/**
 * 400 Bad Request - for validation errors
 */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null, code = null) {
    super(message, 400, code);
    this.name = 'ValidationError';
    this.details = details || {};
  }

  toJSON() {
    return {
      ...super.toJSON(),
      details: this.details,
    };
  }
}

/**
 * 401 Unauthorized - for authentication errors
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'AUTH_REQUIRED') {
    super(message, 401, code);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 403 Forbidden - for authorization/permission errors
 */
class ForbiddenError extends AppError {
  constructor(message = 'Access denied', code = 'FORBIDDEN') {
    super(message, 403, code);
    this.name = 'ForbiddenError';
  }
}

/**
 * 404 Not Found - for missing resources
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, 404, code);
    this.name = 'NotFoundError';
  }
}

/**
 * 409 Conflict - for resource conflicts
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(message, 409, code);
    this.name = 'ConflictError';
  }
}

/**
 * 429 Too Many Requests - for rate limiting
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter = null, code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code);
    this.name = 'RateLimitError';
    this.details = retryAfter ? { retryAfter } : {};
  }

  toJSON() {
    return {
      ...super.toJSON(),
      details: this.details,
    };
  }
}

/**
 * 500 Internal Server Error - for unexpected server errors
 */
class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500);
    this.name = 'InternalError';
  }
}

/**
 * 415 Unsupported Media Type - for unsupported file types
 */
class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(message, 415);
    this.name = 'UnsupportedMediaTypeError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  UnsupportedMediaTypeError,
};
