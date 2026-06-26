import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    diffNativeReadMetrics,
    recordNativeDedupHit,
    recordNativeRead,
    resetNativeReadMetricsForTests,
    snapshotNativeReadMetrics
} from '../../apps/app/src/lib/nativeReadMetrics.ts';
import { loadDedupedNativeRestRequest } from '../../apps/app/src/lib/nativeRestDedup.ts';

afterEach(() => {
    resetNativeReadMetricsForTests();
    vi.restoreAllMocks();
});

describe('native read metrics', () => {
    it('counts reads and dedup hits and diffs snapshots', () => {
        const start = snapshotNativeReadMetrics();
        recordNativeRead();
        recordNativeRead();
        recordNativeDedupHit();
        const delta = diffNativeReadMetrics(start, snapshotNativeReadMetrics());
        expect(delta).toEqual({ reads: 2, dedupHits: 1 });
    });

    it('records one real read and counts subsequent in-flight requests as dedup hits', async () => {
        resetNativeReadMetricsForTests();
        let resolveLoader;
        const pending = new Promise((resolve) => { resolveLoader = resolve; });
        const loader = vi.fn(() => pending);

        const first = loadDedupedNativeRestRequest('GET:teams/x', loader);
        const second = loadDedupedNativeRestRequest('GET:teams/x', loader); // served from in-flight cache

        resolveLoader('ok');
        await Promise.all([first, second]);

        // Loader ran once; second call was a dedup hit, not a second network read.
        expect(loader).toHaveBeenCalledTimes(1);
        const snap = snapshotNativeReadMetrics();
        expect(snap.reads).toBe(1);
        expect(snap.dedupHits).toBe(1);
    });
});
