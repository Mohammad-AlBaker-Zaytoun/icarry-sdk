# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk/releases/tag/v0.1.0
