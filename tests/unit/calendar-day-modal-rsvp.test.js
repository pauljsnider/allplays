import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
            "import { getUserTeamsWithAccess, getParentTeams, getGames, getTeam, getTrackedCalendarEventUids, getUserProfile, submitRsvp, submitRsvpForPlayer, getMyRsvp, getRsvpSummaries } from './js/db.js?v=23';",
            'const { getUserTeamsWithAccess, getParentTeams, getGames, getTeam, getTrackedCalendarEventUids, getUserProfile, submitRsvp, submitRsvpForPlayer, getMyRsvp, getRsvpSummaries } = deps.db;'
        )
        .replace(
            "import { renderHeader, renderFooter, escapeHtml, formatDate, formatTime, fetchAndParseCalendar, expandRecurrence, buildGlobalCalendarIcsEvent, isTrackedCalendarEvent } from './js/utils.js?v=12';",
            'const { renderHeader, renderFooter, escapeHtml, formatDate, formatTime, fetchAndParseCalendar, expandRecurrence, buildGlobalCalendarIcsEvent, isTrackedCalendarEvent } = deps.utils;'
        )
        .replace(
            "import { requireAuth, checkAuth } from './js/auth.js?v=10';",
            'const { requireAuth, checkAuth } = deps.auth;'
        )
        .replace(
            "import { buildLinkedPlayersByTeam, resolveCalendarRsvpSubmission } from './js/calendar-rsvp.js?v=1';",
            'const { buildLinkedPlayersByTeam, resolveCalendarRsvpSubmission } = deps.calendarRsvp;'
        )
        .replace(
            "import { applyRsvpHydration } from './js/rsvp-hydration.js?v=1';",
            'const { applyRsvpHydration } = deps.rsvpHydration;'
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
        'day-modal-content'
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

function createDeps(submitRecorder) {
    const eventDate = new Date('2026-03-15T18:00:00.000Z');
    const initialSummary = { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 };
    const updatedSummary = { going: 1, maybe: 1, notGoing: 0, notResponded: 0, total: 2 };

    return {
        db: {
            async getUserTeamsWithAccess() {
                return [];
            },
            async getParentTeams() {
                return [
                    {
                        id: 'team-1',
                        name: 'Tigers',
                        calendarUrls: ['https://example.com/team.ics']
                    }
                ];
            },
            async getGames() {
                return [
                    {
                        id: 'game-1',
                        type: 'game',
                        opponent: 'Lions',
                        date: eventDate.toISOString(),
                        location: 'North Field',
                        status: 'scheduled'
                    }
                ];
            },
            async getTeam() {
                return null;
            },
            async getTrackedCalendarEventUids() {
                return [];
            },
            async getUserProfile() {
                return {
                    parentOf: [
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
            async getMyRsvp() {
                return null;
            },
            async getRsvpSummaries() {
                return new Map([['game-1', initialSummary]]);
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
                return [
                    {
                        uid: 'ics-1',
                        dtstart: new Date('2026-03-15T20:30:00.000Z'),
                        summary: 'Team dinner',
                        location: 'Clubhouse'
                    }
                ];
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
            isTrackedCalendarEvent() {
                return false;
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
        eventDate,
        initialSummary,
        updatedSummary
    };
}

async function bootCalendar() {
    const submitRecorder = { calls: [] };
    const env = createEnvironment();
    const deps = createDeps(submitRecorder);

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

describe('calendar day modal RSVP refresh', () => {
    it('keeps the day-detail modal open and refreshes RSVP state after a save', async () => {
        const { elements, submitRecorder, updatedSummary, eventDate, window } = await bootCalendar();

        window.setView('calendar');
        window.openDayDetail(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());

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
});
