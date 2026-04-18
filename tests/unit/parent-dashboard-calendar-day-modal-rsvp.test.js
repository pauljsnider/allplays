import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as parentDashboardRsvp from '../../js/parent-dashboard-rsvp.js';
import * as parentDashboardRsvpControls from '../../js/parent-dashboard-rsvp-controls.js';

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
        this.options = [];
        this.disabled = false;
        this.checked = false;
        this.classList = new MockClassList(
            id === 'schedule-day-modal' ? ['hidden'] : []
        );
    }

    appendChild(child) {
        this.children.push(child);
        if (child?.tagName === 'OPTION') {
            this.options.push(child);
        }
        return child;
    }

    removeChild(child) {
        this.children = this.children.filter((candidate) => candidate !== child);
        return child;
    }

    addEventListener() {}

    removeEventListener() {}

    setAttribute(name, value) {
        this[name] = value;
    }

    querySelectorAll() {
        return [];
    }

    querySelector() {
        return null;
    }

    click() {}
}

function readParentDashboardModuleSource() {
    const html = readFileSync(new URL('../../parent-dashboard.html', import.meta.url), 'utf8');
    const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('Parent dashboard module script not found');
    }

    return `
const window = deps.window;
const document = deps.document;
const alert = deps.alert;
const location = deps.location;
const URL = deps.URL;
const Blob = deps.Blob;
` + match[1]
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/db\.js\?v=26';/, 'const { getParentDashboardData, redeemParentInvite, getTeam, getTeams, getPlayers, getGames, getTrackedCalendarEventUids, getUnreadChatCounts, getPracticeSessions, getPracticePacketCompletions, upsertPracticePacketCompletion, updateUserProfile, getUserProfile, submitRsvp, submitRsvpForPlayer, getRsvps, getRsvpSummaries, createRideOffer, listRideOffersForEvent, requestRideSpot, updateRideRequestStatus, closeRideOffer, cancelRideRequest, getAggregatedStatsForPlayer, createParentMembershipRequest, listMyParentMembershipRequests } = deps.db;')
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/utils\.js\?v=10';/, 'const { renderHeader, renderFooter, escapeHtml, fetchAndParseCalendar, extractOpponent, isPracticeEvent, expandRecurrence, getCalendarEventTrackingId, isTrackedCalendarEvent } = deps.utils;')
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/parent-incentives\.js\?v=3';/, 'const { getIncentiveRules, saveIncentiveRule: saveIncentiveRuleFn, toggleIncentiveRule: toggleIncentiveRuleFn, retireIncentiveRule: retireIncentiveRuleFn, markGamePaid: markGamePaidFn, unmarkGamePaid: unmarkGamePaidFn, getPaidGames, calculateEarnings, formatCents, getApplicableRulesForGame, getStatOptionsForTeam, renderIncentivesPanel, renderRuleBuilder, getCapSetting, saveCapSetting: saveCapSettingFn } = deps.parentIncentives;')
        .replace("import { requireAuth, checkAuth } from './js/auth.js?v=10';", 'const { requireAuth, checkAuth } = deps.auth;')
        .replace(
            /import\s*\{[\s\S]*?\}\s*from '\.\/js\/parent-dashboard-packets\.js\?v=3';/,
            'const { resolvePracticePacketSessionIdForEvent: resolvePracticePacketSessionIdForEventBase, resolvePracticePacketContextForEvent: resolvePracticePacketContextForEventBase, getScopedPracticePacketRow: getScopedPracticePacketRowBase, buildPracticePacketCompletionPayload: buildPracticePacketCompletionPayloadBase } = deps.parentDashboardPackets;'
        )
        .replace("import { filterVisiblePracticeSessions } from './js/parent-dashboard-practice-sessions.js?v=1';", 'const { filterVisiblePracticeSessions } = deps.parentDashboardPracticeSessions;')
        .replace("import { resolveRsvpPlayerIdsForSubmission, resolveMyRsvpByChildForGame } from './js/parent-dashboard-rsvp.js?v=5';", 'const { resolveRsvpPlayerIdsForSubmission, resolveMyRsvpByChildForGame } = deps.parentDashboardRsvp;')
        .replace("import { createParentDashboardRsvpController } from './js/parent-dashboard-rsvp-controls.js?v=1';", 'const { createParentDashboardRsvpController } = deps.parentDashboardRsvpControls;')
        .replace("import { getEventRideshareSummary, getOfferSeatInfo } from './js/rideshare-helpers.js?v=1';", 'const { getEventRideshareSummary, getOfferSeatInfo } = deps.rideshareHelpers;')
        .replace("import { resolveSelectedRideChildId, getRideOfferUiState, createRideRequestHandlers } from './js/parent-dashboard-rideshare-controls.js?v=1';", 'const { resolveSelectedRideChildId, getRideOfferUiState, createRideRequestHandlers } = deps.parentDashboardRideshareControls;')
        .replace("import { applyRsvpHydration } from './js/rsvp-hydration.js?v=1';", 'const { applyRsvpHydration } = deps.rsvpHydration;')
        .replace(/\binit\(\);\s*$/, `
window.__parentDashboardTestHooks = {
    setAllScheduleEvents(value) {
        allScheduleEvents = value;
    },
    getAllScheduleEvents() {
        return allScheduleEvents;
    },
    setCurrentUser(user) {
        currentUser = user;
        currentUserId = user?.uid || null;
    },
    setScheduleCalendar(year, month) {
        scheduleCalendarYear = year;
        scheduleCalendarMonth = month;
    },
    setScheduleViewMode(mode) {
        scheduleViewMode = mode;
    },
    renderScheduleFromControls,
    openScheduleDayModal,
    submitGameRsvpFromButton
};
`);
}

