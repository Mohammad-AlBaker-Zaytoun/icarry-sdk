/**
 * Cycle- and depth-safe deep freeze for observability payloads.
 *
 * Hook payloads are advertised as immutable, so the SDK deep-freezes them. This never
 * mutates a fresh clone's *contents* beyond freezing, tolerates cycles, respects a depth
 * cap, skips binary buffers (freezing a typed array's buffer is pointless and can interact
 * badly with some runtimes), and never throws on unusual values.
 *
 * @packageDocumentation
 */

const DEFAULT_MAX_DEPTH = 12;

function isBinaryLike(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))
  );
}

/**
 * Recursively freezes a plain object/array graph in place and returns it. Non-plain values
 * (functions, class instances, binary buffers) are left unfrozen but not descended into.
 */
export function deepFreeze<T>(value: T, maxDepth: number = DEFAULT_MAX_DEPTH): T {
  freezeInner(value, 0, maxDepth, new WeakSet<object>());
  return value;
}

function freezeInner(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (isBinaryLike(value)) {
    return;
  }
  if (depth >= maxDepth || seen.has(value)) {
    return;
  }
  seen.add(value);

  // Descend before freezing so nested structures are frozen too.
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeInner(item, depth + 1, maxDepth, seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      freezeInner((value as Record<string, unknown>)[key], depth + 1, maxDepth, seen);
    }
  }

  try {
    Object.freeze(value);
  } catch {
    /* never let freezing an exotic object break a request */
  }
}
