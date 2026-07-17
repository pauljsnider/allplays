import { describe, expect, it, vi } from 'vitest';
import {
    backfillPracticePacketReminderDueAt,
    derivePracticePacketReminderDueAt
} from '../../_migration/backfill-practice-packet-reminder-due-at.js';

function makeHarness(records) {
    const docs = records.map(({ path, data }) => ({
        id: path.split('/').pop(),
        ref: { path },
        data: () => data
    }));
    const queryCalls = [];
    const writes = [];

    function buildQuery(cursor = null, pageSize = docs.length) {
        return {
            orderBy(field) {
                queryCalls.push(['orderBy', field]);
                return this;
            },
            limit(value) {
                pageSize = value;
                queryCalls.push(['limit', value]);
                return this;
            },
            startAfter(docSnap) {
                cursor = docSnap;
                queryCalls.push(['startAfter', docSnap.ref.path]);
                return this;
            },
            async get() {
                const startIndex = cursor
                    ? docs.findIndex((docSnap) => docSnap.ref.path === cursor.ref.path) + 1
                    : 0;
                return { docs: docs.slice(startIndex, startIndex + pageSize) };
            }
        };
    }

    const db = {
        collectionGroup: vi.fn(() => buildQuery()),
        batch: vi.fn(() => ({
            update: vi.fn((ref, value) => writes.push({ path: ref.path, value })),
            commit: vi.fn(async () => undefined)
        }))
    };
    const Timestamp = {
        fromDate: vi.fn((date) => ({ millis: date.getTime() }))
    };

    return { db, Timestamp, queryCalls, writes };
}

describe('practice packet reminder due-at backfill', () => {
    it('derives explicit packet dueAt before falling back to the session date', () => {
        expect(derivePracticePacketReminderDueAt({
            date: '2026-07-22T18:00:00.000Z',
            homePacketContent: { dueAt: '2026-07-20T09:00:00.000Z' }
        })).toEqual(new Date('2026-07-20T09:00:00.000Z'));
        expect(derivePracticePacketReminderDueAt({
            date: '2026-07-22T18:00:00.000Z',
            homePacketContent: {}
        })).toEqual(new Date('2026-07-22T18:00:00.000Z'));
        expect(derivePracticePacketReminderDueAt({
            date: 'invalid',
            homePacketContent: { dueAt: 'also-invalid' }
        })).toBeNull();
    });

    it('paginates all sessions and skips already-migrated or malformed documents on restart', async () => {
        const harness = makeHarness([
            {
                path: 'teams/team-1/practiceSessions/explicit',
                data: {
                    homePacketGenerated: true,
                    date: '2026-07-22T18:00:00.000Z',
                    homePacketContent: { dueAt: '2026-07-20T09:00:00.000Z' }
                }
            },
            {
                path: 'teams/team-1/practiceSessions/fallback',
                data: {
                    homePacketGenerated: true,
                    date: '2026-07-23T18:00:00.000Z',
                    homePacketContent: {}
                }
            },
            {
                path: 'teams/team-2/practiceSessions/malformed',
                data: {
                    homePacketGenerated: true,
                    date: 'invalid',
                    homePacketContent: { dueAt: 'invalid' }
                }
            },
            {
                path: 'teams/team-2/practiceSessions/already-migrated',
                data: {
                    homePacketGenerated: true,
                    homePacketReminderDueAt: { millis: 123 },
                    homePacketContent: { dueAt: '2026-07-24T09:00:00.000Z' }
                }
            }
        ]);

        const result = await backfillPracticePacketReminderDueAt({
            db: harness.db,
            Timestamp: harness.Timestamp,
            pageSize: 2
        });

        expect(result).toEqual({ scanned: 4, updated: 2, skipped: 1, malformed: 1 });
        expect(harness.queryCalls.filter(([name]) => name === 'limit')).toEqual([
            ['limit', 2],
            ['limit', 2],
            ['limit', 2]
        ]);
        expect(harness.queryCalls.filter(([name]) => name === 'startAfter')).toEqual([
            ['startAfter', 'teams/team-1/practiceSessions/fallback'],
            ['startAfter', 'teams/team-2/practiceSessions/already-migrated']
        ]);
        expect(harness.writes).toEqual([
            {
                path: 'teams/team-1/practiceSessions/explicit',
                value: { homePacketReminderDueAt: { millis: Date.parse('2026-07-20T09:00:00.000Z') } }
            },
            {
                path: 'teams/team-1/practiceSessions/fallback',
                value: { homePacketReminderDueAt: { millis: Date.parse('2026-07-23T18:00:00.000Z') } }
            }
        ]);
    });
});
