import { describe, it, expect } from 'vitest';
import { parseResponse } from '../../src/transport/response-parser';
import { ICarryResponseParseError } from '../../src/errors';

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('parseResponse', () => {
  it('parses a JSON object', async () => {
    const r = await parseResponse(json({ id: 1 }), 'json');
    expect(r.kind).toBe('json');
    if (r.kind === 'json') expect(r.json).toEqual({ id: 1 });
  });

  it('parses a JSON array', async () => {
    const r = await parseResponse(json([{ id: 1 }, { id: 2 }]), 'json');
    expect(r.kind).toBe('json');
    if (r.kind === 'json') expect(Array.isArray(r.json)).toBe(true);
  });

  it('parses a bare JSON string', async () => {
    const r = await parseResponse(json('hello'), 'json');
    expect(r.kind).toBe('json');
    if (r.kind === 'json') expect(r.json).toBe('hello');
  });

  it('returns empty for 204', async () => {
    const r = await parseResponse(new Response(null, { status: 204 }), 'json');
    expect(r.kind).toBe('empty');
  });

  it('returns empty for an empty 200 body', async () => {
    const r = await parseResponse(new Response('', { status: 200 }), 'json');
    expect(r.kind).toBe('empty');
  });

  it('returns text for text/plain', async () => {
    const res = new Response('plain words', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    const r = await parseResponse(res, 'text');
    expect(r.kind).toBe('text');
    if (r.kind === 'text') expect(r.text).toBe('plain words');
  });

  it('returns binary for application/pdf', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const res = new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    const r = await parseResponse(res, 'binary');
    expect(r.kind).toBe('binary');
    if (r.kind === 'binary') {
      expect(r.binary.contentType).toContain('application/pdf');
      expect(Array.from(r.binary.data)).toEqual([0x25, 0x50, 0x44, 0x46]);
    }
  });

  it('throws ICarryResponseParseError for invalid JSON on a 2xx', async () => {
    const res = new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(parseResponse(res, 'json')).rejects.toBeInstanceOf(ICarryResponseParseError);
  });

  it('falls back to text for invalid JSON on a non-2xx (plain-string error)', async () => {
    const res = new Response('Unauthorized', {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    const r = await parseResponse(res, 'json');
    expect(r.kind).toBe('text');
    if (r.kind === 'text') expect(r.text).toBe('Unauthorized');
  });

  describe('auto mode (packaging slip)', () => {
    it('detects binary PDF', async () => {
      const res = new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
      const r = await parseResponse(res, 'auto');
      expect(r.kind).toBe('binary');
    });

    it('detects a JSON envelope', async () => {
      const r = await parseResponse(json({ url: 'https://x/y.pdf' }), 'auto');
      expect(r.kind).toBe('json');
    });
  });
});
