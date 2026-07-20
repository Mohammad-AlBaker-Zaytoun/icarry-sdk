import { describe, it, expect, vi } from 'vitest';
import { TokenManager } from '../../src/transport/token-manager';

describe('TokenManager', () => {
  it('returns a pre-seeded token without acquiring', async () => {
    const acquire = vi.fn(async () => 'fresh');
    const tm = new TokenManager({ acquire, initialToken: 'seed', canReacquire: false });
    expect(await tm.getToken()).toBe('seed');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('acquires lazily and caches the result', async () => {
    const acquire = vi.fn(async () => 'token-1');
    const tm = new TokenManager({ acquire, canReacquire: true });
    expect(await tm.getToken()).toBe('token-1');
    expect(await tm.getToken()).toBe('token-1');
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent acquisitions into a single call', async () => {
    let resolve!: (v: string) => void;
    const acquire = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const tm = new TokenManager({ acquire, canReacquire: true });

    const p1 = tm.getToken();
    const p2 = tm.getToken();
    const p3 = tm.getToken();
    resolve('shared');

    expect(await Promise.all([p1, p2, p3])).toEqual(['shared', 'shared', 'shared']);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a failed acquisition (in-flight slot cleared)', async () => {
    const acquire = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce('token-2');
    const tm = new TokenManager({ acquire, canReacquire: true });

    await expect(tm.getToken()).rejects.toThrow('first fails');
    expect(await tm.getToken()).toBe('token-2');
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('invalidate() re-acquires only when the SDK owns the token', async () => {
    const acquire = vi.fn(async () => 'reacquired');
    const owned = new TokenManager({ acquire, initialToken: 'old', canReacquire: true });
    owned.invalidate();
    expect(await owned.getToken()).toBe('reacquired');
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('invalidate() is a no-op for a caller-supplied (unowned) token', async () => {
    const acquire = vi.fn(async () => 'reacquired');
    const unowned = new TokenManager({ acquire, initialToken: 'static', canReacquire: false });
    unowned.invalidate();
    expect(await unowned.getToken()).toBe('static');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('invalidate(staleToken) does not clobber a newer token', async () => {
    const tm = new TokenManager({
      acquire: async () => 'x',
      initialToken: 'new',
      canReacquire: true,
    });
    tm.invalidate('stale-and-gone');
    expect(tm.peek()).toBe('new');
  });

  it('reflects ownership via ownsToken()', () => {
    expect(new TokenManager({ acquire: async () => 'x', canReacquire: true }).ownsToken()).toBe(
      true
    );
    expect(new TokenManager({ acquire: async () => 'x', canReacquire: false }).ownsToken()).toBe(
      false
    );
  });

  it('setToken()/clearToken() manage the cache', async () => {
    const acquire = vi.fn(async () => 'acquired');
    const tm = new TokenManager({ acquire, canReacquire: true });
    tm.setToken('manual');
    expect(await tm.getToken()).toBe('manual');
    tm.clearToken();
    expect(await tm.getToken()).toBe('acquired');
  });
});
