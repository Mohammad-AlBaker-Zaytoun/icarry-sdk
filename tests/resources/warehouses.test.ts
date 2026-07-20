import { describe, it, expect } from 'vitest';
import {
  WarehousesResource,
  toWireCreateMarketplaceWarehouse,
} from '../../src/resources/warehouses';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';

describe('WarehousesResource', () => {
  it('getById maps the snake_case entity', async () => {
    const mock = sequenceFetch(
      jsonResponse({ name: 'Main', admin_comment: 'c', address_id: 3, is_active: true, id: 9 })
    );
    const wh = new WarehousesResource(makeHttp(mock));
    const result = await wh.getById(9);
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Warehouse/GetById/9');
    expect(result).toEqual({
      name: 'Main',
      adminComment: 'c',
      addressId: 3,
      isActive: true,
      id: 9,
    });
  });

  it('list passes the optional name filter', async () => {
    const mock = sequenceFetch(jsonResponse([{ name: 'A', is_active: true, id: 1 }]));
    const wh = new WarehousesResource(makeHttp(mock));
    const result = await wh.list({ name: 'A' });
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Warehouse/GetAll?name=A');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('A');
  });

  it('createMarketplaceWarehouse serializes country to the wire County field', () => {
    const body = toWireCreateMarketplaceWarehouse({
      name: 'W',
      isActive: true,
      address: {
        firstName: 'F',
        lastName: 'L',
        email: 'e@x.com',
        country: 'lebanon',
        city: 'beirut',
        address1: 'addr',
        phoneNumber: '0100',
      },
    });
    const address = body.Address as Record<string, unknown>;
    expect(address.County).toBe('lebanon');
    expect(address.Country).toBeUndefined();
    expect(body.Name).toBe('W');
  });

  it('createMarketplaceWarehouse maps the PascalCase response and does not retry', async () => {
    const mock = sequenceFetch(
      stringError(503, 'busy'),
      jsonResponse({ Name: 'W', VendorId: 2, IsActive: true, AddressId: 5, Id: 11 })
    );
    const wh = new WarehousesResource(makeHttp(mock));
    await expect(
      wh.createMarketplaceWarehouse({
        name: 'W',
        isActive: true,
        address: {
          firstName: 'F',
          lastName: 'L',
          email: 'e@x.com',
          country: 'lebanon',
          city: 'beirut',
          address1: 'addr',
          phoneNumber: '0100',
        },
      })
    ).rejects.toBeInstanceOf(ICarryApiError);
    expect(mock.calls).toHaveLength(1); // mutating — no retry
  });

  it('validates required address fields', async () => {
    const wh = new WarehousesResource(makeHttp(sequenceFetch(jsonResponse({}))));
    await expect(
      wh.createMarketplaceWarehouse({
        name: 'W',
        isActive: true,
        // @ts-expect-error missing fields intentionally
        address: { firstName: 'F' },
      })
    ).rejects.toBeInstanceOf(ICarryValidationError);
  });
});
