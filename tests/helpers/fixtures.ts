/**
 * Fake fixture data for tests. NEVER use real card numbers or well-known gateway test PANs
 * (e.g. the iCarry docs' repeating-4242 Visa sample) — the CI secret scan rejects them. The
 * card number below is a synthetic, non-issued sequence used only to exercise redaction/serialization.
 */

export const FAKE_CARD = {
  cardNumber: '1111222233334444',
  cardCvv: '000',
  cardType: 'visa',
  cardName: 'TEST HOLDER',
  cardExpirationMonth: '02',
  cardExpirationYear: '2039',
} as const;

export const FAKE_GEO = { latitude: 33.8938, longitude: 35.5018 } as const;

export const FAKE_PARCEL = {
  quantity: 1,
  weight: '1.5',
  length: '30',
  width: '20',
  height: '10',
} as const;

export const FAKE_MERCHANT_ADDRESS = {
  firstName: 'Test',
  lastName: 'Recipient',
  email: 'recipient@example.com',
  phoneNumber: '01000000000',
  country: 'lebanon',
  city: 'beirut',
  address1: 'Beirut, Lebanon',
} as const;

export const FAKE_ON_DEMAND_ADDRESS = {
  firstName: 'Test',
  lastName: 'Sender',
  email: 'sender@example.com',
  phoneNumber: '0123456789',
  countryId: 234,
  stateProvinceId: 1841,
  address1: 'Dubai, UAE',
} as const;
