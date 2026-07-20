/**
 * Transient-retry policy helpers: which statuses are retryable, how long to back off, and
 * how to honor a `Retry-After` header.
 *
 * Only side-effect-free calls that explicitly opt in are ever retried; the decision of
 * *whether* a given call is eligible lives in the resource methods, not here.
 *
 * @packageDocumentation
 */

import type { RetryPolicy } from '../types';

/** Hard ceiling on any honored `Retry-After` delay, to bound worst-case waiting. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Whether an HTTP status is in the policy's retryable set. */
export function isRetryableStatus(status: number, policy: RetryPolicy): boolean {
  return policy.retryableStatuses.includes(status);
}

/**
 * Whether a thrown transport error represents a transient network failure worth retrying.
 * Aborts (timeout / caller cancellation) are deliberately excluded.
 */
export function isTransientError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return (error as { name?: unknown }).name !== 'AbortError';
  }
  return true;
}

/**
 * Parses a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds, clamped to
 * a sane maximum. Returns `undefined` when absent or unparseable.
 */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(0, dateMs - now), MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

/**
 * Computes the backoff delay before a given retry `attempt` (1-based).
 *
 * Honors an explicit `retryAfterMs` when provided; otherwise uses exponential backoff with
 * full jitter, capped at `policy.maxDelayMs`.
 *
 * @param rng - Injectable RNG (defaults to `Math.random`) for deterministic tests.
 */
export function computeDelay(
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
  rng: () => number = Math.random
): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return Math.round(rng() * capped);
}
