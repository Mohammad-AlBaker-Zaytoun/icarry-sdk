/**
 * Shipment management: tracking, cancellation, deletion, and the packaging slip.
 *
 * ⚠️ `cancel` is a **mutating `GET`** in iCarry's API. The SDK treats it as mutating: it is
 * never cached and never automatically retried. `delete` is a mutating `POST` and is likewise
 * never retried. The packaging slip endpoint is named "Pdf" but may return binary PDF *or* a
 * JSON envelope — the result is content-type driven.
 *
 * Results stay {@link AmbiguousApiResult}. The small `is…` helpers below are **opt-in**,
 * local, non-throwing readers for the specific replies observed live (see API_COVERAGE.md,
 * "Live observations (2026-10)"); they recognise those exact forms and nothing broader.
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import { encodePathParam } from '../transport/url';
import { ICarryApiError } from '../errors';
import type { AmbiguousApiResult, RequestOptions } from '../types';
import { requireNonEmptyString, requirePositiveId, toRequestFields } from './_shared';

/** Unverified tracking result — returned as received. */
export type TrackingResult = AmbiguousApiResult;
/** Unverified cancellation result — returned as received. */
export type CancelResult = AmbiguousApiResult;
/**
 * Deletion result — returned as received. Observed live as the bare text
 * `"shipment Delete success"`; read it with {@link isShipmentDeleteSuccess}.
 */
export type DeleteShipmentResult = AmbiguousApiResult;

/**
 * `true` when a {@link ShipmentsResource.track} result is the bare string `"Created"`.
 *
 * Live tenants (`lb.icarry.com`, `test.icarry.com`, 2026-10) answer `orderTracking` for a
 * shipment that has been created but not yet processed with that single word — not an object,
 * and without echoing the tracking number. A shipment in this state is removed with
 * {@link ShipmentsResource.delete} (by shipment id), not {@link ShipmentsResource.cancel}.
 *
 * The bare label carries no identity, so it is an **eligibility hint**, not proof of which
 * shipment it describes. Comparison is trimmed and case-insensitive; anything else → `false`.
 */
export function isCreatedTrackingResult(result: unknown): boolean {
  return typeof result === 'string' && result.trim().toLowerCase() === 'created';
}

/**
 * `true` only for the success reply observed from `DeleteShipment`: the bare text
 * `"shipment Delete success"` (trimmed, case-insensitive; the `shipment ` prefix optional).
 *
 * Seen 7 times on 2026-10-22 (2 on `lb.icarry.com`, 5 on `test.icarry.com`), each confirmed by a
 * follow-up `track()` that failed with "shipment … not exists" — see
 * {@link isShipmentNotFoundError}. Every other value — `true`, `"deleted"`, an object, an
 * unrecognised string such as `"shipment Delete failed"` — returns `false`: those forms have not
 * been observed, and a false "deleted" would hide a live parcel. Re-check with `track()` before
 * treating the shipment as gone.
 */
export function isShipmentDeleteSuccess(result: unknown): boolean {
  return typeof result === 'string' && /^(?:shipment\s+)?delete\s+success$/i.test(result.trim());
}

const SHIPMENT_NOT_FOUND =
  /\bshipment\b[\s\S]*\b(?:not\s+exists?|not\s+found|does\s+not\s+exist)\b/i;

/**
 * `true` when an error from `track()` (or another by-tracking-number call) says iCarry has no
 * such shipment: an {@link ICarryApiError} whose message reads "shipment … not exists" (the
 * live wording, 2026-10) or similar, or one with HTTP status 404.
 *
 * iCarry answers this way after a `DeleteShipment` and after a cancellation made in its portal
 * before pickup. **Absence is not proof of cancellation or of non-collection**: the same reply
 * can follow a wrong tracking number, a different account, or (for a bare 404) a misconfigured
 * base URL. Treat it as "verify in the portal", never as an automatic success. Non-API errors
 * (network, timeout, validation) always return `false`.
 */
export function isShipmentNotFoundError(error: unknown): boolean {
  if (!(error instanceof ICarryApiError)) {
    return false;
  }
  return error.status === 404 || SHIPMENT_NOT_FOUND.test(error.message);
}

