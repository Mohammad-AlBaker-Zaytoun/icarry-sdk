/**
 * Safe invocation of observability hooks.
 *
 * A failing hook must never fail (or alter) the underlying request. All hook errors are
 * swallowed and, when provided, routed to {@link ICarryHooks.onHookError}. Callers pass
 * already-redacted, frozen context objects.
 *
 * @packageDocumentation
 */

import type { ICarryHooks, SafeRequestInfo, SafeResponseInfo, RetryEvent } from '../types';

type HookPhase = 'request' | 'response' | 'retry';

async function safeInvoke<T>(
  fn: ((arg: T) => void | Promise<void>) | undefined,
  arg: T,
  hooks: ICarryHooks,
  phase: HookPhase
): Promise<void> {
  if (!fn) {
    return;
  }
  try {
    await fn(arg);
  } catch (error) {
    if (hooks.onHookError) {
      try {
        hooks.onHookError(error, phase);
      } catch {
        /* even the error sink is best-effort; never let observability break a request */
      }
    }
  }
}

/** Invokes `onRequest` (best-effort). */
export function runRequestHook(hooks: ICarryHooks, info: Readonly<SafeRequestInfo>): Promise<void> {
  return safeInvoke(hooks.onRequest, info, hooks, 'request');
}

/** Invokes `onResponse` (best-effort). */
export function runResponseHook(
  hooks: ICarryHooks,
  info: Readonly<SafeResponseInfo>
): Promise<void> {
  return safeInvoke(hooks.onResponse, info, hooks, 'response');
}

/** Invokes `onRetry` (best-effort). */
export function runRetryHook(hooks: ICarryHooks, event: Readonly<RetryEvent>): Promise<void> {
  return safeInvoke(hooks.onRetry, event, hooks, 'retry');
}
