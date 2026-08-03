import { describe, it, expect } from 'vitest';
import { CountriesResource } from '../../src/resources/countries';
import { makeHttp, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';

describe('CountriesResource', () => {
  // Live 2026-07-30: GET /Country/GetAllCountry answers in PascalCase, unlike GetById.
  it('list maps the live PascalCase GetAllCountry entity', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        {
          AllowsBilling: true,
          AllowsShipping: true,
          CurrencyCode: 'LBP',
          DisplayOrder: 1,
          HSCodeFormat: null,
          HSCodeFormatId: 0,
          Id: 125,
          LimitedToStores: false,
          Name: 'Lebanon',
          NumericIsoCode: 422,
          PhoneCode: '961',
          Published: true,
          RequiredNationalShortAddress: false,
          RequiredZipCode: false,
          Terms: null,
          ThreeLetterIsoCode: 'LBN',
          TwoLetterIsoCode: 'LB',
        },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Country/GetAllCountry');
    expect(result[0]).toEqual({
      name: 'Lebanon',
      id: 125,
      allowsBilling: true,
      allowsShipping: true,
      currencyCode: 'LBP',
      displayOrder: 1,
      limitedToStores: false,
      numericIsoCode: 422,
      phoneCode: '961',
      published: true,
      requiredZipCode: false,
      requiresNationalShortAddress: false,
      hsCodeFormatId: 0,
      threeLetterIsoCode: 'LBN',
      twoLetterIsoCode: 'LB',
    });
    // `HSCodeFormat: null` / `Terms: null` are absent, never the string "null".
    expect(result[0]).not.toHaveProperty('hsCodeFormat');
    expect(result[0]).not.toHaveProperty('terms');
    expect(result[0]).not.toHaveProperty('termAliases');
  });

  // One rule for every optional field: an explicit null means absent. Without it `String(null)`
  // yields "null" and `Number(null)` yields 0 — both worse than a missing optional.
  it('treats an explicit null as absent on every optional field, not just the new ones', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        {
          Id: 125,
          Name: 'Lebanon',
          CurrencyCode: null,
          DisplayOrder: null,
          TwoLetterIsoCode: null,
          NumericIsoCode: null,
          AllowsBilling: null,
          Published: null,
          PhoneCode: null,
          Terms: null,
          HSCodeFormat: null,
          HSCodeFormatId: null,
          RequiredNationalShortAddress: null,
        },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    // Nothing but the two required fields survives — no "null" strings, no phantom 0s, no false.
    expect(result[0]).toEqual({ name: 'Lebanon', id: 125 });
  });

  it('reads the alternate acronym spelling of the HS-code fields', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        { id: 190, name: 'Saudi Arabia', h_s_code_format: 'TwelveDigits', h_s_code_format_id: 0 },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(result[0]?.hsCodeFormat).toBe('TwelveDigits');
    expect(result[0]?.hsCodeFormatId).toBe(0);
  });

  // Live 2026-08-03 (lb.icarry.com): all 238 countries carry these keys, but PhoneCode and Terms
  // are null on most of them (see the null test below). Saudi Arabia is one of the ~25 with real
  // Terms, and the only country with RequiredNationalShortAddress: true.
  it('list maps the GetAllCountry-only catalogue fields', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        {
          Id: 190,
          Name: 'Saudi Arabia',
          PhoneCode: '+966',
          HSCodeFormat: 'TwelveDigits',
          HSCodeFormatId: 0,
          RequiredNationalShortAddress: true,
          Terms: 'السعودية,المملكة العربية السعودية,ksa,',
        },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(result[0]).toEqual({
      name: 'Saudi Arabia',
      id: 190,
      phoneCode: '+966',
      hsCodeFormat: 'TwelveDigits',
      hsCodeFormatId: 0,
      requiresNationalShortAddress: true,
      terms: 'السعودية,المملكة العربية السعودية,ksa,',
      termAliases: ['السعودية', 'المملكة العربية السعودية', 'ksa'],
    });
  });

  it('list maps the catalogue fields from snake_case too', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        {
          id: 190,
          name: 'Saudi Arabia',
          phone_code: '+966',
          hs_code_format: 'TwelveDigits',
          hs_code_format_id: 0,
          required_national_short_address: true,
          terms: 'ksa,saudi,',
        },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(result[0]).toEqual({
      name: 'Saudi Arabia',
      id: 190,
      phoneCode: '+966',
      hsCodeFormat: 'TwelveDigits',
      hsCodeFormatId: 0,
      requiresNationalShortAddress: true,
      terms: 'ksa,saudi,',
      termAliases: ['ksa', 'saudi'],
    });
  });

  it('omits terms and termAliases for a country that has no Terms', async () => {
    const mock = sequenceFetch(
      jsonResponse([{ Id: 81, Name: 'Germany', PhoneCode: '+49', HSCodeFormat: 'TwelveDigits' }])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(result[0]).toEqual({
      name: 'Germany',
      id: 81,
      phoneCode: '+49',
      hsCodeFormat: 'TwelveDigits',
    });
    expect(result[0]?.terms).toBeUndefined();
    expect(result[0]?.termAliases).toBeUndefined();
  });

  it('drops the trailing empty element the Terms string always ends with', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        { Id: 81, Name: 'Germany', Terms: 'ألمانيا,' },
        { Id: 1, Name: 'Nowhere', Terms: ',' },
        { Id: 2, Name: 'Spaced', Terms: ' a , ,  b ,' },
        { Id: 3, Name: 'Empty', Terms: '' },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(result[0]?.termAliases).toEqual(['ألمانيا']);
    expect(result[1]?.termAliases).toEqual([]);
    // Interior empties and surrounding whitespace go the same way as the trailing comma.
    expect(result[2]?.termAliases).toEqual(['a', 'b']);
    // An empty Terms is still *present* on the wire, so it maps to '' plus no aliases.
    expect(result[3]?.terms).toBe('');
    expect(result[3]?.termAliases).toEqual([]);
  });

  it('passes non-ASCII aliases through byte-for-byte, without case folding', async () => {
    const wireTerms =
      'uae,الإمارات العربية المتحدة,émirats arabes unis,emiratos árabes unidos,🇦🇪 الإمارات العربية المتحدة,';
    const mock = sequenceFetch(
      jsonResponse([{ Id: 234, Name: 'United Arab Emirates', Terms: wireTerms }])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    // The raw string survives unchanged — trailing comma included.
    expect(result[0]?.terms).toBe(wireTerms);
    expect(result[0]?.termAliases).toEqual([
      'uae',
      'الإمارات العربية المتحدة',
      'émirats arabes unis',
      'emiratos árabes unidos',
      '🇦🇪 الإمارات العربية المتحدة',
    ]);
    // Arabic, accented Latin and the emoji flag must not be normalized, folded or stripped.
    expect(result[0]?.termAliases?.[4]).toContain('🇦🇪');
    expect(result[0]?.termAliases?.join(',')).toBe(wireTerms.slice(0, -1));
  });

  it('list still maps snake_case countries if the endpoint changes casing', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        {
          name: 'Lebanon',
          allows_shipping: true,
          two_letter_iso_code: 'LB',
          numeric_iso_code: 422,
          id: 125,
        },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.list();
    expect(result[0]).toEqual({
      name: 'Lebanon',
      allowsShipping: true,
      twoLetterIsoCode: 'LB',
      numericIsoCode: 422,
      id: 125,
    });
  });

  // Live 2026-07-30: GET /Country/GetById/{id} answers in snake_case, unlike GetAllCountry.
  it('getById maps the live snake_case entity', async () => {
    const mock = sequenceFetch(
      jsonResponse({
        allows_billing: true,
        allows_shipping: true,
        display_order: 1,
        id: 125,
        limited_to_stores: false,
        name: 'Lebanon',
        numeric_iso_code: 422,
        published: true,
        required_zip_code: false,
        three_letter_iso_code: 'LBN',
        two_letter_iso_code: 'LB',
      })
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.getById(125);
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Country/GetById/125');
    expect(result).toEqual({
      name: 'Lebanon',
      id: 125,
      allowsBilling: true,
      allowsShipping: true,
      displayOrder: 1,
      limitedToStores: false,
      numericIsoCode: 422,
      published: true,
      requiredZipCode: false,
      threeLetterIsoCode: 'LBN',
      twoLetterIsoCode: 'LB',
    });
    // GetById does not carry a currency; the field must stay absent rather than empty.
    expect(result.currencyCode).toBeUndefined();
    // The live GetById capture carried none of the GetAllCountry-only catalogue fields either.
    expect(result.phoneCode).toBeUndefined();
    expect(result.terms).toBeUndefined();
    expect(result.termAliases).toBeUndefined();
    expect(result.requiresNationalShortAddress).toBeUndefined();
    expect(result.hsCodeFormat).toBeUndefined();
    expect(result.hsCodeFormatId).toBeUndefined();
  });

  // If iCarry ever adds the catalogue fields to GetById, the mapper already reads them —
  // it is casing-agnostic per field, so no code change is needed to pick them up.
  it('getById maps the catalogue fields if that route ever starts sending them', async () => {
    const mock = sequenceFetch(
      jsonResponse({ id: 190, name: 'Saudi Arabia', phone_code: '+966', terms: 'ksa,' })
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.getById(190);
    expect(result.phoneCode).toBe('+966');
    expect(result.termAliases).toEqual(['ksa']);
  });

  it('getById maps a PascalCase country if that endpoint changes casing', async () => {
    const mock = sequenceFetch(jsonResponse({ Name: 'UAE', Id: 234, AllowsBilling: true }));
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.getById(234);
    expect(result).toEqual({ name: 'UAE', id: 234, allowsBilling: true });
  });

  it('listStates sends the boolean addSelectStateItem query and preserves custom_properties', async () => {
    const mock = sequenceFetch(
      jsonResponse([
        { name: 'Beirut', id: 1837, custom_properties: { region: 'x', extra: { a: 1 } } },
      ])
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.listStates(125, { addSelectStateItem: true });
    expect(sentUrl(mock)).toBe(
      'https://test.icarry.com/api-frontend/Country/GetStatesByCountryId/125?addSelectStateItem=true'
    );
    expect(result[0]?.customProperties).toEqual({ region: 'x', extra: { a: 1 } });
  });

  it('getStateProvinceById maps the entity', async () => {
    const mock = sequenceFetch(
      jsonResponse({ country_id: 125, name: 'Beirut', abbreviation: 'BEY', id: 1837 })
    );
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.getStateProvinceById(1837);
    expect(result).toEqual({ countryId: 125, name: 'Beirut', abbreviation: 'BEY', id: 1837 });
  });
});
