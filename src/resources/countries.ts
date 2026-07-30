/**
 * Countries & states resource.
 *
 * iCarry returns **two different casings for the same entity**: `GetAllCountry` responds in
 * PascalCase while `GetById` responds in snake_case (verified live 2026-07-30). The country
 * mapper therefore reads both spellings per field. The states endpoint is snake_case and
 * returns an open `custom_properties` dictionary which is preserved verbatim (no recursive
 * key transformation).
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import { encodePathParam } from '../transport/url';
import type { RequestOptions } from '../types';
import { readWireField, requirePositiveId, toRequestFields } from './_shared';

/** A country entity. */
export interface Country {
  name: string;
  id: number;
  allowsBilling?: boolean;
  allowsShipping?: boolean;
  twoLetterIsoCode?: string;
  threeLetterIsoCode?: string;
  numericIsoCode?: number;
  requiredZipCode?: boolean;
  published?: boolean;
  displayOrder?: number;
  limitedToStores?: boolean;
  /**
   * ISO currency code. Returned by `GetAllCountry` ({@link CountriesResource.list}) only —
   * `GetById` does not include it, so it is absent on {@link CountriesResource.getById}.
   */
  currencyCode?: string;
}

/** A state list item. `customProperties` is passed through untouched. */
export interface StateItem {
  name: string;
  id: number;
  customProperties: Record<string, unknown>;
}

/** A state/province entity. */
export interface StateProvince {
  name: string;
  id: number;
  countryId?: number;
  abbreviation?: string;
  published?: boolean;
  displayOrder?: number;
}

/** Options for {@link CountriesResource.listStates}. */
export interface ListStatesOptions extends RequestOptions {
  /** Whether to include a "Select state" placeholder item (`?addSelectStateItem=`). */
  addSelectStateItem?: boolean;
}

/**
 * Maps a country from either casing iCarry uses (`GetAllCountry` is PascalCase, `GetById` is
 * snake_case), so the same mapper is correct for both routes.
 */
function fromWireCountry(wire: Record<string, unknown>): Country {
  const allowsBilling = readWireField(wire, 'AllowsBilling', 'allows_billing');
  const allowsShipping = readWireField(wire, 'AllowsShipping', 'allows_shipping');
  const twoLetterIsoCode = readWireField(wire, 'TwoLetterIsoCode', 'two_letter_iso_code');
  const threeLetterIsoCode = readWireField(wire, 'ThreeLetterIsoCode', 'three_letter_iso_code');
  const numericIsoCode = readWireField(wire, 'NumericIsoCode', 'numeric_iso_code');
  const requiredZipCode = readWireField(wire, 'RequiredZipCode', 'required_zip_code');
  const published = readWireField(wire, 'Published', 'published');
  const displayOrder = readWireField(wire, 'DisplayOrder', 'display_order');
  const limitedToStores = readWireField(wire, 'LimitedToStores', 'limited_to_stores');
  const currencyCode = readWireField(wire, 'CurrencyCode', 'currency_code');
  return {
    name: String(readWireField(wire, 'Name', 'name') ?? ''),
    id: Number(readWireField(wire, 'Id', 'id')),
    ...(allowsBilling !== undefined ? { allowsBilling: Boolean(allowsBilling) } : {}),
    ...(allowsShipping !== undefined ? { allowsShipping: Boolean(allowsShipping) } : {}),
    ...(twoLetterIsoCode !== undefined ? { twoLetterIsoCode: String(twoLetterIsoCode) } : {}),
    ...(threeLetterIsoCode !== undefined ? { threeLetterIsoCode: String(threeLetterIsoCode) } : {}),
    ...(numericIsoCode !== undefined ? { numericIsoCode: Number(numericIsoCode) } : {}),
    ...(requiredZipCode !== undefined ? { requiredZipCode: Boolean(requiredZipCode) } : {}),
    ...(published !== undefined ? { published: Boolean(published) } : {}),
    ...(displayOrder !== undefined ? { displayOrder: Number(displayOrder) } : {}),
    ...(limitedToStores !== undefined ? { limitedToStores: Boolean(limitedToStores) } : {}),
    ...(currencyCode !== undefined ? { currencyCode: String(currencyCode) } : {}),
  };
}

function fromWireState(wire: Record<string, unknown>): StateItem {
  const custom = wire.custom_properties;
  return {
    name: String(wire.name ?? ''),
    id: Number(wire.id),
    customProperties:
      custom && typeof custom === 'object' ? (custom as Record<string, unknown>) : {},
  };
}

function fromWireStateProvince(wire: Record<string, unknown>): StateProvince {
  return {
    name: String(wire.name ?? ''),
    id: Number(wire.id),
    ...(wire.country_id !== undefined ? { countryId: Number(wire.country_id) } : {}),
    ...(wire.abbreviation !== undefined ? { abbreviation: String(wire.abbreviation) } : {}),
    ...(wire.published !== undefined ? { published: Boolean(wire.published) } : {}),
    ...(wire.display_order !== undefined ? { displayOrder: Number(wire.display_order) } : {}),
  };
}

export class CountriesResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists all countries available in the iCarry system. */
  async list(options: RequestOptions = {}): Promise<Country[]> {
    const wire = await this.http.request<Array<Record<string, unknown>>>({
      method: 'GET',
      path: ENDPOINTS.countryGetAll,
      retryable: true,
      ...toRequestFields(options),
    });
    return Array.isArray(wire) ? wire.map(fromWireCountry) : [];
  }

  /** Gets a single country by id. */
  async getById(id: number | string, options: RequestOptions = {}): Promise<Country> {
    requirePositiveId(id, 'id');
    const wire = await this.http.request<Record<string, unknown>>({
      method: 'GET',
      path: `${ENDPOINTS.countryGetById}/${encodePathParam(id)}`,
      retryable: true,
      ...toRequestFields(options),
    });
    return fromWireCountry(wire ?? {});
  }

  /** Lists the states/provinces for a country. */
  async listStates(
    countryId: number | string,
    options: ListStatesOptions = {}
  ): Promise<StateItem[]> {
    requirePositiveId(countryId, 'countryId');
    const { addSelectStateItem, ...rest } = options;
    const wire = await this.http.request<Array<Record<string, unknown>>>({
      method: 'GET',
      path: `${ENDPOINTS.countryGetStatesByCountryId}/${encodePathParam(countryId)}`,
      query: { addSelectStateItem }, // buildQuery skips undefined
      retryable: true,
      ...toRequestFields(rest),
    });
    return Array.isArray(wire) ? wire.map(fromWireState) : [];
  }

  /** Gets a single state/province by its id. */
  async getStateProvinceById(
    id: number | string,
    options: RequestOptions = {}
  ): Promise<StateProvince> {
    requirePositiveId(id, 'id');
    const wire = await this.http.request<Record<string, unknown>>({
      method: 'GET',
      path: `${ENDPOINTS.countryGetStateProvincesById}/${encodePathParam(id)}`,
      retryable: true,
      ...toRequestFields(options),
    });
    return fromWireStateProvince(wire ?? {});
  }
}
