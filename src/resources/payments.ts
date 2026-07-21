/**
 * Payment operations for the on-demand flow.
 *
 * ⚠️ **SERVER-ONLY.** {@link PaymentsResource.createShipmentOrder} transmits card data as
 * **query-string parameters** — this is iCarry's contract, not the SDK's design. The SDK
 * preserves that contract exactly but redacts every card parameter from hooks, logs, and
 * errors and never exposes the serialized payment URL. Never call these methods from a
 * browser or any client-side context, never log the raw input, and do not treat the SDK as
 * a card vault. The SDK stores nothing and makes no PCI-compliance claim.
 *
 * MontyPay return operations are thin wrappers over iCarry's return URLs. The SDK does **not**
 * verify any payment callback signature (iCarry documents none) — never treat a return call
 * as proof of payment.
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import { encodePathParam } from '../transport/url';
import { ICarryValidationError } from '../errors';
import type { ExtensibleResponse, RequestOptions } from '../types';
import {
  requireNonEmptyString,
  requirePositiveId,
  requireAbsoluteHttpsUrl,
  toRequestFields,
} from './_shared';

/** Card details for {@link PaymentsResource.createShipmentOrder}. Never persisted by the SDK. */
export interface PaymentCardInput {
  cardNumber: string;
  cardCvv: string;
  cardType: string;
  cardName: string;
  /** Expiry month, `1`–`12` (or a 2-digit string). */
  cardExpirationMonth: string | number;
  /** Expiry year (e.g. `2039` or `"39"`). */
  cardExpirationYear: string | number;
}

/** Optional redirect URLs for the hosted payment flow. */
export interface PaymentRedirectUrls {
  redirectUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
}

/** Input for {@link PaymentsResource.createShipmentOrder}. */
export interface CreateShipmentOrderInput {
  card: PaymentCardInput;
  /** Defaults to `"Payments.MontyPay"`. */
  paymentMethodSystemName?: string;
  redirect?: PaymentRedirectUrls;
}

/**
 * Body for {@link PaymentsResource.confirmPayment}. iCarry's ConfirmPayment expects a large
 * order object (PascalCase wire fields); its schema is unverified, so this is an open record
 * you populate with the fields iCarry requires. Any card fields present are redacted from
 * hooks/errors.
 */
export type ConfirmPaymentInput = Record<string, unknown>;

/** Input for the MontyPay return operations. */
export interface MontyPayReturnInput {
  orderId: number | string;
  shipmentId: number | string;
}

/** Unverified result — returned as received (often a bare string). */
export type PaymentResult = ExtensibleResponse | string;

function validateCard(card: PaymentCardInput): void {
  if (!card || typeof card !== 'object') {
    throw new ICarryValidationError('card is required.', 'card');
  }
  requireNonEmptyString(card.cardNumber, 'card.cardNumber');
  requireNonEmptyString(card.cardCvv, 'card.cardCvv');
  requireNonEmptyString(card.cardType, 'card.cardType');
  requireNonEmptyString(card.cardName, 'card.cardName');
  const month = Number(card.cardExpirationMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ICarryValidationError(
      'card.cardExpirationMonth must be an integer between 1 and 12.',
      'card.cardExpirationMonth'
    );
  }
  // A non-empty numeric year (2- or 4-digit, e.g. "39" or "2039"). Not a compliance check.
  if (!/^[0-9]{2,4}$/.test(String(card.cardExpirationYear).trim())) {
    throw new ICarryValidationError(
      'card.cardExpirationYear must be a numeric year (e.g. 2039 or 39).',
      'card.cardExpirationYear'
    );
  }
}

