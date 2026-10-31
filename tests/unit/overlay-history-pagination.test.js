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

it('fails explicitly beyond2000 records after a bounded overflow probe', async () => {
    const getDocs = vi.fn(async () => ({ docs: Array.from({ length: 20 }, (_, n) => doc(n)), metadata: { fromCache: false } }));
    await expect(loadWith(getDocs)('team', 'game')).rejects.toThrow('overlay/history-limit');
    expect(getDocs).toHaveBeenCalledTimes(101);
    expect(getDocs.mock.calls.at(-1)[0]).toContainEqual({ limit: 1 });
});

it('accepts exactly2000 records when the single-record overflow probe is empty', async () => {
    let page = 0;
    const getDocs = vi.fn(async () => ({
        docs: page++ < 100 ? Array.from({ length: 20 }, (_, n) => doc(page * 20 + n)) : [],
        metadata: { fromCache: false }
    }));
    expect(await loadWith(getDocs)('team', 'game')).toHaveLength(2000);
    expect(getDocs).toHaveBeenCalledTimes(101);
});

const pointStart = source.indexOf('export async function readOverlayLiveEvents(');
if (pointStart < 0 || !source.slice(pointStart).trimEnd().endsWith('}')) throw new Error('Missing point-read helper');
function pointReader(getDoc) {
    return new Function('db', 'doc', 'decodeSharedGameSyntheticId', 'getDoc',
        `${source.slice(pointStart).replace('export ', '')}; return readOverlayLiveEvents;`)(
        {}, (_db, path, id) => `${path}/${id}`, () => null, getDoc);
}
it('selectively distinguishes eviction from deletion using server-confirmed point reads', async () => {
    const getDoc = vi.fn(async path => ({ metadata: { fromCache: false }, id: path.split('/').at(-1),
        exists: () => path.endsWith('/retained'), data: () => ({ id: 'spoofed', value: 2 }) }));
    expect(await pointReader(getDoc)('team', 'game', ['retained', 'deleted'])).toEqual([
        { id: 'retained', row: { id: 'retained', value: 2 } }, { id: 'deleted', row: null }
    ]);
    expect(getDoc).toHaveBeenCalledTimes(2);
});
it('rejects cache absence and invalid or oversized point verification batches', async () => {
    const getDoc = vi.fn(async () => ({ metadata: { fromCache: true } }));
    const read = pointReader(getDoc);
    await expect(read('team', 'game', ['old'])).rejects.toThrow('overlay/history-offline');
    getDoc.mockClear();
    await expect(read('team', 'game', ['../other'])).rejects.toThrow('overlay/invalid-event-id');
    await expect(read('team', 'game', Array(21).fill('old'))).rejects.toThrow('overlay/verification-limit');
    expect(getDoc).not.toHaveBeenCalled();
});
it('cancels selective reads between documents without interpreting unread IDs as deleted', async () => {
    let cancelled = false;
    const getDoc = vi.fn(async () => {
        cancelled = true;
        return { metadata: { fromCache: false }, exists: () => false };
    });
    expect(await pointReader(getDoc)('team', 'game', ['one', 'two'], () => cancelled))
        .toEqual([{ id: 'one', row: null }]);
    expect(getDoc).toHaveBeenCalledTimes(1);
});
