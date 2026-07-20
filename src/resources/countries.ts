/**
 * Countries & states resource. Responses are snake_case entities, mapped here to camelCase.
 * The states endpoint returns an open `custom_properties` dictionary which is preserved
 * verbatim (no recursive key transformation).
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import { encodePathParam } from '../transport/url';
import type { RequestOptions } from '../types';
import { requirePositiveId, toRequestFields } from './_shared';

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

function fromWireCountry(wire: Record<string, unknown>): Country {
  return {
    name: String(wire.name ?? ''),
    id: Number(wire.id),
    ...(wire.allows_billing !== undefined ? { allowsBilling: Boolean(wire.allows_billing) } : {}),
    ...(wire.allows_shipping !== undefined
      ? { allowsShipping: Boolean(wire.allows_shipping) }
      : {}),
    ...(wire.two_letter_iso_code !== undefined
      ? { twoLetterIsoCode: String(wire.two_letter_iso_code) }
      : {}),
    ...(wire.three_letter_iso_code !== undefined
      ? { threeLetterIsoCode: String(wire.three_letter_iso_code) }
      : {}),
    ...(wire.numeric_iso_code !== undefined
      ? { numericIsoCode: Number(wire.numeric_iso_code) }
      : {}),
    ...(wire.required_zip_code !== undefined
      ? { requiredZipCode: Boolean(wire.required_zip_code) }
      : {}),
    ...(wire.published !== undefined ? { published: Boolean(wire.published) } : {}),
    ...(wire.display_order !== undefined ? { displayOrder: Number(wire.display_order) } : {}),
    ...(wire.limited_to_stores !== undefined
      ? { limitedToStores: Boolean(wire.limited_to_stores) }
      : {}),
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
