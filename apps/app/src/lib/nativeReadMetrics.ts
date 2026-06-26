// Lightweight counters for native Firestore REST reads, so uxTiming spans can
// report "reads per mount" — the metric that surfaces eager/over-fetching on
// multi-team accounts (see docs/app-performance-baseline.md, issue #2050).
//
// `reads` counts loaders that actually executed a request; `dedupHits` counts
// requests served from the in-flight dedup cache instead of hitting the network.

let reads = 0;
let dedupHits = 0;

export function recordNativeRead() {
  reads += 1;
}

export function recordNativeDedupHit() {
  dedupHits += 1;
}

export type NativeReadSnapshot = { reads: number; dedupHits: number };

export function snapshotNativeReadMetrics(): NativeReadSnapshot {
  return { reads, dedupHits };
}

/** Reads performed (and dedupe hits avoided) between two snapshots. */
export function diffNativeReadMetrics(start: NativeReadSnapshot, end: NativeReadSnapshot): NativeReadSnapshot {
  return {
    reads: end.reads - start.reads,
    dedupHits: end.dedupHits - start.dedupHits
  };
}

/** Test-only: reset counters. */
export function resetNativeReadMetricsForTests() {
  reads = 0;
  dedupHits = 0;
}
