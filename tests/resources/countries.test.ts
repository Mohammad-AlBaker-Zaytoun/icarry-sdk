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
      published: true,
      requiredZipCode: false,
      threeLetterIsoCode: 'LBN',
      twoLetterIsoCode: 'LB',
    });
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
