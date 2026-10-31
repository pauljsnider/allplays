import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../js/live-game-overlay-history.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function getOverlayLiveEventHistory(');
const end = source.indexOf('\n}', start);
if (start < 0 || end < start) throw new Error('Missing history function');
const functionSource = source.slice(start + 'export '.length, end + 2);
function loadWith(getDocs) {
    return new Function('db', 'collection', 'decodeSharedGameSyntheticId', 'query', 'orderBy', 'limit', 'startAfter', 'getDocs',
        `${functionSource}; return getOverlayLiveEventHistory;`)(
        {}, () => 'fixture', () => null, (_ref, ...constraints) => constraints,
        (...args) => ({ order: args }), count => ({ limit: count }), cursor => ({ cursor }), getDocs);
}
const doc = n => ({ id: `id-${n}`, data: () => ({ createdAt: 1000, description: `row ${n}` }) });

it('pages equal timestamps by document cursor with every read limited to20', async () => {
    const first = Array.from({ length: 20 }, (_, n) => doc(n));
    const getDocs = vi.fn().mockResolvedValueOnce({ docs: first, metadata: { fromCache: false } })
        .mockResolvedValueOnce({ docs: [doc(20)], metadata: { fromCache: false } });
    const rows = await loadWith(getDocs)('team', 'game');
    expect(rows).toHaveLength(21);
    expect(new Set(rows.map(row => row.id)).size).toBe(21);
    for (const [constraints] of getDocs.mock.calls) expect(constraints).toContainEqual({ limit: 20 });
    expect(getDocs.mock.calls[1][0]).toContainEqual({ cursor: first[19] });
});

it('does not treat cache-only history as confirmation of deletions', async () => {
    await expect(loadWith(async () => ({ docs: [], metadata: { fromCache: true } }))('team', 'game'))
        .rejects.toThrow('overlay/history-offline');
});

it('cancels between pages after identity changes', async () => {
    let cancelled = false;
    const getDocs = vi.fn(async () => {
        cancelled = true;
        return { docs: Array.from({ length: 20 }, (_, n) => doc(n)), metadata: { fromCache: false } };
    });
    expect(await loadWith(getDocs)('team', 'game', () => cancelled)).toEqual([]);
    expect(getDocs).toHaveBeenCalledTimes(1);
});

it('fails explicitly at100 pages rather than presenting truncated history as complete', async () => {
    const getDocs = vi.fn(async () => ({ docs: Array.from({ length: 20 }, (_, n) => doc(n)), metadata: { fromCache: false } }));
    await expect(loadWith(getDocs)('team', 'game')).rejects.toThrow('overlay/history-limit');
    expect(getDocs).toHaveBeenCalledTimes(100);
});