const runParentDashboardModule = new AsyncFunction('deps', readParentDashboardModuleSource());

function createEnvironment() {
    const ids = [
        'footer-container',
        'header-container',
        'player-filter',
        'schedule-list',
        'schedule-calendar-grid',
        'schedule-calendar-nav',
        'schedule-calendar-month-label',
        'schedule-day-modal',
        'schedule-day-modal-title',
        'schedule-day-modal-content',
        'schedule-view-list',
        'schedule-view-calendar'
    ];
    const elements = new Map(ids.map((id) => [id, new MockElement(id)]));

    const document = {
        body: new MockElement('body', 'body'),
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, new MockElement(id));
            }
            return elements.get(id);
        },
        createElement(tagName) {
            return new MockElement('', tagName);
        },
        querySelectorAll() {
            return [];
        }
    };

    const window = {
        document,
        location: {
            reload() {}
        },
        alert(message) {
            throw new Error(`Unexpected alert: ${message}`);
        }
    };

    return { document, elements, window };
}

function createDeps(submitRecorder) {
    return {
        db: {
            async getParentDashboardData() { return { children: [] }; },
            async redeemParentInvite() {},
            async getTeam() { return null; },
            async getTeams() { return []; },
            async getPlayers() { return []; },
            async getGames() { return []; },
            async getTrackedCalendarEventUids() { return []; },
            async getUnreadChatCounts() { return new Map(); },
            async getPracticeSessions() { return []; },
            async getPracticePacketCompletions() { return []; },
            async upsertPracticePacketCompletion() {},
            async updateUserProfile() {},
            async getUserProfile() { return {}; },
            async submitRsvp(teamId, gameId, currentUserId, payload) {
                submitRecorder.calls.push({ teamId, gameId, currentUserId, payload });
                return submitRecorder.updatedSummary;
            },
            async submitRsvpForPlayer() {
                throw new Error('Unexpected submitRsvpForPlayer call');
            },
            async getRsvps() { return []; },
            async getRsvpSummaries() { return new Map(); },
            async createRideOffer() {},
            async listRideOffersForEvent() { return []; },
            async requestRideSpot() {},
            async updateRideRequestStatus() {},
            async closeRideOffer() {},
            async cancelRideRequest() {},
            async getAggregatedStatsForPlayer() { return null; },
            async createParentMembershipRequest() {},
            async listMyParentMembershipRequests() { return []; }
        },
        utils: {
            renderHeader() {},
            renderFooter() {},
            escapeHtml(value) { return String(value ?? ''); },
            async fetchAndParseCalendar() { return []; },
            extractOpponent() { return 'Opponent'; },
            isPracticeEvent() { return false; },
            expandRecurrence() { return []; },
            getCalendarEventTrackingId(event) { return event?.uid || null; },
            isTrackedCalendarEvent() { return false; }
        },
        parentIncentives: {
            async getIncentiveRules() { return []; },
            async saveIncentiveRule() {},
            async toggleIncentiveRule() {},
            async retireIncentiveRule() {},
            async markGamePaid() {},
            async unmarkGamePaid() {},
            async getPaidGames() { return new Map(); },
            calculateEarnings() { return { totalCents: 0 }; },
            formatCents() { return '$0.00'; },
            getApplicableRulesForGame() { return []; },
            async getStatOptionsForTeam() { return []; },
            renderIncentivesPanel() { return ''; },
            renderRuleBuilder() { return ''; },
            async getCapSetting() { return null; },
            async saveCapSetting() {}
        },
        auth: {
            async requireAuth() { return null; },
            checkAuth() {}
        },
        parentDashboardPackets: {
            resolvePracticePacketSessionIdForEvent() { return null; },
            resolvePracticePacketContextForEvent() { return { sessionId: null, homePacket: null }; },
            getScopedPracticePacketRow() { return null; },
            buildPracticePacketCompletionPayload() { return {}; }
        },
        parentDashboardPracticeSessions: {
            filterVisiblePracticeSessions(sessions) { return sessions || []; }
        },
        parentDashboardRsvp,
        parentDashboardRsvpControls,
        rideshareHelpers: {
            getEventRideshareSummary() { return { seatsLeft: 0, requests: 0, isFull: false }; },
            getOfferSeatInfo() { return { seatCountConfirmed: 0, seatCapacity: 0, seatsLeft: 0 }; }
        },
        parentDashboardRideshareControls: {
            resolveSelectedRideChildId({ defaultChildId }) { return defaultChildId || ''; },
            getRideOfferUiState() { return { disabled: false, reason: '' }; },
            createRideRequestHandlers() {
                return {
                    requestRideSpotForChild: async () => {},
                    cancelMyRideRequest: async () => {}
                };
            }
        },
        rsvpHydration: {
            applyRsvpHydration(allEvents, teamId, gameId, hydration) {
                allEvents.forEach((event) => {
                    if (event.teamId === teamId && event.id === gameId) {
                        if (Object.prototype.hasOwnProperty.call(hydration, 'myRsvp')) {
                            event.myRsvp = hydration.myRsvp;
                        }
                        if (Object.prototype.hasOwnProperty.call(hydration, 'summary')) {
                            event.rsvpSummary = hydration.summary;
                        }
                    }
                });
            }
        }
    };
}

