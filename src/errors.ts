/**
 * Error hierarchy for the iCarry SDK.
 *
 * Every error thrown by the SDK is an instance of {@link ICarryError}, carries a
 * stable {@link ICarryError.code}, and — critically — is safe to log. Messages and
 * {@link ICarryError.details} are pre-redacted by the transport layer, so they never
 * contain passwords, bearer tokens, card numbers, CVVs, or URLs with sensitive query
 * parameters.
 *
 * @packageDocumentation
 */

/**
 * Stable, machine-readable category codes carried by every {@link ICarryError}.
 *
 * These identify the *kind* of SDK failure (configuration, network, timeout, …). They
 * are distinct from any error `code` returned by the iCarry API itself, which — when
 * present — is surfaced on {@link ICarryApiErrorDetails.code}.
 */
export const ERROR_CODES = {
  CONFIGURATION: 'CONFIGURATION',
  VALIDATION: 'VALIDATION',
  AUTHENTICATION: 'AUTHENTICATION',
  API: 'API',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  ABORT: 'ABORT',
  RESPONSE_PARSE: 'RESPONSE_PARSE',
} as const;

/** Union of the stable SDK error category codes. */
export type ICarryErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Safe, structured metadata attached to an {@link ICarryApiError}.
 *
 * All values are already redacted. `path` never includes the query string, so card
 * data passed as query parameters (see {@link ICarryApiError}) cannot leak here.
 */
export interface ICarryApiErrorDetails {
  /** HTTP status code of the failing response. */
  status?: number;
  /** HTTP method of the request. */
  method?: string;
  /** Request path **without** the query string. */
  path?: string;
  /** Machine-readable error code reported by the iCarry API, when present. */
  code?: string;
  /** Correlation/request id echoed by the API in a response header, when present. */
  requestId?: string;
  /** Redacted, safe representation of the parsed API error body. */
  details?: unknown;
}

/** Options accepted by every {@link ICarryError} constructor. */
export interface ICarryErrorOptions {
  /** The underlying error that caused this one (preserved as the native `cause`). */
  cause?: unknown;
  /** Safe structured metadata (primarily for {@link ICarryApiError}). */
  details?: ICarryApiErrorDetails;
}

/**
 * Abstract base class for all iCarry SDK errors.
 *
 * Uses `Object.setPrototypeOf(this, new.target.prototype)` so `instanceof` remains
 * reliable across the dual ESM/CJS build and downstream bundlers, and `new.target.name`
 * so every subclass reports the correct `name` without per-class boilerplate.
 */
export abstract class ICarryError extends Error {
  /** Stable SDK error category. */
  readonly code: ICarryErrorCode;

  /** Safe structured metadata, when available. */
  readonly details?: ICarryApiErrorDetails;

  protected constructor(message: string, code: ICarryErrorCode, options?: ICarryErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
    Object.setPrototypeOf(this, new.target.prototype);
    const err = Error as unknown as {
      captureStackTrace?: (targetObject: object, constructorOpt?: unknown) => void;
    };
    if (typeof err.captureStackTrace === 'function') {
      err.captureStackTrace(this, new.target);
    }
  }
}

/**
 * The client was constructed with invalid or contradictory options
 * (e.g. missing `baseUrl`, or both a static `token` and `password`).
 */
export class ICarryConfigurationError extends ICarryError {
  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.CONFIGURATION, options);
  }
}

/**
 * A caller-supplied argument failed lightweight client-side validation
 * (empty required string, negative dimension, out-of-range latitude, …).
 *
 * This never reflects a server-side business rule — those surface as {@link ICarryApiError}.
 */
export class ICarryValidationError extends ICarryError {
  /** The offending field, when identifiable. */
  readonly field?: string;

  constructor(message: string, field?: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.VALIDATION, options);
    if (field !== undefined) {
      this.field = field;
    }
  }
}

/**
 * Authentication could not be established or recovered — invalid credentials, a failed
 * token acquisition, or a `401` on a caller-supplied token the SDK cannot refresh.
 */
export class ICarryAuthenticationError extends ICarryError {
  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.AUTHENTICATION, options);
  }
}

/**
 * The iCarry API returned a non-2xx response. Inspect {@link ICarryApiError.status} and
 * {@link ICarryError.details} for the (redacted) specifics.
 */
export class ICarryApiError extends ICarryError {
  /** HTTP status code of the failing response. */
  readonly status?: number;

  /** Correlation/request id echoed by the API, when present. */
  readonly requestId?: string;

  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.API, options);
    if (options?.details?.status !== undefined) {
      this.status = options.details.status;
    }
    if (options?.details?.requestId !== undefined) {
      this.requestId = options.details.requestId;
    }
  }
}

/** The request never produced an HTTP response (DNS failure, connection reset, offline). */
export class ICarryNetworkError extends ICarryError {
  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.NETWORK, options);
  }
}

/** The request exceeded the configured `timeoutMs` and was aborted by the SDK. */
export class ICarryTimeoutError extends ICarryError {
  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.TIMEOUT, options);
  }
}

/** The request was aborted via a caller-supplied `AbortSignal`. */
export class ICarryAbortError extends ICarryError {
  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.ABORT, options);
  }
}

/** A response body could not be parsed as its declared content type. */
export class ICarryResponseParseError extends ICarryError {
  constructor(message: string, options?: ICarryErrorOptions) {
    super(message, ERROR_CODES.RESPONSE_PARSE, options);
  }
}
