/**
 * Shared, framework-agnostic value objects and cross-cutting types used across the SDK.
 *
 * Resource-specific request/response types live next to their resource (e.g.
 * `resources/merchant.ts`); this module holds only the pieces reused by more than one
 * resource plus the transport-facing configuration types.
 *
 * @packageDocumentation
 */

/**
 * Accepts either a `number` or a `string` for money and measurement values.
 *
 * Strings are serialized to the wire verbatim (no rounding), which lets callers preserve
 * exact decimal representations for financial amounts where binary floating point would
 * otherwise introduce drift.
 */
export type NumericInput = number | string;

/**
 * Dimension unit. iCarry documents `"cm"` and `"inch"`; the open-ended union keeps
 * forward compatibility if the API accepts other values.
 */
export type DimensionUnit = 'cm' | 'inch' | (string & {});

/**
 * Package type. iCarry documentation shows `"parcel"`, `"documents"`, and `"Product"`
 * inconsistently; the open union avoids rejecting values the API may accept.
 */
export type PackageType = 'parcel' | 'documents' | 'Product' | (string & {});

/** A geographic coordinate. Latitude ∈ [-90, 90], longitude ∈ [-180, 180]. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Physical dimensions of a shipment or parcel. Units are per the iCarry account/config. */
export interface Dimensions {
  length: NumericInput;
  width: NumericInput;
  height: NumericInput;
}

/** {@link Dimensions} plus an explicit unit (used by the on-demand rate model). */
export interface DimensionsWithUnit extends Dimensions {
  unit?: DimensionUnit;
}

/** A single parcel line within a `ParcelDimensionsList`. */
export interface ParcelDimensions {
  quantity: number;
  weight: NumericInput;
  length: NumericInput;
  width: NumericInput;
  height: NumericInput;
}

/**
 * An open, read-only record used for iCarry responses whose exact schema is **not
 * verified** against a live tenant (the Postman "examples" for create/rate/track/confirm
 * endpoints are auto-generated echoes of the request, not real captured responses).
 *
 * The parsed body is returned as-is: read fields defensively and do not rely on any
 * particular property until confirmed against your account.
 */
export type ExtensibleResponse = { readonly [key: string]: unknown };

/** Alias of {@link ExtensibleResponse} for entity-shaped payloads. */
export type ICarryEntity = ExtensibleResponse;

/** Tunable transient-retry policy. All fields optional; unset fields use SDK defaults. */
export interface RetryOptions {
  /** Maximum number of retries after the initial attempt. */
  maxRetries?: number;
  /** Base backoff delay in milliseconds (grows exponentially with full jitter). */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay in milliseconds. */
  maxDelayMs?: number;
  /** HTTP statuses treated as transient/retryable (in addition to network failures). */
  retryableStatuses?: readonly number[];
}

/** Fully-resolved retry policy (no optional fields) used internally by the transport. */
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: readonly number[];
}

/**
 * Per-call options accepted by resource methods and the low-level {@link ICarryClient.request}.
 */
export interface RequestOptions {
  /** Caller-owned abort signal; combined with the SDK's own timeout signal. */
  signal?: AbortSignal;
  /** Overrides the client-level `timeoutMs` for this call only. */
  timeoutMs?: number;
  /** Extra headers merged over the defaults for this call (never mutates the input). */
  headers?: Record<string, string>;
  /**
   * Opt in to transient retry for an otherwise non-retried but side-effect-free call
   * (e.g. a rate estimate). Ignored for mutating operations, which are never retried.
   */
  retry?: boolean;
}

/**
 * Redacted, immutable snapshot of an outgoing request passed to {@link ICarryHooks.onRequest}.
 * Sensitive headers, body fields, and query parameters are already masked.
 */
export interface SafeRequestInfo {
  method: string;
  /** Full request URL with sensitive query parameters redacted. */
  url: string;
  /** Request path without the query string. */
  path: string;
  /** Redacted request headers (the `Authorization` value is never present). */
  headers: Record<string, string>;
  /** Redacted request body, when one was sent. */
  body?: unknown;
  /** 1-based attempt number (increments on retry / re-auth). */
  attempt: number;
}

/**
 * Redacted, immutable snapshot of a completed response passed to {@link ICarryHooks.onResponse}.
 */
export interface SafeResponseInfo {
  method: string;
  path: string;
  status: number;
  ok: boolean;
  durationMs: number;
  attempt: number;
  requestId?: string;
}

/** Event passed to {@link ICarryHooks.onRetry} immediately before a retry sleeps. */
export interface RetryEvent {
  method: string;
  path: string;
  /** The upcoming attempt number. */
  attempt: number;
  /** Delay before the retry fires, in milliseconds. */
  delayMs: number;
  /** Why the retry was scheduled. */
  reason: 'network' | 'status';
  /** HTTP status that triggered the retry, when `reason === 'status'`. */
  status?: number;
}

/** The phase in which a hook error occurred. */
export type HookPhase = 'request' | 'response' | 'retry';

/**
 * A sanitized, minimal representation of an error thrown by a hook. Passed to
 * {@link ICarryHooks.onHookError} instead of the raw thrown object so that sensitive values
 * embedded in a hook's error can never reach the error sink.
 */
export interface SafeHookError {
  name: string;
  /** Sanitized error message. */
  message: string;
  /** Safe error code, when the original error carried one. */
  code?: string;
}

/**
 * Optional observability hooks. Every hook receives **redacted, deep-frozen** data and its
 * throwing never fails the underlying request — hook errors are swallowed and, if provided,
 * routed (sanitized) to {@link ICarryHooks.onHookError}.
 */
export interface ICarryHooks {
  onRequest?(info: Readonly<SafeRequestInfo>): void | Promise<void>;
  onResponse?(info: Readonly<SafeResponseInfo>): void | Promise<void>;
  onRetry?(event: Readonly<RetryEvent>): void | Promise<void>;
  /**
   * Invoked (best-effort) when one of the other hooks throws. Receives a **sanitized**
   * {@link SafeHookError}, never the raw thrown object.
   */
  onHookError?(error: Readonly<SafeHookError>, phase: HookPhase): void;
}