async function bootParentDashboard() {
    const submitRecorder = {
        calls: [],
        updatedSummary: { going: 2, maybe: 0, notGoing: 0, notResponded: 0, total: 2 }
    };
    const env = createEnvironment();
    const deps = createDeps(submitRecorder);

    await runParentDashboardModule({
        ...deps,
        window: env.window,
        document: env.document,
        alert: env.window.alert,
        location: env.window.location,
        URL: globalThis.URL,
        Blob: globalThis.Blob
    });

    return {
        ...env,
        submitRecorder,
        hooks: env.window.__parentDashboardTestHooks
    };
}

describe('parent dashboard calendar day modal RSVP flow', () => {
    it('submits both child ids from the shared-game modal and refreshes the open modal state', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-14T12:00:00Z'));

        try {
            const { elements, hooks, submitRecorder } = await bootParentDashboard();
            const eventDate = new Date('2026-04-15T18:00:00.000Z');
            const initialSummary = { going: 0, maybe: 0, notGoing: 0, notResponded: 2, total: 2 };

            hooks.setCurrentUser({
                uid: 'parent-1',
                displayName: 'Parent One',
                email: 'parent@example.com'
            });
            hooks.setAllScheduleEvents([
                {
                    teamId: 'team-1',
                    id: 'game-1',
                    type: 'game',
                    isDbGame: true,
                    date: eventDate,
                    opponent: 'Lions',
                    location: 'North Field',
                    childId: 'child-a',
                    childName: 'Avery',
                    myRsvp: null,
                    rsvpSummary: initialSummary
                },
                {
                    teamId: 'team-1',
                    id: 'game-1',
                    type: 'game',
                    isDbGame: true,
                    date: eventDate,
                    opponent: 'Lions',
                    location: 'North Field',
                    childId: 'child-b',
                    childName: 'Blake',
                    myRsvp: null,
                    rsvpSummary: initialSummary
                }
            ]);
            hooks.setScheduleCalendar(eventDate.getFullYear(), eventDate.getMonth());
            hooks.setScheduleViewMode('calendar');
            hooks.renderScheduleFromControls();
            hooks.openScheduleDayModal(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

            const beforeHtml = elements.get('schedule-day-modal-content').innerHTML;
            expect(beforeHtml).toContain('data-child-ids="child-a,child-b"');
            expect(beforeHtml).toContain("bg-white text-green-700 border-green-300 hover:bg-green-50");
            expect(beforeHtml).toContain(`${initialSummary.going} going · ${initialSummary.maybe} maybe · ${initialSummary.notGoing} can't go · ${initialSummary.notResponded} no response`);

            await hooks.submitGameRsvpFromButton({
                dataset: {
                    teamId: 'team-1',
                    gameId: 'game-1',
                    childIds: 'child-a,child-b'
                }
            }, 'going');

            expect(submitRecorder.calls).toEqual([
                {
                    teamId: 'team-1',
                    gameId: 'game-1',
                    currentUserId: 'parent-1',
                    payload: {
                        displayName: 'Parent One',
                        playerIds: ['child-a', 'child-b'],
                        response: 'going'
                    }
                }
            ]);

            const afterHtml = elements.get('schedule-day-modal-content').innerHTML;
            expect(elements.get('schedule-day-modal').classList.contains('hidden')).toBe(false);
            expect(afterHtml).toContain("bg-green-600 text-white border-green-600");
            expect(afterHtml).toContain(`${submitRecorder.updatedSummary.going} going · ${submitRecorder.updatedSummary.maybe} maybe · ${submitRecorder.updatedSummary.notGoing} can't go · ${submitRecorder.updatedSummary.notResponded} no response`);
            expect(afterHtml).toContain('For Avery, Blake');
        } finally {
            vi.useRealTimers();
        }
    });
});
