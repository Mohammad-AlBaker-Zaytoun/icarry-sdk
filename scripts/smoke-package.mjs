#!/usr/bin/env node
/**
 * Packed-package consumer smoke test.
 *
 * Packs the SDK into an npm tarball, installs it into a throwaway project outside the repo,
 * then validates it exactly as a real consumer would: ESM import, CommonJS require, the
 * `package.json` subpath export, TypeScript declaration resolution, version consistency, and a
 * mocked client call — plus that the tarball ships no src/tests/coverage. Cross-platform
 * (Linux + Windows), uses os.tmpdir(), and always cleans up.
 *
 * Requires a prior `npm run build` (dist/ must exist). Uses `npm pack --ignore-scripts` so it
 * never re-triggers `prepublishOnly` (no recursion). Publishes nothing.
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

function runNpm(args, cwd) {
  // shell:true only on Windows so `.cmd` resolves; args are simple/safe.
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

  // Tarball hygiene: the installed package must not contain src/tests/coverage.
  const installed = readdirSync(join(tempDir, 'node_modules', 'icarry-sdk'));
  const forbidden = installed.filter((f) =>
    ['src', 'tests', 'coverage', 'node_modules'].includes(f)
  );
  if (forbidden.length > 0) {
    throw new Error(`published package contains forbidden entries: ${forbidden.join(', ')}`);
  }

  // ESM root import.
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
      "console.log('  ESM import ok');",
    ].join('\n')
  );
  runNode(['esm.mjs'], tempDir);

  // CommonJS require + package.json subpath export.
  writeFileSync(
    join(tempDir, 'cjs.cjs'),
    [
      "const { ICarryClient, SDK_VERSION } = require('icarry-sdk');",
      "const assert = require('node:assert/strict');",
      "assert.equal(typeof ICarryClient, 'function');",
      `assert.equal(SDK_VERSION, ${JSON.stringify(version)});`,
      "const meta = require('icarry-sdk/package.json');",
      `assert.equal(meta.version, ${JSON.stringify(version)});`,
      "console.log('  CJS require + package.json subpath ok');",
    ].join('\n')
  );
  runNode(['cjs.cjs'], tempDir);

  // TypeScript declaration resolution — with skipLibCheck FALSE so the generated .d.ts files
  // (as shipped in the tarball) are themselves fully type-checked.
  writeFileSync(
    join(tempDir, 'consumer.ts'),
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
      '  type PaymentResult,',
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
      '// Resource access + ambiguous-result narrowing.',
      'export async function trackOne(n: string): Promise<string> {',
      '  const r: TrackingResult = await client.shipments.track(n);',
      "  if (typeof r === 'string') return r;",
      "  if (r === null || r === undefined) return 'empty';",
      "  if (Array.isArray(r)) return 'array';",
      "  if (typeof r === 'object') return typeof r['status'];",
      '  return typeof r; // number | boolean',
      '}',
      '',
      'export async function pay(id: number): Promise<PaymentResult> {',
      '  return client.payments.confirmPayment(id, {});',
      '}',
      '',
      '// Error narrowing.',
      'export function statusOf(e: unknown): number | undefined {',
      '  return e instanceof ICarryApiError ? e.status : undefined;',
      '}',
      '',
      '// Request-input types resolve from the package root.',
      'export const merchant: Partial<MerchantRateInput> = {};',
      'export const marketplace: Partial<MarketplaceRateInput> = {};',
      'export const onDemand: Partial<OnDemandRateInput> = {};',
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
        files: ['consumer.ts'],
      },
      null,
      2
    )
  );
  const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  runNode([tsc, '-p', 'tsconfig.json'], tempDir);
  console.log('  TypeScript consumer resolves ok (skipLibCheck: false)');

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
