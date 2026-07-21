import { describe, it, expect } from 'vitest';
import { redactUrl } from '../../src/transport/redaction';
import { PaymentsResource } from '../../src/resources/payments';
import { ICarryApiError } from '../../src/errors';
import { makeHttp } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';
import { FAKE_CARD } from '../helpers/fixtures';

const NESTED_SECRETS = ['SECRET_REDIRECT', '1111222233334444', 'hunter2'];
const REDIRECT = {
  successUrl: 'https://shop.example/success?token=SECRET_REDIRECT&cardNumber=1111222233334444',
  cancelUrl: 'https://shop.example/cancel?password=hunter2',
  redirectUrl: 'https://shop.example/3ds?token=SECRET_REDIRECT',
};

function assertNoNestedSecrets(text: string): void {
  for (const secret of NESTED_SECRETS) {
    expect(text).not.toContain(secret);
    expect(text).not.toContain(encodeURIComponent(secret));
  }
}

describe('redactUrl masks redirect/success/cancel URL parameters', () => {
  it('masks the entire nested redirect URL value (literal and encoded)', () => {
    const url =
      '/api-frontend/x?successUrl=https%3A%2F%2Fshop%2Fs%3Ftoken%3DSECRET_REDIRECT&cancelUrl=https://shop/c?token=SECRET_REDIRECT&ok=1';
    const out = redactUrl(url);
    expect(out).toContain('successUrl=[REDACTED]');
    expect(out).toContain('cancelUrl=[REDACTED]');
    expect(out).toContain('ok=1');
    assertNoNestedSecrets(out);
  });

  it('masks alias keys (returnUrl, callbackUrl, failureUrl, errorUrl)', () => {
    const out = redactUrl(
      '/x?returnUrl=https://a?token=SECRET_REDIRECT&callbackUrl=b&failureUrl=c&errorUrl=d'
    );
    expect(out).toContain('returnUrl=[REDACTED]');
    expect(out).toContain('callbackUrl=[REDACTED]');
    expect(out).toContain('failureUrl=[REDACTED]');
    expect(out).toContain('errorUrl=[REDACTED]');
  });
});

describe('payment redirect URL leakage through observability', () => {
  it('never leaks nested redirect secrets in the onRequest hook url', async () => {
    const urls: string[] = [];
    const mock = sequenceFetch(jsonResponse({}));
    const payments = new PaymentsResource(
      makeHttp(mock, { hooks: { onRequest: (info) => void urls.push(info.url) } })
    );
    await payments.createShipmentOrder(7, { card: FAKE_CARD, redirect: REDIRECT });
    expect(urls[0]).toContain('successUrl=[REDACTED]');
    assertNoNestedSecrets(urls[0] ?? '');
  });

  it('never leaks nested redirect secrets in a thrown API error', async () => {
    const mock = sequenceFetch(stringError(400, 'Declined'));
    const payments = new PaymentsResource(makeHttp(mock));
    try {
      await payments.createShipmentOrder(7, { card: FAKE_CARD, redirect: REDIRECT });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ICarryApiError);
      const s = JSON.stringify({
        message: (error as Error).message,
        details: (error as ICarryApiError).details,
        string: String(error),
      });
      assertNoNestedSecrets(s);
    }
  });
});
