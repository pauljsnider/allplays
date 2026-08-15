import { describe, expect, it, vi } from 'vitest';
import {
    buildCalendarGameMaterializationId,
    getCalendarOccurrenceTrackingId,
    materializeCalendarGame
} from '../../js/calendar-game-materialization.js';

const TEAM_ID = 'team-1';
const CALENDAR_EVENT_ID = 'calendar-uid-1';
const STARTS_AT = new Date('2026-08-16T15:00:00.000Z');

function buildDependencies({ existingDocs = [], storedDocs = new Map(), cryptoApi = globalThis.crypto } = {}) {
    const writes = [];
    const dependencies = {
        db: { name: 'test-db' },
        auth: { currentUser: { uid: 'coach-1' } },
        cryptoApi,
        now: () => new Date('2026-08-15T12:00:00.000Z'),
        collection: vi.fn((_db, path) => ({ path })),
        where: vi.fn((field, operator, value) => ({ field, operator, value })),
        limit: vi.fn((value) => ({ value })),
        query: vi.fn((collectionRef, ...constraints) => ({ collectionRef, constraints })),
        getDocs: vi.fn(async () => ({
            docs: existingDocs.map((entry) => ({
                id: entry.id,
                data: () => entry.data
            }))
        })),
        doc: vi.fn((_db, path) => ({ id: path.split('/').pop(), path })),
        serverTimestamp: vi.fn(() => 'server-timestamp'),
        runTransaction: vi.fn(async (_db, callback) => callback({
            get: async (ref) => ({
                exists: () => storedDocs.has(ref.id),
                data: () => storedDocs.get(ref.id)
            }),
            set: (ref, value) => {
                writes.push({ id: ref.id, value });
                storedDocs.set(ref.id, value);
            }
        }))
    };

    return { dependencies, storedDocs, writes };
}

function buildGameData() {
    return {
        type: 'game',
        date: STARTS_AT,
        opponent: 'Union KC 18/19 Jr Elite MO Navy',
        location: '6310 Lewis Rd Kansas City MO',
        status: 'scheduled',
        homeScore: 0,
        awayScore: 0
    };
}

describe('calendar game materialization', () => {
    it('matches the app deterministic ID and occurrence identity', async () => {
        expect(getCalendarOccurrenceTrackingId(CALENDAR_EVENT_ID, STARTS_AT)).toBe(
            'calendar-uid-1__2026-08-16T15:00:00.000Z'
        );
        expect(await buildCalendarGameMaterializationId(TEAM_ID, CALENDAR_EVENT_ID, STARTS_AT)).toBe(
            'calendar_74e9b49a563b93ca172a8008a1b58f0c797548a17d701d716acb9d76fc3abd20'
        );
    });

    it('reuses a legacy random-ID game instead of creating another record', async () => {
        const { dependencies } = buildDependencies({
            existingDocs: [{
                id: 'legacy-random-id',
                data: { calendarEventUid: CALENDAR_EVENT_ID }
            }]
        });

        const gameId = await materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        });

        expect(gameId).toBe('legacy-random-id');
        expect(dependencies.runTransaction).not.toHaveBeenCalled();
    });

    it('reuses the occurrence identity written by the React app', async () => {
        const occurrenceId = getCalendarOccurrenceTrackingId(CALENDAR_EVENT_ID, STARTS_AT);
        const { dependencies } = buildDependencies({
            existingDocs: [{
                id: 'react-materialized-id',
                data: { calendarEventUid: occurrenceId }
            }]
        });

        const gameId = await materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        });

        expect(gameId).toBe('react-materialized-id');
        expect(dependencies.where).toHaveBeenCalledWith(
            'calendarEventUid',
            'in',
            [CALENDAR_EVENT_ID, occurrenceId]
        );
        expect(dependencies.runTransaction).not.toHaveBeenCalled();
    });

    it('fails closed without writing when the existing-game lookup is unavailable', async () => {
        const { dependencies } = buildDependencies();
        dependencies.getDocs.mockRejectedValueOnce(new Error('lookup unavailable'));

        await expect(materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        })).rejects.toThrow('lookup unavailable');

        expect(dependencies.runTransaction).not.toHaveBeenCalled();
    });

    it('creates once and reuses the deterministic record after a stale empty lookup', async () => {
        const { dependencies, storedDocs, writes } = buildDependencies();
        const input = {
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        };

        const firstId = await materializeCalendarGame(input);
        const secondId = await materializeCalendarGame(input);

        expect(secondId).toBe(firstId);
        expect(storedDocs.size).toBe(1);
        expect(writes).toHaveLength(1);
        expect(writes[0].value).toMatchObject({
            calendarEventUid: 'calendar-uid-1',
            source: 'calendar',
            sourceMetadata: {
                sourceType: 'calendar',
                sourceLabel: 'Imported calendar'
            },
            createdAt: 'server-timestamp',
            createdBy: 'coach-1',
            importBatch: {
                rowNumber: 1,
                totalCount: 1,
                importedBy: 'coach-1'
            }
        });
        expect(writes[0].value.importBatch.actionId).toBe(`calendar-materialize:${firstId.slice('calendar_'.length)}`);
    });

    it('fails closed when the deterministic ID belongs to another calendar event', async () => {
        const gameId = await buildCalendarGameMaterializationId(TEAM_ID, CALENDAR_EVENT_ID, STARTS_AT);
        const storedDocs = new Map([[gameId, { calendarEventUid: 'another-event' }]]);
        const { dependencies } = buildDependencies({ storedDocs });

        await expect(materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        })).rejects.toThrow('deterministic calendar game ID is already in use');
    });

    it('rejects incomplete identity and unavailable secure hashing', async () => {
        const { dependencies } = buildDependencies({ cryptoApi: {} });

        await expect(materializeCalendarGame({
            teamId: '',
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        })).rejects.toThrow('Team is required');

        await expect(materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: '',
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        })).rejects.toThrow('calendar event ID');

        await expect(materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: 'not-a-date',
            gameData: buildGameData(),
            dependencies
        })).rejects.toThrow('valid start time');

        await expect(materializeCalendarGame({
            teamId: TEAM_ID,
            calendarEventId: CALENDAR_EVENT_ID,
            startsAt: STARTS_AT,
            gameData: buildGameData(),
            dependencies
        })).rejects.toThrow('securely create a stable tracked event ID');
    });
});
