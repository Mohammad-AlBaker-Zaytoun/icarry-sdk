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
npm run format:check   # Prettier
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit (strict)
npm test               # Vitest (mocked fetch, no live credentials)
npm run test:coverage  # coverage thresholds
npm run build          # tsup (ESM + CJS + d.ts)
npm pack --dry-run     # inspect the publishable tarball
```

`npm run format` and `npm run lint:fix` auto-fix formatting/lint issues.

## Design principles (please preserve these)

This SDK exists to make iCarry pleasant to use **without changing iCarry's HTTP contract**. When
contributing:

1. **Preserve the wire contract.** Do not "fix" iCarry's field names. The misspellings and casing
   quirks (`County`, `COdCurrency` vs `CODCurrency`, `MethodId` vs `MethodName`) are intentional and
   guarded by tests. Never emit two spellings of the same field.
2. **Public camelCase, internal exact-wire.** Keep the camelCase↔wire mapping in explicit `toWire*` /
   `fromWire*` serializers co-located with each resource. No global recursive case conversion.
3. **Be honest about unknowns.** Response schemas that iCarry does not document (create/rate/track/etc.)
   stay as `ExtensibleResponse` — do not invent fields.
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
