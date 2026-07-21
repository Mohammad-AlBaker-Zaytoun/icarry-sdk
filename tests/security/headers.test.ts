import { describe, it, expect } from 'vitest';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse, type MockFetch } from '../helpers/mockFetch';

function sentHeaders(mock: MockFetch): Record<string, string> {
  return mock.calls[0]?.init.headers as Record<string, string>;
}

/** Counts headers whose names collide case-insensitively. */
function caseInsensitiveDuplicates(headers: Record<string, string>): string[] {
  const seen = new Map<string, number>();
  for (const name of Object.keys(headers)) {
    const key = name.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

describe('case-insensitive header normalization', () => {
  it('produces exactly one effective value per header regardless of case', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock).request({
      method: 'POST',
      path: '/x',
      body: { a: 1 },
      headers: { 'content-type': 'text/xml', ACCEPT: 'text/plain', 'User-Agent': 'caller/1' },
    });
    const h = sentHeaders(mock);
    expect(caseInsensitiveDuplicates(h)).toEqual([]);
  });

  it('SDK Authorization wins; a caller cannot inject a second bearer', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock).request({
      method: 'GET',
      path: '/x',
      headers: { authorization: 'Bearer ATTACKER', Authorization: 'Bearer ALSO_ATTACKER' },
    });
    const h = sentHeaders(mock);
    expect(caseInsensitiveDuplicates(h)).toEqual([]);
    const authValues = Object.entries(h)
      .filter(([k]) => k.toLowerCase() === 'authorization')
      .map(([, v]) => v);
    expect(authValues).toEqual(['Bearer tok']); // the SDK token, exactly once
    expect(JSON.stringify(h)).not.toContain('ATTACKER');
  });

  it('forces Content-Type application/json for JSON bodies even if the caller overrides it', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock).request({
      method: 'POST',
      path: '/x',
      body: { a: 1 },
      headers: { 'Content-Type': 'text/xml' },
    });
    const h = sentHeaders(mock);
    const ct = Object.entries(h).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
    expect(ct).toBe('application/json');
  });

  it('allows overriding safe headers like Accept', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock).request({ method: 'GET', path: '/x', headers: { Accept: 'text/plain' } });
    const h = sentHeaders(mock);
    const accept = Object.entries(h).find(([k]) => k.toLowerCase() === 'accept')?.[1];
    expect(accept).toBe('text/plain');
  });

  it('never mutates the caller-owned header object', async () => {
    const mock = sequenceFetch(jsonResponse({}));
    const callerHeaders = { 'X-Trace': 'z', authorization: 'Bearer HACK' };
    const snapshot = JSON.stringify(callerHeaders);
    await makeHttp(mock).request({ method: 'GET', path: '/x', headers: callerHeaders });
    expect(JSON.stringify(callerHeaders)).toBe(snapshot);
  });
});
