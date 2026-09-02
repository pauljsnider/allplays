import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addCalendarLoadedRange, createLatestCalendarRangeLoader, getMissingCalendarLoadRanges } from '../../js/calendar-load-window.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class MockClassList {
    constructor(initial = []) {
        this.tokens = new Set(initial);
    }

    add(...tokens) {
        tokens.forEach((token) => this.tokens.add(token));
    }

    remove(...tokens) {
        tokens.forEach((token) => this.tokens.delete(token));
    }

    contains(token) {
        return this.tokens.has(token);
    }

    toggle(token, force) {
        if (typeof force === 'boolean') {
            if (force) this.tokens.add(token);
            else this.tokens.delete(token);
            return force;
        }

        if (this.tokens.has(token)) {
            this.tokens.delete(token);
            return false;
        }

        this.tokens.add(token);
        return true;
    }
}

class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.className = '';
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.download = '';
        this.href = '';
        this.listeners = new Map();
        this.classList = new MockClassList(id === 'day-modal' ? ['hidden'] : []);
    }

    appendChild(child) {
        this.children.push(child);
        if (child?.tagName === 'OPTION') {
            if (!this.options) this.options = [];
            this.options.push(child);
        }
        return child;
    }

    click() {}

    addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(callback);
    }

    removeEventListener(type, callback) {
        const listeners = this.listeners.get(type) || [];
        this.listeners.set(type, listeners.filter((listener) => listener !== callback));
    }

    querySelectorAll() {
        return [];
    }

    querySelector() {
        return null;
    }
}

function readCalendarModuleSource() {
    const html = readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('Calendar module script not found');
    }

    return `
const window = deps.window;
const document = deps.document;
const alert = deps.alert;
const URL = deps.URL;
const Blob = deps.Blob;
` + match[1]
        .replace(
            /import \{ getUserTeamsWithAccess, getParentTeams, getGames, getTeam, getTrackedCalendarEventUids, getUserProfile, submitRsvp, submitRsvpForPlayer, getMyRsvp, getMyRsvps, getRsvpSummaries, getRsvps \} from '\.\/js\/db\.js\?v=\d+';/,
            'const { getUserTeamsWithAccess, getParentTeams, getGames, getTeam, getTrackedCalendarEventUids, getUserProfile, submitRsvp, submitRsvpForPlayer, getMyRsvp, getMyRsvps, getRsvpSummaries, getRsvps } = deps.db;'
        )
        .replace(
            /import \{ renderHeader, renderFooter, escapeHtml, formatDate, formatTime, fetchAndParseCalendar, expandRecurrence, buildGlobalCalendarIcsEvent, isTrackedCalendarEvent \} from '\.\/js\/utils\.js\?v=\d+';/,
            'const { renderHeader, renderFooter, escapeHtml, formatDate, formatTime, fetchAndParseCalendar, expandRecurrence, buildGlobalCalendarIcsEvent, isTrackedCalendarEvent } = deps.utils;'
        )
        .replace(
            /import \{ mergeGlobalCalendarIcsEvents \} from '\.\/js\/calendar-ics-sync\.js\?v=\d+';/,
            'const { mergeGlobalCalendarIcsEvents } = deps.calendarIcsSync;'
        )
        .replace(
            /import \{ requireAuth, checkAuth \} from '\.\/js\/auth\.js\?v=\d+';/,
            'const { requireAuth, checkAuth } = deps.auth;'
        )
        .replace(
            /import \{ buildLinkedPlayersByTeam, resolveCalendarRsvpSubmission \} from '\.\/js\/calendar-rsvp\.js\?v=\d+';/,
            'const { buildLinkedPlayersByTeam, resolveCalendarRsvpSubmission } = deps.calendarRsvp;'
        )
        .replace(
            /import \{ applyRsvpHydration \} from '\.\/js\/rsvp-hydration\.js\?v=\d+';/,
            'const { applyRsvpHydration } = deps.rsvpHydration;'
        )
        .replace(
            /import \{ buildAvailabilityNoteRows, canViewAvailabilityNotes, formatAvailabilityCutoff, isAvailabilityLocked, normalizeAvailabilityPreferences \} from '\.\/js\/availability-preferences\.js\?v=\d+';/,
            'const { buildAvailabilityNoteRows, canViewAvailabilityNotes, formatAvailabilityCutoff, isAvailabilityLocked, normalizeAvailabilityPreferences } = deps.availabilityPreferences;'
        )
        .replace(
            /import \{ getDefaultSchedulePrintOptions, printSchedule, promptSchedulePrintOptions \} from '\.\/js\/schedule-print\.js\?v=\d+';/,
            'const { getDefaultSchedulePrintOptions, printSchedule, promptSchedulePrintOptions } = deps.schedulePrint;'
        )
        .replace(
            /import \{ addCalendarLoadedRange, createLatestCalendarRangeLoader, getMissingCalendarLoadRanges \} from '\.\/js\/calendar-load-window\.js\?v=\d+';/,
            'const { addCalendarLoadedRange, createLatestCalendarRangeLoader, getMissingCalendarLoadRanges } = deps.calendarLoadWindow;'
        )
        .replace(
            /import \{ fetchLegacyCalendarFeed \} from '\.\/js\/calendar-feed-loading\.js\?v=\d+';/,
            'const { fetchLegacyCalendarFeed } = deps.calendarFeed;'
        )
        .replace(
            /import \{ functions, httpsCallable \} from '\.\/js\/firebase\.js\?v=\d+';/,
            'const { functions, httpsCallable } = deps.firebase;'
        )
        .replace(/\binit\(\);\s*$/, 'await init();');
}

