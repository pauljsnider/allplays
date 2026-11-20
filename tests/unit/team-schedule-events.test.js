import { boundedMap } from '../../js/bounded-map.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamPage() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

function extractFunctionBody(source, name, nextSignature) {
    const pattern = new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n        \\}\\n\\n        ${nextSignature}`);
    const match = source.match(pattern);
    expect(match, `${name} should exist`).toBeTruthy();
    return match[1];
}

function extractAsyncFunctionBody(source, name, nextSignature) {
    const pattern = new RegExp(`async function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n        \\}\\n\\n        ${nextSignature}`);
    const match = source.match(pattern);
    expect(match, `${name} should exist`).toBeTruthy();
    return match[1];
}

function buildGetAllEvents(overrides = {}) {
    const source = readTeamPage();
    const body = extractAsyncFunctionBody(source, 'getAllEvents', 'async function renderSchedule');
    const deps = {
        boundedMap,
        isTeamAuthContextCurrent: () => true,
        currentTeamId: 'team-1',
        getTrackedCalendarEventUids: async () => [],
        fetchAndParseCalendar: async () => [],
        isTrackedCalendarEvent: () => false,
        isPracticeEvent: () => false,
        extractOpponent: () => 'Opponent',
        normalizeAvailabilityPreferences: () => ({ cutoffMinutesBeforeStart: 0, noteVisibility: 'admins' }),
        buildAvailabilityNoteRows: () => [],
        getRsvps: async () => [],
        canManageTeamAvailability: () => false,
        hasReplayVideoEvidence: () => false,
        currentTeamAccessInfo: null,
        currentUser: null,
        ...overrides
    };

    const createGetAllEvents = new Function('deps', `
        const {
            boundedMap,
            isTeamAuthContextCurrent,
            currentTeamId,
            getTrackedCalendarEventUids,
            fetchAndParseCalendar,
            isTrackedCalendarEvent,
            isPracticeEvent,
            extractOpponent,
            normalizeAvailabilityPreferences,
            buildAvailabilityNoteRows,
            getRsvps,
            canManageTeamAvailability,
            hasReplayVideoEvidence,
            currentTeamAccessInfo,
            currentUser
        } = deps;
        return async function(team, dbGames) {
${body}
        };
    `);

    return createGetAllEvents(deps);
}

function buildGetNextGame(overrides = {}) {
    const source = readTeamPage();
    const body = extractFunctionBody(source, 'getNextGame', 'function updateCountdown');
    const deps = {
        showPractices: false,
        ...overrides
    };

    const createGetNextGame = new Function('deps', `
        const { showPractices } = deps;
        return function(allEvents) {
${body}
        };
    `);

    return createGetNextGame(deps);
}

function buildCanExposePublicFanFeed() {
    const source = readTeamPage();
    const shareableBody = extractFunctionBody(source, 'isShareableFanGame', 'function isPublicFanFeedGame');
    const fanGameBody = extractFunctionBody(source, 'isPublicFanFeedGame', 'function canExposePublicFanFeed');
    const exposeBody = extractFunctionBody(source, 'canExposePublicFanFeed', 'function getPublicGamesFeedUrl');

    return new Function(`
        function isShareableFanGame(game = {}) {
${shareableBody}
        }
        function isPublicFanFeedGame(team = {}, game = {}) {
${fanGameBody}
        }
        return function canExposePublicFanFeed(team = {}, games = []) {
${exposeBody}
        };
    `)();
}

describe('team page schedule event normalization', () => {
    it('preserves CTA-driving db game fields and marks cancelled games explicitly', async () => {
        const getAllEvents = buildGetAllEvents();
        const [event] = await getAllEvents({ calendarUrls: [] }, [{
            id: 'game-123',
            type: 'game',
            date: '2099-03-10T18:00:00.000Z',
            opponent: 'Tigers',
            location: 'Main Gym',
            status: 'cancelled',
            liveStatus: 'completed',
            homeScore: 20,
            awayScore: 18,
            isHome: true,
            kitColor: 'Blue',
            arrivalTime: '2099-03-10T17:15:00.000Z',
            notes: 'Bring warmups',
            assignments: [{ role: 'Book', value: 'Sam' }],
            rsvpSummary: { going: 8, maybe: 1, notGoing: 2 }
        }]);

        expect(event).toMatchObject({
            type: 'db',
            id: 'game-123',
            gameId: 'game-123',
            status: 'cancelled',
            liveStatus: 'completed',
            isCancelled: true,
            isHome: true,
            kitColor: 'Blue',
            notes: 'Bring warmups',
            rsvpSummary: { going: 8, maybe: 1, notGoing: 2 }
        });
        expect(event.assignments).toEqual([{ role: 'Book', value: 'Sam' }]);
    });

    it('keeps non-cancelled future games eligible for next game selection', () => {
        const getNextGame = buildGetNextGame();
        const nextGame = getNextGame([
            {
                type: 'db',
                status: 'cancelled',
                isCancelled: true,
                date: new Date('2099-03-10T18:00:00.000Z'),
                opponent: 'Cancelled Opponent'
            },
            {
                type: 'db',
                status: 'scheduled',
                isCancelled: false,
                date: new Date('2099-03-10T19:00:00.000Z'),
                opponent: 'Playable Opponent'
            }
        ]);

        expect(nextGame?.opponent).toBe('Playable Opponent');
    });

    it('only exposes the public fan feed when a public or shareable game exists', () => {
        const canExposePublicFanFeed = buildCanExposePublicFanFeed();

        expect(canExposePublicFanFeed({ isPublic: true }, [
            { id: 'game-1', type: 'game', date: '2099-03-10T18:00:00.000Z' }
        ])).toBe(true);

        expect(canExposePublicFanFeed({ isPublic: true, active: false }, [
            { id: 'inactive-game', type: 'game', date: '2099-03-10T18:00:00.000Z' }
        ])).toBe(false);

        expect(canExposePublicFanFeed({ isPublic: false }, [
            { id: 'practice-1', type: 'practice', date: '2099-03-10T18:00:00.000Z' },
            { id: 'private-game', type: 'game', visibility: 'private', date: '2099-03-10T19:00:00.000Z' }
        ])).toBe(false);

        expect(canExposePublicFanFeed({ isPublic: false }, [
            { id: 'shareable-game', type: 'game', shareable: true, date: '2099-03-10T20:00:00.000Z' }
        ])).toBe(true);

        expect(canExposePublicFanFeed({ isPublic: true, active: false }, [
            { id: 'shareable-inactive-game', type: 'game', shareable: true, date: '2099-03-10T20:00:00.000Z' }
        ])).toBe(true);
    });
});

it('stops starting queued RSVP reads after auth changes', async () => {
    let current = true, reads = 0;
    const getAllEvents = buildGetAllEvents({
        currentUser: { uid: 'admin', isAdmin: true },
        currentTeamAccessInfo: { hasAccess:true, accessLevel:'full' },
        canManageTeamAvailability: () => true,
        isTeamAuthContextCurrent: () => current,
        getRsvps: async () => { reads++; current = false; return []; }
    });
    const events = await getAllEvents({calendarUrls:[]}, Array.from({length:30}, (_, i) => ({id:`game-${i}`, date:'2099-03-10', type:'game'})));
    expect(events).toBeNull();
    expect(reads).toBe(1);
});
