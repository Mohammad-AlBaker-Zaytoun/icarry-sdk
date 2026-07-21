#!/usr/bin/env node
/**
 * Post-build packaging integrity check (runs after `npm run build`, inside `validate`).
 *
 * Verifies, against the ACTUAL build output, that:
 *   - the export map's four conditional paths point at files that exist;
 *   - dist/index.d.ts and dist/index.d.cts both exist (the CJS declaration must ship);
 *   - runtime outputs (index.js, index.cjs) exist;
 *   - the built SDK_VERSION equals package.json.version;
 *   - the ESM and CJS declarations export the SAME public symbol set (no drift, no accidental
 *     private transport exports leaking into only one).
 *
 * Fails clearly (non-zero exit) on any drift. Reads no test/source files beyond package.json.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error(`check:package FAILED — ${msg}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 1. Export-map paths point at files that exist.
const dot = pkg.exports?.['.'];
const expected = {
  'import.types': './dist/index.d.ts',
  'import.default': './dist/index.js',
  'require.types': './dist/index.d.cts',
  'require.default': './dist/index.cjs',
};
for (const [key, want] of Object.entries(expected)) {
  const [cond, field] = key.split('.');
  const got = dot?.[cond]?.[field];
  if (got !== want)
    fail(`exports["."].${cond}.${field} is ${JSON.stringify(got)}, expected ${want}`);
  const abs = join(root, want);
  if (!existsSync(abs)) fail(`export-map path ${want} does not exist (run \`npm run build\`)`);
}

// 2. Both declarations + runtime outputs exist.
for (const f of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
  if (!existsSync(join(root, 'dist', f))) fail(`missing dist/${f}`);
}

// 3. Built SDK_VERSION equals package.json.version.
const mod = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
if (mod.SDK_VERSION !== pkg.version) {
  fail(`SDK_VERSION (${mod.SDK_VERSION}) !== package.json.version (${pkg.version})`);
}

// 4. ESM vs CJS declaration public-symbol parity.
function exportedSymbols(declFile) {
  const src = readFileSync(join(root, 'dist', declFile), 'utf8');
  // tsup emits a single trailing `export { ... };` block listing every public symbol.
  const matches = [...src.matchAll(/export\s*\{([^}]*)\}/g)];
  if (matches.length === 0) fail(`${declFile} has no export block`);
  const names = new Set();
  for (const m of matches) {
    for (const raw of m[1].split(',')) {
      const token = raw.trim().replace(/^type\s+/, '');
      if (!token) continue;
      // Handle `X as Y` — the exported name is Y.
      const name = token.includes(' as ') ? token.split(' as ').pop().trim() : token;
      if (name) names.add(name);
    }
  }
  return names;
}
const dts = exportedSymbols('index.d.ts');
const cts = exportedSymbols('index.d.cts');
const onlyDts = [...dts].filter((n) => !cts.has(n));
const onlyCts = [...cts].filter((n) => !dts.has(n));
if (onlyDts.length || onlyCts.length) {
  fail(
    `declaration export drift — only in .d.ts: [${onlyDts.join(', ')}]; only in .d.cts: [${onlyCts.join(', ')}]`
  );
}

console.log(
  `check:package OK — ${dts.size} public symbols, SDK_VERSION ${mod.SDK_VERSION}, export map consistent`
);
