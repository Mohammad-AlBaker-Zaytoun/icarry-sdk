/**
 * Authentication resource: obtaining and managing the bearer token.
 *
 * Public surface: `client.auth.getToken()`, `.setToken()`, `.clearToken()`, and
 * `.authenticate()`. The wire mapping (`email`/`password` → `Email`/`Password`, and the
 * snake_case token response → camelCase) lives here, close to the endpoint.
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { TokenManager } from '../transport/token-manager';
import { ENDPOINTS } from '../constants';
import {
  ICarryAuthenticationError,
  ICarryConfigurationError,
  ICarryValidationError,
} from '../errors';
import type { ExtensibleResponse } from '../types';
import type { ResolvedAuth } from '../config';

/** Public authentication input. */
export interface AuthenticateRequest {
  email: string;
  password: string;
}

/**
 * Token response. `token` is the only field required for use; the rest mirror iCarry's
 * documented fields (also preserved in their original snake_case form via the index
 * signature). Their exact presence is not guaranteed by the docs.
 */
export interface AuthTokenResponse extends ExtensibleResponse {
  /** The bearer token. */
  token: string;
  /** The authenticated connector email, when returned. */
  email?: string;
  /** Customer id (`customer_id`), when returned. */
  customerId?: number | string;
  /** Plugin type (`api_plugin_type`), when returned. */
  apiPluginType?: string;
  /** Store URL (`site_url`), when returned. */
  siteUrl?: string;
}

/** Maps the public camelCase input to iCarry's exact wire field names. */
export function toWireAuthenticate(req: AuthenticateRequest): Record<string, unknown> {
  return { Email: req.email, Password: req.password };
}

/** Maps the wire token response to the public shape, preserving unknown fields. */
export function fromWireAuthToken(wire: Record<string, unknown>): AuthTokenResponse {
  return {
    ...wire,
    token: typeof wire.token === 'string' ? wire.token : String(wire.token ?? ''),
    ...(typeof wire.email === 'string' ? { email: wire.email } : {}),
    ...(wire.customer_id !== undefined ? { customerId: wire.customer_id as number | string } : {}),
    ...(typeof wire.api_plugin_type === 'string' ? { apiPluginType: wire.api_plugin_type } : {}),
    ...(typeof wire.site_url === 'string' ? { siteUrl: wire.site_url } : {}),
  };
}

function validateAuthenticate(req: AuthenticateRequest): void {
  if (typeof req.email !== 'string' || req.email.trim() === '') {
    throw new ICarryValidationError('email must be a non-empty string.', 'email');
  }
  if (typeof req.password !== 'string' || req.password === '') {
    throw new ICarryValidationError('password must be a non-empty string.', 'password');
  }
}

export class AuthResource {
  constructor(
    private readonly http: HttpClient,
    private readonly tokenManager: TokenManager,
    private readonly auth: ResolvedAuth
  ) {}

  /**
   * Performs the authentication request and returns the full token response. Uses the
   * client-configured credentials unless explicit ones are passed. Does not read or write
   * the cached token — use {@link getToken} for the cached, deduplicated path.
   *
   * @throws {@link ICarryAuthenticationError} if the API returns no token.
   */
  async authenticate(credentials?: AuthenticateRequest): Promise<AuthTokenResponse> {
    const creds = credentials ?? this.auth.credentials;
    if (!creds) {
      throw new ICarryConfigurationError(
        'No credentials configured. Pass { email, password } to authenticate().'
      );
    }
    validateAuthenticate(creds);
    const wire = await this.http.request<Record<string, unknown> | undefined>({
      method: 'POST',
      path: ENDPOINTS.authGetToken,
      auth: false,
      body: toWireAuthenticate(creds),
    });
    const response = fromWireAuthToken(wire ?? {});
    if (!response.token) {
      throw new ICarryAuthenticationError('Authentication succeeded but no token was returned.');
    }
    return response;
  }

  /**
   * Returns a bearer token, acquiring and caching one on first use. Concurrent callers
   * share a single acquisition.
   */
  getToken(): Promise<string> {
    return this.tokenManager.getToken();
  }

  /** Sets the cached bearer token explicitly (e.g. restored from a secret store). */
  setToken(token: string): void {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new ICarryValidationError('token must be a non-empty string.', 'token');
    }
    this.tokenManager.setToken(token);
  }

  /** Clears the cached bearer token. */
  clearToken(): void {
    this.tokenManager.clearToken();
  }

  /**
   * Internal: acquires a fresh token per the configured auth mode. Wired into the token
   * manager as its `acquire` callback (uses `auth:false`, so it never recurses through the
   * token manager).
   */
  async acquireToken(): Promise<string> {
    switch (this.auth.mode) {
      case 'credentials':
        return (await this.authenticate()).token;
      case 'provider': {
        const provider = this.auth.tokenProvider;
        if (!provider) {
          throw new ICarryConfigurationError('tokenProvider mode selected but no provider set.');
        }
        const token = await provider();
        if (!token) {
          throw new ICarryAuthenticationError('tokenProvider returned no token.');
        }
        return token;
      }
      case 'static':
        throw new ICarryAuthenticationError(
          'The configured token was rejected and cannot be refreshed (no credentials provided).'
        );
      case 'none':
        throw new ICarryAuthenticationError(
          'No authentication configured. Provide email/password, a token, or a tokenProvider, or call auth.setToken() before making requests.'
        );
    }
  }
}
