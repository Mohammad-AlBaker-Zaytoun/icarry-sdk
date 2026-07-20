/**
 * Bearer-token lifecycle manager.
 *
 * Responsibilities:
 * - Acquire a token lazily on first protected use, via an **injected** `acquire()` callback
 *   (so this module never imports the HTTP client or auth resource — breaking the cycle).
 * - Deduplicate concurrent acquisitions behind a single in-flight promise.
 * - Track *ownership*: whether the SDK is able to obtain a fresh token on its own
 *   (credentials / provider modes) or was handed an opaque token it must not discard.
 * - Support a bounded, ownership-gated invalidation for one-time re-auth after a `401`.
 *
 * The token is treated as opaque: there is no expiry assumption and no JWT decoding — an
 * HTTP `401` is the only signal that a token is stale. Nothing is ever persisted to disk
 * or storage; the token lives only in instance memory.
 *
 * @packageDocumentation
 */

/** Construction options for {@link TokenManager}. */
export interface TokenManagerOptions {
  /**
   * Produces a fresh token. Only invoked when there is no cached token and no in-flight
   * acquisition. For static-token / no-auth clients this should reject.
   */
  acquire: () => Promise<string>;
  /** A pre-seeded token (e.g. a static token or a warm-start cache). */
  initialToken?: string;
  /** Whether {@link acquire} can produce a *new* token (credentials/provider modes). */
  canReacquire: boolean;
}

export class TokenManager {
  private token: string | undefined;
  private inFlight: Promise<string> | undefined;
  private readonly acquireFn: () => Promise<string>;
  private readonly canReacquire: boolean;

  constructor(options: TokenManagerOptions) {
    this.acquireFn = options.acquire;
    this.canReacquire = options.canReacquire;
    this.token = options.initialToken;
  }

  /**
   * Returns a bearer token, acquiring one if necessary. Concurrent callers share a single
   * in-flight acquisition, so a burst of parallel requests triggers exactly one login.
   */
  getToken(): Promise<string> {
    if (this.token !== undefined) {
      return Promise.resolve(this.token);
    }
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }
    const pending = this.acquireFn().then((token) => {
      this.token = token;
      return token;
    });
    this.inFlight = pending;
    // Clear the in-flight slot once settled (success or failure) so a later call can retry.
    void pending
      .catch(() => undefined)
      .finally(() => {
        if (this.inFlight === pending) {
          this.inFlight = undefined;
        }
      });
    return pending;
  }

  /** Overwrites the cached token with a caller-supplied value. */
  setToken(token: string): void {
    this.token = token;
  }

  /** Clears the cached token (next protected call re-acquires if able). */
  clearToken(): void {
    this.token = undefined;
  }

  /** Whether the SDK can obtain a fresh token on its own (credentials/provider modes). */
  ownsToken(): boolean {
    return this.canReacquire;
  }

  /** The currently cached token, if any (used by the transport to detect a stale 401). */
  peek(): string | undefined {
    return this.token;
  }

  /**
   * Invalidates the cached token so the next {@link getToken} re-acquires — but only if the
   * SDK owns the acquisition mechanism. The optional `staleToken` guard prevents a slow
   * `401` from clobbering a token another concurrent request has already refreshed.
   */
  invalidate(staleToken?: string): void {
    if (!this.canReacquire) {
      return;
    }
    if (staleToken !== undefined && this.token !== staleToken) {
      return;
    }
    this.token = undefined;
  }
}
