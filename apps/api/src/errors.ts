/**
 * A single error shape for the whole API, so clients can branch on `code`
 * and translate on `messageKey` rather than pattern-matching English prose.
 */

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** i18n key the client renders. Falls back to `error.generic`. */
    readonly messageKey: string = 'error.generic',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, messageKey: this.messageKey, details: this.details },
    };
  }
}

export const badRequest = (msg: string, key = 'error.generic', details?: unknown) =>
  new ApiError(400, 'bad_request', msg, key, details);

export const unauthorized = (msg = 'Authentication required') =>
  new ApiError(401, 'unauthorized', msg, 'error.unauthorized');

export const forbidden = (msg = 'You do not have access to this resource') =>
  new ApiError(403, 'forbidden', msg, 'error.forbidden');

export const notFound = (what = 'Resource') =>
  new ApiError(404, 'not_found', `${what} not found`, 'error.notFound');

export const conflict = (msg: string, key = 'error.generic') =>
  new ApiError(409, 'conflict', msg, key);

export const tooManyRequests = (msg = 'Too many requests') =>
  new ApiError(429, 'rate_limited', msg, 'error.serverBusy');

export const serviceUnavailable = (msg: string, key = 'error.serverBusy') =>
  new ApiError(503, 'service_unavailable', msg, key);

/**
 * Maps a Postgres error onto the API surface.
 *
 * RLS denials arrive as either an empty result or a policy violation. Both
 * are reported as 403 — never as a 500, and never with the underlying SQL,
 * which would leak schema detail to an attacker.
 */
export function fromPostgrest(err: { code?: string; message?: string } | null): ApiError {
  if (!err) return new ApiError(500, 'internal', 'Unknown database error');
  switch (err.code) {
    case '23505': return conflict('That already exists');
    case '23503': return badRequest('Referenced record does not exist');
    case '23514': return badRequest(err.message ?? 'Value failed a validation rule');
    case '42501': return forbidden();
    case 'PGRST116': return notFound();
    default:
      return new ApiError(500, 'internal', 'Database request failed', 'error.generic');
  }
}
