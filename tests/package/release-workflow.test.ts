import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static guard for the manual release workflow. Reads the YAML as text (no YAML parser / runtime
 * dependency) and asserts the security-relevant invariants from the 0.1.6 audit.
 */
const wf = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
const ifLines = wf.split('\n').filter((l) => /(^|\s)if:/.test(l));

describe('release workflow (.github/workflows/release.yml)', () => {
  it('is workflow_dispatch only (never push / pull_request)', () => {
    expect(wf).toContain('workflow_dispatch');
    expect(wf).not.toMatch(/^\s*push:/m);
    expect(wf).not.toMatch(/^\s*pull_request:/m);
  });

  it('accepts an exact git_tag input (not git_ref / arbitrary commit)', () => {
    expect(wf).toMatch(/^\s*git_tag:/m);
    expect(wf).not.toContain('git_ref');
  });

  it('offers all three publish modes', () => {
    for (const mode of ['validate-only', 'trusted', 'token']) {
      expect(wf).toContain(mode);
    }
  });

  it('never references secrets.* inside an if: condition', () => {
    for (const line of ifLines) {
      expect(line).not.toMatch(/secrets\./);
    }
    // Token availability is checked via the env-mapped var.
    expect(wf).toContain("env.NPM_TOKEN == ''");
    expect(wf).toContain("env.NPM_TOKEN != ''");
  });

  it('maps the secret to a job env var exactly once', () => {
    expect(wf).toMatch(/NPM_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
    expect(wf.match(/secrets\.NPM_TOKEN/g)?.length).toBe(1);
  });

  it('token mode requires NPM_TOKEN and uses NODE_AUTH_TOKEN with provenance', () => {
    expect(wf).toMatch(/publish_mode == 'token' && env\.NPM_TOKEN == ''/);
    expect(wf).toContain('npm publish --provenance --access public');
    // NODE_AUTH_TOKEN appears only in the token publish step.
    expect(wf.match(/NODE_AUTH_TOKEN/g)?.length).toBe(1);
    expect(wf).toMatch(/NODE_AUTH_TOKEN:\s*\$\{\{\s*env\.NPM_TOKEN\s*\}\}/);
  });

  it('trusted mode publishes without a token', () => {
    const trusted = wf.slice(wf.indexOf('Publish (trusted'));
    const trustedStep = trusted.slice(0, trusted.indexOf('Publish (classic'));
    expect(trustedStep).toContain('npm publish --access public --tag "$NPM_TAG"');
    expect(trustedStep).not.toContain('NODE_AUTH_TOKEN');
  });

  it('runs the release gate before any publish and verifies tag/commit exactly', () => {
    expect(wf.indexOf('npm run release:check')).toBeGreaterThan(0);
    expect(wf.indexOf('npm run release:check')).toBeLessThan(wf.indexOf('npm publish'));
    expect(wf).toContain('git describe --tags --exact-match HEAD');
    expect(wf).toContain('already exists on npm');
  });

  it('keeps minimal permissions and configures concurrency', () => {
    expect(wf).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write/);
    expect(wf).not.toMatch(/contents:\s*write/);
    expect(wf).not.toMatch(/^\s*packages:/m);
    expect(wf).not.toMatch(/^\s*pull-requests:/m);
    expect(wf).toMatch(/concurrency:/);
    expect(wf).toContain('npm-release-');
  });

  it('passes free-text inputs through env, not inline into run scripts', () => {
    expect(wf).toMatch(/RELEASE_TAG:\s*\$\{\{\s*inputs\.git_tag\s*\}\}/);
    expect(wf).toContain('"$RELEASE_TAG"');
    expect(wf).toContain('"$NPM_TAG"');
  });
});
