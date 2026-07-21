/**
 * Test helpers for mocking `fetch` and constructing responses. All fixtures use fake data
 * only — see tests/helpers/fixtures.ts.
 */
import { vi } from 'vitest';
import type { FetchLike } from '../../src/transport/http-client';

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(
  text: string,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain', ...headers },
  });
}

export function pdfResponse(bytes: number[], status = 200): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'content-type': 'application/pdf' },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

/** RFC 7807 ProblemDetails error body. */
export function problemDetails(
  status: number,
  detail: string,
  extra: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      Type: 'https://httpstatuses.io/' + status,
      Title: 'Error',
      Status: status,
      Detail: detail,
      ...extra,
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

/** A bare JSON string error body (iCarry's other error shape). */
export function stringError(status: number, message: string): Response {
  return new Response(JSON.stringify(message), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Records each call's (url, init) and returns queued responses in order. */
export interface MockFetch {
  fetch: FetchLike;
  calls: Array<{ url: string; init: RequestInit }>;
  lastBody(): unknown;
}

export function sequenceFetch(...responses: Array<Response | (() => Response)>): MockFetch {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (!next) {
      throw new Error(`mock fetch: no response queued for call ${i}`);
    }
    // Clone Response instances so a queued response reused across calls stays readable
    // (a Response body can only be consumed once).
    return typeof next === 'function' ? next() : next.clone();
  });
  return {
    fetch: fetch as unknown as FetchLike,
    calls,
    lastBody() {
      const last = calls[calls.length - 1];
      const body = last?.init.body;
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  };
}

/**
 * Builds a minimal Response-like object with a controllable (or absent) content-type, for
 * simulating servers that omit or mislabel `Content-Type`. Use via a factory in
 * `sequenceFetch(() => fakeResponse(...))` since it is not a real (cloneable) `Response`.
 */
export function fakeResponse(
  body: string | null,
  opts: { status?: number; contentType?: string | null } = {}
): Response {
  const status = opts.status ?? 200;
  const contentType = opts.contentType === undefined ? null : opts.contentType;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    } as unknown as Headers,
    text: async () => body ?? '',
    arrayBuffer: async () => new TextEncoder().encode(body ?? '').buffer,
  } as unknown as Response;
}

/** A fetch that never resolves until its signal aborts, then rejects with an AbortError. */
export function hangingFetch(): FetchLike {
  return (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) {
        reject(makeAbortError());
        return;
      }
      signal?.addEventListener('abort', () => reject(makeAbortError()), { once: true });
    });
}

export function makeAbortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}
