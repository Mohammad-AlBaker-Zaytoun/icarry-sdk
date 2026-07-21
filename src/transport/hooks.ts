/**
 * Safe invocation of observability hooks.
 *
 * A failing hook must never fail (or alter) the underlying request. All hook errors are
 * swallowed and, when provided, routed to {@link ICarryHooks.onHookError}. Callers pass
 * already-redacted, frozen context objects.
 *
 * @packageDocumentation
 */

import type {
  ICarryHooks,
  SafeRequestInfo,
  SafeResponseInfo,
  RetryEvent,
  SafeHookError,
  HookPhase,
} from '../types';
import { redactString } from './redaction';

/** Converts an arbitrary thrown value into a sanitized {@link SafeHookError}. */
function toSafeHookError(error: unknown): SafeHookError {
  if (error instanceof Error) {
    const out: SafeHookError = {
      name: typeof error.name === 'string' && error.name.length > 0 ? error.name : 'Error',
      message: typeof error.message === 'string' ? redactString(error.message) : '',
    };
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      out.code = code;
    } else if (typeof code === 'number') {
      out.code = String(code);
    }
    return out;
  }
  let text: string;
  try {
    text = typeof error === 'string' ? error : String(error);
  } catch {
    text = 'Unknown error';
  }
  return { name: 'Error', message: redactString(text) };
}

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
        hooks.onHookError(Object.freeze(toSafeHookError(error)), phase);
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
