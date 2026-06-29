import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as parentDashboardRsvp from '../../js/parent-dashboard-rsvp.js';
import * as parentDashboardRsvpControls from '../../js/parent-dashboard-rsvp-controls.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

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
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/db\.js\?v=\d+';/, 'const { getParentDashboardData, redeemParentInvite, getTeam, getTeams, getPlayers, getGames, getTrackedCalendarEventUids, getUnreadChatCounts, getPracticeSessions, getPracticePacketCompletions, upsertPracticePacketCompletion, updateUserProfile, getUserProfile, submitRsvp, submitRsvpForPlayer, getRsvps, getRsvpSummaries, createRideOffer, listRideOffersForEvent, requestRideSpot, updateRideRequestStatus, closeRideOffer, cancelRideRequest, getAggregatedStatsForPlayer, createParentMembershipRequest, listMyParentMembershipRequests, listParentTeamFeeRecipients, listCertificatesForPlayer, claimAssignmentSlot, releaseAssignmentClaim, getAssignmentClaims, inviteCoParentToAthlete, createFamilyShareToken, listFamilyShareTokens, revokeFamilyShareToken, updateFamilyShareTokenCalendars } = deps.db;')
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/utils\.js\?v=11';/, 'const { renderHeader, renderFooter, escapeHtml, fetchAndParseCalendar, extractOpponent, isPracticeEvent, expandRecurrence, getCalendarEventTrackingId, isTrackedCalendarEvent } = deps.utils;')
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/parent-incentives\.js\?v=3';/, 'const { getIncentiveRules, saveIncentiveRule: saveIncentiveRuleFn, toggleIncentiveRule: toggleIncentiveRuleFn, retireIncentiveRule: retireIncentiveRuleFn, markGamePaid: markGamePaidFn, unmarkGamePaid: unmarkGamePaidFn, getPaidGames, calculateEarnings, formatCents, getApplicableRulesForGame, getStatOptionsForTeam, renderIncentivesPanel, renderRuleBuilder, getCapSetting, saveCapSetting: saveCapSettingFn } = deps.parentIncentives;')
        .replace("import { requireAuth, checkAuth } from './js/auth.js?v=38';", 'const { requireAuth, checkAuth } = deps.auth;')
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/parent-dashboard-packets\.js\?v=3';/, 'const { resolvePracticePacketSessionIdForEvent: resolvePracticePacketSessionIdForEventBase, resolvePracticePacketContextForEvent: resolvePracticePacketContextForEventBase, getScopedPracticePacketRow: getScopedPracticePacketRowBase, buildPracticePacketCompletionPayload: buildPracticePacketCompletionPayloadBase } = deps.parentDashboardPackets;')
        .replace("import { filterVisiblePracticeSessions } from './js/parent-dashboard-practice-sessions.js?v=1';", 'const { filterVisiblePracticeSessions } = deps.parentDashboardPracticeSessions;')
        .replace("import { resolveRsvpPlayerIdsForSubmission, resolveMyRsvpByChildForGame } from './js/parent-dashboard-rsvp.js?v=5';", 'const { resolveRsvpPlayerIdsForSubmission, resolveMyRsvpByChildForGame } = deps.parentDashboardRsvp;')
        .replace("import { createParentDashboardRsvpController } from './js/parent-dashboard-rsvp-controls.js?v=1';", 'const { createParentDashboardRsvpController } = deps.parentDashboardRsvpControls;')
        .replace("import { getEventRideshareSummary, getOfferSeatInfo } from './js/rideshare-helpers.js?v=1';", 'const { getEventRideshareSummary, getOfferSeatInfo } = deps.rideshareHelpers;')
        .replace("import { mergeAssignmentsWithClaims } from './js/snack-helpers.js?v=1';", 'const { mergeAssignmentsWithClaims } = deps.snackHelpers;')
        .replace("import { resolveSelectedRideChildId, getRideOfferUiState, createRideRequestHandlers } from './js/parent-dashboard-rideshare-controls.js?v=1';", 'const { resolveSelectedRideChildId, getRideOfferUiState, createRideRequestHandlers } = deps.parentDashboardRideshareControls;')
        .replace("import { applyRsvpHydration } from './js/rsvp-hydration.js?v=1';", 'const { applyRsvpHydration } = deps.rsvpHydration;')
        .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/js\/parent-dashboard-fees\.js\?v=\d+';/, 'const { handleParentTeamFeeCheckoutClick, renderParentTeamFees } = deps.parentDashboardFees;')
        .replace(/import\s*\{\s*initiateTeamFeeCheckout\s*\}\s*from '\.\/js\/stripe-service\.js\?v=\d+';/, 'const { initiateTeamFeeCheckout } = deps.stripeService;')
        .replace("import { renderFamilyPlanSection } from './js/family-plan.js?v=2';", 'const { renderFamilyPlanSection } = deps.familyPlan;')
        .replace("import { buildAvailabilityNoteRows, formatAvailabilityCutoff, isAvailabilityLocked, normalizeAvailabilityPreferences } from './js/availability-preferences.js?v=1';", 'const { buildAvailabilityNoteRows, formatAvailabilityCutoff, isAvailabilityLocked, normalizeAvailabilityPreferences } = deps.availabilityPreferences;')
        .replace(/\binit\(\);\s*$/, `
window.__parentDashboardIcsTestHooks = {
    buildIcs,
    getCalendarEntries
};
`);
}

