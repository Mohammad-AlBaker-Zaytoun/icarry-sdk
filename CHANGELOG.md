# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - Configuration and release hardening

A backward-compatible patch release. All 21 endpoint wrappers, iCarry wire casing, retry policy,
authentication modes, ESM/CJS output, and zero runtime dependencies are preserved. There is no
public API or runtime-behavior change for valid configurations; invalid `baseUrl`, header, and
retry inputs are now rejected earlier and more strictly at construction time.

### Security

- **Strict WHATWG-URL `baseUrl` validation.** The base URL is parsed with the WHATWG `URL` API
  (never a bare regex) and canonicalized to `scheme://host[:port][/path]` with no credentials,
  query string, or fragment. Rejected: embedded credentials (`https://user:pass@host`), query
  strings (`?token=...`), fragments (`#...`), protocol-relative (`//host`) and backslash
  authorities, control characters, and non-http(s) schemes (`javascript:`, `data:`, `file:`,
  `ftp:`). Plain `http` is allowed only for local development hosts (`localhost`, `127.0.0.1`,
  `[::1]`); every remote host must use `https`.
- **Shared, safe API-root resolution.** A single `resolveApiRoot` helper builds the effective
  `/api-frontend` root (appended at most once) and verifies the origin is unchanged with no
  query/fragment. Configuration validation and the transport's prefix-containment check now share
  it, so URL normalization can never diverge between the two paths.
- **Header and `User-Agent` injection prevented.** Configured default headers, the `User-Agent`,
  and per-call headers are validated: names must be RFC 7230 tokens and values must contain no
  CR, LF, NUL, or other control characters, blocking header/response splitting.
- **Defense-in-depth inspection safety.** Public client inspection (`getBaseUrl()`, `toJSON()`,
  `toString()`, and the Node inspect hook) routes the base URL through a display sanitizer that
  strips any credentials, query, and fragment, so an unsafe value could not leak even if
  configuration validation were bypassed.

### Fixed

- Retry configuration is now validated at construction: `maxRetries` must be a non-negative
  integer, `retryableStatuses` must be integer HTTP codes in 100–599, and `baseDelayMs` /
  `maxDelayMs` must be non-negative finite numbers. Invalid values raise
  `ICarryConfigurationError` instead of misbehaving at request time.

### Validation

- New `validate:release` script runs the full `validate` gate plus `npm pack --dry-run` and the
  packed-package consumer smoke test. `smoke:dist` is now part of `validate`. `prepublishOnly`
  remains a single, non-recursive `validate` run; the packed-package test uses
  `npm pack --ignore-scripts` to avoid re-entering the publish lifecycle.
- The packed-package smoke test now type-checks the consumer with `skipLibCheck: false` and
  exercises a broader public type surface (client options, ambiguous-result narrowing, hooks,
  the three rate-input models, tracking/payment results, and error narrowing).

### Tests

- Added suites for base-URL validation (every documented reject/accept case and inspection
  safety), `resolveApiRoot`, header/`User-Agent` CR-LF injection, and retry-policy validation.
- Added an optional, env-gated live-contract test foundation (`ICARRY_LIVE_TESTS=true`) with a
  privacy-preserving `summarizeShape` helper that records only value kinds and property names —
  never values, ids, names, addresses, emails, phone numbers, tracking numbers, tokens, card
  data, or full response bodies. Every included live check is read-only; mutating and payment
  checks remain opt-in behind `ICARRY_ALLOW_MUTATIONS=true` / `ICARRY_ALLOW_PAYMENT_TESTS=true`
  and ship with none enabled.

### Documentation

- README/`SECURITY.md` note the strict `baseUrl` policy (https-only except local hosts; no
  credentials/query/fragment) and document the env-gated live-contract tests and their privacy
  guarantees.

### Release

- The `v0.1.0`, `v0.1.1`, and `v0.1.2` git tags have since been created and pushed at their exact
  published commits, resolving the historical-tag gap noted under 0.1.2. This change does **not**
  create a `v0.1.3` tag.

## [0.1.2] - Type accuracy & boundary hardening

