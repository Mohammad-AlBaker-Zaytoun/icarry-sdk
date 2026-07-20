import { describe, it, expect } from 'vitest';
import { CountriesResource } from '../../src/resources/countries';
import { makeHttp, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse } from '../helpers/mockFetch';

describe('CountriesResource', () => {
  it('list maps snake_case countries to camelCase', async () => {
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
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Country/GetAllCountry');
    expect(result[0]).toEqual({
      name: 'Lebanon',
      allowsShipping: true,
      twoLetterIsoCode: 'LB',
      numericIsoCode: 422,
      id: 125,
    });
  });

  it('getById maps a single country', async () => {
    const mock = sequenceFetch(jsonResponse({ name: 'UAE', id: 234, allows_billing: true }));
    const countries = new CountriesResource(makeHttp(mock));
    const result = await countries.getById(234);
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Country/GetById/234');
    expect(result.allowsBilling).toBe(true);
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