const runParentDashboardModule = new AsyncFunction('deps', readParentDashboardModuleSource());

class MockClassList {
    add() {}
    remove() {}
    contains() { return false; }
    toggle() { return false; }
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
        this.classList = new MockClassList();
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        this.children = this.children.filter((candidate) => candidate !== child);
        return child;
    }

    addEventListener() {}
    removeEventListener() {}
    setAttribute(name, value) { this[name] = value; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    click() {}
    focus() {}
}

function createEnvironment() {
    const ids = [
        'download-ics',
        'player-filter',
        'footer-container',
        'header-container',
        'schedule-list',
        'schedule-calendar-grid',
        'schedule-calendar-nav',
        'schedule-calendar-month-label',
        'schedule-day-modal',
        'schedule-day-modal-title',
        'schedule-day-modal-content',
        'schedule-view-list',
        'schedule-view-calendar',
        'new-share-link-btn',
        'create-share-link-btn',
        'share-link-player-summary',
        'share-form-calendar-add-btn',
        'share-form-calendar-input',
        'share-link-form',
        'share-link-create-status',
        'cancel-share-link-btn',
        'team-fees-list',
        'request-team-select',
        'submit-parent-access-request-btn',
        'send-co-parent-invite-btn'
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
        querySelectorAll() { return []; }
    };

    const window = {
        document,
        location: { origin: 'https://allplays.test', reload() {} },
        setTimeout,
        navigator: { clipboard: { writeText: vi.fn().mockResolvedValue() } }
    };

    return { document, window };
}

function createDeps() {
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
            async submitRsvp() { return null; },
            async submitRsvpForPlayer() { return null; },
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
            async listMyParentMembershipRequests() { return []; },
            async listParentTeamFeeRecipients() { return []; },
            async listCertificatesForPlayer() { return []; },
            async claimAssignmentSlot() {},
            async releaseAssignmentClaim() {},
            async getAssignmentClaims() { return {}; },
            async inviteCoParentToAthlete() {},
            async createFamilyShareToken() { return 'token'; },
            async listFamilyShareTokens() { return []; },
            async revokeFamilyShareToken() {},
            async updateFamilyShareTokenCalendars() {}
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
        snackHelpers: {
            mergeAssignmentsWithClaims(assignments) { return assignments || []; }
        },
        parentDashboardRideshareControls: {
            resolveSelectedRideChildId({ defaultChildId }) { return defaultChildId || ''; },
            getRideOfferUiState() { return { myRequest: null, canRequest: false, statusText: '' }; },
            createRideRequestHandlers() {
                return {
                    requestRideSpotForChild: async () => {},
                    cancelMyRideRequest: async () => {}
                };
            }
        },
        rsvpHydration: {
            applyRsvpHydration() {}
        },
        parentDashboardFees: {
            async handleParentTeamFeeCheckoutClick() {},
            renderParentTeamFees() { return ''; }
        },
        stripeService: {
            async initiateTeamFeeCheckout() {}
        },
        familyPlan: {
            async renderFamilyPlanSection() {}
        },
        availabilityPreferences: {
            buildAvailabilityNoteRows() { return []; },
            formatAvailabilityCutoff() { return 'No cutoff'; },
            isAvailabilityLocked() { return false; },
            normalizeAvailabilityPreferences() { return { cutoffMinutesBeforeStart: 0, noteVisibility: 'admins' }; }
        }
    };
}

describe('parent dashboard ICS export', () => {
    it('keeps sibling names when shared events collapse into one calendar item', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-02T05:53:00Z'));

        try {
            const env = createEnvironment();
            await runParentDashboardModule({
                ...createDeps(),
                window: env.window,
                document: env.document,
                alert: () => {},
                location: env.window.location,
                URL: globalThis.URL,
                Blob: globalThis.Blob
            });

            const hooks = env.window.__parentDashboardIcsTestHooks;
            const sharedDate = new Date('2026-06-15T18:00:00Z');
            const ics = hooks.buildIcs([
                {
                    teamId: 'team-1',
                    id: 'game-1',
                    type: 'game',
                    date: sharedDate,
                    location: 'North Field',
                    opponent: 'Lions',
                    childId: 'child-a',
                    childName: 'Avery'
                },
                {
                    teamId: 'team-1',
                    id: 'game-1',
                    type: 'game',
                    date: new Date(sharedDate),
                    location: 'North Field',
                    opponent: 'Lions',
                    childId: 'child-b',
                    childName: 'Blake'
                }
            ]);

            expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
            expect(ics).toContain('SUMMARY:Avery\\, Blake vs Lions');
            expect(ics).toContain('DESCRIPTION:For Avery\\, Blake');
        } finally {
            vi.useRealTimers();
        }
    });
});
