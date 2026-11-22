import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('        async function loadRoster()'), html.indexOf('        function handlePrintRoster()'));

describe('roster first render', () => {
    it('enables player actions while unrelated optional reads remain pending', async () => {
        const tbody = { innerHTML: '' };
        const pending = () => new Promise(() => {});
        const context = vm.createContext({
            document: { getElementById: () => tbody, querySelectorAll: () => [] },
            currentTeamId: 'team', rosterLoadGeneration: 0,
            currentTeam: {}, currentUser: { uid: 'coach', isAdmin: false },
            buildRosterStaffEntries: () => [], renderRosterStaffSection: () => {},
            collectRosterParentContacts: () => [], getPlayerImportSourceType: () => '',
            getPlayersWithPrivateRosterContacts: async () => [{ id: 'p', name: '<Player>', number: '7' }],
            loadOptionalRosterData: (_label, loader) => loader(),
            getGames: pending, listTeamParentMembershipRequests: pending, listTeamRegistrationForms: pending,
            escapeHtml: (value) => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'), console
        });
        vm.runInContext(source, context);
        void context.loadRoster();
        await new Promise((resolve) => setImmediate(resolve));
        expect(tbody.innerHTML).toContain('&lt;Player&gt;');
        expect(tbody.innerHTML).toContain('edit-btn');
        expect(tbody.innerHTML).toContain('deactivate-btn');
        expect(tbody.innerHTML).toContain('invite-btn');
        expect(tbody.innerHTML).not.toContain('No players yet');
    });

    it('does not put chat counts, reviews or tracking ahead of core rows', () => {
        const init = html.slice(html.indexOf('        async function init()'), html.indexOf('        async function refreshTrackingItems()'));
        expect(init).not.toContain('await getUnreadChatCount');
        expect(source).not.toContain('await refreshTrackingItems');
        expect(source).not.toContain('await loadRegistrationReviews');
        expect(source).not.toContain('await renderTrackingStatusMatrix');
        expect(source.indexOf('renderRosterRows(players,')).toBeLessThan(source.indexOf('const [games, membershipRequests, forms]'));
    });
});


describe('tracking hydration ownership', () => {
    const refreshSource = html.slice(html.indexOf('        async function refreshTrackingItems()'), html.indexOf('        function renderTrackingItemSelect()'));

    it('retains the newest result when refreshes resolve in reverse order', async () => {
        const resolvers = [];
        let renders = 0;
        const context = vm.createContext({
            currentTeamId: 'team', rosterLoadGeneration: 1, trackingItemsLoadToken: 0,
            trackingItems: [], selectedTrackingItemId: '',
            listTeamTrackingItems: () => new Promise((resolve) => resolvers.push(resolve)),
            renderTrackingItemSelect: () => { renders += 1; }
        });
        vm.runInContext(refreshSource, context);
        const old = context.refreshTrackingItems();
        const latest = context.refreshTrackingItems();
        resolvers[1]([{ id: 'new' }]);
        expect(await latest).toBe(true);
        resolvers[0]([{ id: 'old' }]);
        expect(await old).toBe(false);
        expect(context.trackingItems).toEqual([{ id: 'new' }]);
        expect(context.selectedTrackingItemId).toBe('new');
        expect(renders).toBe(1);
    });

    it.each(['team', 'generation'])('does not mutate state after %s changes', async (change) => {
        let resolve;
        const context = vm.createContext({
            currentTeamId: 'team', rosterLoadGeneration: 1, trackingItemsLoadToken: 0,
            trackingItems: [{ id: 'kept' }], selectedTrackingItemId: 'kept',
            listTeamTrackingItems: () => new Promise((done) => { resolve = done; }),
            renderTrackingItemSelect: () => { throw new Error('must not render stale items'); }
        });
        vm.runInContext(refreshSource, context);
        const pending = context.refreshTrackingItems();
        if (change === 'team') context.currentTeamId = 'other';
        else context.rosterLoadGeneration += 1;
        resolve([{ id: 'stale' }]);
        expect(await pending).toBe(false);
        expect(context.trackingItems).toEqual([{ id: 'kept' }]);
        expect(context.selectedTrackingItemId).toBe('kept');
    });
});