const runCalendarModule = new AsyncFunction('deps', readCalendarModuleSource());

function createEnvironment() {
    const ids = [
        'footer-container',
        'header-container',
        'team-filter',
        'calendar-content',
        'month-nav',
        'month-label',
        'view-detailed',
        'view-compact',
        'view-calendar',
        'day-modal',
        'day-modal-title',
        'day-modal-content',
        'sync-calendar',
        'sync-calendar-modal',
        'sync-calendar-backdrop',
        'sync-calendar-close',
        'sync-calendar-apple',
        'sync-calendar-google',
        'sync-calendar-copy',
        'sync-calendar-feedback',
        'public-games-feed'
    ];
    const elements = new Map(ids.map((id) => [id, new MockElement(id)]));
    elements.get('team-filter').value = '';

    const timeRangeButtons = ['Week', 'Month', 'Quarter', 'All'].map((label) => {
        const button = new MockElement('', 'button');
        button.textContent = label;
        return button;
    });
    const typeFilterButtons = ['All', 'Games', 'Practices'].map((label) => {
        const button = new MockElement('', 'button');
        button.textContent = label;
        return button;
    });

    const document = {
        getElementById(id) {
            const element = elements.get(id);
            if (!element) {
                throw new Error(`Unknown element: ${id}`);
            }
            return element;
        },
        createElement(tagName) {
            return new MockElement('', tagName);
        },
        querySelectorAll(selector) {
            if (selector === '#view-detailed, #view-compact, #view-calendar') {
                return [
                    elements.get('view-detailed'),
                    elements.get('view-compact'),
                    elements.get('view-calendar')
                ];
            }
            if (selector === '.time-range-btn') {
                return timeRangeButtons;
            }
            if (selector === '.type-filter-btn') {
                return typeFilterButtons;
            }
            return [];
        }
    };

    const window = {
        document,
        alert(message) {
            throw new Error(`Unexpected alert: ${message}`);
        }
    };

    return { document, elements, window };
}

