/**
 * Optional live smoke tests against a real iCarry environment.
 *
 * DISABLED BY DEFAULT. Enable only with real test credentials:
 *
 *   ICARRY_LIVE_TESTS=true \
 *   ICARRY_BASE_URL=https://test.icarry.com \
 *   ICARRY_EMAIL=... ICARRY_PASSWORD=... \
 *   npm test
 *
 * These tests perform ONLY read-only operations by default. They never run in CI, never use real
 * card data, and never create paid shipments. Any mutating/paid live check must be added behind a
 * separate explicit opt-in (e.g. ICARRY_LIVE_MUTATE=true) and is intentionally not included here.
 */
import { describe, it, expect } from 'vitest';
import { ICarryClient } from '../../src';

const enabled = process.env.ICARRY_LIVE_TESTS === 'true';
const baseUrl = process.env.ICARRY_BASE_URL;
const email = process.env.ICARRY_EMAIL;
const password = process.env.ICARRY_PASSWORD;
const ready = enabled && !!baseUrl && !!email && !!password;

// Constructed lazily inside tests — the describe body still executes during collection even
// when skipped, so we must not build the client (which requires a baseUrl) at that point.
function liveClient(): ICarryClient {
  return new ICarryClient({
    baseUrl: baseUrl as string,
    email: email as string,
    password: password as string,
    timeoutMs: 20_000,
  });
}

describe.skipIf(!ready)('live smoke (read-only)', () => {
  it('authenticates and returns a token', async () => {
    const token = await liveClient().auth.getToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('lists countries', async () => {
    const countries = await liveClient().countries.list();
    expect(Array.isArray(countries)).toBe(true);
  });
});

// Ensures the file always has at least one collected (non-skipped) test.
describe('live smoke (guard)', () => {
  it('stays disabled without ICARRY_LIVE_TESTS=true and full credentials', () => {
    expect(ready).toBe(
      process.env.ICARRY_LIVE_TESTS === 'true' && !!baseUrl && !!email && !!password
    );
  });
});
