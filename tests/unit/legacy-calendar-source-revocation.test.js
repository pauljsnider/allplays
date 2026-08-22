import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { resolveCanonicalParentScopeInput } from '../../js/parent-membership-utils.js';

const resolverPages = [
    'calendar.html',
    'edit-schedule.html',
    'game-plan.html'
];

function readPage(page) {
    return readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
}

function extractNamedFunctionSource(page, name) {
    const source = readPage(page);
    const start = source.indexOf(`function ${name}(`);
    expect(start, `${page} should define ${name}`).toBeGreaterThan(-1);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }
    throw new Error(`${name} did not terminate`);
}

function extractNamedFunction(page, name) {
    const functionSource = extractNamedFunctionSource(page, name);
    return new Function(`${functionSource}\nreturn ${name};`)();
}

function buildCalendarSourceScopeReconciler(state) {
    const sourceKeyFunction = extractNamedFunctionSource('calendar.html', 'getCalendarSourceKey');
    const clearFunction = extractNamedFunctionSource('calendar.html', 'clearCalendarTeamLoadState');
    const reconcileFunction = extractNamedFunctionSource(
        'calendar.html',
        'clearCalendarTeamLoadStateIfSourceChanged'
    );
    return new Function('state', `
        const {
            completeCalendarFeedEventsByTeam,
            calendarEventsByTeam,
            calendarGamesByTeam,
            loadedCalendarRangesByTeam,
            fullyLoadedCalendarTeams
        } = state;
        ${sourceKeyFunction}
        ${clearFunction}
        ${reconcileFunction}
        return clearCalendarTeamLoadStateIfSourceChanged;
    `)(state);
}

function buildCalendarScopeRefreshHarness(overrides = {}) {
    const sourceKeyFunction = extractNamedFunctionSource('calendar.html', 'getCalendarSourceKey');
    const clearFunction = extractNamedFunctionSource('calendar.html', 'clearCalendarTeamLoadState');
    const reconcileFunction = extractNamedFunctionSource('calendar.html', 'clearCalendarTeamLoadStateIfSourceChanged');
    const refreshFunction = readPage('calendar.html').slice(
        readPage('calendar.html').indexOf('async function refreshCalendarTeamsForLoad()'),
        readPage('calendar.html').indexOf('// COMPLETE_CALENDAR_FALLBACK_END')
    );
    return new Function('deps', `
        let calendarTeams = deps.calendarTeams;
        let linkedPlayersByTeam = deps.linkedPlayersByTeam;
        const currentUserId = deps.currentUserId;
        const currentUser = deps.currentUser;
        const completeCalendarFeedEventsByTeam = deps.completeCalendarFeedEventsByTeam;
        const calendarEventsByTeam = deps.calendarEventsByTeam;
        const calendarGamesByTeam = deps.calendarGamesByTeam;
        const loadedCalendarRangesByTeam = deps.loadedCalendarRangesByTeam;
        const fullyLoadedCalendarTeams = deps.fullyLoadedCalendarTeams;
        const teamColors = deps.teamColors;
        const colorPalette = deps.colorPalette;
        const getUserProfile = deps.getUserProfile;
        const resolveCanonicalParentScopeInput = deps.resolveCanonicalParentScopeInput;
        const buildLinkedPlayersByTeam = deps.buildLinkedPlayersByTeam;
        const getUserTeamsWithAccess = deps.getUserTeamsWithAccess;
        const getParentTeams = deps.getParentTeams;
        const getTeam = deps.getTeam;
        ${sourceKeyFunction}
        ${clearFunction}
        ${reconcileFunction}
        ${refreshFunction}
        return {
            refreshCalendarTeamsForLoad,
            getCalendarTeams: () => calendarTeams,
            getLinkedPlayersByTeam: () => linkedPlayersByTeam
        };
    `)({
        calendarTeams: [],
        linkedPlayersByTeam: new Map(),
        currentUserId: 'parent-1',
        currentUser: { email: 'parent@example.com' },
        completeCalendarFeedEventsByTeam: new Map(),
        calendarEventsByTeam: new Map(),
        calendarGamesByTeam: new Map(),
        loadedCalendarRangesByTeam: new Map(),
        fullyLoadedCalendarTeams: new Set(),
        teamColors: {},
        colorPalette: ['#123456'],
        getUserProfile: vi.fn().mockResolvedValue({}),
        resolveCanonicalParentScopeInput,
        buildLinkedPlayersByTeam: (links) => {
            const byTeam = new Map();
            links.forEach((link) => {
                const players = byTeam.get(link.teamId) || [];
                players.push(link);
                byTeam.set(link.teamId, players);
            });
            return byTeam;
        },
        getUserTeamsWithAccess: vi.fn().mockResolvedValue([]),
        getParentTeams: vi.fn().mockResolvedValue([]),
        getTeam: vi.fn().mockResolvedValue(null),
        ...overrides
    });
}