export class PaymentsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Creates and pays for an on-demand shipment order.
   *
   * ⚠️ **SERVER-ONLY.** Card data is sent as query parameters per iCarry's contract. The SDK
   * redacts these everywhere it surfaces requests and never exposes the payment URL, but the
   * caller must never invoke this from a browser and must not log the raw input. **Mutating +
   * payment — never automatically retried.**
   *
   * @param shipmentId - The shipment id returned by `onDemand.createShipment`.
   */
  async createShipmentOrder(
    shipmentId: number | string,
    input: CreateShipmentOrderInput,
    options: RequestOptions = {}
  ): Promise<PaymentResult> {
    requirePositiveId(shipmentId, 'shipmentId');
    validateCard(input.card);
    if (input.paymentMethodSystemName !== undefined) {
      requireNonEmptyString(input.paymentMethodSystemName, 'paymentMethodSystemName');
    }
    const card = input.card;
    const redirect = input.redirect ?? {};
    if (redirect.redirectUrl !== undefined) {
      requireAbsoluteHttpsUrl(redirect.redirectUrl, 'redirect.redirectUrl');
    }
    if (redirect.successUrl !== undefined) {
      requireAbsoluteHttpsUrl(redirect.successUrl, 'redirect.successUrl');
    }
    if (redirect.cancelUrl !== undefined) {
      requireAbsoluteHttpsUrl(redirect.cancelUrl, 'redirect.cancelUrl');
    }
    return this.http.request<PaymentResult>({
      method: 'POST',
      path: `${ENDPOINTS.createShipmentOrder}/${encodePathParam(shipmentId)}`,
      query: {
        cardNumber: card.cardNumber,
        cardCVV: card.cardCvv,
        cardType: card.cardType,
        cardName: card.cardName,
        cardExpirationMonth: String(card.cardExpirationMonth),
        cardExpirationYear: String(card.cardExpirationYear),
        redirectUrl: redirect.redirectUrl,
        successUrl: redirect.successUrl,
        cancelUrl: redirect.cancelUrl,
        paymentMethodSystemName: input.paymentMethodSystemName ?? 'Payments.MontyPay',
      },
      expect: 'auto',
      retryable: false, // payment — never retried
      ...toRequestFields(options),
    });
  }

  /**
   * Confirms a payment for a shipment.
   *
   * ⚠️ **SERVER-ONLY.** The body may include card fields (redacted from hooks/errors).
   * **Mutating + payment — never automatically retried.**
   */
  async confirmPayment(
    shipmentId: number | string,
    body: ConfirmPaymentInput,
    options: RequestOptions = {}
  ): Promise<PaymentResult> {
    requirePositiveId(shipmentId, 'shipmentId');
    if (!body || typeof body !== 'object') {
      throw new ICarryValidationError('body is required.', 'body');
    }
    return this.http.request<PaymentResult>({
      method: 'POST',
      path: `${ENDPOINTS.confirmPayment}/${encodePathParam(shipmentId)}`,
      body,
      expect: 'auto',
      retryable: false,
      ...toRequestFields(options),
    });
  }

  /**
   * Invokes the MontyPay success return URL.
   *
   * ⚠️ The SDK does **not** verify any callback signature (iCarry documents none). Never
   * treat this as proof of payment — verify order/payment status server-side. **Mutating —
   * never automatically retried.**
   */
  async processMontyPaySuccess(
    input: MontyPayReturnInput,
    options: RequestOptions = {}
  ): Promise<PaymentResult> {
    requirePositiveId(input.orderId, 'orderId');
    requirePositiveId(input.shipmentId, 'shipmentId');
    return this.http.request<PaymentResult>({
      method: 'POST',
      path: ENDPOINTS.montyPaySuccessReturnUrl,
      query: { orderId: input.orderId, shipmentId: input.shipmentId },
      expect: 'auto',
      retryable: false,
      ...toRequestFields(options),
    });
  }

  /**
   * Invokes the MontyPay cancel return URL. No signature verification is performed.
   * **Mutating — never automatically retried.**
   */
  async processMontyPayCancellation(
    input: MontyPayReturnInput,
    options: RequestOptions = {}
  ): Promise<PaymentResult> {
    requirePositiveId(input.orderId, 'orderId');
    requirePositiveId(input.shipmentId, 'shipmentId');
    return this.http.request<PaymentResult>({
      method: 'POST',
      path: ENDPOINTS.montyPayCancelReturnUrl,
      query: { orderId: input.orderId, shipmentId: input.shipmentId },
      expect: 'auto',
      retryable: false,
      ...toRequestFields(options),
    });
  }
}
