#!/usr/bin/env node
/**
 * Fails if any tracked source/test/doc file contains a forbidden value — well-known test card
 * numbers (which must never be committed, and which appear in iCarry's public docs) or obvious
 * committed secrets. Runs in CI and locally via `npm run check:secrets`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tests', 'scripts'];
const SCAN_ROOT_FILES = ['README.md', 'API_COVERAGE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);

/** Known real-looking test PANs that must never be committed (incl. iCarry's docs sample). */
const FORBIDDEN = [
  { re: /4242[ -]?4242[ -]?4242[ -]?4242/, label: 'iCarry docs sample card number (4242…)' },
  { re: /4111[ -]?1111[ -]?1111[ -]?1111/, label: 'well-known Visa test PAN (4111…)' },
  { re: /5555[ -]?5555[ -]?5555[ -]?4444/, label: 'well-known Mastercard test PAN (5555…)' },
  { re: /4000[ -]?0000[ -]?0000[ -]?0002/, label: 'well-known Visa test PAN (4000…0002)' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'committed private key' },
];

const files = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (SCAN_EXTS.has(extname(entry))) {
      files.push(full);
    }
  }
}

for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
for (const f of SCAN_ROOT_FILES) {
  try {
    statSync(join(ROOT, f));
    files.push(join(ROOT, f));
  } catch {
    /* file may not exist */
  }
}

const violations = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { re, label } of FORBIDDEN) {
      if (re.test(line)) {
        violations.push(`${file}:${i + 1}: ${label}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('❌ Forbidden values found:\n' + violations.map((v) => '  ' + v).join('\n'));
  process.exit(1);
}
console.log(`✅ No forbidden values found (${files.length} files scanned).`);
