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
| `warehouses.getById` | GET | `/Warehouse/GetById/{id}` | yes | `id` | `Warehouse` | read | — | High (live-verified) | Response is snake_case — see [casing split](#getall-vs-getbyid-casing-split). |
| `warehouses.list` / `listWithMeta` | GET | `/Warehouse/GetAll?name=` | yes | `ListWarehousesOptions` | `Warehouse[]` / `WarehouseListPage` | read | — | Med (live-verified, with caveats) | **Not an array** — a [DataTables envelope](#the-getall-datatables-envelope) of **PascalCase** records. `name` filters server-side. Envelope fields other than `Data`/`recordsTotal`/`recordsFiltered` are not modeled. |
| `warehouses.createMarketplaceWarehouse` | POST | `/Warehouse/createWarehouseForMarketPlace` | yes | `CreateMarketplaceWarehouseInput` | `Warehouse` | never | — | Med | Wire uses `County` for country; response is **PascalCase** (unlike `GetById`). |
| `countries.list` | GET | `/Country/GetAllCountry` | yes | — | `Country[]` | read | — | Med (live-verified, with caveats) | Responds in **PascalCase**, unlike `GetById` — see [casing split](#getall-vs-getbyid-casing-split). Carries six fields `GetById` does not, all mapped: `CurrencyCode`, `PhoneCode`, `HSCodeFormat`, `HSCodeFormatId`, `RequiredNationalShortAddress`, `Terms` — see [catalogue fields](#getallcountry-only-catalogue-fields). |
| `countries.getById` | GET | `/Country/GetById/{id}` | yes | `id` | `Country` | read | — | High (live-verified) | snake_case; carries none of the six [catalogue fields](#getallcountry-only-catalogue-fields), so `currencyCode`, `phoneCode`, `terms`/`termAliases`, `requiresNationalShortAddress`, `hsCodeFormat` and `hsCodeFormatId` are all absent here. |
| `countries.listStates` | GET | `/Country/GetStatesByCountryId/{countryId}?addSelectStateItem=` | yes | `ListStatesOptions` | `StateItem[]` | read | — | High (live-verified) | Plain array of snake_case `{id, name, custom_properties}`; `custom_properties` is an open dict (preserved verbatim). |
| `countries.getStateProvinceById` | GET | `/Country/GetStateProvincesById/{id}` | yes | `id` | `StateProvince` | read | — | High | — |
| `merchant.estimateRates` | POST | `/SmartwareShipment/EstimateRatesByCOD` | yes | `MerchantRateInput` | `MerchantRateResult` (open) | opt-in | — | Med (req), Low (resp) | Body carries both `Dimensions` and `ParcelDimensionsList`; `Unit`/`ZipPostCode` placement unverified; `COdCurrency` casing. Response unverified. |
| `merchant.createOrder` | POST | `/SmartwareShipment/CreateOrder` | yes | `MerchantCreateOrderInput` | `MerchantOrderResult` (open) | never | — | Med (req), Low (resp) | `MethodId`; top-level `Length/Width/Height`; docs duplicate `ToLongitude`; `ProcessOrder`/`ExternalId` sent only if provided. Response unverified. |
| `marketplace.estimateRates` | POST | `/SmartwareShipment/EstimateRatesForMarketplace` | yes | `MarketplaceRateInput` | `MarketplaceRateResult` (open) | opt-in | — | Med (req), Low (resp) | Merchant model + `pickupLocation`. Response seen live **once**; type deliberately **not** narrowed — opt into structure with [`parseMarketplaceRates()`](#provisional-marketplace-rate-options). |
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

## GetAll vs GetById casing split

Verified live against `https://test.icarry.com` on **2026-07-30**: iCarry serves the *same entity*
in **two different casings depending on the route**. This is not documented upstream, and it is not
consistent per resource — it is per route.

| Route | Casing |
|---|---|
| `GET /Country/GetAllCountry` | **PascalCase** (`Name`, `Id`, `TwoLetterIsoCode`, `CurrencyCode`) |
| `GET /Country/GetById/{id}` | snake_case (`name`, `id`, `two_letter_iso_code`) |
| `GET /Country/GetStatesByCountryId/{id}` | snake_case (`id`, `name`, `custom_properties`) |
| `GET /Warehouse/GetAll` | **PascalCase** records (`Name`, `Id`, `IsActive`, `AdminComment`) |
| `GET /Warehouse/GetById/{id}` | snake_case (`name`, `id`, `is_active`, `admin_comment`) |
| `POST /Warehouse/createWarehouseForMarketPlace` | **PascalCase** |

Consequently the `Country` and `Warehouse` mappers read **both spellings per field** rather than one
casing per method. If iCarry flips either route's casing, the mappers keep working; a field that
disappears entirely degrades to an absent optional rather than `{ name: '', id: NaN }`.

## GetAllCountry-only catalogue fields

`GET /Country/GetAllCountry` returns six fields that the recorded `GET /Country/GetById/{id}`
response does not. All six are now modeled, and all six are **absent** on `countries.getById()`
results:

| Wire field (PascalCase) | `Country` property | Type | Live observation |
|---|---|---|---|
| `CurrencyCode` | `currencyCode` | `string` | ISO currency code. |
| `PhoneCode` | `phoneCode` | `string` | **Sparse: `null` on 148 of 238; only 90 (38%) carry a value** (2026-08-03). `"+961"`, `"+1"`, `"+966"` on `lb.icarry.com` — but `"961"`, **without** the `+`, on `test.icarry.com` (2026-07-30). Do not assume presence or prefix. |
| `Terms` | `terms` + `termAliases` | `string` + `readonly string[]` | **Sparse: `null` on 213 of 238; only 25 carry aliases** (2026-08-03). Comma-separated multilingual search aliases with a **trailing comma**. See below. |
| `RequiredNationalShortAddress` | `requiresNationalShortAddress` | `boolean` | `true` for **Saudi Arabia only**; `false` for the other 237 (2026-08-03). |
| `HSCodeFormat` | `hsCodeFormat` | `string` | `"TwelveDigits"` on all 238 records on `lb.icarry.com` (2026-08-03) — but `null` for Lebanon on `test.icarry.com` (2026-07-30). Not uniform across tenants. |
| `HSCodeFormatId` | `hsCodeFormatId` | `number` | `0` on all 238 — no discriminating signal yet. |

The mapper reads both casings per field (`PhoneCode` / `phone_code`, …) like every other `Country`
field, so if iCarry adds any of them to `GetById` they map with no code change. Those snake_case
spellings are **inferred**, not observed — `GetById` has never sent one — so where an acronym makes
the convention ambiguous both forms are read (`hs_code_format` *and* `h_s_code_format`). A spelling
nobody guessed degrades to an absent optional, never to a wrong value.

An explicit `null` is treated as **absent** for every optional `Country` and `StateProvince` field,
not just these six: `null` would otherwise coerce into the string `"null"` (`CurrencyCode`) or the
number `0` (`DisplayOrder`), both worse than a missing optional.

`Terms` is exposed twice on purpose. `terms` is the raw wire string, unmodified; `termAliases` is
that string split on `,`, trimmed, with empty elements dropped — which is what makes the trailing
comma harmless. Its only use is matching what a shopper types against a country, and every consumer
would otherwise re-implement the same split and get the trailing empty element wrong differently.
Aliases are **not** lowercased or normalized by the SDK: they contain Arabic, French, Spanish and
emoji (`"uae,الإمارات العربية المتحدة,émirats arabes unis,🇦🇪 الإمارات العربية المتحدة,"`), and case
folding is locale-sensitive enough to be the caller's decision. `termAliases` is absent whenever
`terms` is.

### What is deliberately *not* built on these

- **No HS-code or customs field is added to any create-order input.** No documented iCarry request
  body — `MerchantCreateOrderInput`, `MarketplaceCreateOrderInput`, `MerchantAddress`, on-demand —
  has a customs, HS-code, duty or declaration field. `HSCodeFormat` is uniform across all 238
  countries including domestic Lebanon, so it reads as catalogue metadata, not a per-shipment
  requirement.
- **`requiresNationalShortAddress` is exposed, not acted on.** Saudi Arabia's national short address
  is a real requirement, but no documented create body accepts one, so there is nowhere to send it.
  The SDK surfaces the flag and leaves the decision to the caller.

**Open question for iCarry** (unanswered as of 2026-08-03): `RequiredNationalShortAddress` is `true`
for Saudi Arabia while no request field accepts a national short address, and `HSCodeFormat` is
advertised per country while no request field carries an HS code. Whether a marketplace shipment to
Saudi Arabia — or any customs-cleared international destination — is actually creatable through this
API as documented, or whether there is an undocumented field, has **not** been confirmed. Worth
asking before relying on either path.

## The GetAll DataTables envelope

`GET /Warehouse/GetAll` does **not** return an array. It returns a DataTables-style envelope:

```jsonc
{
  "Data": [ /* PascalCase warehouse records */ ],
  "draw": 0,
  "recordsFiltered": 1,
  "recordsTotal": 1,
  "CustomProperties": {},
  "friendlyPluginName": null
}
```

`warehouses.list()` unwraps `Data`; `warehouses.listWithMeta()` returns the records plus
`recordsTotal` / `recordsFiltered`. Both still accept a bare array (counters absent in that case) so
a future shape change degrades rather than breaks. The `?name=` filter is applied **server-side**
and is reflected in `recordsFiltered`. `draw`, `CustomProperties` and `friendlyPluginName` are not
modeled. No other list endpoint has been observed using this envelope — `GetAllCountry` and
`GetStatesByCountryId` both return plain arrays.

## Not implemented (intentionally)

The docs' **Platform Plugins** sections — Shopify, WooCommerce, Magento, OpenCart, MANSATI — are
prose/integration guides, not callable REST routes. They are out of scope for this SDK.

## Response parsing (content-type driven)

Endpoints with **High** response confidence (auth, warehouses, countries) parse with strict
`expect: 'json'`. Endpoints with **Low/Med** confidence (all `estimateRates`, `createOrder`,
`createShipment`, payment, MontyPay, `track`, `cancel`) parse with `expect: 'auto'`: JSON content
types parse as JSON; `text/*` and JSON strings return as-is; empty bodies return `undefined`; a
missing/misleading content type is read as text and JSON-parsed only if it parses. These endpoints
therefore never raise `ICarryResponseParseError` for a successful plain-text body. `getPackagingSlip`
returns a binary-or-JSON discriminated union based on the response content type.

Every `expect: 'auto'` endpoint is typed as **`AmbiguousApiResult`** (`object | unknown[] | string |
number | boolean | null | undefined`), not `ExtensibleResponse` — because the parser can legitimately
return any of those and the live shape is unverified. These types must stay `AmbiguousApiResult`
until a repeatable, documented live-contract observation justifies narrowing; a mocked example that
happens to return an object is **not** sufficient. Narrowing after `1.0.0` is a semver-significant
change. `ExtensibleResponse` is reserved for the **High**-confidence, confidently object-shaped
responses above.

### Provisional marketplace rate options

A live call to `EstimateRatesForMarketplace` on **2026-07-30** returned a plain JSON array of
PascalCase rate options:

```text
CODCurrency, CarrierAdminVehicleTypeId, CarrierModel, CarrierTransportationTypeId,
CustomProperties, DeliveryDateFormat, Description, DisplayOrder, Finance,
LocalizedMethodName, MethodBodyInfo, MethodId, MethodName, Name, Price, Rate,
Selected, ShippingRateComputationMethodSystemName, WorkingCurrency, friendlyPluginName
```

That is **one observation from one tenant**, which the policy above says is not enough to narrow
`MarketplaceRateResult`. So the type is unchanged, and the structure is **opt-in** instead:

- `parseMarketplaceRates(result)` → `MarketplaceRateOption[]`. Local, non-throwing, and strict:
  it returns `[]` for any shape it does not recognize and drops individual options missing
  `ShippingRateComputationMethodSystemName`, `MethodId`, or `Rate`. An empty array means "no rates
  **or** unrecognized shape" — the raw result is still yours to inspect. Optional fields are only
  populated when the value is already the right kind, so an object never gets stringified into a
  field.
- `toMarketplaceOrderFields(option)` projects an option onto the four `createOrder` inputs it
  feeds: `ShippingRateComputationMethodSystemName` → `provider`, `MethodId` → `methodId`,
  `Description` → `methodDescription`, and **`Rate` → `price`**.

The `Rate`/`Price` split is the reason this helper exists: `Rate` is the numeric value (`2.121`)
while `Price` is a **formatted display string** (`"$2.12"`). `MarketplaceRateOption` exposes them as
`rate: number` and `formattedPrice?: string` — there is no bare `price` — so a currency-formatted
string cannot reach `createOrder`'s numeric `Price` field by autocomplete accident.

Fields whose type could not be inferred with confidence (`Finance`, `MethodBodyInfo`, `CarrierModel`,
`DeliveryDateFormat`, `CustomProperties`, the carrier type ids, `friendlyPluginName`) are **not**
modeled; every option carries the untouched record on `raw`. Narrowing the method's return type
still requires repeatable observations across tenants. The merchant and on-demand rate endpoints
have **no** such helper — their responses remain unobserved.

## Live-verified (2026-07-30)

Confirmed against the iCarry test tenant (`https://test.icarry.com`) with customer-API
credentials. Read-only calls only.

| Endpoint | Result |
|---|---|
| `POST /Authenticate/GetTokenForCustomerApi` | ✅ Exact match — `token`, `email`, `customer_id`, `api_plugin_type`, `site_url`. |
| `GET /Country/GetAllCountry` | ⚠️ Verified with caveats — PascalCase (was mapped as snake_case; fixed), 249 records, extra fields now modeled as [catalogue fields](#getallcountry-only-catalogue-fields). |
| `GET /Country/GetById/{id}` | ✅ snake_case, as mapped. |
| `GET /Country/GetStatesByCountryId/{id}` | ✅ Plain array of snake_case items; path-param form correct. |
| `GET /Warehouse/GetAll` | ⚠️ Verified with caveats — DataTables envelope of PascalCase records (was mapped as a snake_case array; fixed). `?name=` honoured server-side. |
| `GET /Warehouse/GetById/{id}` | ✅ snake_case, as mapped. |
| `POST /SmartwareShipment/EstimateRatesForMarketplace` | 🔍 Single observation — array of PascalCase rate options. **Type not narrowed**; structure is opt-in via [`parseMarketplaceRates()`](#provisional-marketplace-rate-options). |

The two ⚠️ rows are why their **Confidence** is **Med**, not High: the response contract is now
known but has an undocumented, route-specific shape that iCarry could change again. The 🔍 row is
weaker still — one tenant, one call — so it changes no type at all.

### Live-verified (2026-08-03)

`GET /Country/GetAllCountry` re-observed on a **second tenant** (`lb.icarry.com`), all records
inspected — which is what promoted the six [catalogue fields](#getallcountry-only-catalogue-fields)
from unmodeled to modeled. Two things differ from the 2026-07-30 capture on `test.icarry.com`, and
both are why those fields are typed as optional rather than required:

| Field | `test.icarry.com` (2026-07-30) | `lb.icarry.com` (2026-08-03) |
|---|---|---|
| Record count | 249 | 238 |
| `PhoneCode` (Lebanon) | `"961"` | `"+961"` |
| `HSCodeFormat` (Lebanon) | `null` | `"TwelveDigits"` (all 238) |
| `Terms` (Lebanon) | `null` | populated for the countries checked |

So neither the `+` prefix nor a non-`null` `HSCodeFormat` is a contract — they are tenant- and
record-dependent. The mapper treats `null` as absent, and callers must handle both dialling-prefix
forms. `GET /Country/GetById/{id}` was **not** re-run on 2026-08-03; the claim that it sends none of
the six rests on the 2026-07-30 capture. `smoke.live.test.ts` logs per-field presence for both
routes so the next live run confirms or refutes it.

## Requires live verification

The following cannot be confirmed without live iCarry test credentials and are modeled defensively:

- Exact response schemas for all rate/create/track/confirm/MontyPay operations (returned as open records).
- Whether `EstimateRatesByCOD` honors `Dimensions`, `ParcelDimensionsList`, or both, and the placement
  of `Unit`/`ZipPostCode`.
- Whether the MontyPay return operations require authentication (currently sent authenticated).
- Whether `PdfPackagingSlip` returns binary PDF or a JSON envelope in practice.