const CANCELLATION_REJECTED =
  /\bcannot\s+cancel(?:led)?\s+this\s+order\b|\bcan(?:not|'t)\s+be\s+cancel(?:led)?\b/i;

/**
 * `true` when iCarry **actively refused** a {@link ShipmentsResource.cancel}: either an
 * {@link ICarryApiError} or a string result reading `"Cannot cancelled this order."` (live
 * wording, sic) or "… cannot be cancelled".
 *
 * This is distinct from a transport failure: the carrier answered and said no. It does not mean
 * the shipment is live or cancelled — check its status — and it is never a reason to resend the
 * mutating request. For a shipment still in `Created` state, {@link ShipmentsResource.delete} is
 * the operation iCarry expects instead.
 */
export function isCancellationRejected(errorOrResult: unknown): boolean {
  if (errorOrResult instanceof ICarryApiError) {
    return CANCELLATION_REJECTED.test(errorOrResult.message);
  }
  return typeof errorOrResult === 'string' && CANCELLATION_REJECTED.test(errorOrResult);
}

/**
 * Packaging-slip result. iCarry's response content type is ambiguous, so the shape is a
 * discriminated union decided at runtime from the `Content-Type`.
 */
export type PackagingSlip =
  | { kind: 'binary'; data: Uint8Array; contentType: string; filename?: string }
  | { kind: 'json'; data: unknown };

function parseFilename(headers: Headers): string | undefined {
  const disposition = headers.get('content-disposition');
  if (!disposition) {
    return undefined;
  }
  const star = /filename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1];
}

export class ShipmentsResource {
  constructor(private readonly http: HttpClient) {}

  /** Tracks a shipment by tracking number. */
  async track(trackingNumber: string, options: RequestOptions = {}): Promise<TrackingResult> {
    requireNonEmptyString(trackingNumber, 'trackingNumber');
    return this.http.request<TrackingResult>({
      method: 'GET',
      path: ENDPOINTS.orderTracking,
      query: { trackingNumber },
      expect: 'auto',
      retryable: true,
      ...toRequestFields(options),
    });
  }

  /**
   * Cancels a shipment by tracking number.
   *
   * ⚠️ Despite being an HTTP `GET`, this **mutates** server state. It is never cached or
   * automatically retried.
   */
  async cancel(trackingNumber: string, options: RequestOptions = {}): Promise<CancelResult> {
    requireNonEmptyString(trackingNumber, 'trackingNumber');
    return this.http.request<CancelResult>({
      method: 'GET',
      path: ENDPOINTS.cancelOrder,
      query: { trackingNumber },
      expect: 'auto',
      retryable: false, // mutating GET — do not retry
      ...toRequestFields(options),
    });
  }

  /**
   * Deletes a shipment by its numeric shipment id (`POST /SmartwareShipment/DeleteShipment/{id}`,
   * no body).
   *
   * Not in iCarry's published docs or OpenAPI; behaviour comes from live use (2026-10). It is the
   * operation for a shipment whose tracking still reads `Created` (see
   * {@link isCreatedTrackingResult}) — `cancel()` is for shipments past that state. Success is
   * the bare text `"shipment Delete success"` (see {@link isShipmentDeleteSuccess}); afterwards
   * `track()` fails with "shipment … not exists".
   *
   * ⚠️ **Mutating** — never automatically retried. On a timeout or network error the shipment
   * may or may not have been deleted: re-check with `track()` rather than calling this again.
   */
  async delete(
    shipmentId: number | string,
    options: RequestOptions = {}
  ): Promise<DeleteShipmentResult> {
    requirePositiveId(shipmentId, 'shipmentId');
    // Validation accepts surrounding whitespace on a string id; send the trimmed id.
    const id = typeof shipmentId === 'string' ? shipmentId.trim() : shipmentId;
    return this.http.request<DeleteShipmentResult>({
      method: 'POST',
      path: `${ENDPOINTS.deleteShipment}/${encodePathParam(id)}`,
      expect: 'auto',
      retryable: false, // mutating — do not retry
      ...toRequestFields(options),
    });
  }

  /**
   * Fetches the packaging slip for a shipment. Returns binary PDF data or a JSON envelope,
   * decided from the response `Content-Type`. Does not write any file.
   */
  async getPackagingSlip(
    shipmentId: number | string,
    options: RequestOptions = {}
  ): Promise<PackagingSlip> {
    requirePositiveId(shipmentId, 'shipmentId');
    const parsed = await this.http.requestRaw({
      method: 'GET',
      path: `${ENDPOINTS.pdfPackagingSlip}/${encodePathParam(shipmentId)}`,
      expect: 'auto',
      // Advertise a binary (PDF) preference while still content-type-auto-parsing the result.
      accept: 'application/pdf, application/octet-stream;q=0.9, application/json;q=0.8, */*;q=0.1',
      retryable: true,
      ...toRequestFields(options),
    });
    if (parsed.kind === 'binary') {
      const filename = parseFilename(parsed.headers);
      return {
        kind: 'binary',
        data: parsed.binary.data,
        contentType: parsed.binary.contentType,
        ...(filename !== undefined ? { filename } : {}),
      };
    }
    if (parsed.kind === 'json') {
      return { kind: 'json', data: parsed.json };
    }
    if (parsed.kind === 'text') {
      return { kind: 'json', data: parsed.text };
    }
    return { kind: 'json', data: undefined };
  }
}
