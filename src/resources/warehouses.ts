/**
 * Warehouses resource.
 *
 * Two iCarry quirks are absorbed here (both verified live 2026-07-30):
 *
 * - **Mixed casing.** `GetById` returns a snake_case entity, while `GetAll` and
 *   `createWarehouseForMarketPlace` return PascalCase. The mapper reads both spellings per
 *   field, so one public {@link Warehouse} shape covers every route.
 * - **List envelope.** `GetAll` does not return an array; it returns a DataTables-style
 *   `{ Data, draw, recordsFiltered, recordsTotal, … }` envelope, unwrapped by
 *   {@link WarehousesResource.list} / {@link WarehousesResource.listWithMeta}.
 *
 * The create input's country field is serialized to the wire's misspelled `County` (which
 * iCarry uses to mean *country*).
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import { encodePathParam } from '../transport/url';
import { ICarryValidationError } from '../errors';
import type { RequestOptions } from '../types';
import {
  omitUndefined,
  readWireField,
  requireNonEmptyString,
  requirePositiveId,
  toRequestFields,
  unwrapWireList,
} from './_shared';

/** A warehouse / pickup location. */
export interface Warehouse {
  name: string;
  isActive: boolean;
  id: number;
  adminComment?: string;
  addressId?: number;
  vendorId?: number;
  limitedToStores?: boolean;
}

/** Address block for creating a marketplace warehouse. */
export interface MarketplaceWarehouseAddress {
  firstName: string;
  lastName: string;
  email: string;
  /** Country chosen from the iCarry country list (serialized to the wire's `County`). */
  country: string;
  /** City/state chosen from the iCarry list. */
  city: string;
  address1: string;
  phoneNumber: string;
  address2?: string;
  zipPostalCode?: string;
}

/** Input for {@link WarehousesResource.createMarketplaceWarehouse}. */
export interface CreateMarketplaceWarehouseInput {
  name: string;
  isActive: boolean;
  address: MarketplaceWarehouseAddress;
}

/** Options for {@link WarehousesResource.list}. */
export interface ListWarehousesOptions extends RequestOptions {
  /** Optional name filter (`?name=`), applied server-side. */
  name?: string;
}

/** A warehouse list plus the DataTables counters `GetAll` reports alongside it. */
export interface WarehouseListPage {
  warehouses: Warehouse[];
  /** Total records before the `name` filter. Absent if the endpoint returned a bare array. */
  recordsTotal?: number;
  /** Records matching the `name` filter. Absent if the endpoint returned a bare array. */
  recordsFiltered?: number;
}

/**
 * Maps a warehouse from either casing iCarry uses (`GetById` is snake_case; `GetAll` and the
 * marketplace create response are PascalCase), so the same mapper is correct for every route.
 */
function fromWireWarehouse(wire: Record<string, unknown>): Warehouse {
  const adminComment = readWireField(wire, 'AdminComment', 'admin_comment');
  const addressId = readWireField(wire, 'AddressId', 'address_id');
  const vendorId = readWireField(wire, 'VendorId', 'vendor_id');
  const limitedToStores = readWireField(wire, 'LimitedToStores', 'limited_to_stores');
  return {
    name: String(readWireField(wire, 'Name', 'name') ?? ''),
    isActive: Boolean(readWireField(wire, 'IsActive', 'is_active')),
    id: Number(readWireField(wire, 'Id', 'id')),
    ...(adminComment !== undefined ? { adminComment: String(adminComment) } : {}),
    ...(addressId !== undefined ? { addressId: Number(addressId) } : {}),
    ...(vendorId !== undefined ? { vendorId: Number(vendorId) } : {}),
    ...(limitedToStores !== undefined ? { limitedToStores: Boolean(limitedToStores) } : {}),
  };
}

/** Maps the public create input to the exact wire body (note `County`). */
export function toWireCreateMarketplaceWarehouse(
  input: CreateMarketplaceWarehouseInput
): Record<string, unknown> {
  const a = input.address;
  return {
    Name: input.name,
    IsActive: input.isActive,
    Address: omitUndefined({
      FirstName: a.firstName,
      LastName: a.lastName,
      Email: a.email,
      County: a.country, // wire misspelling: iCarry's `County` means country
      City: a.city,
      Address1: a.address1,
      Address2: a.address2,
      ZipPostalCode: a.zipPostalCode,
      PhoneNumber: a.phoneNumber,
    }),
  };
}

function validateCreateInput(input: CreateMarketplaceWarehouseInput): void {
  requireNonEmptyString(input.name, 'name');
  if (typeof input.isActive !== 'boolean') {
    throw new ICarryValidationError('isActive must be a boolean.', 'isActive');
  }
  const a = input.address;
  if (!a || typeof a !== 'object') {
    throw new ICarryValidationError('address is required.', 'address');
  }
  requireNonEmptyString(a.firstName, 'address.firstName');
  requireNonEmptyString(a.lastName, 'address.lastName');
  requireNonEmptyString(a.email, 'address.email');
  requireNonEmptyString(a.country, 'address.country');
  requireNonEmptyString(a.city, 'address.city');
  requireNonEmptyString(a.address1, 'address.address1');
  requireNonEmptyString(a.phoneNumber, 'address.phoneNumber');
}

export class WarehousesResource {
  constructor(private readonly http: HttpClient) {}

  /** Gets a single warehouse by id. */
  async getById(id: number | string, options: RequestOptions = {}): Promise<Warehouse> {
    requirePositiveId(id, 'id');
    const wire = await this.http.request<Record<string, unknown>>({
      method: 'GET',
      path: `${ENDPOINTS.warehouseGetById}/${encodePathParam(id)}`,
      retryable: true,
      ...toRequestFields(options),
    });
    return fromWireWarehouse(wire ?? {});
  }

  /**
   * Lists warehouses, optionally filtered by `name`.
   *
   * Use {@link WarehousesResource.listWithMeta} when you also need the record counters.
   */
  async list(options: ListWarehousesOptions = {}): Promise<Warehouse[]> {
    return (await this.listWithMeta(options)).warehouses;
  }

  /**
   * Lists warehouses and the record counters reported by `GetAll`.
   *
   * `GetAll` answers with a DataTables envelope (`{ Data, recordsTotal, recordsFiltered, … }`);
   * a bare array is still accepted, in which case the counters are absent.
   */
  async listWithMeta(options: ListWarehousesOptions = {}): Promise<WarehouseListPage> {
    const { name, ...rest } = options;
    const wire = await this.http.request<unknown>({
      method: 'GET',
      path: ENDPOINTS.warehouseGetAll,
      query: { name }, // buildQuery skips undefined
      retryable: true,
      ...toRequestFields(rest),
    });
    const { records, recordsTotal, recordsFiltered } = unwrapWireList(wire);
    return {
      warehouses: records.map(fromWireWarehouse),
      ...(recordsTotal !== undefined ? { recordsTotal } : {}),
      ...(recordsFiltered !== undefined ? { recordsFiltered } : {}),
    };
  }

  /**
   * Creates a marketplace warehouse. **Mutating** — never automatically retried.
   */
  async createMarketplaceWarehouse(
    input: CreateMarketplaceWarehouseInput,
    options: RequestOptions = {}
  ): Promise<Warehouse> {
    validateCreateInput(input);
    const wire = await this.http.request<Record<string, unknown>>({
      method: 'POST',
      path: ENDPOINTS.warehouseCreateForMarketplace,
      body: toWireCreateMarketplaceWarehouse(input),
      retryable: false,
      ...toRequestFields(options),
    });
    return fromWireWarehouse(wire ?? {});
  }
}
