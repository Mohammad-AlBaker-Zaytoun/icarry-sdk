/**
 * {@link ICarryClient} — the public entry point.
 *
 * Composes the transport, token manager, and resource groups. Authentication is wired via a
 * lazy `acquire` closure so the token manager never imports the auth resource (breaking the
 * import cycle), and so credentials are only exercised on first protected use.
 *
 * @packageDocumentation
 */

import { normalizeConfig, type ICarryClientOptions } from './config';
import { HttpClient, type RequestSpec } from './transport/http-client';
import { TokenManager } from './transport/token-manager';
import { AuthResource } from './resources/auth';
import { WarehousesResource } from './resources/warehouses';
import { CountriesResource } from './resources/countries';
import { MerchantResource } from './resources/merchant';
import { MarketplaceResource } from './resources/marketplace';
import { OnDemandResource } from './resources/on-demand';
import { PaymentsResource } from './resources/payments';
import { ShipmentsResource } from './resources/shipments';
import type { QueryParams } from './transport/query';
import type { Expect } from './transport/response-parser';

/** Options for {@link ICarryClient.request}, the low-level escape hatch. */
export interface LowLevelRequest {
  method: 'GET' | 'POST';
  /** Path relative to the API prefix (leading slash optional). */
  path: string;
  query?: QueryParams;
  body?: unknown;
  /** Whether a bearer token is attached. Defaults to `true`. */
  auth?: boolean;
  /** Whether the call may be transiently retried. Defaults to `false`. */
  retryable?: boolean;
  /** Response parse strategy. Defaults to `'json'`. */
  expect?: Expect;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * A type-safe, secure client for the iCarry shipping & logistics API.
 *
 * @example
 * ```typescript
 * import { ICarryClient } from 'icarry-sdk';
 *
 * const icarry = new ICarryClient({
 *   baseUrl: process.env.ICARRY_BASE_URL!,
 *   email: process.env.ICARRY_EMAIL!,
 *   password: process.env.ICARRY_PASSWORD!,
 * });
 *
 * const countries = await icarry.countries.list();
 * const tracking = await icarry.shipments.track('TRACKING_NUMBER');
 * ```
 */
export class ICarryClient {
  /** Authentication: token acquisition and management. */
  readonly auth: AuthResource;
  /** Warehouses / pickup locations. */
  readonly warehouses: WarehousesResource;
  /** Countries and states/provinces. */
  readonly countries: CountriesResource;
  /** Merchant (COD) shipping. */
  readonly merchant: MerchantResource;
  /** Marketplace shipping. */
  readonly marketplace: MarketplaceResource;
  /** On-demand shipping. */
  readonly onDemand: OnDemandResource;
  /** Payment operations (server-only). */
  readonly payments: PaymentsResource;
  /** Shipment tracking, cancellation, and packaging slips. */
  readonly shipments: ShipmentsResource;

  private readonly http: HttpClient;
  private readonly baseUrl: string;

  constructor(options: ICarryClientOptions) {
    const config = normalizeConfig(options);
    this.baseUrl = config.baseUrl;

    const tokenManager = new TokenManager({
      // Lazy: resolved on first protected call, after `this.auth` is assigned below.
      acquire: () => this.auth.acquireToken(),
      canReacquire: config.auth.canReacquire,
      ...(config.auth.initialToken !== undefined ? { initialToken: config.auth.initialToken } : {}),
    });

    const http = new HttpClient({
      baseUrl: config.baseUrl,
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
      tokenManager,
      retryPolicy: config.retryPolicy,
      hooks: config.hooks,
      defaultHeaders: config.defaultHeaders,
      userAgent: config.userAgent,
      autoReauth: config.autoReauth,
      redactEmail: config.redactEmail,
    });
    this.http = http;

    this.auth = new AuthResource(http, tokenManager, config.auth);
    this.warehouses = new WarehousesResource(http);
    this.countries = new CountriesResource(http);
    this.merchant = new MerchantResource(http);
    this.marketplace = new MarketplaceResource(http);
    this.onDemand = new OnDemandResource(http);
    this.payments = new PaymentsResource(http);
    this.shipments = new ShipmentsResource(http);
  }

  /** The resolved base URL. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Low-level escape hatch for undocumented or future endpoints. Reuses authentication,
   * timeout/abort, redaction, parsing, retry, and error handling. Prefer the typed resource
   * methods where they exist.
   *
   * @typeParam T - Expected response shape (unwrapped body).
   */
  request<T>(req: LowLevelRequest): Promise<T> {
    const spec: RequestSpec = { method: req.method, path: req.path };
    if (req.query !== undefined) spec.query = req.query;
    if (req.body !== undefined) spec.body = req.body;
    if (req.auth !== undefined) spec.auth = req.auth;
    if (req.retryable !== undefined) spec.retryable = req.retryable;
    if (req.expect !== undefined) spec.expect = req.expect;
    if (req.signal !== undefined) spec.signal = req.signal;
    if (req.timeoutMs !== undefined) spec.timeoutMs = req.timeoutMs;
    if (req.headers !== undefined) spec.headers = req.headers;
    return this.http.request<T>(spec);
  }
}
