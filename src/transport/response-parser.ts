/**
 * Content-type-driven response parsing.
 *
 * iCarry responses are inconsistent: JSON objects, JSON arrays, bare JSON strings, empty
 * bodies, and (for the packaging slip) possibly binary PDF or a JSON envelope. This module
 * turns a `Response` into a small discriminated union the transport can reason about,
 * without ever blindly assuming JSON.
 *
 * @packageDocumentation
 */

import { ICarryResponseParseError } from '../errors';

/** Desired parse strategy for a request. `'auto'` decides from the response `Content-Type`. */
export type Expect = 'json' | 'text' | 'binary' | 'empty' | 'auto';

/** Discriminated result of {@link parseResponse}. */
export type ParsedResponse =
  | { kind: 'empty'; status: number; ok: boolean; headers: Headers }
  | { kind: 'json'; status: number; ok: boolean; headers: Headers; json: unknown }
  | { kind: 'text'; status: number; ok: boolean; headers: Headers; text: string }
  | {
      kind: 'binary';
      status: number;
      ok: boolean;
      headers: Headers;
      binary: { data: Uint8Array; contentType: string };
    };

function isJsonType(contentType: string): boolean {
  return /application\/(?:[\w.+-]*\+)?json/i.test(contentType) || /\/json\b/i.test(contentType);
}

function isBinaryType(contentType: string): boolean {
  return /^(?:application\/pdf|application\/octet-stream|application\/zip|image\/|audio\/|video\/)/i.test(
    contentType
  );
}

/**
 * Parses a fetch `Response` according to `expect`, inspecting the `Content-Type` when
 * `expect` is `'auto'`.
 *
 * - `204`/`205` and empty bodies → `{ kind: 'empty' }`.
 * - Binary content types → `{ kind: 'binary' }` (never decoded as text).
 * - JSON that fails to parse on a **2xx** response → throws {@link ICarryResponseParseError}.
 * - JSON that fails to parse on a **non-2xx** response → falls back to `{ kind: 'text' }` so
 *   the caller can still surface the raw (often plain-string) error body.
 */
export async function parseResponse(res: Response, expect: Expect): Promise<ParsedResponse> {
  const status = res.status;
  const ok = res.ok;
  const headers = res.headers;
  const contentType = headers.get('content-type') ?? '';

  if (status === 204 || status === 205) {
    return { kind: 'empty', status, ok, headers };
  }

  let mode: Exclude<Expect, 'auto'> = expect === 'auto' ? 'json' : expect;
  if (expect === 'auto') {
    if (isBinaryType(contentType)) {
      mode = 'binary';
    } else if (contentType.startsWith('text/') && !isJsonType(contentType)) {
      mode = 'text';
    } else {
      mode = 'json';
    }
  }

  if (mode === 'binary') {
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength === 0) {
      return { kind: 'empty', status, ok, headers };
    }
    return {
      kind: 'binary',
      status,
      ok,
      headers,
      binary: { data, contentType: contentType || 'application/octet-stream' },
    };
  }

  const text = await res.text();
  if (text.length === 0) {
    return { kind: 'empty', status, ok, headers };
  }
  if (mode === 'empty') {
    // Body was expected to be empty but wasn't; hand it back as text rather than lose it.
    return { kind: 'text', status, ok, headers, text };
  }
  if (mode === 'text') {
    return { kind: 'text', status, ok, headers, text };
  }

  // mode === 'json'
  try {
    const json: unknown = JSON.parse(text);
    return { kind: 'json', status, ok, headers, json };
  } catch {
    if (ok) {
      throw new ICarryResponseParseError(
        `Failed to parse a successful (${status}) response as JSON (content-type: ${
          contentType || 'unknown'
        }).`
      );
    }
    // Non-2xx with an unparseable body (e.g. a bare error string) — preserve it as text.
    return { kind: 'text', status, ok, headers, text };
  }
}