describe.each(resolverPages)('%s external calendar source revocation', (page) => {
    it('does not replay source A after the team replaces it with failing source B', () => {
        const resolve = extractNamedFunction(page, 'resolveExternalCalendarEventsForLoad');
        const cache = new Map();
        const sourceAEvents = [{ id: 'private-source-a' }];

        expect(resolve(cache, 'team-1', 'source-a', sourceAEvents, true, true)).toEqual(sourceAEvents);
        expect(resolve(cache, 'team-1', 'source-b', [], false, true)).toEqual([]);

        const sourceBEvents = [{ id: 'source-b-after-retry' }];
        expect(resolve(cache, 'team-1', 'source-b', sourceBEvents, true, true)).toEqual(sourceBEvents);
    });

    it('clears a scoped snapshot on callable access or source loss', () => {
        const resolve = extractNamedFunction(page, 'resolveExternalCalendarEventsForLoad');
        const isScopeLoss = extractNamedFunction(page, 'isCalendarAccessOrSourceLossError');
        const cache = new Map();

        resolve(cache, 'team-1', 'source-a', [{ id: 'private-source-a' }], true, true);
        expect(isScopeLoss({ code: 'functions/permission-denied' })).toBe(true);
        expect(isScopeLoss({ code: 'unauthenticated' })).toBe(true);
        expect(isScopeLoss({ code: 'functions/not-found' })).toBe(true);

        expect(resolve(cache, 'team-1', 'source-a', [], false, false)).toEqual([]);
        expect(cache.has('team-1')).toBe(false);

        // A later transient failure cannot resurrect data from before the
        // access/source denial. Only another complete response may replace it.
        expect(resolve(cache, 'team-1', 'source-a', [], false, true)).toEqual([]);
    });

    it('preserves the same freshly verified source on a transient provider failure', () => {
        const resolve = extractNamedFunction(page, 'resolveExternalCalendarEventsForLoad');
        const isScopeLoss = extractNamedFunction(page, 'isCalendarAccessOrSourceLossError');
        const cache = new Map();
        const complete = [{ id: 'known-source-a' }];

        resolve(cache, 'team-1', 'source-a', complete, true, true);
        expect(isScopeLoss({ code: 'functions/unavailable' })).toBe(false);
        expect(isScopeLoss({ code: 'resource-exhausted' })).toBe(false);
        expect(resolve(cache, 'team-1', 'source-a', [], false, true)).toEqual(complete);
    });
});

