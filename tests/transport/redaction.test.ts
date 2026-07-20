import { describe, it, expect } from 'vitest';
import { redact, redactUrl, maskCardNumber, REDACTED } from '../../src/transport/redaction';

describe('redact', () => {
  it('fully masks password, token, and authorization keys', () => {
    const out = redact({ password: 'hunter2', token: 'abc', Authorization: 'Bearer xyz' });
    expect(out.password).toBe(REDACTED);
    expect(out.token).toBe(REDACTED);
    expect(out.Authorization).toBe(REDACTED);
  });

  it('masks card numbers to last 4 digits', () => {
    const out = redact({ cardNumber: '1111 2222 3333 4111' });
    expect(out.cardNumber).toBe('************4111');
  });

  it('fully removes cvv/cvc/securityCode (never last-4)', () => {
    const out = redact({ cardCVV: '123', cvv: '456', securityCode: '789' });
    expect(out.cardCVV).toBe(REDACTED);
    expect(out.cvv).toBe(REDACTED);
    expect(out.securityCode).toBe(REDACTED);
  });

  it('redacts the exact nopCommerce ConfirmPayment card fields (incl. CardCvv2)', () => {
    const out = redact({
      CardNumber: '1111222233334444',
      CardCvv2: '321',
      CardExpirationMonth: '02',
      CardExpirationYear: '2039',
      CardName: 'HOLDER',
      CardType: 'visa',
      MaskedCreditCardNumber: '1111********4444',
      OrderTotal: 42, // non-sensitive — must survive
    });
    expect(out.CardNumber).toBe('************4444');
    expect(out.CardCvv2).toBe(REDACTED); // regression guard: must not leak
    expect(out.CardExpirationMonth).toBe(REDACTED);
    expect(out.CardExpirationYear).toBe(REDACTED);
    expect(out.CardName).toBe(REDACTED);
    expect(out.CardType).toBe(REDACTED);
    expect(out.OrderTotal).toBe(42);
  });

  it('is case-insensitive across key spellings', () => {
    const out = redact({ PASSWORD: 'p', Card_Number: '1111111111111111', CVV2: '000' });
    expect(out.PASSWORD).toBe(REDACTED);
    expect(out.Card_Number).toBe('************1111');
    expect(out.CVV2).toBe(REDACTED);
  });

  it('recurses into nested objects and arrays', () => {
    const out = redact({
      user: { name: 'ok', password: 'secret' },
      cards: [{ cardNumber: '1000000000000002', cardCVV: '111' }],
    });
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.name).toBe('ok');
    expect(out.cards[0]?.cardNumber).toBe('************0002');
    expect(out.cards[0]?.cardCVV).toBe(REDACTED);
  });

  it('does not mutate the input', () => {
    const input = { password: 'p', nested: { token: 't' } };
    const snapshot = JSON.stringify(input);
    redact(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles cycles without throwing', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe('x');
    expect(out.self).toBe('[circular]');
  });

  it('does not recurse into binary data', () => {
    const out = redact({ blob: new Uint8Array([1, 2, 3]) });
    expect(out.blob).toBe('[binary]');
  });

  it('leaves email untouched by default and masks it when enabled', () => {
    expect(redact({ email: 'a@b.com' }).email).toBe('a@b.com');
    expect(redact({ email: 'alice@b.com' }, { redactEmail: true }).email).toBe('a***@b.com');
  });

  it('caps recursion depth', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 'x' } } } } } } } } };
    const out = JSON.stringify(redact(deep, { maxDepth: 3 }));
    expect(out).toContain('[truncated]');
  });
});

describe('maskCardNumber', () => {
  it('keeps only the last four digits', () => {
    expect(maskCardNumber('1111-1111-1111-1234')).toBe('************1234');
  });
  it('returns REDACTED for too-short input', () => {
    expect(maskCardNumber('12')).toBe(REDACTED);
  });
});

describe('redactUrl', () => {
  it('returns the url unchanged when there is no query', () => {
    expect(redactUrl('https://host/path')).toBe('https://host/path');
  });

  it('masks card query parameters but keeps the path and safe params', () => {
    const url =
      'https://host/api-frontend/SmartwareShipment/CreateShipmentOrder/5?cardNumber=1111222233334444&cardCVV=000&paymentMethodSystemName=Payments.MontyPay';
    const out = redactUrl(url);
    expect(out).toContain('cardNumber=[REDACTED]');
    expect(out).toContain('cardCVV=[REDACTED]');
    expect(out).toContain('paymentMethodSystemName=Payments.MontyPay');
    expect(out).not.toContain('1111222233334444');
  });

  it('works on relative urls', () => {
    expect(redactUrl('/pay?cardNumber=1111111111111111&ok=1')).toBe(
      '/pay?cardNumber=[REDACTED]&ok=1'
    );
  });
});
