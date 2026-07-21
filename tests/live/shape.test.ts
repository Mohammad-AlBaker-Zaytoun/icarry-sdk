import { describe, it, expect } from 'vitest';
import { summarizeShape } from './shape';

describe('summarizeShape (contract capture, no value leakage)', () => {
  it('summarizes primitives and nullish', () => {
    expect(summarizeShape(null)).toEqual({ kind: 'null' });
    expect(summarizeShape(undefined)).toEqual({ kind: 'undefined' });
    expect(summarizeShape('x')).toEqual({ kind: 'string' });
    expect(summarizeShape(1)).toEqual({ kind: 'number' });
    expect(summarizeShape(true)).toEqual({ kind: 'boolean' });
  });

  it('records object property names and value kinds only', () => {
    const s = summarizeShape({ id: 5, name: 'Beirut', active: true, meta: { a: 1 }, tags: [] });
    expect(s).toEqual({
      kind: 'object',
      keys: { id: 'number', name: 'string', active: 'boolean', meta: 'object', tags: 'array' },
    });
    expect(JSON.stringify(s)).not.toContain('Beirut'); // value never recorded
  });

  it('summarizes arrays with distinct element kinds', () => {
    expect(summarizeShape([1, 2, 3])).toEqual({ kind: 'array', length: 3, elements: ['number'] });
    expect(summarizeShape([{ a: 1 }, 'x'])).toEqual({
      kind: 'array',
      length: 2,
      elements: ['object', 'string'],
    });
  });

  it('never leaks sensitive values from a realistic payload', () => {
    const payload = {
      token: 'SECRET_TOKEN_VALUE',
      email: 'person@example.com',
      trackingNumber: '1111222233334444',
      address: '123 Some Street',
      phone: '0100000000',
    };
    const json = JSON.stringify(summarizeShape(payload));
    for (const secret of Object.values(payload)) {
      expect(json).not.toContain(secret);
    }
    expect(summarizeShape(payload).keys).toEqual({
      token: 'string',
      email: 'string',
      trackingNumber: 'string',
      address: 'string',
      phone: 'string',
    });
  });
});