describe('calendar.html authoritative navigation scope refresh', () => {
    it('re-reads accessible teams and exact team documents before each range load', () => {
        const source = readPage('calendar.html');
        const refreshStart = source.indexOf('async function refreshCalendarTeamsForLoad()');
        const loadStart = source.indexOf('const loadCalendarRange = createLatestCalendarRangeLoader');
        const refreshCall = source.indexOf('const verifiedTeamLoad = await refreshCalendarTeamsForLoad();', loadStart);

        expect(refreshStart).toBeGreaterThan(-1);
        expect(source.slice(refreshStart, loadStart)).toContain('const profile = await getUserProfile(currentUserId);');
        expect(source.slice(refreshStart, loadStart)).toContain('resolveCanonicalParentScopeInput(profile || {})');
        expect(source.slice(refreshStart, loadStart)).toContain('linkedPlayersByTeam = buildLinkedPlayersByTeam(canonicalParentScope.parentLinks);');
        expect(source.slice(refreshStart, loadStart)).toContain('getUserTeamsWithAccess(currentUserId');
        expect(source.slice(refreshStart, loadStart)).toContain('getParentTeams(currentUserId, { profile })');
        expect(source.slice(refreshStart, loadStart)).toContain('const freshTeam = await getTeam(discoveredTeam.id);');
        expect(source.slice(refreshStart, loadStart)).toContain('clearCalendarTeamLoadState(discoveredTeam.id);');
        expect(refreshCall).toBeGreaterThan(loadStart);
        expect(refreshCall).toBeLessThan(source.indexOf('const loadPromises = calendarTeams.map', loadStart));
    });

    it('replaces the live same-team player selector from current canonical keys', async () => {
        const profile = {
            parentOf: [
                { teamId: 'team-1', playerId: 'player-current' },
                { teamId: 'team-1', playerId: 'player-revoked' }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-current']
        };
        const getParentTeams = vi.fn().mockResolvedValue([{ id: 'team-1', name: 'Team' }]);
        const harness = buildCalendarScopeRefreshHarness({
            calendarTeams: [{ id: 'team-1', name: 'Team' }],
            getUserProfile: vi.fn().mockResolvedValue(profile),
            getParentTeams,
            getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Team' })
        });

        await expect(harness.refreshCalendarTeamsForLoad()).resolves.toMatchObject({ complete: true });

        expect(harness.getLinkedPlayersByTeam().get('team-1')).toEqual([
            { teamId: 'team-1', playerId: 'player-current' }
        ]);
        expect(getParentTeams).toHaveBeenCalledWith('parent-1', { profile });
    });

    it('clears live child/team scope when the current profile cannot be verified', async () => {
        const calendarEventsByTeam = new Map([['team-1', [{ id: 'private-event' }]]]);
        const harness = buildCalendarScopeRefreshHarness({
            calendarTeams: [{ id: 'team-1', name: 'Team' }],
            linkedPlayersByTeam: new Map([['team-1', [{ playerId: 'player-stale' }]]]),
            calendarEventsByTeam,
            getUserProfile: vi.fn().mockRejectedValue(new Error('profile unavailable'))
        });

        await expect(harness.refreshCalendarTeamsForLoad()).resolves.toEqual({ teams: [], complete: false });

        expect(harness.getLinkedPlayersByTeam().size).toBe(0);
        expect(harness.getCalendarTeams()).toEqual([]);
        expect(calendarEventsByTeam.size).toBe(0);
    });

    it('clears rendered and cached A before a downstream game read can fail after A changes to B', async () => {
        const state = {
            completeCalendarFeedEventsByTeam: new Map([['team-1', {
                sourceKey: '["https://calendar.example/a.ics"]',
                events: [{ id: 'source-a-event' }]
            }]]),
            calendarEventsByTeam: new Map([['team-1', [{ id: 'source-a-event' }]]]),
            calendarGamesByTeam: new Map([['team-1', new Map([['game-a', { id: 'game-a' }]])]]),
            loadedCalendarRangesByTeam: new Map([['team-1', [{ start: 1, end: 2 }]]]),
            fullyLoadedCalendarTeams: new Set(['team-1'])
        };
        const reconcile = buildCalendarSourceScopeReconciler(state);
        const previousTeam = { id: 'team-1', calendarUrls: ['https://calendar.example/a.ics'] };
        const freshTeam = { id: 'team-1', calendarUrls: ['https://calendar.example/b.ics'] };

        expect(reconcile(previousTeam, freshTeam)).toBe(true);
        const renderedAfterFreshScope = [freshTeam]
            .flatMap((team) => state.calendarEventsByTeam.get(team.id) || []);
        expect(renderedAfterFreshScope).toEqual([]);
        expect(state.completeCalendarFeedEventsByTeam.has('team-1')).toBe(false);
        expect(state.calendarGamesByTeam.has('team-1')).toBe(false);
        expect(state.loadedCalendarRangesByTeam.has('team-1')).toBe(false);
        expect(state.fullyLoadedCalendarTeams.has('team-1')).toBe(false);

        await expect(Promise.reject(new Error('downstream game read failed'))).rejects.toThrow(
            'downstream game read failed'
        );
        expect(renderedAfterFreshScope).toEqual([]);

        const source = readPage('calendar.html');
        const loadStart = source.indexOf('const loadCalendarRange = createLatestCalendarRangeLoader');
        const earlyPublish = source.indexOf('publishCalendarEvents();', loadStart);
        const downstreamReads = source.indexOf('const loadPromises = calendarTeams.map', loadStart);
        expect(earlyPublish).toBeGreaterThan(loadStart);
        expect(earlyPublish).toBeLessThan(downstreamReads);
    });

    it('keeps rendered A when the freshly verified source is unchanged and only the game read is transient', async () => {
        const sourceAEvent = { id: 'source-a-event' };
        const state = {
            completeCalendarFeedEventsByTeam: new Map([['team-1', {
                sourceKey: '["https://calendar.example/a.ics"]',
                events: [sourceAEvent]
            }]]),
            calendarEventsByTeam: new Map([['team-1', [sourceAEvent]]]),
            calendarGamesByTeam: new Map([['team-1', new Map()]]),
            loadedCalendarRangesByTeam: new Map(),
            fullyLoadedCalendarTeams: new Set()
        };
        const reconcile = buildCalendarSourceScopeReconciler(state);
        const previousTeam = { id: 'team-1', calendarUrls: ['https://calendar.example/a.ics'] };
        const freshTeam = { id: 'team-1', calendarUrls: ['https://calendar.example/a.ics'] };

        expect(reconcile(previousTeam, freshTeam)).toBe(false);
        const renderedAfterFreshScope = [freshTeam]
            .flatMap((team) => state.calendarEventsByTeam.get(team.id) || []);
        await expect(Promise.reject(new Error('transient game read'))).rejects.toThrow('transient game read');
        expect(renderedAfterFreshScope).toEqual([sourceAEvent]);
        expect(state.completeCalendarFeedEventsByTeam.has('team-1')).toBe(true);
    });
});

describe('legacy page fresh source-scope wiring', () => {
    it('refreshes the schedule editor team before selecting calendar sources', () => {
        const source = readPage('edit-schedule.html');
        const loadStart = source.indexOf('async function loadSchedule()');
        const refreshCall = source.indexOf('const verifiedTeam = await refreshScheduleTeamScopeForLoad();', loadStart);
        const sourceRead = source.indexOf('const calendarUrls = Array.isArray(currentTeam.calendarUrls)', loadStart);

        expect(refreshCall).toBeGreaterThan(loadStart);
        expect(refreshCall).toBeLessThan(sourceRead);
        expect(source).toContain('completeCalendarImportEventsByTeam.delete(currentTeamId);');
    });

    it('verifies game-plan team access before loading other schedule slices', () => {
        const source = readPage('game-plan.html');
        const loadStart = source.indexOf('async function loadGamePlanner()');
        const teamRead = source.indexOf('const team = await getTeam(teamId);', loadStart);
        const otherReads = source.indexOf('const [allPlayers, games] = await Promise.all([', loadStart);

        expect(teamRead).toBeGreaterThan(loadStart);
        expect(otherReads).toBeGreaterThan(teamRead);
        expect(source.slice(teamRead, otherReads)).toContain('completeCalendarGamesByTeam.delete(teamId);');
        expect(source.slice(teamRead, otherReads)).toContain('teamCalendarScopeVerified = true;');
    });
});

describe('team.html hidden-source public projection', () => {
    it('uses current canonical profile scope for access and RSVP player ids', () => {
        const source = readPage('team.html');
        expect(source).toContain("import { resolveCanonicalParentScopeInput } from './js/parent-membership-utils.js?v=4';");
        expect(source).toContain('applyCurrentParentAccessProfile(profile);');
        expect(source).toContain('const parentScopeVerified = await refreshCurrentParentAccessForTeam();');

        const scope = resolveCanonicalParentScopeInput({
            parentOf: [
                { teamId: 'team-1', playerId: 'player-1' },
                { teamId: 'team-1', playerId: 'player-revoked' }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1']
        });
        expect(scope.parentLinks.map((link) => link.playerId)).toEqual(['player-1']);

        const revoked = resolveCanonicalParentScopeInput({
            parentOf: [{ teamId: 'team-1', playerId: 'player-revoked' }],
            parentTeamIds: [],
            parentPlayerKeys: []
        });
        expect(revoked.parentLinks).toEqual([]);
        expect(revoked.parentTeamIds).toEqual([]);
    });

    it('never treats the projection sentinel as exact same-source evidence after a partial load', () => {
        const resolve = extractNamedFunction('team.html', 'resolveTeamExternalCalendarEventsForLoad');
        const cache = new Map();

        resolve(cache, 'team-1', 'public-projection', [{ id: 'hidden-source-a' }], true, true);
        expect(resolve(cache, 'team-1', 'public-projection', [], false, false)).toEqual([]);
        expect(cache.has('team-1')).toBe(false);

        const source = readPage('team.html');
        const partialProjectionBranch = source.indexOf('if (!publicCalendarProjection.complete || publicCalendarProjection.warnings.length > 0)');
        const projectionCatch = source.indexOf("console.warn('Public calendar projection unavailable for team schedule:'", partialProjectionBranch);
        expect(source.slice(partialProjectionBranch, projectionCatch)).toContain('externalCalendarScopeVerified = false;');
    });

    it('distinguishes callable denial from a transient raw-source failure', () => {
        const resolve = extractNamedFunction('team.html', 'resolveTeamExternalCalendarEventsForLoad');
        const isScopeLoss = extractNamedFunction('team.html', 'isCalendarAccessOrSourceLossError');
        const complete = [{ id: 'raw-source-a' }];
        const transientCache = new Map();

        resolve(transientCache, 'team-1', 'raw:source-a', complete, true, true);
        expect(isScopeLoss({ code: 'functions/unavailable' })).toBe(false);
        expect(resolve(transientCache, 'team-1', 'raw:source-a', [], false, true)).toEqual(complete);

        const deniedCache = new Map();
        resolve(deniedCache, 'team-1', 'raw:source-a', complete, true, true);
        expect(isScopeLoss({ code: 'functions/permission-denied' })).toBe(true);
        expect(resolve(deniedCache, 'team-1', 'raw:source-a', [], false, false)).toEqual([]);
        expect(deniedCache.has('team-1')).toBe(false);
    });
});