describe('roster contact enrichment', () => {
    function setup(isAdmin = false) {
        const calls = { team: 0, player: 0, renders: [] };
        const context = vm.createContext({
            document: { getElementById: () => ({ innerHTML: '' }) }, console: { warn() {} },
            currentTeamId: 'team', currentTeam: {}, currentUser: { uid: 'coach', isAdmin },
            rosterLoadGeneration: 0, selectedRegistrationFormId: '',
            getPlayersWithPrivateRosterContacts: async () => [{ id: 'p', name: 'Player' }],
            collectRosterParentContacts: () => [{ userId: 'linked', email: 'linked@example.test' }],
            getPlayerImportSourceType: () => '', normalizeEmail: (email) => email.toLowerCase(),
            buildRosterStaffEntries: () => [], renderRosterStaffSection() {},
            getGames: async () => [], listTeamParentMembershipRequests: async () => [],
            listTeamRegistrationForms: async () => [], renderRegistrationFormFilter() {},
            loadRegistrationReviews() {}, refreshTrackingItems: async () => false,
            getUsersByParentTeamId: async () => { calls.team++; return []; },
            getUsersByParentPlayerKey: async () => {
                calls.player++;
                return [{ id: 'legacy', email: 'legacy@example.test', parentPlayerKeys: ['team::p'] }];
            },
            renderRosterRows: (_players, options) => calls.renders.push(options)
        });
        vm.runInContext(html.slice(html.indexOf('        async function loadOptionalRosterData('), html.indexOf('        function renderRosterRows(')), context);
        return { context, calls };
    }

    it('does not issue global user-directory queries for a team manager', async () => {
        const { context, calls } = setup();
        await context.loadRoster();
        expect(calls.team).toBe(0);
        expect(calls.player).toBe(0);
        expect(calls.renders.at(-1).parentsByPlayerId.get('p')).toEqual([{ userId: 'linked', email: 'linked@example.test' }]);
    });

    it('retains authorized global-admin legacy contacts without delaying the initial controls', async () => {
        const { context, calls } = setup(true);
        let release;
        context.getUsersByParentTeamId = () => new Promise((resolve) => { release = resolve; });
        const pending = context.loadRoster();
        await new Promise((resolve) => setImmediate(resolve));
        expect(calls.renders).toHaveLength(1);
        expect(calls.renders[0].detailsPending).toBe(true);
        release([]);
        await pending;
        expect(calls.player).toBe(1);
        expect(calls.renders.at(-1).parentsByPlayerId.get('p').map(p => p.userId)).toEqual(['linked', 'legacy']);
    });

    it('marks failed details as unavailable while retaining known linked contacts', async () => {
        const { context, calls } = setup(true);
        context.getUsersByParentTeamId = async () => { throw new Error('offline'); };
        await context.loadRoster();
        expect(calls.renders.at(-1).detailsUnavailable).toBe(true);
        expect(calls.renders.at(-1).parentsByPlayerId.get('p')[0].userId).toBe('linked');
    });

    it('retries incomplete details on later loads and expands without caching partial contacts', async () => {
        const { context, calls } = setup(true);
        context.getUsersByParentTeamId = async () => { throw new Error('offline'); };
        context.getUsersByParentPlayerKey = async () => { throw new Error('offline'); };
        await context.loadRoster();
        await context.loadRoster();
        expect(calls.renders.at(-1).detailsUnavailable).toBe(true);
        expect(calls.renders.at(-1).parentsByPlayerId.get('p')).toHaveLength(1);
        context.getUsersByParentTeamId = async () => [{ id: 'recovered', email: 'recovered@example.test', parentPlayerKeys: ['team::p'] }];
        context.getUsersByParentPlayerKey = async () => [];
        await context.loadRoster();
        expect(calls.renders.at(-1).detailsUnavailable).toBe(false);
        expect(calls.renders.at(-1).parentsByPlayerId.get('p').map(p => p.userId)).toEqual(['linked', 'recovered']);
    });

    it('accepts a complete empty optional result without an unavailable warning', async () => {
        const { context, calls } = setup(true);
        context.getUsersByParentPlayerKey = async () => [];
        await context.loadRoster();
        expect(calls.renders.at(-1).detailsUnavailable).toBe(false);
        expect(calls.renders.at(-1).parentsByPlayerId.get('p')).toHaveLength(1);
    });

    it('ignores enrichment and stops queued directory reads after a newer roster load', async () => {
        const { context, calls } = setup(true);
        let release;
        context.getUsersByParentTeamId = () => new Promise((resolve) => { release = resolve; });
        const pending = context.loadRoster();
        await new Promise((resolve) => setImmediate(resolve));
        context.rosterLoadGeneration++;
        release([]);
        await pending;
        expect(calls.player).toBe(0);
        expect(calls.renders).toHaveLength(1);
    });
});
