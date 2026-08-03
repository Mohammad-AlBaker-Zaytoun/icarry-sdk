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
  /**
   * International dialling prefix, e.g. `"+961"`. Present on every country in the
   * `GetAllCountry` response (live 2026-08-03, `lb.icarry.com`, all 238 records).
   *
   * The leading `+` is **not** guaranteed: an earlier capture (`test.icarry.com`, 2026-07-30)
   * returned Lebanon as `"961"`. Normalize before display or dialling rather than assuming
   * either form.
   *
   * Not observed on `GetById` — see {@link Country.currencyCode}.
   */
  phoneCode?: string;
  /**
   * Raw search-alias string exactly as iCarry sends it: comma-separated, multilingual, and with
   * a **trailing comma** — e.g. `"uae,الإمارات العربية المتحدة,émirats arabes unis,"`. Kept for
   * fidelity; use {@link Country.termAliases} for matching.
   *
   * May be `null` on the wire (observed 2026-07-30), in which case this field is absent rather
   * than the string `"null"`. Not observed on `GetById` — see {@link Country.currencyCode}.
   */
  terms?: string;
  /**
   * {@link Country.terms} split on `,`, trimmed, with empty elements dropped — so the wire's
   * trailing comma does not yield a trailing `""`. Absent whenever `terms` is.
   *
   * Aliases are **not** lowercased or otherwise normalized: they contain Arabic, French,
   * Spanish and emoji, and case folding is a locale-sensitive decision that belongs to the
   * consumer, not the SDK.
   */
  termAliases?: readonly string[];
  /**
   * Whether the destination requires a national short address. Live 2026-08-03: `true` for
   * **Saudi Arabia only**, `false` for the other 237 countries.
   *
   * This SDK only surfaces the flag. No documented create-order body accepts a national short
   * address, so there is currently nowhere to send one — what to do about the requirement is
   * the caller's call. Not observed on `GetById` — see {@link Country.currencyCode}.
   */
  requiresNationalShortAddress?: boolean;
  /**
   * Customs HS-code format advertised for the country, e.g. `"TwelveDigits"`. Catalogue
   * metadata only: it is uniform across all 238 countries (live 2026-08-03) including domestic
   * Lebanon, and no SDK request body — merchant, marketplace or on-demand — carries an HS code.
   *
   * May be `null` on the wire (observed 2026-07-30 on `test.icarry.com`), so the value is not
   * uniform across tenants and the field is absent rather than `"null"` in that case. Not
   * observed on `GetById` — see {@link Country.currencyCode}.
   */
  hsCodeFormat?: string;
  /**
   * Numeric companion to {@link Country.hsCodeFormat}. Observed as `0` on all 238 countries
   * (live 2026-08-03), so it carries no discriminating signal yet. Not observed on `GetById` —
   * see {@link Country.currencyCode}.
   */
  hsCodeFormatId?: number;
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
 * Whether a wire value is present enough to map. An explicit `null` counts as **absent**: iCarry
 * sends `null` for fields it has no value for (`HSCodeFormat` and `Terms` were both observed as
 * `null` live on 2026-07-30), and the coercions below would otherwise turn it into the string
 * `"null"` or the number `0` instead of leaving the optional field unset.
 */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Splits iCarry's `Terms` alias string into usable aliases: split on `,`, trim, drop empties —
 * which is what makes the wire's trailing comma harmless. Deliberately does **not** lowercase
 * or fold: aliases are multilingual (Arabic, French, Spanish) and carry emoji, so normalization
 * is the consumer's decision.
 */
function parseTermAliases(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);
}

/**
 * Maps a country from either casing iCarry uses (`GetAllCountry` is PascalCase, `GetById` is
 * snake_case), so the same mapper is correct for both routes.
 *
 * Every optional field uses the same {@link isPresent} test, so `null` never coerces into a
 * bogus value — a `null` `CurrencyCode` would otherwise map to the string `"null"` and a `null`
 * `DisplayOrder` to `0`.
 *
 * The **snake_case** spellings of the six `GetAllCountry`-only fields are *inferred*, not
 * observed: `GetById` has never been seen sending any of them, so there is no capture to copy
 * from. They follow the convention the observed fields use (`TwoLetterIsoCode` →
 * `two_letter_iso_code`). Where an acronym makes that ambiguous — `HSCodeFormat` could
 * reasonably serialize as either `hs_code_format` or `h_s_code_format` — both spellings are
 * read, since {@link readWireField} takes the first present one at no cost. A spelling nobody
 * guessed still degrades to an absent optional, never to a wrong value.
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
  const phoneCode = readWireField(wire, 'PhoneCode', 'phone_code');
  const terms = readWireField(wire, 'Terms', 'terms');
  const requiresNationalShortAddress = readWireField(
    wire,
    'RequiredNationalShortAddress',
    'required_national_short_address'
  );
  const hsCodeFormat = readWireField(wire, 'HSCodeFormat', 'hs_code_format', 'h_s_code_format');
  const hsCodeFormatId = readWireField(
    wire,
    'HSCodeFormatId',
    'hs_code_format_id',
    'h_s_code_format_id'
  );
  const termsText = isPresent(terms) ? String(terms) : undefined;
  return {
    name: String(readWireField(wire, 'Name', 'name') ?? ''),
    id: Number(readWireField(wire, 'Id', 'id')),
    ...(isPresent(allowsBilling) ? { allowsBilling: Boolean(allowsBilling) } : {}),
    ...(isPresent(allowsShipping) ? { allowsShipping: Boolean(allowsShipping) } : {}),
    ...(isPresent(twoLetterIsoCode) ? { twoLetterIsoCode: String(twoLetterIsoCode) } : {}),
    ...(isPresent(threeLetterIsoCode) ? { threeLetterIsoCode: String(threeLetterIsoCode) } : {}),
    ...(isPresent(numericIsoCode) ? { numericIsoCode: Number(numericIsoCode) } : {}),
    ...(isPresent(requiredZipCode) ? { requiredZipCode: Boolean(requiredZipCode) } : {}),
    ...(isPresent(published) ? { published: Boolean(published) } : {}),
    ...(isPresent(displayOrder) ? { displayOrder: Number(displayOrder) } : {}),
    ...(isPresent(limitedToStores) ? { limitedToStores: Boolean(limitedToStores) } : {}),
    ...(isPresent(currencyCode) ? { currencyCode: String(currencyCode) } : {}),
    ...(isPresent(phoneCode) ? { phoneCode: String(phoneCode) } : {}),
    ...(termsText !== undefined
      ? { terms: termsText, termAliases: parseTermAliases(termsText) }
      : {}),
    ...(isPresent(requiresNationalShortAddress)
      ? { requiresNationalShortAddress: Boolean(requiresNationalShortAddress) }
      : {}),
    ...(isPresent(hsCodeFormat) ? { hsCodeFormat: String(hsCodeFormat) } : {}),
    ...(isPresent(hsCodeFormatId) ? { hsCodeFormatId: Number(hsCodeFormatId) } : {}),
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
    ...(isPresent(wire.country_id) ? { countryId: Number(wire.country_id) } : {}),
    ...(isPresent(wire.abbreviation) ? { abbreviation: String(wire.abbreviation) } : {}),
    ...(isPresent(wire.published) ? { published: Boolean(wire.published) } : {}),
    ...(isPresent(wire.display_order) ? { displayOrder: Number(wire.display_order) } : {}),
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