function createDeps(submitRecorder, overrides = {}) {
    const getMyRsvpCalls = [];
    const getRsvpSummariesCalls = [];
    const getRsvpsCalls = [];
    const getMyRsvpsCalls = [];
    const eventDate = overrides.eventDate || new Date('2026-03-15T18:00:00.000Z');
    const initialSummary = overrides.initialSummary || { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 };
    const updatedSummary = overrides.updatedSummary || { going: 1, maybe: 1, notGoing: 0, notResponded: 0, total: 2 };
    const games = overrides.games || [
        {
            id: 'game-1',
            type: 'game',
            opponent: 'Lions',
            date: eventDate.toISOString(),
            location: 'North Field',
            status: 'scheduled'
        }
    ];
    const trackedUids = overrides.trackedUids || [];
    const icsEvents = overrides.icsEvents || [
        {
            uid: 'ics-1',
            dtstart: new Date('2026-03-15T20:30:00.000Z'),
            summary: 'Team dinner',
            location: 'Clubhouse'
        }
    ];

    return {
        db: {
            async getUserTeamsWithAccess() {
                return [];
            },
            async getParentTeams() {
                return overrides.parentTeams || [
                    {
                        id: 'team-1',
                        name: 'Tigers',
                        calendarUrls: ['https://example.com/team.ics']
                    }
                ];
            },
            async getGames() {
                return games;
            },
            async getTeam() {
                return null;
            },
            async getTrackedCalendarEventUids() {
                return trackedUids;
            },
            async getUserProfile() {
                return {
                    parentOf: overrides.parentOf || [
                        { teamId: 'team-1', playerId: 'player-1', playerName: 'Avery' }
                    ]
                };
            },
            async submitRsvp(teamId, gameId, currentUserId, payload) {
                submitRecorder.calls.push({ teamId, gameId, currentUserId, payload });
                return updatedSummary;
            },
            async submitRsvpForPlayer() {
                throw new Error('Unexpected submitRsvpForPlayer call');
            },
            async getMyRsvp(teamId, gameId, userId, playerIds) {
                getMyRsvpCalls.push({ teamId, gameId, userId, playerIds });
                if (typeof overrides.getMyRsvp === 'function') {
                    return overrides.getMyRsvp(teamId, gameId, userId, playerIds);
                }
                return overrides.myRsvp || null;
            },
            async getRsvpSummaries(teamId, gameIds) {
                getRsvpSummariesCalls.push({ teamId, gameIds });
                return overrides.rsvpSummaries || new Map([['game-1', initialSummary]]);
            },
            async getRsvps(teamId, gameId) {
                getRsvpsCalls.push({ teamId, gameId });
                return overrides.rsvps || [];
            },
            async getMyRsvps(teamId, gameId, userId, playerIds) {
                getMyRsvpsCalls.push({ teamId, gameId, userId, playerIds });
                return overrides.rsvps || [];
            }
        },
        utils: {
            renderHeader() {},
            renderFooter() {},
            escapeHtml(value) {
                return String(value ?? '');
            },
            formatDate(value) {
                return String(value ?? '');
            },
            formatTime(value) {
                return String(value ?? '');
            },
            async fetchAndParseCalendar() {
                return icsEvents;
            },
            expandRecurrence() {
                return [];
            },
            buildGlobalCalendarIcsEvent({ team, teamColor, event }) {
                return {
                    id: event.uid,
                    teamId: team.id,
                    teamName: team.name,
                    teamColor,
                    type: 'game',
                    title: event.summary,
                    date: event.dtstart,
                    location: event.location,
                    status: 'scheduled',
                    isHome: null,
                    kitColor: null,
                    arrivalTime: null,
                    notes: null,
                    assignments: null,
                    rsvpSummary: null,
                    homeScore: null,
                    awayScore: null,
                    liveStatus: null,
                    myRsvp: null,
                    source: 'ics'
                };
            },
            isTrackedCalendarEvent(event, currentTrackedUids) {
                if (typeof overrides.isTrackedCalendarEvent === 'function') {
                    return overrides.isTrackedCalendarEvent(event, currentTrackedUids);
                }
                return currentTrackedUids.includes(event.uid);
            }
        },
        auth: {
            async requireAuth() {
                return {
                    uid: 'user-1',
                    email: 'parent@example.com',
                    displayName: 'Parent User'
                };
            },
            checkAuth(callback) {
                callback({
                    uid: 'user-1',
                    email: 'parent@example.com',
                    displayName: 'Parent User'
                });
            }
        },
        calendarIcsSync: {
            mergeGlobalCalendarIcsEvents({
                team,
                teamColor,
                existingEvents,
                icsEvents,
                trackedUids,
                isTrackedCalendarEvent,
                buildGlobalCalendarIcsEvent
            }) {
                return (icsEvents || []).reduce((mergedEvents, event) => {
                    if (isTrackedCalendarEvent(event, trackedUids)) {
                        return mergedEvents;
                    }
                    const hasTrackedConflict = (existingEvents || []).some((existingEvent) => {
                        if (existingEvent?.source !== 'db') return false;
                        if (existingEvent?.teamId !== team.id) return false;
                        return Math.abs(existingEvent.date - event.dtstart) < 60000;
                    });
                    if (hasTrackedConflict) {
                        return mergedEvents;
                    }
                    const mappedEvent = buildGlobalCalendarIcsEvent({ team, teamColor, event });
                    if (mappedEvent) {
                        mergedEvents.push(mappedEvent);
                    }
                    return mergedEvents;
                }, []);
            }
        },
        calendarRsvp: {
            buildLinkedPlayersByTeam(parentLinks) {
                return parentLinks.reduce((acc, link) => {
                    if (!acc.has(link.teamId)) acc.set(link.teamId, []);
                    acc.get(link.teamId).push({
                        playerId: link.playerId,
                        playerName: link.playerName
                    });
                    return acc;
                }, new Map());
            },
            resolveCalendarRsvpSubmission(linkedPlayersByTeam, teamId) {
                return {
                    playerIds: linkedPlayersByTeam.get(teamId).map((player) => player.playerId),
                    submitMode: 'user'
                };
            }
        },
        availabilityPreferences: {
            buildAvailabilityNoteRows(rsvps) {
                return (rsvps || [])
                    .filter((rsvp) => rsvp.note)
                    .map((rsvp) => ({ displayName: rsvp.displayName || 'Player', note: rsvp.note }));
            },
            canViewAvailabilityNotes() { return !!overrides.notesVisible; },
            formatAvailabilityCutoff() { return 'No cutoff'; },
            isAvailabilityLocked() { return false; },
            normalizeAvailabilityPreferences() { return { cutoffMinutesBeforeStart: 0, noteVisibility: 'admins' }; }
        },
        rsvpHydration: {
            applyRsvpHydration(allEvents, teamId, gameId, hydration) {
                allEvents.forEach((event) => {
                    if (event.teamId === teamId && event.id === gameId) {
                        event.myRsvp = hydration.myRsvp;
                        if (hydration.summary) event.rsvpSummary = hydration.summary;
                    }
                });
            }
        },
        schedulePrint: {
            getDefaultSchedulePrintOptions() { return {}; },
            printSchedule() {},
            promptSchedulePrintOptions() { return null; }
        },
        calendarLoadWindow: {
            addCalendarLoadedRange,
            createLatestCalendarRangeLoader,
            getMissingCalendarLoadRanges
        },
        calendarFeed: {
            async fetchLegacyCalendarFeed(_calendarUrl, fetchCalendar) {
                return fetchCalendar();
            }
        },
        firebase: {
            functions: {},
            httpsCallable() {
                throw new Error('Unexpected private calendar token request');
            }
        },
        eventDate,
        initialSummary,
        updatedSummary,
        getMyRsvpCalls,
        getRsvpSummariesCalls,
        getRsvpsCalls,
        getMyRsvpsCalls
    };
}

