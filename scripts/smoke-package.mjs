#!/usr/bin/env node
/**
 * Packed-package consumer smoke test.
 *
 * Packs the SDK into an npm tarball, installs it into a throwaway project OUTSIDE the repo, then
 * validates it exactly as four real consumers would:
 *   - esm.mjs      ESM JavaScript  (import)
 *   - cjs.cjs      CommonJS JavaScript (require) + package.json subpath
 *   - consumer.mts ESM TypeScript  (import) → must resolve types via dist/index.d.ts
 *   - consumer.cts CommonJS TypeScript (import x = require) → must resolve via dist/index.d.cts
 *
 * The two TypeScript consumers compile under strict NodeNext with skipLibCheck:false, so a wrong
 * export-map/declaration pairing (e.g. TS1479) fails the release. A --traceResolution pass proves
 * the require condition resolves to index.d.cts and the import condition to index.d.ts.
 *
 * Cross-platform (Linux + Windows), uses os.tmpdir(), always cleans up the temp project AND the
 * generated .tgz (on success and failure). Uses `npm pack --ignore-scripts` so it never
 * re-triggers prepublishOnly (no recursion). Publishes nothing. Depends on no repo source files.
 *
 * Requires a prior `npm run build` (dist/ must exist).
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const tgzName = `icarry-sdk-${version}.tgz`;
const tgzPath = join(repoRoot, tgzName);
const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

function runNpm(args, cwd) {
  return execFileSync(npm, args, { cwd, stdio: 'pipe', encoding: 'utf8', shell: isWindows });
}
function runNode(args, cwd) {
  return execFileSync(process.execPath, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

let tempDir;
try {
  if (!existsSync(join(repoRoot, 'dist', 'index.js'))) {
    throw new Error('dist/ is missing — run `npm run build` before `npm run smoke:package`.');
  }

  console.log('  packing tarball (--ignore-scripts)…');
  runNpm(['pack', '--ignore-scripts'], repoRoot);
  if (!existsSync(tgzPath)) {
    throw new Error(`tarball was not created: ${tgzName}`);
  }

  tempDir = mkdtempSync(join(tmpdir(), 'icarry-consumer-'));
  writeFileSync(
    join(tempDir, 'package.json'),
    JSON.stringify({ name: 'icarry-consumer', version: '1.0.0', private: true }, null, 2)
  );
  copyFileSync(tgzPath, join(tempDir, tgzName));

  console.log('  installing tarball into a temp consumer…');
  runNpm(['install', `./${tgzName}`, '--no-audit', '--no-fund'], tempDir);

  // Tarball hygiene: the installed package must not contain src/tests/coverage/node_modules.
  const installed = readdirSync(join(tempDir, 'node_modules', 'icarry-sdk'));
  const forbidden = installed.filter((f) =>
    ['src', 'tests', 'coverage', 'node_modules'].includes(f)
  );
  if (forbidden.length > 0) {
    throw new Error(`published package contains forbidden entries: ${forbidden.join(', ')}`);
  }
  // The CommonJS declaration MUST ship — it is what the require condition resolves to.
  for (const f of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
    if (!existsSync(join(tempDir, 'node_modules', 'icarry-sdk', 'dist', f))) {
      throw new Error(`installed package is missing dist/${f}`);
    }
  }

  // ---- ESM JavaScript ----
  writeFileSync(
    join(tempDir, 'esm.mjs'),
    [
      "import { ICarryClient, SDK_VERSION } from 'icarry-sdk';",
      "import assert from 'node:assert/strict';",
      "assert.equal(typeof ICarryClient, 'function');",
      `assert.equal(SDK_VERSION, ${JSON.stringify(version)});`,
      "const c = new ICarryClient({ baseUrl: 'https://x', token: 't', fetch: async () => new Response('[{\"name\":\"Lebanon\",\"id\":1}]', { headers: { 'content-type': 'application/json' } }) });",
      'const r = await c.countries.list();',
      "assert.ok(Array.isArray(r) && r[0].name === 'Lebanon');",
      "console.log('  ESM JavaScript ok');",
    ].join('\n')
  );
  runNode(['esm.mjs'], tempDir);

  // ---- CommonJS JavaScript + package.json subpath ----
  writeFileSync(
    join(tempDir, 'cjs.cjs'),
    [
      "const { ICarryClient, SDK_VERSION } = require('icarry-sdk');",
      "const assert = require('node:assert/strict');",
      "assert.equal(typeof ICarryClient, 'function');",
      `assert.equal(SDK_VERSION, ${JSON.stringify(version)});`,
      "const meta = require('icarry-sdk/package.json');",
      `assert.equal(meta.version, ${JSON.stringify(version)});`,
      "console.log('  CommonJS JavaScript + package.json subpath ok');",
    ].join('\n')
  );
  runNode(['cjs.cjs'], tempDir);

  // ---- ESM TypeScript (.mts) ----
  writeFileSync(
    join(tempDir, 'consumer.mts'),
    [
      'import {',
      '  ICarryClient,',
      '  ICarryApiError,',
      '  type ICarryClientOptions,',
      '  type AmbiguousApiResult,',
      '  type MerchantRateInput,',
      '  type MarketplaceRateInput,',
      '  type OnDemandRateInput,',
      '  type TrackingResult,',
      '  type ICarryHooks,',
      "} from 'icarry-sdk';",
      '',
      'const hooks: ICarryHooks = {',
      '  onRequest: (info) => void info.method,',
      '  onHookError: (err) => void err.message,',
      '};',
      "const options: ICarryClientOptions = { baseUrl: 'https://test.icarry.com', token: 't', hooks };",
      'const client = new ICarryClient(options);',
      '',
      'export async function trackOne(n: string): Promise<string> {',
      '  const r: TrackingResult = await client.shipments.track(n);',
      "  if (typeof r === 'string') return r;",
      "  if (r === null || r === undefined) return 'empty';",
      "  if (Array.isArray(r)) return 'array';",
      "  if (typeof r === 'object') return typeof r['status'];",
      '  return typeof r;',
      '}',
      'export function statusOf(e: unknown): number | undefined {',
      '  return e instanceof ICarryApiError ? e.status : undefined;',
      '}',
      'export const merchant: Partial<MerchantRateInput> = {};',
      'export const marketplace: Partial<MarketplaceRateInput> = {};',
      'export const onDemand: Partial<OnDemandRateInput> = {};',
      'const amb: AmbiguousApiResult = null;',
      'void amb;',
    ].join('\n')
  );

  // ---- CommonJS TypeScript (.cts) ----
  writeFileSync(
    join(tempDir, 'consumer.cts'),
    [
      "import sdk = require('icarry-sdk');",
      '',
      "const options: sdk.ICarryClientOptions = { baseUrl: 'https://test.icarry.com', token: 'test-token' };",
      'const client = new sdk.ICarryClient(options);',
      'void client;',
      '',
      '// Public interfaces + type aliases through the namespace.',
      'const hooks: sdk.ICarryHooks = {};',
      'void hooks;',
      'const rate: Partial<sdk.MerchantRateInput> = {};',
      'void rate;',
      'const amb: sdk.AmbiguousApiResult = null;',
      'void amb;',
      '',
      '// Resource access.',
      'export function track(n: string): Promise<sdk.TrackingResult> {',
      '  return client.shipments.track(n);',
      '}',
      '// Error classes.',
      'export function isApiErr(e: unknown): e is sdk.ICarryApiError {',
      '  return e instanceof sdk.ICarryApiError;',
      '}',
      '// Version constant resolves through the CommonJS declaration.',
      'if (sdk.SDK_VERSION !== ' + JSON.stringify(version) + ') {',
      "  throw new Error('SDK_VERSION mismatch');",
      '}',
    ].join('\n')
  );

  writeFileSync(
    join(tempDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        files: ['consumer.mts', 'consumer.cts'],
      },
      null,
      2
    )
  );

  // Type-check both TypeScript consumers (fails on any ESM/CJS resolution problem, e.g. TS1479).
  runNode([tsc, '-p', 'tsconfig.json'], tempDir);
  console.log(
    '  ESM TypeScript (.mts) + CommonJS TypeScript (.cts) type-check ok (skipLibCheck: false)'
  );

  // Prove condition→declaration mapping with the resolver trace.
  const trace = runNode([tsc, '-p', 'tsconfig.json', '--traceResolution'], tempDir);
  const resolvedCts = /successfully resolved to '[^']*index\.d\.cts'/i.test(trace);
  const resolvedDts = /successfully resolved to '[^']*index\.d\.ts'/i.test(trace);
  if (!resolvedCts) {
    throw new Error('require condition did NOT resolve to dist/index.d.cts (CJS declaration)');
  }
  if (!resolvedDts) {
    throw new Error('import condition did NOT resolve to dist/index.d.ts (ESM declaration)');
  }
  console.log('  resolution proof: require → index.d.cts, import → index.d.ts');

  console.log(`smoke:package OK (icarry-sdk@${version})`);
} catch (error) {
  const detail =
    error && typeof error === 'object' && 'stdout' in error && error.stdout
      ? `${error.message}\n${String(error.stdout)}\n${String(error.stderr ?? '')}`
      : String(error && error.message ? error.message : error);
  console.error(`smoke:package FAILED\n${detail}`);
  process.exitCode = 1;
} finally {
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
  try {
    rmSync(tgzPath, { force: true });
  } catch {
    /* best-effort cleanup */
  }
}
