/**
 * Client configuration: the public options object and its normalization/validation into a
 * fully-resolved internal configuration (including the resolved authentication mode).
 *
 * @packageDocumentation
 */

import { ICarryConfigurationError } from './errors';
import type { ICarryHooks, RetryOptions, RetryPolicy } from './types';
import { DEFAULT_RETRY_POLICY, DEFAULT_TIMEOUT_MS, USER_AGENT } from './constants';
import { normalizeBaseUrl } from './transport/url';
import type { FetchLike } from './transport/http-client';

/**
 * Options accepted by {@link ICarryClient}.
 *
 * Authentication is flexible: supply a connector `email`+`password`, a pre-obtained
 * `token`, or an async `tokenProvider`. You may also construct with no auth and call
 * `client.auth.setToken()` later. `token` + `email`/`password` together is allowed (the
 * token warm-starts the cache); a `tokenProvider` may not be combined with the others.
 */
export interface ICarryClientOptions {
  /**
   * The API base URL. Either the origin (`https://test.icarry.com`) or a URL already
   * ending with the API prefix (`https://test.icarry.com/api-frontend`). Required — the SDK
   * never hardcodes an environment.
   */
  baseUrl: string;

  /** Connector email (from iCarry store → Settings → Connectors & Integration). */
  email?: string;
  /** Connector password. */
  password?: string;

  /** A pre-obtained bearer token. */
  token?: string;
  /** An async callback that returns a bearer token (e.g. from a secret store). */
  tokenProvider?: () => Promise<string | undefined>;

  /** Custom `fetch` implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;

  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;

  /**
   * Transient-retry configuration for retry-eligible (idempotent) calls. `true`/omitted →
   * default policy; `false` → disable retries; an object → override specific fields.
   */
  retry?: boolean | RetryOptions;

  /** Extra headers sent with every request. */
  headers?: Record<string, string>;

  /** Overrides the default `User-Agent`. */
  userAgent?: string;

  /** Optional, best-effort observability hooks (receive redacted data). */
  hooks?: ICarryHooks;

  /** Whether to transparently re-authenticate once on a `401`. Defaults to `true`. */
  autoReauth?: boolean;

  /** Whether to additionally mask `email` fields in redacted output. Defaults to `false`. */
  redactEmail?: boolean;
}

/** Resolved authentication strategy. */
export interface ResolvedAuth {
  mode: 'static' | 'credentials' | 'provider' | 'none';
  canReacquire: boolean;
  initialToken?: string;
  credentials?: { email: string; password: string };
  tokenProvider?: () => Promise<string | undefined>;
}

/** Fully-resolved configuration consumed by {@link ICarryClient}. */
export interface ResolvedConfig {
  baseUrl: string;
  fetch: FetchLike;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  hooks: ICarryHooks;
  defaultHeaders: Record<string, string>;
  userAgent: string;
  autoReauth: boolean;
  redactEmail: boolean;
  auth: ResolvedAuth;
}

function resolveRetryPolicy(retry: ICarryClientOptions['retry']): RetryPolicy {
  if (retry === false) {
    return { ...DEFAULT_RETRY_POLICY, maxRetries: 0 };
  }
  if (retry === true || retry === undefined) {
    return { ...DEFAULT_RETRY_POLICY };
  }
  return {
    maxRetries: retry.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
    baseDelayMs: retry.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
    maxDelayMs: retry.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
    retryableStatuses: retry.retryableStatuses ?? DEFAULT_RETRY_POLICY.retryableStatuses,
  };
}

function resolveAuth(options: ICarryClientOptions): ResolvedAuth {
  const { token, email, password, tokenProvider } = options;

  if (tokenProvider) {
    if (token !== undefined || email !== undefined || password !== undefined) {
      throw new ICarryConfigurationError(
        'tokenProvider cannot be combined with token, email, or password — choose one auth strategy.'
      );
    }
    return { mode: 'provider', canReacquire: true, tokenProvider };
  }

  if ((email === undefined) !== (password === undefined)) {
    throw new ICarryConfigurationError(
      'Both email and password are required to authenticate with connector credentials.'
    );
  }

  if (email !== undefined && password !== undefined) {
    const auth: ResolvedAuth = {
      mode: 'credentials',
      canReacquire: true,
      credentials: { email, password },
    };
    if (token !== undefined) {
      auth.initialToken = token;
    }
    return auth;
  }

  if (token !== undefined) {
    return { mode: 'static', canReacquire: false, initialToken: token };
  }

  return { mode: 'none', canReacquire: false };
}

function resolveFetch(provided: ICarryClientOptions['fetch']): FetchLike {
  const impl = provided ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined);
  if (!impl) {
    throw new ICarryConfigurationError(
      'No fetch implementation available. Provide options.fetch or run on a runtime with a global fetch (Node >= 18).'
    );
  }
  // Wrap so the underlying implementation is always invoked consistently and our input
  // object is never handed to a differently-typed signature.
  return (url, init) => impl(url, init);
}

/**
 * Validates and normalizes {@link ICarryClientOptions} into a {@link ResolvedConfig}.
 *
 * @throws {@link ICarryConfigurationError} for missing/invalid `baseUrl`, an unavailable
 * `fetch`, or a contradictory authentication configuration.
 */
export function normalizeConfig(options: ICarryClientOptions): ResolvedConfig {
  if (!options || typeof options !== 'object') {
    throw new ICarryConfigurationError('ICarryClient requires an options object.');
  }
  if (typeof options.baseUrl !== 'string' || options.baseUrl.trim() === '') {
    throw new ICarryConfigurationError('baseUrl is required and must be a non-empty string.');
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new ICarryConfigurationError('baseUrl must be an absolute http(s) URL.');
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw new ICarryConfigurationError('timeoutMs must be a positive number.');
  }

  return {
    baseUrl,
    fetch: resolveFetch(options.fetch),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(options.retry),
    hooks: options.hooks ?? {},
    defaultHeaders: { ...(options.headers ?? {}) },
    userAgent: options.userAgent ?? USER_AGENT,
    autoReauth: options.autoReauth ?? true,
    redactEmail: options.redactEmail ?? false,
    auth: resolveAuth(options),
  };
}
