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

## Redaction

The SDK masks sensitive keys (case-insensitive) — passwords, tokens, `authorization`, card numbers
(kept to last 4 only), CVV/security codes (fully removed), expiry, and cardholder name/type — anywhere
it surfaces request or error data. This protects the SDK's own output; it cannot protect data that
**you** log or store from the original inputs.

## Transport security

Use `https` base URLs and callback/redirect URLs only. Plain `http` allows credentials and card
parameters to be intercepted in transit.

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
