# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - Security hardening & reliability

A backward-compatible patch release. All 21 endpoint wrappers, iCarry wire casing, and retry
policy are preserved. One small, security-motivated public type change (see Changed).

### Security

- **Runtime-private secret state.** `ICarryClient`, `AuthResource`, `HttpClient`, and
  `TokenManager` now hold credentials, tokens, and transport dependencies in ECMAScript
  `#private` fields, so they no longer appear via `Object.keys`, `getOwnPropertyNames`,
  `JSON.stringify`, `String()`, or `util.inspect`. Each exposes a minimal safe `toJSON()`
  (and a `util.inspect` hook that needs no `node:util` import).
- **Error & cause sanitization.** A centralized `redactString` sanitizes free-form text
  (embedded URLs' sensitive query params, `Bearer` tokens, `key=value`/`"key":"value"`
  secrets, and card-number-like digit runs). It is applied to network, authentication, API,
  plain-text-body, and parse error messages. Error `cause` is now a sanitized minimal `Error`
  (name + redacted message + safe `code` only) — the raw thrown object, its custom properties,
  URLs, and stack are never retained.
- **Low-level path leakage prevention.** `client.request({ path })` now rejects paths
  containing a query string, fragment, absolute URL, or control characters (use `query`
  instead). Independently, all error/hook metadata paths are stripped of any query/fragment
  via `sanitizePathForMetadata`, even for internal callers.
- **`onHookError` sanitization.** The error sink now receives a sanitized `SafeHookError`
  (`{ name, message, code? }`) rather than the raw thrown object.
- **Deep-frozen hook payloads.** `onRequest`/`onResponse`/`onRetry` payloads are now deeply
  frozen (cycle- and depth-safe), matching the documented immutability guarantee.
- **Complete card-field redaction** across structured values, URLs, and free-form strings.

### Fixed

- Ambiguous successful responses (`text/plain`, JSON strings, empty bodies, missing/misleading
  content types) no longer raise `ICarryResponseParseError`. Rate/create/track/payment/MontyPay
  methods now parse with `expect: 'auto'`; only endpoints that reliably return JSON stay strict.
- Case-insensitive header normalization: exactly one effective value per header, SDK-controlled
  `Authorization`/`Content-Type` always win, and a caller can no longer inject a second bearer.

### Changed

- `ICarryHooks.onHookError` signature changed from `(error: unknown, phase)` to
  `(error: Readonly<SafeHookError>, phase)`. New exported types: `SafeHookError`, `HookPhase`.
- Stronger runtime validation: positive-integer ids (rejecting decimals, zero, negatives,
  `NaN`/`Infinity`, and non-numeric strings), positive-integer parcel quantities, non-negative
  package values, required currencies, card type/name/expiry, and HTTPS (or `localhost` http)
  payment redirect URLs.
- `prepublishOnly` now runs the full quality gate via a reusable `validate` script (format,
  lint, type-check, secret scan, coverage, build). CI adds a Node 22 target and a consumer
  import smoke test.

### Tests

- Added security suites for secret privacy, error/cause redaction, low-level path safety,
  ambiguous responses, header normalization, hook immutability, `onHookError` sanitization, and
  the strengthened validators.

## [0.1.0] - Initial release

Initial, pre-1.0 release. The API contract was reverse-engineered from iCarry's public Postman
documentation and has **not** been fully verified against a live tenant; treat response shapes for
create/rate/track/payment operations as provisional.

### Added

- `ICarryClient` with resource groups: `auth`, `warehouses`, `countries`, `merchant`, `marketplace`,
  `onDemand`, `payments`, `shipments`, plus a low-level `request()` escape hatch.
- Coverage of all 21 documented iCarry routes (see `API_COVERAGE.md`).
- Four authentication modes (token, credentials, async token provider, manual `setToken`) with lazy,
  deduplicated acquisition and one-time ownership-gated re-auth on `401`.
- Shared transport: base-URL normalization, content-type-driven parsing (JSON/text/binary/empty),
  combined timeout + caller-abort signals, and a typed error hierarchy.
- Recursive, case-insensitive redaction of secrets (passwords, tokens, card numbers → last 4 only,
  CVVs removed) across errors, logs, and observability hooks; payment URLs never surfaced.
- Conservative, structural retry policy (idempotent GETs by default; rate estimates opt-in; mutating
  and payment calls never retried, including the mutating-`GET` cancel).
- Dual ESM + CommonJS build with TypeScript declarations; zero runtime dependencies.
- Documentation: README, `API_COVERAGE.md`, `SECURITY.md`, `CONTRIBUTING.md`, and full TSDoc.

### Security

- `payments.createShipmentOrder` marked server-only; card query parameters redacted everywhere and the
  serialized payment URL never exposed. No PCI-compliance claim; no card storage.
- MontyPay return operations perform no callback signature verification (none is documented).

[Unreleased]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/releases/tag/v0.1.0