A backward-compatible patch release. All 21 endpoint wrappers, iCarry wire casing, retry
policy, authentication modes, ESM/CJS output, and zero runtime dependencies are preserved. One
correctness-driven type broadening (see Types).

### Fixed

- The `Accept` header no longer over-advertises PDF for `expect: 'auto'` (tracking, rate, order,
  payment, cancellation). Each parse mode now sends an appropriate `Accept` (`json` →
  `application/json`; `text` → text-preferred; `binary` → pdf/octet-stream; `auto` →
  json-preferred). The packaging slip explicitly prefers PDF/binary while still content-type
  auto-parsing.

### Security

- **Authentication-error sanitization bypass closed.** Every failure from credential auth, token
  providers, token-acquisition callbacks, and auth-response parsing is wrapped in a freshly
  sanitized `ICarryAuthenticationError` (message via `redactString`, cause via
  `sanitizeErrorCause`, details sanitized). An existing `ICarryAuthenticationError` is no longer
  rethrown unchanged.
- **API-prefix escape via dot segments prevented.** Low-level path validation now rejects `.` /
  `..` segments (literal, percent-encoded, and double-encoded) and backslashes. Additionally the
  fully-resolved URL is verified to keep the base origin and stay within `/api-frontend`, a
  catch-all against traversal that URL normalization could otherwise resolve outside the prefix.
  No bearer token is sent when validation fails.
- **Error names and codes sanitized.** New `sanitizeErrorName`/`sanitizeErrorCode` are applied to
  sanitized causes, `SafeHookError`, surfaced API error codes, and request/correlation ids, so a
  hostile `error.name` / `error.code` cannot leak secrets.
- **Nested redirect-URL leakage fixed.** `redirectUrl`, `successUrl`, `cancelUrl` (and the
  aliases `returnUrl`, `callbackUrl`, `failureUrl`, `errorUrl`) are treated as fully sensitive in
  every URL representation — their entire, possibly secret-bearing values are masked in request
  hooks, error messages/details, sanitized causes, and retry diagnostics.

### Types

- Endpoints parsed with `expect: 'auto'` now return the accurate `AmbiguousApiResult` union
  (`object | unknown[] | string | number | boolean | null | undefined`) rather than always an
  object, matching runtime behavior. This broadens `MerchantRateResult`, `MerchantOrderResult`,
  `MarketplaceRateResult`, `MarketplaceOrderResult`, `OnDemandRateResult`, `OnDemandShipmentResult`,
  `TrackingResult`, `CancelResult`, and `PaymentResult`, and exports `AmbiguousApiResult`. Callers
  must narrow (e.g. `typeof result === 'object' && result !== null`) before treating an ambiguous
  result as an object. High-confidence endpoints (auth, countries, states, warehouses) are
  unchanged. This reflects incomplete iCarry documentation and is shipped as a **patch-level
  correctness fix**. The change is **compile-time only and runtime-compatible** — the parsed
  runtime payload is identical to 0.1.1; only TypeScript consumers that treated an ambiguous
  result as an object without narrowing are affected, and they need only add a narrowing check.

### Tests

- Added compile-time type tests (`npm run test:types`) proving ambiguous results require
  narrowing, plus regression suites for auth-error sanitization, path traversal, per-mode `Accept`
  headers, error name/code sanitization, and nested redirect-URL redaction.
- Added a packed-package consumer smoke test (`npm run smoke:package`) that packs the real
  tarball, installs it into a temp project, and validates ESM import, CommonJS require, the
  `package.json` subpath export, TypeScript declaration resolution, version consistency, a mocked
  call, and the absence of `src/`/`tests/`/`coverage/` from the tarball.

### Release

- At the time of the 0.1.2 work no `v0.1.0` or `v0.1.1` git tags existed (locally or on the
  remote). Their exact published commits (npm `gitHead`) are
  `1aa12aecf84500a719be4acb12fb4338b0620416` (0.1.0) and
  `73656669afb4501790d93ef6fc0351766aed9fbe` (0.1.1). These tags — along with `v0.1.2` — have
  since been created and pushed at those commits (see 0.1.3 → Release). CI now builds, packs, and
  runs the packed-package smoke test.

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

[Unreleased]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/releases/tag/v0.1.0
