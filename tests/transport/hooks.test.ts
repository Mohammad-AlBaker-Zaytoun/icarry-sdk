import { describe, it, expect, vi } from 'vitest';
import { runRequestHook, runResponseHook, runRetryHook } from '../../src/transport/hooks';
import type { SafeRequestInfo, SafeResponseInfo, RetryEvent } from '../../src/types';

const reqInfo: SafeRequestInfo = {
  method: 'GET',
  url: '/x',
  path: '/x',
  headers: {},
  attempt: 1,
};
const resInfo: SafeResponseInfo = {
  method: 'GET',
  path: '/x',
  status: 200,
  ok: true,
  durationMs: 1,
  attempt: 1,
};
const retryEvent: RetryEvent = {
  method: 'GET',
  path: '/x',
  attempt: 2,
  delayMs: 5,
  reason: 'status',
  status: 503,
};

describe('hooks', () => {
  it('invokes each hook with its context', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const onRetry = vi.fn();
    await runRequestHook({ onRequest }, reqInfo);
    await runResponseHook({ onResponse }, resInfo);
    await runRetryHook({ onRetry }, retryEvent);
    expect(onRequest).toHaveBeenCalledWith(reqInfo);
    expect(onResponse).toHaveBeenCalledWith(resInfo);
    expect(onRetry).toHaveBeenCalledWith(retryEvent);
  });

  it('is a no-op when the hook is absent', async () => {
    await expect(runRequestHook({}, reqInfo)).resolves.toBeUndefined();
  });

  it('swallows a throwing hook and routes it to onHookError', async () => {
    const boom = new Error('hook exploded');
    const onHookError = vi.fn();
    await expect(
      runRequestHook(
        {
          onRequest: () => {
            throw boom;
          },
          onHookError,
        },
        reqInfo
      )
    ).resolves.toBeUndefined();
    expect(onHookError).toHaveBeenCalledWith(boom, 'request');
  });

  it('swallows a throwing onHookError too', async () => {
    await expect(
      runResponseHook(
        {
          onResponse: () => {
            throw new Error('a');
          },
          onHookError: () => {
            throw new Error('b');
          },
        },
        resInfo
      )
    ).resolves.toBeUndefined();
  });

  it('awaits async hooks', async () => {
    let done = false;
    await runRequestHook(
      {
        onRequest: async () => {
          await Promise.resolve();
          done = true;
        },
      },
      reqInfo
    );
    expect(done).toBe(true);
  });
});
