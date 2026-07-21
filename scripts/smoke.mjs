#!/usr/bin/env node
/**
 * Package-consumer smoke test. Verifies the built package can be imported as ESM and
 * required as CommonJS, that key named exports exist in both, and that a client can be
 * constructed and used against an injected fetch (no network). Run after `npm run build`.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);

const EXPECTED = [
  'ICarryClient',
  'ICarryError',
  'ICarryApiError',
  'ICarryValidationError',
  'ICarryAuthenticationError',
  'ERROR_CODES',
  'SDK_VERSION',
];

const esm = await import('../dist/index.js');
const cjs = require('../dist/index.cjs');

for (const name of EXPECTED) {
  assert.ok(name in esm, `ESM build is missing export: ${name}`);
  assert.ok(name in cjs, `CJS build is missing export: ${name}`);
}
console.log('  exports present in ESM + CJS');

// The published version must match what the consumer sees.
const pkg = require('../package.json');
assert.equal(
  esm.SDK_VERSION,
  pkg.version,
  `SDK_VERSION (${esm.SDK_VERSION}) !== package.json (${pkg.version})`
);
console.log(`  SDK_VERSION matches package.json (${pkg.version})`);

// Construct and exercise the client with an injected fetch (no real network).
const { ICarryClient } = esm;
const fetchStub = async () =>
  new Response('[{"name":"Lebanon","id":125}]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const client = new ICarryClient({
  baseUrl: 'https://test.icarry.com',
  token: 'smoke-token',
  fetch: fetchStub,
});
assert.equal(client.getBaseUrl(), 'https://test.icarry.com');
const countries = await client.countries.list();
assert.ok(Array.isArray(countries) && countries[0].name === 'Lebanon', 'countries.list failed');

// Runtime-private secret hygiene must survive the build.
const dump = JSON.stringify(client) + String(client);
assert.ok(!dump.includes('smoke-token'), 'token leaked through client serialization!');
console.log('  client constructs, calls, and hides secrets');

console.log('smoke OK');
