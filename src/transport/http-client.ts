/**
 * The HTTP transport orchestrator.
 *
 * A single {@link HttpClient.request} drives the full request lifecycle for every resource:
 * lazy/deduped auth → normalized header assembly (never mutating caller input) → fetch with
 * a combined timeout/abort signal → content-type-driven parsing → deep-frozen redacted hooks
 * → sanitized typed-error mapping → bounded transient retry → one-time ownership-gated `401`
 * re-auth.
 *
 * @packageDocumentation
 */

import {
  ICarryApiError,
  ICarryAuthenticationError,
  ICarryNetworkError,
  ICarryTimeoutError,
  ICarryAbortError,
  ICarryResponseParseError,
  ICarryError,
  type ICarryApiErrorDetails,
} from '../errors';
import type {
  ICarryHooks,
  RetryPolicy,
  SafeRequestInfo,
  SafeResponseInfo,
  RetryEvent,
} from '../types';
import { API_PREFIX } from '../constants';
import { TokenManager } from './token-manager';
import { joinPath, sanitizePathForMetadata } from './url';
import { buildQuery, type QueryParams } from './query';
import { parseResponse, type Expect, type ParsedResponse } from './response-parser';
import { redact, redactUrl, redactString, sanitizeErrorCause } from './redaction';
import { deepFreeze } from './freeze';
import { isRetryableStatus, isTransientError, parseRetryAfter, computeDelay } from './retry';
import { runRequestHook, runResponseHook, runRetryHook } from './hooks';

/** The subset of `fetch` the SDK relies on. Any compatible implementation may be injected. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A single request description handed to {@link HttpClient.request}. */
export interface RequestSpec {
  method: 'GET' | 'POST';
  /** Endpoint path relative to the API prefix (leading slash optional). No query/fragment. */
  path: string;
  query?: QueryParams;
  body?: unknown;
  /** Whether a bearer token is required. Defaults to `true`. */
  auth?: boolean;
  /** Whether the call may be transiently retried. Defaults to `false` (mutating-safe). */
  retryable?: boolean;
  /** Response parse strategy. Defaults to `'json'`. */
  expect?: Expect;
  /** Caller abort signal, combined with the SDK's timeout. */
  signal?: AbortSignal;
  /** Per-call timeout override in milliseconds. */
  timeoutMs?: number;
  /** Extra headers merged over defaults (never mutates the input object). */
  headers?: Record<string, string>;
}

/** Dependencies injected into the {@link HttpClient}. */
export interface HttpClientDeps {
  baseUrl: string;
  fetch: FetchLike;
  timeoutMs: number;
  tokenManager: TokenManager;
  retryPolicy: RetryPolicy;
  hooks: ICarryHooks;
  defaultHeaders: Record<string, string>;
  userAgent: string;
  autoReauth: boolean;
  redactEmail: boolean;
}

const REQUEST_ID_HEADERS = ['x-request-id', 'x-correlation-id', 'request-id', 'x-amzn-requestid'];
const MAX_ERROR_MESSAGE_LENGTH = 500;

export class HttpClient {
  /** Runtime-private so transport dependencies (incl. auth state) resist accidental inspection. */
  readonly #deps: HttpClientDeps;

  constructor(deps: HttpClientDeps) {
    this.#deps = deps;
  }

  /** Executes a request and returns the unwrapped body (`json`/`text`/`binary`/`undefined`). */
  async request<T>(spec: RequestSpec): Promise<T> {
    const parsed = await this.execute(spec);
    return unwrap<T>(parsed);
  }

  /** Executes a request and returns the full parsed response (used for binary/ambiguous bodies). */
  requestRaw(spec: RequestSpec): Promise<ParsedResponse> {
    return this.execute(spec);
  }

