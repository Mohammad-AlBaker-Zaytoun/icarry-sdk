/**
 * Shipment management: tracking, cancellation, and the packaging slip.
 *
 * ⚠️ `cancel` is a **mutating `GET`** in iCarry's API. The SDK treats it as mutating: it is
 * never cached and never automatically retried. The packaging slip endpoint is named "Pdf"
 * but may return binary PDF *or* a JSON envelope — the result is content-type driven.
 *
 * @packageDocumentation
 */

import { HttpClient } from '../transport/http-client';
import { ENDPOINTS } from '../constants';
import { encodePathParam } from '../transport/url';
import type { AmbiguousApiResult, RequestOptions } from '../types';
import { requireNonEmptyString, requirePositiveId, toRequestFields } from './_shared';

/** Unverified tracking result — returned as received. */
export type TrackingResult = AmbiguousApiResult;
/** Unverified cancellation result — returned as received. */
export type CancelResult = AmbiguousApiResult;

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
