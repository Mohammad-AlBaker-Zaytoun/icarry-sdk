# Contributing to icarry-sdk

Thanks for your interest in improving icarry-sdk! This is an unofficial, community-maintained package.

## Getting started

```bash
git clone https://github.com/Mohammad-AlBaker-Zaytoun/icarry-sdk.git
cd icarry-sdk
npm ci
```

## Development workflow

Run the full quality gate before opening a PR — CI runs the same checks:

```bash
npm run validate       # format:check + lint + typecheck + test:types + check:secrets + test:coverage + build + check:package + smoke:dist
npm run smoke          # ESM + CJS consumer import smoke test (after build)
npm pack --dry-run     # inspect the publishable tarball
```

`npm run validate` is also what `prepublishOnly` runs. Individual steps are available too:
`format:check`, `lint`, `typecheck`, `test:types`, `check:secrets`, `test`, `test:coverage`,
`build`, `check:package`.

### Releasing

Maintainers **must** publish via `release:publish`, never `npm publish` directly — the former
runs the full release gate (including the packed-package consumer test) first:

```bash
npm run release:publish   # release:check → npm publish  (prompts for 2FA OTP)
# release:check on its own (no publish):
npm run release:check     # = validate:release = validate + npm pack --dry-run + smoke:package
```

`smoke:package` packs the real tarball, installs it into a temporary external project, and
type-checks ESM (`.mts`) **and** CommonJS (`.cts`) consumers under strict `NodeNext` with
`skipLibCheck: false` — so a broken ESM/CJS declaration export (e.g. `TS1479`) fails the release.
`prepublishOnly` runs only `validate` (not `smoke:package`) to avoid a **recursive `npm pack`** (the
packed-package test itself runs `npm pack`); the packed-package check therefore lives in
`release:check`/`release:publish` and in CI, which every release must pass. Running a bare
`npm publish` still triggers `prepublishOnly` but **skips** the packed-package test — so use
`release:publish`.

There is also an optional manual GitHub Actions release workflow
([`.github/workflows/release.yml`](./.github/workflows/release.yml)): `workflow_dispatch` only (never
on push/PR), it checks out the selected tag, runs `release:check`, verifies the Git tag ==
`package.json.version` == `SDK_VERSION` and that the npm version does not already exist, then
publishes with provenance **only if** an `NPM_TOKEN` secret (or npm trusted publishing) is
configured — otherwise it runs the checks and skips the publish step rather than failing. Configure
credentials before relying on it.

`npm run format` and `npm run lint:fix` auto-fix formatting/lint issues.

## Design principles (please preserve these)

This SDK exists to make iCarry pleasant to use **without changing iCarry's HTTP contract**. When
contributing:

1. **Preserve the wire contract.** Do not "fix" iCarry's field names. The misspellings and casing
   quirks (`County`, `COdCurrency` vs `CODCurrency`, `MethodId` vs `MethodName`) are intentional and
   guarded by tests. Never emit two spellings of the same field.
2. **Public camelCase, internal exact-wire.** Keep the camelCase↔wire mapping in explicit `toWire*` /
   `fromWire*` serializers co-located with each resource. No global recursive case conversion.
3. **Be honest about unknowns.** Unverified endpoints parsed with `expect: 'auto'` must remain typed
   as **`AmbiguousApiResult`** (the union of `object | unknown[] | string | number | boolean | null |
   undefined`) until their live response contract is verified. Do **not** narrow them to
   `ExtensibleResponse` merely because a mocked example currently returns an object.
   - `ExtensibleResponse` is appropriate **only** when the response is confidently object-shaped
     (e.g. auth token, country, warehouse GET, state) — never invent fields.
   - `AmbiguousApiResult` is appropriate whenever the content type or shape is uncertain.
   - Live-contract observations (e.g. from `summarizeShape`) must **not** be used to narrow a type
     until they are repeatable and documented in `API_COVERAGE.md`.
   - After `1.0.0`, narrowing a provisional type is a potential breaking change and requires a
     deliberate semantic-versioning review.
4. **Security first.** Never leak passwords, tokens, or card data in errors, logs, or hooks. Never
   auto-retry mutating or payment calls. Never write real card data or the docs' sample PAN into tests.
5. **No new runtime dependencies** without strong justification — the package ships zero.

## Tests

- Every endpoint should assert method, path, query/body wire mapping, and error behavior.
- Use mocked `fetch` (see `tests/helpers/`). Fixtures must use fake values only.
- Aim to keep coverage above the configured thresholds.

## Commit & PR

- Keep PRs focused. Describe what changed and why, and note any iCarry behavior you verified.
- Update `API_COVERAGE.md`, the README, and `CHANGELOG.md` when you add or change endpoints.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
