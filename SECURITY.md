# Security Policy

## Scope

This document covers security considerations for the **icarry-sdk** npm package itself. For the
security of the iCarry platform, contact iCarry directly. This package is unofficial and not
affiliated with iCarry.

## Credential handling

Your connector `email`/`password` and any bearer `token` are sensitive.

**Rules that must never be broken:**

- Never include connector credentials or bearer tokens in client-side JavaScript or any bundle
  delivered to a browser. This SDK is **server-side only**.
- Never log full request objects, headers, or raw responses that may contain credentials or tokens.
- Never commit credentials to version control — use environment variables or a secrets manager.
- If credentials are exposed (committed, logged, leaked), **rotate them immediately** in your iCarry
  store and treat the old values as compromised.

The SDK caches tokens **in memory only** — it never writes them to disk or browser storage.

## Server-side only

`ICarryClient` must only be instantiated and used on the server:

- **Next.js:** only in Route Handlers (`app/api/…`), `pages/api/…`, or Server Actions — never in a
  Client Component or any code shipped to the browser.
- **Express / Fastify / Hono:** only inside route handlers on trusted infrastructure.

## Payment data

`payments.createShipmentOrder` transmits card details as **query-string parameters** because that is
iCarry's documented contract. Query strings are frequently logged by proxies, load balancers, and web
servers.

- The SDK **redacts** every card query parameter (and body card fields for `confirmPayment`) from
  observability hooks and error objects, and **never** exposes the serialized payment URL.
- The SDK **cannot** control logging at the HTTP or infrastructure layer — ensure your gateway/proxy
  does not log query strings for these requests.
- The SDK **stores no card data**, performs no card-vault behavior, and makes **no PCI-compliance
  claim**. Handle card data only in a PCI-appropriate environment.
- Never treat a MontyPay return call as proof of payment — the SDK verifies **no** callback signature
  (iCarry documents none). Verify payment/order status server-side.

## Redaction and sanitization

The SDK sanitizes known sensitive values at its own logging and error boundaries, using one shared
set of sensitive-key definitions across three surfaces:

- **Structured values** (hook payloads, error `details`): sensitive keys (case-insensitive) are
  masked — passwords, tokens, `authorization`, card numbers (kept to last 4 only), CVV/security codes
  (fully removed), expiry, and cardholder name/type.
- **URLs**: sensitive query-parameter values (e.g. the payment card parameters) are masked; the
  serialized payment URL is never surfaced in errors or hooks.
- **Free-form strings** (error messages, error causes): embedded URLs, `Bearer` tokens,
  `key=value`/`"key":"value"` secrets, and card-number-like digit runs are masked. Error `cause` is a
  minimal sanitized `Error` (name + redacted message + safe code) — never the raw thrown object.

**Limits of these guarantees — the SDK cannot:**

- Control URL or request logging performed at the HTTP or infrastructure layer (proxies, gateways,
  servers), or by a custom `fetch` you inject. Ensure such layers do not log query strings.
- Protect original input values that **you** log or store yourself.
- Protect against malicious code running in the same process. Credentials and tokens are held in
  runtime-private (`#`) fields, which prevent *accidental* exposure through `console`,
  `JSON.stringify`, `Object.keys`, and `util.inspect`, but are not an in-process security boundary.

Hook payloads are deep-frozen; `onHookError` receives a sanitized `SafeHookError`, not the raw error.

## Transport security

Use `https` base URLs and callback/redirect URLs only. Plain `http` allows credentials and card
parameters to be intercepted in transit.

The `baseUrl` is validated strictly at construction with the WHATWG `URL` API and canonicalized to
`scheme://host[:port][/path]`. Embedded credentials, query strings, and fragments are rejected, as
are protocol-relative URLs and non-http(s) schemes (`javascript:`, `data:`, `file:`, `ftp:`). Plain
`http` is permitted only for local development hosts (`localhost`, `127.0.0.1`, `[::1]`); every
remote host must use `https`. Header names/values and the `User-Agent` are validated to reject CR,
LF, NUL, and other control characters, preventing header/response splitting. Client inspection
methods never expose credentials, query strings, or fragments from the configured URL.

## Dependency security

`icarry-sdk` has **zero runtime dependencies**, eliminating transitive supply-chain risk at runtime.
Development dependencies (TypeScript, Vitest, tsup, ESLint, Prettier) are not included in the published
package.

## Reporting a vulnerability

If you find a security issue in this package (e.g. credential leakage through the SDK's API, a
redaction bypass, or similar):

1. **Do not open a public GitHub issue.**
2. Use GitHub's private vulnerability reporting: open a report at
   `https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/security/advisories/new`.

Please include a description, reproduction steps, impact, and any suggested mitigation. You can expect
an acknowledgement within a reasonable timeframe.

## Disclaimer

This package is unofficial and not affiliated with iCarry. The maintainers make no guarantees about
the correctness or completeness of the API integration. Verify endpoint behavior against your own
iCarry account before production use.
