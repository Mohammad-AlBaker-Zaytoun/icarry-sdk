# icarry-sdk

> Unofficial, type-safe, secure client for the [iCarry](https://icarry.com) shipping & logistics API — zero dependencies.

[![npm version](https://img.shields.io/npm/v/icarry-sdk.svg)](https://www.npmjs.com/package/icarry-sdk)
[![npm downloads](https://img.shields.io/npm/dm/icarry-sdk.svg)](https://www.npmjs.com/package/icarry-sdk)
[![CI](https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

> **⚠️ UNOFFICIAL PACKAGE — NOT AFFILIATED WITH iCARRY**
>
> This is an unofficial, community-created client for the iCarry Web API. It is **not** affiliated
> with, endorsed by, or maintained by iCarry. The iCarry API is documented only as a Postman
> collection with several known inconsistencies (see [Known iCarry inconsistencies](#known-icarry-inconsistencies)).
> Verify endpoint behavior against your own account before relying on it in production, and treat
> all response shapes for create/rate/track/payment operations as **unverified** until confirmed
> against a live tenant.

---

A lightweight, framework-agnostic client for the iCarry shipping API. Works with Next.js (server
routes / Server Actions), Express, Fastify, Hono, or any modern JavaScript runtime with `fetch`.

## What it is

- A clean, camelCase, strongly-typed wrapper over iCarry's `/api-frontend` endpoints.
- **Faithful to the wire contract** — it preserves iCarry's exact (and sometimes misspelled) field
  names internally rather than "fixing" them, so requests actually work.
- **Secure by default** — passwords, tokens, and card data are redacted from errors, logs, and hooks;
  mutating and payment calls are never automatically retried.

## Table of contents

- [Installation](#installation) · [Runtime requirements](#runtime-requirements) · [Quick start](#quick-start)
- [Configuration](#configuration) · [Authentication](#authentication) · [Base URL](#base-url)
- [Merchant flow](#merchant-flow) · [Marketplace flow](#marketplace-flow) · [On-demand flow](#on-demand-flow)
- [Tracking](#tracking) · [Cancellation](#cancellation) · [Packaging slips](#packaging-slips)
- [Error handling](#error-handling) · [Retry behavior](#retry-behavior) · [Timeouts & cancellation](#timeouts--cancellation)
- [TypeScript usage](#typescript-usage) · [Security considerations](#security-considerations)
- [⚠️ Server-only payment warning](#-server-only-payment-warning)
- [Endpoint coverage matrix](#endpoint-coverage-matrix) · [Known iCarry inconsistencies](#known-icarry-inconsistencies)
- [Low-level request escape hatch](#low-level-request-escape-hatch) · [Observability hooks](#observability-hooks)
- [Testing](#testing) · [Contributing](#contributing) · [License](#license)

---

## Installation

```bash
npm install icarry-sdk
```

## Runtime requirements

- **Node.js ≥ 18** (uses the global `fetch` and `AbortController`), or any runtime with a WHATWG
  `fetch`. You may inject a custom `fetch` via options.
- Ships both **ESM** and **CommonJS** builds with full TypeScript declarations. Zero runtime dependencies.

## Quick start

```typescript
import { ICarryClient } from 'icarry-sdk';

const icarry = new ICarryClient({
  baseUrl: process.env.ICARRY_BASE_URL!, // e.g. https://test.icarry.com
  email: process.env.ICARRY_EMAIL!, // connector email
  password: process.env.ICARRY_PASSWORD!, // connector password
});

const countries = await icarry.countries.list();
const tracking = await icarry.shipments.track('TRACKING_NUMBER');
```

Get your connector `email`/`password` from your iCarry store → **Settings → Connectors & Integration**
(regional portals: [lb.icarry.com](https://lb.icarry.com), [uae.icarry.com](https://uae.icarry.com)).

## Configuration

```typescript
new ICarryClient({
  baseUrl: string,                    // required; origin or origin + /api-frontend

  // --- authentication (choose one strategy) ---
  email?: string,
  password?: string,
  token?: string,                     // pre-obtained bearer token
  tokenProvider?: () => Promise<string | undefined>,

  // --- transport ---
  fetch?: typeof fetch,               // inject a custom fetch (defaults to global)
  timeoutMs?: number,                 // default 30000
  retry?: boolean | {                 // default: retries enabled for idempotent GETs
    maxRetries?: number,              //   default 2
    baseDelayMs?: number,             //   default 300
    maxDelayMs?: number,              //   default 5000
    retryableStatuses?: number[],     //   default [408, 429, 500, 502, 503, 504]
  },
  headers?: Record<string, string>,   // extra headers on every request
  userAgent?: string,
  hooks?: ICarryHooks,                // redacted observability hooks
  autoReauth?: boolean,               // default true (re-auth once on 401)
  redactEmail?: boolean,              // default false
});
```

## Authentication

Four modes are supported:

```typescript
// 1. Connector credentials (authenticates lazily on first protected call)
new ICarryClient({ baseUrl, email, password });

// 2. Explicit bearer token
new ICarryClient({ baseUrl, token });

// 3. Async token provider (e.g. from a secret store)
new ICarryClient({ baseUrl, tokenProvider: async () => loadTokenFromVault() });

// 4. Manual, after construction
const client = new ICarryClient({ baseUrl });
client.auth.setToken(await loadToken());
```

Behavior:

- The token is acquired **lazily** and cached in memory (never persisted to disk or storage).
- Concurrent first calls trigger **one** authentication request (deduplicated).
- On a `401`, if the SDK owns the credentials (email/password or `tokenProvider`) it re-authenticates
  **once** and retries. A caller-supplied static `token` is never silently refreshed — you get an
  `ICarryAuthenticationError`. Disable auto-reauth with `autoReauth: false`.
- The token is treated as opaque — the SDK makes no JWT/expiry assumptions.

```typescript
await icarry.auth.getToken();   // force/inspect the token
icarry.auth.setToken('...');    // set manually
icarry.auth.clearToken();       // clear the cache
```

## Base URL

`baseUrl` is **required** — the SDK never hardcodes an environment. Pass either the origin
(`https://test.icarry.com`) or a URL already including the API prefix
(`https://test.icarry.com/api-frontend`); the `/api-frontend` prefix is added idempotently. The known
test environment is `https://test.icarry.com/api-frontend`. Production/regional base URLs are not
clearly documented by iCarry — confirm yours before going live.

## Merchant flow

COD rate estimation and order creation using a country **code** + free-text drop-off location.

```typescript
const rates = await icarry.merchant.estimateRates({
  dropOffLocation: 'Beirut',
  to: { latitude: 33.8938, longitude: 35.5018 },
  actualWeight: '1.5',
  packageType: 'parcel',
  dimensions: { length: '30', width: '20', height: '10' },
  dropAddress: { countryCode: 'LB', city: 'Beirut' },
  parcels: [{ quantity: 1, weight: '1.5', length: '30', width: '20', height: '10' }],
  cod: { amount: '25.00', currency: 'USD' },
});

const order = await icarry.merchant.createOrder({
  parcels: [{ quantity: 1, weight: '1.5', length: '30', width: '20', height: '10' }],
  dropOff: {
    firstName: 'Test', lastName: 'Recipient', email: 'r@example.com', phoneNumber: '0100',
    country: 'lebanon', city: 'beirut', address1: 'Beirut, Lebanon',
  },
  actualWeight: '5', packageType: 'parcel',
  dimensions: { length: '10', width: '50', height: '30' },
  provider: 'Shipping.ICarry.example', methodId: 26, price: '3.60',
  parcel: { quantity: 1, packageValue: '120', packageCurrency: 'USD' },
  cod: { amount: '10', currency: 'USD' },
});
```

> Money and measurements accept `number | string`; strings are serialized verbatim (no rounding).
> Units follow your iCarry account configuration — the SDK does not assume cm/inch or a currency.

## Marketplace flow

Same as the merchant model plus a `pickupLocation` (your warehouse/pickup name). Marketplace
**warehouse creation** lives on `client.warehouses`:

```typescript
await icarry.warehouses.createMarketplaceWarehouse({
  name: 'Main Warehouse', isActive: true,
  address: {
    firstName: 'Sender', lastName: 'Name', email: 's@example.com',
    country: 'lebanon', city: 'beirut', address1: 'Pickup St', phoneNumber: '0100',
  },
});

const rates = await icarry.marketplace.estimateRates({ pickupLocation: 'Main Warehouse', /* ...merchant rate fields */ });
const order = await icarry.marketplace.createOrder({ pickupLocation: 'Main Warehouse', /* ...merchant order fields */ });
```

## On-demand flow

A **different** model: country/state **ids**, `From`/`To` coordinates, and a nested `dimensions`
object. Shipment creation returns a shipment id used by the (server-only) payment step.

```typescript
const rates = await icarry.onDemand.estimateRates({
  pickup: { countryId: 234, stateProvinceId: 1841, geo: { latitude: 25.2, longitude: 55.3 } },
  drop: { countryId: 234, stateProvinceId: 1841, geo: { latitude: 25.1, longitude: 55.2 } },
  actualWeight: 5, packageType: 'documents',
  dimensions: { length: 5, width: 5, height: 5, unit: 'cm' },
  isVendor: false,
});

const shipment = await icarry.onDemand.createShipment({
  pickupAddress: { firstName: 'A', lastName: 'B', email: 'a@x.com', phoneNumber: '012',
    countryId: 234, stateProvinceId: 1841, address1: 'Dubai' },
  dropOffAddress: { firstName: 'C', lastName: 'D', email: 'c@x.com', phoneNumber: '012',
    countryId: 234, stateProvinceId: 1841, address1: 'Dubai' },
  actualWeight: 5, packageType: 'documents',
  dimensions: { length: 5, width: 5, height: 5 },
  provider: 'Shipping.ICarry.example', methodName: 'Motor Express', price: 1.3,
  parcel: { quantity: 1, currency: 'USD', packageValue: 0 },
});
// Then pay for it — SERVER-ONLY, see the payment warning below.
```

## Tracking

```typescript
const tracking = await icarry.shipments.track('TRACKING_NUMBER');
```

The tracking response shape is not documented by iCarry — it is returned as an open, read-only record
(`ExtensibleResponse`). Read fields defensively.

## Cancellation

```typescript
await icarry.shipments.cancel('TRACKING_NUMBER');
```

> ⚠️ iCarry implements cancellation as a **mutating `GET`**. The SDK treats it as mutating: it is
> never cached and never automatically retried.

## Packaging slips

The endpoint is named "Pdf" but may return binary PDF **or** a JSON envelope. The result is a
discriminated union decided from the response `Content-Type`. The SDK never writes a file.

```typescript
const slip = await icarry.shipments.getPackagingSlip(shipmentId);
if (slip.kind === 'binary') {
  // slip.data: Uint8Array, slip.contentType, slip.filename?
} else {
  // slip.data: unknown (JSON envelope — often a URL or encoded payload)
}
```

## Error handling

All errors extend `ICarryError` and are safe to log (secrets are redacted). Narrow with `instanceof`:

```typescript
import { ICarryApiError, ICarryAuthenticationError, ICarryTimeoutError } from 'icarry-sdk';

try {
  await icarry.shipments.track('TRACKING_NUMBER');
} catch (error) {
  if (error instanceof ICarryAuthenticationError) {
    // invalid or expired credentials
  } else if (error instanceof ICarryTimeoutError) {
    // request timed out
  } else if (error instanceof ICarryApiError) {
    console.error(error.status, error.details?.code, error.message);
  }
  throw error;
}
```

Hierarchy: `ICarryError` → `ICarryConfigurationError`, `ICarryValidationError`,
`ICarryAuthenticationError`, `ICarryApiError`, `ICarryNetworkError`, `ICarryTimeoutError`,
`ICarryAbortError`, `ICarryResponseParseError`. `ICarryApiError.details` carries a safe
`{ status, method, path, code?, requestId?, details? }` — `path` never includes the query string, so
payment query parameters cannot leak through errors.

iCarry returns two error body shapes (an RFC 7807 object **or** a bare JSON string); both are handled.

## Retry behavior

Conservative and structural. Only **side-effect-free, opted-in** calls are ever retried, and only on
transient failures (network errors, `408`, `429`, and selected `5xx`), with bounded exponential
backoff + full jitter and `Retry-After` support.

- Read-only GETs (`countries.*`, `warehouses.getById`/`list`, `shipments.track`, `getPackagingSlip`)
  are retried by default.
- Rate estimates (`*.estimateRates`) are **not** retried unless you pass `{ retry: true }` per call.
- **Never retried:** order creation, shipment creation, all payment operations, MontyPay returns,
  marketplace warehouse creation, and `shipments.cancel` (a mutating GET).

Disable retries entirely with `retry: false`.

## Timeouts & cancellation

Every request has a timeout (default 30s, override per call). You may also pass your own `AbortSignal`;
it is combined with the SDK's timeout. A timeout raises `ICarryTimeoutError`; a caller abort raises
`ICarryAbortError`.

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 2000);
await icarry.countries.list({ signal: controller.signal, timeoutMs: 5000 });
```

## TypeScript usage

Fully typed. Import input/result types as needed:

```typescript
import type { MerchantRateInput, Country, PackagingSlip, ICarryClientOptions } from 'icarry-sdk';
```

Unverified response types are modeled as `ExtensibleResponse` (an open, read-only record) so the SDK
never pretends to know more than iCarry documents.

## Security considerations

See [`SECURITY.md`](./SECURITY.md) for the full policy. In short:

- Keep connector `email`/`password` **on the server**. Never ship them to a browser.
- Never expose bearer tokens in client-side code; don't commit credentials — use env vars or a secret manager.
- The SDK redacts known secrets from errors/logs/hooks, but it cannot protect data **you** log yourself.
- Use TLS (`https`) endpoints only. Rotate credentials immediately if exposed.
- The SDK stores no card data and makes **no PCI-compliance claim**.

## ⚠️ Server-only payment warning

`icarry.payments.createShipmentOrder(...)` sends **card data as query-string parameters** — this is
iCarry's contract, not a design choice by this SDK. The SDK preserves it exactly, but:

- **Call it only from a trusted server context. Never from a browser.** Query strings are routinely
  logged by proxies, gateways, and servers.
- The SDK redacts every card parameter from hooks/errors and never exposes the serialized payment URL,
  but it cannot control logging at the HTTP/infrastructure layer.
- Payment calls are never retried, cached, or subject to telemetry. Use obvious placeholders in tests;
  never commit real card data.

```typescript
// SERVER-ONLY. Placeholders only.
await icarry.payments.createShipmentOrder(shipmentId, {
  card: {
    cardNumber: 'XXXXXXXXXXXXXXXX', cardCvv: 'XXX', cardType: 'visa', cardName: 'CARDHOLDER',
    cardExpirationMonth: '02', cardExpirationYear: '2039',
  },
  paymentMethodSystemName: 'Payments.MontyPay',
});
```

MontyPay return operations (`processMontyPaySuccess` / `processMontyPayCancellation`) are thin wrappers
over iCarry's return URLs. **The SDK performs no callback signature verification** (iCarry documents
none) — never treat a return call as proof of payment; verify status server-side.

## Endpoint coverage matrix

See [`API_COVERAGE.md`](./API_COVERAGE.md) for the full matrix (method · route · auth · retry class ·
sensitive-data class · documentation confidence · known ambiguity). All 21 documented routes are
implemented. The plugin sections (Shopify/WooCommerce/Magento/OpenCart/MANSATI) are prose in iCarry's
docs, not callable REST routes, and are intentionally **not** implemented.

## Known iCarry inconsistencies

The SDK preserves iCarry's exact wire contract while giving you a clean camelCase surface. Notable
quirks it handles for you:

| Public (camelCase) | iCarry wire | Note |
|---|---|---|
| `address.country` (warehouse) | `County` | Misspelled wire field that means *country*. |
| `cod.currency` (merchant/marketplace) | `COdCurrency` | Odd casing on these endpoints… |
| `cod.currency` (on-demand) | `CODCurrency` | …but proper casing here. |
| `methodId` (merchant/marketplace) | `MethodId` | Same concept, different name… |
| `methodName` (on-demand) | `MethodName` | …than here. |
| `shipments.cancel` | `GET /CancelOrder` | Mutating `GET`. |
| `payments.createShipmentOrder` | card in query string | Server-only; redacted. |
| `getPackagingSlip` | "Pdf" endpoint | May return binary **or** JSON. |

Additionally: response schemas for create/rate/track/confirm/MontyPay are **unverified** (iCarry's
"examples" are auto-generated echoes of the request), so they are returned as open records; error
bodies may be a JSON object or a bare string; and no public Swagger/OpenAPI is available.

## Low-level request escape hatch

For undocumented or future endpoints. It reuses authentication, timeout/abort, redaction, parsing,
retry, and error handling. Prefer the typed resource methods where they exist.

```typescript
const data = await icarry.request<MyType>({
  method: 'GET',
  path: '/SomeFutureEndpoint',
  query: { foo: 'bar' },
  retryable: true, // opt in only for safe, idempotent calls
});
```

## Observability hooks

Optional, best-effort hooks receive **redacted, frozen** data. A throwing hook never fails a request
(errors are swallowed and routed to `onHookError` if provided). No telemetry runs by default.

```typescript
new ICarryClient({
  baseUrl,
  token,
  hooks: {
    onRequest: (info) => console.debug(info.method, info.path),  // headers/body/url already redacted
    onResponse: (info) => console.debug(info.status, info.durationMs),
    onRetry: (evt) => console.warn('retrying', evt.path, 'in', evt.delayMs, 'ms'),
  },
});
```

## Testing

```bash
npm test            # unit tests (mocked fetch; no live credentials)
npm run test:coverage
```

An optional live smoke suite is gated behind environment variables and disabled by default:

```bash
ICARRY_LIVE_TESTS=true ICARRY_BASE_URL=... ICARRY_EMAIL=... ICARRY_PASSWORD=... npm test
```

The live suite never runs in CI, never uses real card data, and gates any mutating/paid operation
behind an additional explicit opt-in.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). In short: `npm ci`, then `npm run format:check && npm run
lint && npm run typecheck && npm test && npm run build` before opening a PR.

## License

[MIT](./LICENSE) © Zaytoun Solutions. Unofficial — not affiliated with iCarry.
