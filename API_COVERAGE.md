# API Coverage

All routes are relative to `{baseUrl}/api-frontend`. Every route except authentication requires an
`Authorization: Bearer <token>` header.

**Retry class:** `read` = idempotent GET, retried by default on transient failures · `opt-in` =
side-effect-free POST, retried only with `{ retry: true }` · `never` = mutating/payment, never
retried. **Sensitivity:** `creds` (password) · `card` (card data) · `—` (none). **Confidence:** how
well iCarry's docs pin down the request/response contract.

| SDK method | HTTP | Route | Auth | Request type | Response type | Retry | Sensitive | Confidence | Known ambiguity |
|---|---|---|---|---|---|---|---|---|---|
| `auth.getToken` / `authenticate` | POST | `/Authenticate/GetTokenForCustomerApi` | no | `AuthenticateRequest` | `AuthTokenResponse` | never | creds | High (req), Med (resp) | Typos in docs (`Emaill`); token treated as opaque. |
| `warehouses.getById` | GET | `/Warehouse/GetById/{id}` | yes | `id` | `Warehouse` | read | — | High | Response is snake_case. |
| `warehouses.list` | GET | `/Warehouse/GetAll?name=` | yes | `ListWarehousesOptions` | `Warehouse[]` | read | — | High | Optional `name` filter. |
| `warehouses.createMarketplaceWarehouse` | POST | `/Warehouse/createWarehouseForMarketPlace` | yes | `CreateMarketplaceWarehouseInput` | `Warehouse` | never | — | Med | Wire uses `County` for country; response is **PascalCase** (unlike the GETs). |
| `countries.list` | GET | `/Country/GetAllCountry` | yes | — | `Country[]` | read | — | High | — |
| `countries.getById` | GET | `/Country/GetById/{id}` | yes | `id` | `Country` | read | — | High | — |
| `countries.listStates` | GET | `/Country/GetStatesByCountryId/{countryId}?addSelectStateItem=` | yes | `ListStatesOptions` | `StateItem[]` | read | — | High | `custom_properties` is an open dict (preserved verbatim). |
| `countries.getStateProvinceById` | GET | `/Country/GetStateProvincesById/{id}` | yes | `id` | `StateProvince` | read | — | High | — |
| `merchant.estimateRates` | POST | `/SmartwareShipment/EstimateRatesByCOD` | yes | `MerchantRateInput` | `MerchantRateResult` (open) | opt-in | — | Med (req), Low (resp) | Body carries both `Dimensions` and `ParcelDimensionsList`; `Unit`/`ZipPostCode` placement unverified; `COdCurrency` casing. Response unverified. |
| `merchant.createOrder` | POST | `/SmartwareShipment/CreateOrder` | yes | `MerchantCreateOrderInput` | `MerchantOrderResult` (open) | never | — | Med (req), Low (resp) | `MethodId`; top-level `Length/Width/Height`; docs duplicate `ToLongitude`; `ProcessOrder`/`ExternalId` sent only if provided. Response unverified. |
| `marketplace.estimateRates` | POST | `/SmartwareShipment/EstimateRatesForMarketplace` | yes | `MarketplaceRateInput` | `MarketplaceRateResult` (open) | opt-in | — | Med (req), Low (resp) | Merchant model + `pickupLocation`. |
| `marketplace.createOrder` | POST | `/SmartwareShipment/CreateOrderForMarketPlace` | yes | `MarketplaceCreateOrderInput` | `MarketplaceOrderResult` (open) | never | — | Med (req), Low (resp) | Merchant model + `pickupLocation`; `MethodId`. |
| `onDemand.estimateRates` | POST | `/SmartwareShipment/EstimateRates` | yes | `OnDemandRateInput` | `OnDemandRateResult` (open) | opt-in | — | Med (req), Low (resp) | Country/state **ids**, `From`/`To` geo, `CODCurrency` (proper casing). Response unverified. |
| `onDemand.createShipment` | POST | `/SmartwareShipment/CreateOnDemandShipment` | yes | `OnDemandCreateShipmentInput` | `OnDemandShipmentResult` (open) | never | — | Med (req), Low (resp) | `MethodName` (not `MethodId`); id-based addresses. Expected to return a shipment id (unverified). |
| `payments.createShipmentOrder` | POST | `/SmartwareShipment/CreateShipmentOrder/{shipmentId}?card…` | yes | `CreateShipmentOrderInput` | `PaymentResult` (open) | never | **card** | Med (req), Low (resp) | **SERVER-ONLY.** Card data in query string; redacted everywhere; URL never surfaced. |
| `payments.confirmPayment` | POST | `/SmartwareShipment/ConfirmPayment/{shipmentId}` | yes | `ConfirmPaymentInput` (open) | `PaymentResult` (open) | never | **card** | Low | Large nopCommerce order body; schema unverified — pass wire (PascalCase) fields. |
| `payments.processMontyPaySuccess` | POST | `/SmartwareShipment/montyPaySuccessReturnUrl?orderId=&shipmentId=` | yes | `MontyPayReturnInput` | `PaymentResult` (open) | never | — | Low | **No** callback signature verification is performed or claimed. |
| `payments.processMontyPayCancellation` | POST | `/SmartwareShipment/montyPayCancelReturnUrl?orderId=&shipmentId=` | yes | `MontyPayReturnInput` | `PaymentResult` (open) | never | — | Low | No signature verification. |
| `shipments.track` | GET | `/SmartwareShipment/orderTracking?trackingNumber=` | yes | `trackingNumber` | `TrackingResult` (open) | read | — | Med (req), Low (resp) | Response unverified. |
| `shipments.cancel` | GET | `/SmartwareShipment/CancelOrder?trackingNumber=` | yes | `trackingNumber` | `CancelResult` (open) | never | — | Med | **Mutating GET** — not cached or retried. |
| `shipments.getPackagingSlip` | GET | `/SmartwareShipment/PdfPackagingSlip/{shipmentId}` | yes | `shipmentId` | `PackagingSlip` (binary \| json) | read | — | Low | Named "Pdf" but content type is ambiguous; handled at runtime. |

## Not implemented (intentionally)

The docs' **Platform Plugins** sections — Shopify, WooCommerce, Magento, OpenCart, MANSATI — are
prose/integration guides, not callable REST routes. They are out of scope for this SDK.

## Requires live verification

The following cannot be confirmed without live iCarry test credentials and are modeled defensively:

- Exact response schemas for all rate/create/track/confirm/MontyPay operations (returned as open records).
- Whether `EstimateRatesByCOD` honors `Dimensions`, `ParcelDimensionsList`, or both, and the placement
  of `Unit`/`ZipPostCode`.
- Whether the MontyPay return operations require authentication (currently sent authenticated).
- Whether `PdfPackagingSlip` returns binary PDF or a JSON envelope in practice.
