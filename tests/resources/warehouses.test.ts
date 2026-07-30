import { describe, it, expect } from 'vitest';
import {
  WarehousesResource,
  toWireCreateMarketplaceWarehouse,
} from '../../src/resources/warehouses';
import { ICarryApiError, ICarryValidationError } from '../../src/errors';
import { makeHttp, sentBody, sentUrl } from '../helpers/http';
import { sequenceFetch, jsonResponse, stringError } from '../helpers/mockFetch';

/**
 * Shape observed live on 2026-07-30 from `GET /Warehouse/GetAll?name=Baabda` — a DataTables
 * envelope whose `Data` records are PascalCase. Values are synthetic; only the keys matter.
 */
const liveGetAllEnvelope = {
  Data: [
    {
      Address: 'Baabda, Lebanon',
      Address1: 'Main street',
      AdminComment: 'main hub',
      AssignedShipmentIds: null,
      AvailableCarriers: null,
      AvailableFulfillmentsLibraries: null,
      AvailableManagers: null,
      AvailableStatuses: null,
      BusinessAccount: null,
      CarrierIcon: null,
      CarrierId: 0,
      CarrierName: null,
      CarrierSystemName: null,
      CustomProperties: {},
      EndDate: null,
      ExternalId: null,
      FulfillmentCost: 0,
      FulfillmentName: null,
      FulfillmentProfit: 0,
      FulfillmentSystemName: null,
      Id: 42,
      IsActive: true,
      IsFulfillmentCenter: false,
      ManageByCustomerId: 0,
      Manager: null,
      ManagerId: 0,
      Name: 'Baabda',
      ShipmentStatusId: 0,
      StartDate: null,
      ThirdParty: false,
      friendlyPluginName: null,
      trackingNumber: null,
    },
  ],
  draw: 0,
  recordsFiltered: 1,
  recordsTotal: 1,
  CustomProperties: {},
  friendlyPluginName: null,
};

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

  it('getById maps a PascalCase warehouse if that endpoint changes casing', async () => {
    const mock = sequenceFetch(jsonResponse({ Name: 'Main', IsActive: true, Id: 9 }));
    const wh = new WarehousesResource(makeHttp(mock));
    expect(await wh.getById(9)).toEqual({ name: 'Main', isActive: true, id: 9 });
  });

  // Live 2026-07-30: GET /Warehouse/GetAll returns a DataTables envelope of PascalCase records,
  // not an array of snake_case entities.
  it('list unwraps the live DataTables envelope and passes the name filter', async () => {
    const mock = sequenceFetch(jsonResponse(liveGetAllEnvelope));
    const wh = new WarehousesResource(makeHttp(mock));
    const result = await wh.list({ name: 'Baabda' });
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Warehouse/GetAll?name=Baabda');
    expect(result).toEqual([{ name: 'Baabda', isActive: true, id: 42, adminComment: 'main hub' }]);
  });

  it('listWithMeta surfaces the envelope record counters', async () => {
    const mock = sequenceFetch(jsonResponse(liveGetAllEnvelope));
    const wh = new WarehousesResource(makeHttp(mock));
    const page = await wh.listWithMeta({ name: 'Baabda' });
    expect(page.warehouses).toHaveLength(1);
    expect(page.recordsTotal).toBe(1);
    expect(page.recordsFiltered).toBe(1);
  });

  it('list still accepts a bare array, with no counters', async () => {
    const mock = sequenceFetch(jsonResponse([{ name: 'A', is_active: true, id: 1 }]));
    const wh = new WarehousesResource(makeHttp(mock));
    const page = await wh.listWithMeta({ name: 'A' });
    expect(sentUrl(mock)).toBe('https://test.icarry.com/api-frontend/Warehouse/GetAll?name=A');
    expect(page.warehouses).toEqual([{ name: 'A', isActive: true, id: 1 }]);
    expect(page.recordsTotal).toBeUndefined();
    expect(page.recordsFiltered).toBeUndefined();
  });

  it('list yields no warehouses for an unusable body', async () => {
    const mock = sequenceFetch(jsonResponse({ recordsTotal: 0 }));
    const wh = new WarehousesResource(makeHttp(mock));
    expect(await wh.list()).toEqual([]);
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
