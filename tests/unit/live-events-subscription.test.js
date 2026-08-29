import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeLiveEventsSnapshot } from '../../js/live-event-utils.js';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

describe('legacy live-event subscriptions', () => {
    it('queries the newest 20 events and normalizes them chronologically', () => {
        expect(dbSource).toContain("query(eventsRef, orderBy('createdAt', 'desc'), limit(20))");
        expect(dbSource).toContain('callback(normalizeLiveEventsSnapshot(snapshot));');
        expect(readFileSync(new URL('../../game-day.html', import.meta.url), 'utf8'))
            .toContain('const recent = state.liveEvents.slice(-10);');

        const fixtures = Array.from({ length: 25 }, (_, index) => ({
            id: `event-${index + 1}`,
            createdAt: 1000 + index
        }));
        const newestTwenty = fixtures.slice(-20).reverse();

        expect(normalizeLiveEventsSnapshot({
            docs: newestTwenty.map((event) => ({
                id: event.id,
                data: () => ({ createdAt: event.createdAt })
            }))
        })).toEqual(Array.from({ length: 20 }, (_, index) => ({
            id: `event-${index + 6}`,
            createdAt: 1005 + index
        })));
    });

    it('keeps completed-game replay loading unbounded and chronological', () => {
        expect(dbSource).toContain("query(eventsRef, orderBy('createdAt', 'asc'))");
        expect(dbSource).toContain('const snapshot = await getDocs(q);');
        const replayLoader = dbSource.slice(dbSource.indexOf('export async function getLiveEvents'), dbSource.indexOf('export function subscribeAggregatedStats'));
        expect(replayLoader).toContain("query(eventsRef, orderBy('createdAt', 'asc'))");
        expect(replayLoader).not.toContain('limit(20)');
    });
});
