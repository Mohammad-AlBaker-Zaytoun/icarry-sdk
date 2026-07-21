import { describe, it, expect } from 'vitest';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';
import type { SafeRequestInfo, SafeResponseInfo, RetryEvent } from '../../src/types';

describe('hook payload deep immutability', () => {
  it('deep-freezes onRequest payload (nested headers/body too)', async () => {
    let info!: SafeRequestInfo;
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock, {
      hooks: { onRequest: (i) => void (info = i as SafeRequestInfo) },
    }).request({
      method: 'POST',
      path: '/x',
      body: { nested: { value: 1 }, list: [{ a: 1 }] },
    });
    expect(Object.isFrozen(info)).toBe(true);
    expect(Object.isFrozen(info.headers)).toBe(true);
    expect(Object.isFrozen(info.body)).toBe(true);
    const body = info.body as { nested: { value: number }; list: unknown[] };
    expect(Object.isFrozen(body.nested)).toBe(true);
    expect(Object.isFrozen(body.list)).toBe(true);
    expect(Object.isFrozen(body.list[0])).toBe(true);
    // A mutation attempt in strict mode (ESM) throws and does not change the value.
    expect(() => {
      (body.nested as { value: number }).value = 999;
    }).toThrow(TypeError);
    expect(body.nested.value).toBe(1);
  });

  it('deep-freezes onResponse payload', async () => {
    let info!: SafeResponseInfo;
    const mock = sequenceFetch(jsonResponse({}));
    await makeHttp(mock, {
      hooks: { onResponse: (i) => void (info = i as SafeResponseInfo) },
    }).request({ method: 'GET', path: '/x' });
    expect(Object.isFrozen(info)).toBe(true);
    expect(() => {
      (info as { status: number }).status = 500;
    }).toThrow(TypeError);
  });

  it('deep-freezes onRetry event', async () => {
    let event!: RetryEvent;
    const mock = sequenceFetch(stringError(503, 'busy'), jsonResponse({ ok: 1 }));
    await makeHttp(mock, { hooks: { onRetry: (e) => void (event = e as RetryEvent) } }).request({
      method: 'GET',
      path: '/x',
      retryable: true,
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(() => {
      (event as { delayMs: number }).delayMs = -1;
    }).toThrow(TypeError);
  });
});