async function bootCalendar(overrides = {}) {
    const submitRecorder = { calls: [] };
    const env = createEnvironment();
    const deps = createDeps(submitRecorder, overrides);

    await runCalendarModule({
        ...deps,
        window: env.window,
        document: env.document,
        alert: env.window.alert,
        URL: globalThis.URL,
        Blob: globalThis.Blob
    });

    return { ...env, ...deps, submitRecorder };
}

async function flushCalendarHydration() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('calendar day modal RSVP refresh', () => {
    it('bounds visible RSVP hydration to six FIFO event tasks', async () => {
        const eventDate = new Date();
        const games = Array.from({ length: 50 }, (_, index) => ({
            id: `game-${String(index + 1).padStart(2, '0')}`,
            type: 'game',
            opponent: `Opponent ${index + 1}`,
            date: new Date(eventDate.getTime() + index * 60000).toISOString(),
            location: 'North Field',
            status: 'scheduled',
            rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 }
        }));
        const pending = new Map();
        const startOrder = [];
        let inFlight = 0;
        let peakInFlight = 0;

        await bootCalendar({
            eventDate,
            games,
            getMyRsvp(_teamId, gameId) {
                startOrder.push(gameId);
                inFlight += 1;
                peakInFlight = Math.max(peakInFlight, inFlight);
                return new Promise((resolve) => {
                    pending.set(gameId, () => {
                        inFlight -= 1;
                        resolve(null);
                    });
                });
            }
        });
        await flushCalendarHydration();

        expect(startOrder).toEqual(games.slice(0, 6).map((game) => game.id));
        expect(peakInFlight).toBe(6);

        for (let index = 0; index < games.length; index += 1) {
            const gameId = games[index].id;
            pending.get(gameId)();
            await flushCalendarHydration();
        }

        expect(startOrder).toEqual(games.map((game) => game.id));
        expect(peakInFlight).toBe(6);
        expect(inFlight).toBe(0);
    });

    it('releases a hydration worker after failure and continues queued events', async () => {
        const eventDate = new Date();
        const games = Array.from({ length: 8 }, (_, index) => ({
            id: `game-${index + 1}`,
            type: 'game',
            opponent: `Opponent ${index + 1}`,
            date: new Date(eventDate.getTime() + index * 60000).toISOString(),
            location: 'North Field',
            status: 'scheduled',
            rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 }
        }));
        const pending = new Map();
        const startOrder = [];
        const attempts = new Map();

        const { window } = await bootCalendar({
            eventDate,
            games,
            getMyRsvp(_teamId, gameId) {
                startOrder.push(gameId);
                const attempt = (attempts.get(gameId) || 0) + 1;
                attempts.set(gameId, attempt);
                if (gameId === 'game-1' && attempt > 1) return null;
                return new Promise((resolve, reject) => {
                    pending.set(gameId, { resolve, reject });
                });
            }
        });
        await flushCalendarHydration();

        expect(startOrder).toEqual(games.slice(0, 6).map((game) => game.id));

        pending.get('game-1').reject(new Error('Firestore unavailable'));
        await flushCalendarHydration();
        expect(startOrder).toContain('game-7');

        for (const gameId of ['game-2', 'game-3', 'game-4', 'game-5', 'game-6', 'game-7']) {
            pending.get(gameId).resolve(null);
            await flushCalendarHydration();
        }
        expect(startOrder).toContain('game-8');
        pending.get('game-8').resolve(null);
        await flushCalendarHydration();

        expect(startOrder).toEqual(games.map((game) => game.id));

        await window.setTimeRange('all');
        await flushCalendarHydration();

        expect(attempts.get('game-1')).toBe(2);
        games.slice(1).forEach((game) => expect(attempts.get(game.id)).toBe(1));
    });

    it('prioritizes selected-day hydration through the bounded scheduler', async () => {
        const now = new Date();
        const listDate = new Date(now.getFullYear(), now.getMonth(), 10, 12);
        const selectedDate = new Date(now.getFullYear(), now.getMonth(), 20, 12);
        const games = Array.from({ length: 8 }, (_, index) => ({
            id: `game-${index + 1}`,
            type: 'game',
            opponent: `Opponent ${index + 1}`,
            date: (index === 7 ? selectedDate : new Date(listDate.getTime() + index * 60000)).toISOString(),
            location: 'North Field',
            status: 'scheduled',
            rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 }
        }));
        const pending = new Map();
        const startOrder = [];
        const { elements, window } = await bootCalendar({
            eventDate: listDate,
            games,
            getMyRsvp(_teamId, gameId) {
                startOrder.push(gameId);
                return new Promise((resolve) => pending.set(gameId, resolve));
            }
        });
        await flushCalendarHydration();

        const modalHydration = window.openDayDetail(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate()
        );
        pending.get('game-1')(null);
        await flushCalendarHydration();

        expect(startOrder[6]).toBe('game-8');
        pending.get('game-8')(null);
        await modalHydration;
        expect(elements.get('day-modal-content').innerHTML).toContain('Opponent 8');

        for (const gameId of ['game-2', 'game-3', 'game-4', 'game-5', 'game-6']) {
            pending.get(gameId)(null);
            await flushCalendarHydration();
        }
        pending.get('game-7')(null);
        await flushCalendarHydration();
    });

    it('keeps initial calendar boot summary-only for off-screen RSVP data', async () => {
        const eventDate = new Date('2026-03-15T18:00:00.000Z');
        const games = Array.from({ length: 25 }, (_, index) => ({
            id: `game-${index + 1}`,
            type: 'game',
            opponent: `Opponent ${index + 1}`,
            date: new Date(eventDate.getTime() + index * 86400000).toISOString(),
            location: 'North Field',
            status: 'scheduled',
            rsvpSummary: { going: index, maybe: 0, notGoing: 0, notResponded: 1, total: index + 1 }
        }));
        const { elements, getMyRsvpCalls, getRsvpsCalls, window } = await bootCalendar({ eventDate, games });

        expect(getMyRsvpCalls).toEqual([]);
        expect(getRsvpsCalls).toEqual([]);

        await window.setTimeRange('all');

        expect(elements.get('calendar-content').innerHTML).toContain('0 going · 0 maybe · 0 can\'t go · 1 no response');
        expect(elements.get('calendar-content').innerHTML).toContain('24 going · 0 maybe · 0 can\'t go · 1 no response');
    });

    it('hydrates visible detailed RSVP controls from saved RSVP docs', async () => {
        const eventDate = new Date();
        const { elements, getMyRsvpCalls } = await bootCalendar({
            eventDate,
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    opponent: 'Lions',
                    date: eventDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    rsvpSummary: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
                }
            ],
            myRsvp: {
                id: 'user-1__player-1',
                userId: 'user-1',
                playerId: 'player-1',
                response: 'going'
            }
        });

        await flushCalendarHydration();

        expect(getMyRsvpCalls).toEqual([{
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'user-1',
            playerIds: ['player-1']
        }]);
        expect(elements.get('calendar-content').innerHTML).toContain('bg-green-600 text-white border-green-600');
    });

    it('hydrates visible detailed availability notes without opening the day modal', async () => {
        const eventDate = new Date();
        const { elements, getMyRsvpsCalls, getRsvpsCalls } = await bootCalendar({
            eventDate,
            notesVisible: true,
            rsvps: [
                {
                    displayName: 'Avery',
                    note: 'Running late'
                }
            ],
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    opponent: 'Lions',
                    date: eventDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    rsvpSummary: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
                }
            ]
        });

        await flushCalendarHydration();

        expect(getMyRsvpsCalls).toEqual([{
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'user-1',
            playerIds: ['player-1']
        }]);
        expect(getRsvpsCalls).toEqual([]);
        expect(elements.get('calendar-content').innerHTML).toContain('Avery:');
        expect(elements.get('calendar-content').innerHTML).toContain('Running late');
        expect(elements.get('day-modal').classList.contains('hidden')).toBe(true);
    });

    it('keeps detailed RSVP saves from being overwritten by cached hydration', async () => {
        const eventDate = new Date();
        const { elements, getMyRsvpCalls, submitRecorder, updatedSummary, window } = await bootCalendar({
            eventDate,
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    opponent: 'Lions',
                    date: eventDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    rsvpSummary: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
                }
            ],
            myRsvp: {
                id: 'user-1__player-1',
                userId: 'user-1',
                playerId: 'player-1',
                response: 'going'
            }
        });

        await flushCalendarHydration();
        expect(elements.get('calendar-content').innerHTML).toContain('bg-green-600 text-white border-green-600');

        await window.submitCalendarRsvp('team-1', 'game-1', 'maybe');
        await flushCalendarHydration();

        expect(submitRecorder.calls).toEqual([
            {
                teamId: 'team-1',
                gameId: 'game-1',
                currentUserId: 'user-1',
                payload: {
                    displayName: 'Parent User',
                    playerIds: ['player-1'],
                    response: 'maybe'
                }
            }
        ]);
        expect(getMyRsvpCalls).toHaveLength(1);
        expect(elements.get('calendar-content').innerHTML).toContain('bg-yellow-500 text-white border-yellow-500');
        expect(elements.get('calendar-content').innerHTML).not.toContain('bg-green-600 text-white border-green-600');
        expect(elements.get('calendar-content').innerHTML).toContain(`${updatedSummary.going} going · ${updatedSummary.maybe} maybe · ${updatedSummary.notGoing} can't go · ${updatedSummary.notResponded} no response`);
    });

    it('ignores stale in-flight RSVP hydration after a detailed RSVP save', async () => {
        const eventDate = new Date();
        let resolveMyRsvp;
        const pendingMyRsvp = new Promise((resolve) => {
            resolveMyRsvp = resolve;
        });
        const { elements, submitRecorder, window } = await bootCalendar({
            eventDate,
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    opponent: 'Lions',
                    date: eventDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    rsvpSummary: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
                }
            ],
            myRsvp: pendingMyRsvp
        });

        await window.submitCalendarRsvp('team-1', 'game-1', 'maybe');
        expect(submitRecorder.calls).toHaveLength(1);
        expect(elements.get('calendar-content').innerHTML).toContain('bg-yellow-500 text-white border-yellow-500');

        resolveMyRsvp({
            id: 'user-1__player-1',
            userId: 'user-1',
            playerId: 'player-1',
            response: 'going'
        });
        await flushCalendarHydration();
        await flushCalendarHydration();
        await window.setTimeRange('all');

        expect(elements.get('calendar-content').innerHTML).toContain('bg-yellow-500 text-white border-yellow-500');
        expect(elements.get('calendar-content').innerHTML).not.toContain('bg-green-600 text-white border-green-600');
    });

    it('hydrates day-detail RSVP state from linked player RSVP docs only for the selected day', async () => {
        const selectedDate = new Date('2026-03-15T18:00:00.000Z');
        const offscreenDate = new Date('2026-04-20T18:00:00.000Z');
        const { elements, getMyRsvpCalls, getRsvpsCalls, window } = await bootCalendar({
            eventDate: selectedDate,
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    opponent: 'Lions',
                    date: selectedDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    rsvpSummary: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
                },
                {
                    id: 'game-2',
                    type: 'game',
                    opponent: 'Bears',
                    date: offscreenDate.toISOString(),
                    location: 'South Field',
                    status: 'scheduled',
                    rsvpSummary: { going: 0, maybe: 1, notGoing: 0, notResponded: 1, total: 2 }
                }
            ],
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1', playerName: 'Avery' },
                { teamId: 'team-1', playerId: 'player-2', playerName: 'Blake' }
            ],
            myRsvp: {
                id: 'user-1__player-1',
                userId: 'user-1',
                playerId: 'player-1',
                response: 'going'
            }
        });

        await window.openDayDetail(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate());

        expect(getMyRsvpCalls).toEqual([{
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'user-1',
            playerIds: ['player-1', 'player-2']
        }]);
        expect(getRsvpsCalls).toEqual([]);

        expect(elements.get('day-modal-content').innerHTML).toContain('bg-green-600 text-white border-green-600');
        expect(elements.get('day-modal-content').innerHTML).not.toContain('Bears');
    });

    it('loads missing RSVP summaries for selected day events', async () => {
        const selectedDate = new Date('2026-03-15T18:00:00.000Z');
        const fallbackSummary = { going: 2, maybe: 1, notGoing: 0, notResponded: 3, total: 6 };
        const { elements, getRsvpSummariesCalls, window } = await bootCalendar({
            eventDate: selectedDate,
            games: [
                {
                    id: 'game-1',
                    type: 'practice',
                    title: 'Practice',
                    date: selectedDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    rsvpSummary: null
                }
            ],
            parentTeams: [{ id: 'team-1', name: 'Tigers', ownerId: 'user-1', calendarUrls: [] }],
            icsEvents: [],
            rsvpSummaries: new Map([['game-1', fallbackSummary]])
        });

        await window.openDayDetail(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate());

        expect(getRsvpSummariesCalls).toContainEqual({
            teamId: 'team-1',
            gameIds: ['game-1']
        });
        expect(elements.get('day-modal-content').innerHTML).toContain('2 going · 1 maybe · 0 can\'t go · 3 no response');
        expect(elements.get('day-modal-content').innerHTML).not.toContain('No RSVPs yet.');
    });

    it('uses the day-detail RSVP hydration cache when reopening the same day', async () => {
        const eventDate = new Date('2026-03-15T18:00:00.000Z');
        const { getMyRsvpCalls, getMyRsvpsCalls, getRsvpsCalls, window } = await bootCalendar({
            eventDate,
            notesVisible: true,
            myRsvp: {
                id: 'user-1__player-1',
                userId: 'user-1',
                playerId: 'player-1',
                response: 'maybe'
            },
            rsvps: [
                {
                    displayName: 'Avery',
                    note: 'Running late'
                }
            ]
        });

        await window.openDayDetail(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
        await window.openDayDetail(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());

        expect(getMyRsvpCalls).toHaveLength(1);
        expect(getMyRsvpsCalls).toEqual([{
            teamId: 'team-1',
            gameId: 'game-1',
            userId: 'user-1',
            playerIds: ['player-1']
        }]);
        expect(getRsvpsCalls).toEqual([]);
    });

    it('keeps the day-detail modal open and refreshes RSVP state after a save', async () => {
        const { elements, submitRecorder, updatedSummary, eventDate, window } = await bootCalendar();

        await window.setView('calendar');
        await window.openDayDetail(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());

        const beforeHtml = elements.get('day-modal-content').innerHTML;
        expect(beforeHtml).toContain('submitCalendarRsvpFromButton');
        expect(beforeHtml).toContain('Availability opens after this event is tracked in the schedule.');
        expect((beforeHtml.match(/submitCalendarRsvpFromButton/g) || []).length).toBe(3);
        expect(beforeHtml).toContain("bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50");

        await window.submitCalendarRsvp('team-1', 'game-1', 'maybe');

        expect(submitRecorder.calls).toEqual([
            {
                teamId: 'team-1',
                gameId: 'game-1',
                currentUserId: 'user-1',
                payload: {
                    displayName: 'Parent User',
                    playerIds: ['player-1'],
                    response: 'maybe'
                }
            }
        ]);

        const afterHtml = elements.get('day-modal-content').innerHTML;
        expect(elements.get('day-modal').classList.contains('hidden')).toBe(false);
        expect(afterHtml).toContain("bg-yellow-500 text-white border-yellow-500");
        expect(afterHtml).toContain(`${updatedSummary.going} going · ${updatedSummary.maybe} maybe · ${updatedSummary.notGoing} can't go · ${updatedSummary.notResponded} no response`);
        expect(afterHtml).toContain('Availability opens after this event is tracked in the schedule.');
        expect((afterHtml.match(/submitCalendarRsvpFromButton/g) || []).length).toBe(3);
    });

    it('renders only the DB-backed event after the ICS uid is marked tracked', async () => {
        const trackedDate = new Date('2026-03-15T18:00:00.000Z');
        const { elements, window } = await bootCalendar({
            games: [
                {
                    id: 'game-1',
                    type: 'game',
                    opponent: 'Tracked Opponent',
                    date: trackedDate.toISOString(),
                    location: 'North Field',
                    status: 'scheduled',
                    calendarEventUid: 'ics-1'
                }
            ],
            trackedUids: ['ics-1'],
            icsEvents: [
                {
                    uid: 'ics-1',
                    dtstart: trackedDate,
                    summary: 'Tigers vs Tracked Opponent',
                    location: 'North Field'
                }
            ]
        });

        await window.setTimeRange('all');

        const html = elements.get('calendar-content').innerHTML;
        expect(html).toContain('vs. Tracked Opponent');
        expect(html).not.toContain('Tigers vs Tracked Opponent');
        expect(html).not.toContain('Availability opens after this event is tracked in the schedule.');
    });
});
