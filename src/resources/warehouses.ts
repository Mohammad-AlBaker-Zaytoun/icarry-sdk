/**
 * Warehouses resource.
 *
 * Note the two response casings iCarry uses: the `GetById`/`GetAll` reads return snake_case
 * entities, while `createWarehouseForMarketPlace` returns PascalCase — mapped here into one
 * public {@link Warehouse} shape. The create input's country field is serialized to the
 * wire's misspelled `County` (which iCarry uses to mean *country*).
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
  requireNonEmptyString,
  requirePositiveId,
  toRequestFields,
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
  /** Optional name filter (`?name=`). */
  name?: string;
}

function fromWireWarehouseSnake(wire: Record<string, unknown>): Warehouse {
  return {
    name: String(wire.name ?? ''),
    isActive: Boolean(wire.is_active),
    id: Number(wire.id),
    ...(wire.admin_comment !== undefined ? { adminComment: String(wire.admin_comment) } : {}),
    ...(wire.address_id !== undefined ? { addressId: Number(wire.address_id) } : {}),
  };
}

function fromWireWarehousePascal(wire: Record<string, unknown>): Warehouse {
  return {
    name: String(wire.Name ?? ''),
    isActive: Boolean(wire.IsActive),
    id: Number(wire.Id),
    ...(wire.AdminComment !== undefined ? { adminComment: String(wire.AdminComment) } : {}),
    ...(wire.AddressId !== undefined ? { addressId: Number(wire.AddressId) } : {}),
    ...(wire.VendorId !== undefined ? { vendorId: Number(wire.VendorId) } : {}),
    ...(wire.LimitedToStores !== undefined
      ? { limitedToStores: Boolean(wire.LimitedToStores) }
      : {}),
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
    return fromWireWarehouseSnake(wire ?? {});
  }

  /** Lists warehouses, optionally filtered by `name`. */
  async list(options: ListWarehousesOptions = {}): Promise<Warehouse[]> {
    const { name, ...rest } = options;
    const wire = await this.http.request<Array<Record<string, unknown>>>({
      method: 'GET',
      path: ENDPOINTS.warehouseGetAll,
      query: { name }, // buildQuery skips undefined
      retryable: true,
      ...toRequestFields(rest),
    });
    return Array.isArray(wire) ? wire.map(fromWireWarehouseSnake) : [];
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
    return fromWireWarehousePascal(wire ?? {});
  }
}
