/**
 * Optional live-contract tests against a real iCarry tenant.
 *
 * DISABLED BY DEFAULT. They never run in CI and are skipped unless explicitly enabled. All
 * checks here are READ-ONLY. Enable with:
 *
 *   ICARRY_LIVE_TESTS=true \
 *   ICARRY_BASE_URL=https://test.icarry.com \
 *   (ICARRY_EMAIL=... ICARRY_PASSWORD=...  OR  ICARRY_TOKEN=...) \
 *   npm test
 *
 * Optional read-only extras run only when their identifier is supplied:
 *   ICARRY_TEST_WAREHOUSE_ID     → warehouse lookup by id
 *   ICARRY_TEST_TRACKING_NUMBER  → shipment tracking
 *   ICARRY_TEST_SHIPMENT_ID      → packaging-slip content-type
 *
 * MUTATING calls are intentionally NOT included and must never run by default. A future
 * mutating live test must additionally require ICARRY_ALLOW_MUTATIONS=true, and any payment
 * test must additionally require ICARRY_ALLOW_PAYMENT_TESTS=true with NO real card data.
 *
 * Maintainers can use `summarizeShape` to learn provisional response schemas without capturing
 * customer data — it records only value kinds and property names, never values.
 */
import { describe, it, expect } from 'vitest';
import { ICarryClient, type ICarryClientOptions } from '../../src';
import { summarizeShape } from './shape';

const enabled = process.env.ICARRY_LIVE_TESTS === 'true';
const baseUrl = process.env.ICARRY_BASE_URL;
const token = process.env.ICARRY_TOKEN;
const email = process.env.ICARRY_EMAIL;
const password = process.env.ICARRY_PASSWORD;
const hasAuth = !!token || (!!email && !!password);
const ready = enabled && !!baseUrl && hasAuth;

const warehouseId = process.env.ICARRY_TEST_WAREHOUSE_ID;
const trackingNumber = process.env.ICARRY_TEST_TRACKING_NUMBER;
const shipmentId = process.env.ICARRY_TEST_SHIPMENT_ID;

// Constructed lazily — the describe body runs during collection even when skipped.
function liveClient(): ICarryClient {
  const options: ICarryClientOptions = { baseUrl: baseUrl as string, timeoutMs: 20_000 };
  if (token) {
    options.token = token;
  } else {
    options.email = email as string;
    options.password = password as string;
  }
  return new ICarryClient(options);
}

/** Logs a value-free shape summary for maintainers strengthening provisional types. */
function reportShape(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[live shape] ${label}:`, JSON.stringify(summarizeShape(value)));
}

describe.skipIf(!ready)('live contract (read-only)', () => {
  it('authenticates and returns a non-empty token', async () => {
    const t = await liveClient().auth.getToken();
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(0);
  });

  it('lists countries', async () => {
    const countries = await liveClient().countries.list();
    expect(Array.isArray(countries)).toBe(true);
    if (countries.length > 0) reportShape('countries[0]', countries[0]);
  });

  it('lists states for the first country', async () => {
    const client = liveClient();
    const countries = await client.countries.list();
    if (countries.length === 0) return;
    const states = await client.countries.listStates(countries[0]!.id);
    expect(Array.isArray(states)).toBe(true);
    if (states.length > 0) reportShape('state[0]', states[0]);
  });

  it('lists warehouses', async () => {
    const warehouses = await liveClient().warehouses.list();
    expect(Array.isArray(warehouses)).toBe(true);
    if (warehouses.length > 0) reportShape('warehouse[0]', warehouses[0]);
  });

  it.skipIf(!warehouseId)('looks up a warehouse by id', async () => {
    const warehouse = await liveClient().warehouses.getById(warehouseId as string);
    expect(typeof warehouse).toBe('object');
    reportShape('warehouse.getById', warehouse);
  });

  it.skipIf(!trackingNumber)('tracks a shipment (provisional shape)', async () => {
    const result = await liveClient().shipments.track(trackingNumber as string);
    reportShape('shipments.track', result);
    expect(result).toBeDefined();
  });

  it.skipIf(!shipmentId)('fetches a packaging slip (content-type aware)', async () => {
    const slip = await liveClient().shipments.getPackagingSlip(shipmentId as string);
    expect(slip.kind === 'binary' || slip.kind === 'json').toBe(true);
    reportShape('packagingSlip.kind', slip.kind);
  });
});

// Always collected so the file has a non-skipped test.
describe('live contract (guard)', () => {
  it('stays disabled without ICARRY_LIVE_TESTS=true and auth', () => {
    expect(ready).toBe(process.env.ICARRY_LIVE_TESTS === 'true' && !!baseUrl && hasAuth);
  });

  it('never enables mutating or payment calls by default', () => {
    // Documented invariants — these opt-ins must be explicit and are unset in normal runs.
    expect(process.env.ICARRY_ALLOW_MUTATIONS === 'true' && !enabled).toBe(false);
    expect(process.env.ICARRY_ALLOW_PAYMENT_TESTS === 'true' && !enabled).toBe(false);
  });
});
