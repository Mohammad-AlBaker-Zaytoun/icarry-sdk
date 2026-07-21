import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Export-map regression guard. Reads package.json directly (no build needed) so a drift in the
 * conditional declaration exports fails fast. The post-build `scripts/check-package.mjs` performs
 * the complementary checks that need dist/ (referenced files exist, .d.ts/.d.cts symbol parity,
 * SDK_VERSION consistency).
 */
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  main: string;
  module: string;
  types: string;
  exports: Record<string, unknown>;
};

describe('package.json export map', () => {
  it('uses conditional declaration exports (.d.ts for import, .d.cts for require)', () => {
    const dot = pkg.exports['.'] as {
      import: { types: string; default: string };
      require: { types: string; default: string };
    };
    expect(dot.import.types).toBe('./dist/index.d.ts');
    expect(dot.import.default).toBe('./dist/index.js');
    expect(dot.require.types).toBe('./dist/index.d.cts');
    expect(dot.require.default).toBe('./dist/index.cjs');
  });

  it('orders types before default within each condition', () => {
    const dot = pkg.exports['.'] as Record<string, Record<string, string>>;
    for (const cond of ['import', 'require']) {
      const keys = Object.keys(dot[cond] as Record<string, string>);
      expect(keys[0]).toBe('types');
      expect(keys.indexOf('types')).toBeLessThan(keys.indexOf('default'));
    }
  });

  it('exposes the package.json subpath and legacy compatibility fields', () => {
    expect(pkg.exports['./package.json']).toBe('./package.json');
    expect(pkg.main).toBe('dist/index.cjs');
    expect(pkg.module).toBe('dist/index.js');
    expect(pkg.types).toBe('dist/index.d.ts');
  });
});
