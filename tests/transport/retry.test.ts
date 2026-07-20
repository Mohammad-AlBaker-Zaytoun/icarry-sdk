import { describe, it, expect } from 'vitest';
import {
  isRetryableStatus,
  isTransientError,
  parseRetryAfter,
  computeDelay,
} from '../../src/transport/retry';
import { DEFAULT_RETRY_POLICY } from '../../src/constants';

const policy = DEFAULT_RETRY_POLICY;

describe('isRetryableStatus', () => {
  it('matches the policy set', () => {
    expect(isRetryableStatus(429, policy)).toBe(true);
    expect(isRetryableStatus(503, policy)).toBe(true);
    expect(isRetryableStatus(400, policy)).toBe(false);
    expect(isRetryableStatus(404, policy)).toBe(false);
  });
});

describe('isTransientError', () => {
  it('treats network errors as transient but not aborts', () => {
    expect(isTransientError(new TypeError('fetch failed'))).toBe(true);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isTransientError(abort)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '2' }))).toBe(2000);
  });
  it('parses an HTTP date relative to now', () => {
    const now = 1_000_000;
    const future = new Date(now + 3000).toUTCString();
    const parsed = parseRetryAfter(new Headers({ 'retry-after': future }), now);
    // Whole-second precision in HTTP dates → allow a small rounding window.
    expect(parsed).toBeGreaterThanOrEqual(2000);
    expect(parsed).toBeLessThanOrEqual(3000);
  });
  it('returns undefined when absent or junk', () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined();
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
  });
});

describe('computeDelay', () => {
  it('honors an explicit retry-after', () => {
    expect(computeDelay(1, policy, 1500)).toBe(1500);
  });

  it('produces bounded exponential backoff with full jitter', () => {
    // rng=1 → the full capped value; rng=0 → zero.
    expect(computeDelay(1, policy, undefined, () => 1)).toBe(policy.baseDelayMs);
    expect(computeDelay(1, policy, undefined, () => 0)).toBe(0);
    expect(computeDelay(2, policy, undefined, () => 1)).toBe(policy.baseDelayMs * 2);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(computeDelay(20, policy, undefined, () => 1)).toBe(policy.maxDelayMs);
  });
});
