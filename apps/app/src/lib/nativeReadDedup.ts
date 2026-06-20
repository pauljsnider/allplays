/**
 * Short-window dedup for native Firestore REST reads (#2032).
 *
 * Native runtimes bypass the Firestore SDK and hit the REST API directly, which
 * has no caching or in-flight dedup — so two identical reads seconds apart (e.g.
 * Schedule → event → back re-listing the same collection) pay two full HTTP
 * round-trips. This collapses identical reads that happen within `windowMs` into
 * a single request by sharing the in-flight/just-resolved promise.
 *
 * Only idempotent reads should go through here; writes must never be deduped.
 */
type DedupEntry = { promise: Promise<unknown>; expiresAt: number };

const inflight = new Map<string, DedupEntry>();
const defaultWindowMs = 5000;

export function dedupeNativeRead<T>(
  key: string,
  loader: () => Promise<T>,
  { windowMs = defaultWindowMs, now = Date.now }: { windowMs?: number; now?: () => number } = {}
): Promise<T> {
  const timestamp = now();
  const existing = inflight.get(key);
  if (existing && existing.expiresAt > timestamp) {
    return existing.promise as Promise<T>;
  }

  const promise = loader();
  inflight.set(key, { promise, expiresAt: timestamp + windowMs });
  // Drop the entry on failure so a transient error isn't cached for the window.
  promise.catch(() => {
    const current = inflight.get(key);
    if (current && current.promise === promise) {
      inflight.delete(key);
    }
  });
  return promise;
}

export function clearNativeReadDedup() {
  inflight.clear();
}
