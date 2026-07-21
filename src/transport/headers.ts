/**
 * HTTP header name/value validation.
 *
 * Prevents header injection and request smuggling by rejecting invalid header names and any
 * value containing CR, LF, NUL, or other control characters. Applied to caller-supplied
 * default headers, the `User-Agent`, and per-call headers.
 *
 * @packageDocumentation
 */

/** RFC 7230 field-name token characters (`-` placed last so it is literal). */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Whether a header field name is a valid RFC 7230 token. */
export function isValidHeaderName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && HEADER_NAME_RE.test(name);
}

/**
 * Whether a header field value is safe to send: a string with no CR, LF, NUL, or other
 * control characters (a horizontal tab is permitted). This blocks header/response splitting.
 */
export function isValidHeaderValue(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x09) {
      continue; // horizontal tab is allowed in header values
    }
    if (code < 0x20 || code === 0x7f) {
      return false; // control characters (incl. CR 0x0d, LF 0x0a, NUL) are rejected
    }
  }
  return true;
}
