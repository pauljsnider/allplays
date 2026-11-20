import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('        async function loadRoster()'), html.indexOf('        function handlePrintRoster()'));

describe('roster first render', () => {
    it('shows authoritative players while unrelated optional reads remain pending', async () => {
        const tbody = { innerHTML: '' };
        const pending = () => new Promise(() => {});
        const context = vm.createContext({
            document: { getElementById: () => tbody },
            currentTeamId: 'team', rosterLoadGeneration: 0,
            getPlayersWithPrivateRosterContacts: async () => [{ id: 'p', name: '<Player>', number: '7' }],
            loadOptionalRosterData: (_label, loader) => loader(),
            getGames: pending, listTeamParentMembershipRequests: pending, listTeamRegistrationForms: pending,
            escapeHtml: (value) => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'), console
        });
        vm.runInContext(source, context);
        void context.loadRoster();
        await new Promise((resolve) => setImmediate(resolve));
        expect(tbody.innerHTML).toContain('&lt;Player&gt;');
        expect(tbody.innerHTML).toContain('Loading contacts and actions');
        expect(tbody.innerHTML).not.toContain('No players yet');
    });

    it('does not put chat counts, reviews or tracking ahead of core rows', () => {
        const init = html.slice(html.indexOf('        async function init()'), html.indexOf('        async function refreshTrackingItems()'));
        expect(init).not.toContain('await getUnreadChatCount');
        expect(source).not.toContain('await refreshTrackingItems');
        expect(source).not.toContain('await loadRegistrationReviews');
        expect(source).not.toContain('await renderTrackingStatusMatrix');
        expect(source.indexOf('Loading contacts and actions')).toBeLessThan(source.indexOf('const [games, membershipRequests, forms]'));
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