  /** Safe JSON representation — never exposes transport dependencies or auth state. */
  toJSON(): Record<string, unknown> {
    return { name: 'HttpClient', baseUrl: this.#deps.baseUrl };
  }

  /** Node's `util.inspect` hook (well-known symbol; no `node:util` import needed). */
  [Symbol.for('nodejs.util.inspect.custom')](): Record<string, unknown> {
    return this.toJSON();
  }

  private async execute(spec: RequestSpec): Promise<ParsedResponse> {
    const method = spec.method;
    const needsAuth = spec.auth !== false;
    const expect: Expect = spec.expect ?? 'json';
    const timeoutMs = spec.timeoutMs ?? this.#deps.timeoutMs;
    const fullUrl = joinPath(this.#deps.baseUrl, API_PREFIX, spec.path) + buildQuery(spec.query);
    // Metadata path is always stripped of any query/fragment, even if an internal spec.path
    // erroneously contained one — belt-and-suspenders against query-string leakage.
    const path = sanitizePathForMetadata(joinPath('', API_PREFIX, spec.path));
    const policy = this.#deps.retryPolicy;

    let attempt = 0;
    let triedReauth = false;

    for (;;) {
      attempt += 1;

      let token: string | undefined;
      if (needsAuth) {
        token = await this.acquireToken();
      }

      const headers = this.buildHeaders(spec, token, spec.body !== undefined, expect);
      const controller = new AbortController();
      const state = { timedOut: false };
      const timeoutId = setTimeout(() => {
        state.timedOut = true;
        controller.abort();
      }, timeoutMs);
      const detach = linkSignal(spec.signal, controller);
      const startedAt = Date.now();

      await runRequestHook(
        this.#deps.hooks,
        this.buildRequestInfo(method, fullUrl, path, headers, spec.body, attempt)
      );

      let parsed: ParsedResponse;
      try {
        const init: RequestInit = { method, headers, signal: controller.signal };
        if (spec.body !== undefined) {
          init.body = JSON.stringify(spec.body);
        }
        const res = await this.#deps.fetch(fullUrl, init);
        parsed = await parseResponse(res, expect);
      } catch (error) {
        clearTimeout(timeoutId);
        detach();
        if (error instanceof ICarryResponseParseError) {
          throw error;
        }
        const mapped = this.mapTransportError(error, state.timedOut, spec.signal, timeoutMs);
        if (
          mapped instanceof ICarryNetworkError &&
          spec.retryable === true &&
          attempt <= policy.maxRetries &&
          isTransientError(error)
        ) {
          const delay = computeDelay(attempt, policy);
          await this.emitRetry(method, path, attempt + 1, delay, 'network');
          await sleep(delay, spec.signal);
          continue;
        }
        throw mapped;
      }
      clearTimeout(timeoutId);
      detach();

      const durationMs = Date.now() - startedAt;
      const requestId = extractRequestId(parsed.headers);
      await runResponseHook(
        this.#deps.hooks,
        this.buildResponseInfo(method, path, parsed, durationMs, attempt, requestId)
      );

      if (parsed.ok) {
        return parsed;
      }

      // One-time, ownership-gated re-auth on 401 — a budget separate from transient retry.
      if (
        parsed.status === 401 &&
        needsAuth &&
        !triedReauth &&
        this.#deps.autoReauth &&
        this.#deps.tokenManager.ownsToken()
      ) {
        triedReauth = true;
        this.#deps.tokenManager.invalidate(token);
        continue;
      }

      // Transient retry on retryable statuses, for opted-in idempotent calls only.
      if (
        spec.retryable === true &&
        attempt <= policy.maxRetries &&
        isRetryableStatus(parsed.status, policy)
      ) {
        const retryAfter = parseRetryAfter(parsed.headers);
        const delay = computeDelay(attempt, policy, retryAfter);
        await this.emitRetry(method, path, attempt + 1, delay, 'status', parsed.status);
        await sleep(delay, spec.signal);
        continue;
      }

      throw this.buildResponseError(parsed, method, path, requestId);
    }
  }

  private async acquireToken(): Promise<string> {
    try {
      return await this.#deps.tokenManager.getToken();
    } catch (error) {
      if (error instanceof ICarryAuthenticationError) {
        throw error;
      }
      const message =
        error instanceof ICarryError
          ? redactString(error.message)
          : 'Failed to acquire an iCarry authentication token';
      throw new ICarryAuthenticationError(message, { cause: sanitizeErrorCause(error) });
    }
  }

  /**
   * Builds request headers with case-insensitive de-duplication (exactly one effective value
   * per header name). Precedence, lowest to highest: SDK defaults (`Accept`, `User-Agent`,
   * overridable) → client `defaultHeaders` → per-call headers → SDK-controlled `Content-Type`
   * (for JSON bodies) and `Authorization` (when auth is enabled). SDK-controlled headers win
   * last, so a caller cannot override the bearer token or create a second `Authorization`.
   * Never mutates the caller's header objects.
   */
  private buildHeaders(
    spec: RequestSpec,
    token: string | undefined,
    hasBody: boolean,
    expect: Expect
  ): Record<string, string> {
    const accept =
      expect === 'binary' || expect === 'auto'
        ? 'application/pdf, application/json;q=0.9, */*;q=0.1'
        : 'application/json';

    // lowercase name -> [display name, value]
    const map = new Map<string, [string, string]>();
    const put = (name: string, value: string): void => {
      map.set(name.toLowerCase(), [name, value]);
    };

    put('Accept', accept);
    put('User-Agent', this.#deps.userAgent);
    for (const [name, value] of Object.entries(this.#deps.defaultHeaders)) {
      put(name, value);
    }
    if (spec.headers) {
      for (const [name, value] of Object.entries(spec.headers)) {
        put(name, value);
      }
    }
    // SDK-controlled, highest precedence:
    if (hasBody) {
      put('Content-Type', 'application/json');
    }
    if (token !== undefined) {
      put('Authorization', `Bearer ${token}`);
    }

    const out: Record<string, string> = {};
    for (const [displayName, value] of map.values()) {
      out[displayName] = value;
    }
    return out;
  }

  private buildRequestInfo(
    method: string,
    fullUrl: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
    attempt: number
  ): Readonly<SafeRequestInfo> {
    const opts = { redactEmail: this.#deps.redactEmail };
    const info: SafeRequestInfo = {
      method,
      url: redactUrl(fullUrl),
      path,
      headers: redact({ ...headers }, opts),
      attempt,
    };
    if (body !== undefined) {
      info.body = redact(body, opts);
    }
    return deepFreeze(info);
  }

  private buildResponseInfo(
    method: string,
    path: string,
    parsed: ParsedResponse,
    durationMs: number,
    attempt: number,
    requestId: string | undefined
  ): Readonly<SafeResponseInfo> {
    const info: SafeResponseInfo = {
      method,
      path,
      status: parsed.status,
      ok: parsed.ok,
      durationMs,
      attempt,
    };
    if (requestId !== undefined) {
      info.requestId = requestId;
    }
    return deepFreeze(info);
  }

  private mapTransportError(
    error: unknown,
    timedOut: boolean,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): ICarryError {
    const name =
      typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    if (name === 'AbortError') {
      if (timedOut) {
        return new ICarryTimeoutError(`Request timed out after ${timeoutMs}ms`, {
          cause: sanitizeErrorCause(error),
        });
      }
      if (signal?.aborted === true) {
        return new ICarryAbortError('Request was aborted by the caller', {
          cause: sanitizeErrorCause(error),
        });
      }
      return new ICarryAbortError('Request was aborted', { cause: sanitizeErrorCause(error) });
    }
    const detail = error instanceof Error ? redactString(error.message) : 'unknown network failure';
    return new ICarryNetworkError(`Network request failed: ${detail}`, {
      cause: sanitizeErrorCause(error),
    });
  }

  private buildResponseError(
    parsed: ParsedResponse,
    method: string,
    path: string,
    requestId: string | undefined
  ): ICarryError {
    const { message, code, body } = interpretErrorBody(parsed);
    const safeMessage = redactString(message);
    const details: ICarryApiErrorDetails = { status: parsed.status, method, path };
    if (code !== undefined) {
      details.code = redactString(code);
    }
    if (requestId !== undefined) {
      details.requestId = requestId;
    }
    if (body !== undefined) {
      details.details =
        typeof body === 'string'
          ? redactString(body)
          : redact(body, { redactEmail: this.#deps.redactEmail, sanitizeStrings: true });
    }
    // A 401 that reached this point could not be recovered (unowned or already retried);
    // surface it as an authentication error for ergonomic `instanceof` narrowing.
    if (parsed.status === 401) {
      return new ICarryAuthenticationError(safeMessage, { details });
    }
    return new ICarryApiError(safeMessage, { details });
  }

  private async emitRetry(
    method: string,
    path: string,
    attempt: number,
    delayMs: number,
    reason: 'network' | 'status',
    status?: number
  ): Promise<void> {
    const event: RetryEvent = { method, path, attempt, delayMs, reason };
    if (status !== undefined) {
      event.status = status;
    }
    await runRetryHook(this.#deps.hooks, deepFreeze(event));
  }
}

function unwrap<T>(parsed: ParsedResponse): T {
  switch (parsed.kind) {
    case 'json':
      return parsed.json as T;
    case 'text':
      return parsed.text as unknown as T;
    case 'binary':
      return parsed.binary as unknown as T;
    case 'empty':
      return undefined as unknown as T;
  }
}

function extractRequestId(headers: Headers): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : value;
}

/** Extracts a (not-yet-sanitized) message/code from a non-2xx body (ProblemDetails or string). */
function interpretErrorBody(parsed: ParsedResponse): {
  message: string;
  code?: string;
  body?: unknown;
} {
  const fallback = `iCarry API request failed (HTTP ${parsed.status})`;
  if (parsed.kind === 'text') {
    const text = parsed.text.trim();
    return { message: text ? truncate(text) : fallback, body: parsed.text };
  }
  if (parsed.kind === 'json') {
    const json = parsed.json;
    if (typeof json === 'string') {
      return { message: json ? truncate(json) : fallback, body: json };
    }
    if (json !== null && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      const message = firstString(obj, ['Detail', 'detail', 'Title', 'title', 'message', 'error']);
      const code = firstString(obj, ['code', 'Code', 'errorCode', 'ErrorCode', 'Type']);
      const result: { message: string; code?: string; body?: unknown } = {
        message: message ? truncate(message) : fallback,
        body: json,
      };
      if (code !== undefined) {
        result.code = code;
      }
      return result;
    }
    return { message: fallback, body: json };
  }
  return { message: fallback };
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Links a caller signal to our controller; returns a detach function. */
function linkSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

/** A cancellable sleep that rejects with {@link ICarryAbortError} if the caller aborts. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ICarryAbortError('Request was aborted by the caller'));
      return;
    }
    const cleanup = (): void => {
      clearTimeout(id);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new ICarryAbortError('Request was aborted by the caller'));
    };
    const id = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
