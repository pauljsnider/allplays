import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { resolveCanonicalParentScopeInput } from '../../js/parent-membership-utils.js';

const pages = [
    'calendar.html',
    'edit-schedule.html',
    'game-plan.html',
    'parent-dashboard.html'
];

function readPage(page) {
    return readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
}

function extractExternalCalendarResolver(page) {
    const source = readPage(page);
    const start = source.indexOf('function resolveExternalCalendarEventsForLoad(');
    const end = source.indexOf('// COMPLETE_CALENDAR_FALLBACK_END', start);
    expect(start, `${page} should define the complete-calendar fallback resolver`).toBeGreaterThan(-1);
    expect(end, `${page} should delimit the complete-calendar fallback resolver`).toBeGreaterThan(start);
    const functionSource = source.slice(start, end);
    return new Function(`${functionSource}\nreturn resolveExternalCalendarEventsForLoad;`)();
}

function extractNamedFunction(page, name) {
    const source = readPage(page);
    const start = source.indexOf(`function ${name}(`);
    expect(start, `${page} should define ${name}`).toBeGreaterThan(-1);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) {
            return new Function(`${source.slice(start, index + 1)}\nreturn ${name};`)();
        }
    }
    throw new Error(`${name} did not terminate`);
}

function extractAsyncNamedFunction(page, name, dependencies = {}) {
    const source = readPage(page);
    const start = source.indexOf(`async function ${name}(`);
    expect(start, `${page} should define async ${name}`).toBeGreaterThan(-1);
    const bodyStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) {
            const names = Object.keys(dependencies);
            const values = Object.values(dependencies);
            return new Function(...names, `${source.slice(start, index + 1)}\nreturn ${name};`)(...values);
        }
    }
    throw new Error(`${name} did not terminate`);
}

function resolveWithVerifiedAccess(page, resolve, ...args) {
    return page === 'parent-dashboard.html'
        ? resolve(...args, true)
        : resolve(...args);
}

describe.each(pages)('%s external calendar completeness state', (page) => {
    it('recovers after an initial partial-empty load', () => {
        const resolve = extractExternalCalendarResolver(page);
        const cache = new Map();
        const recovered = [{ id: 'external-after-retry' }];

        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual([]);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', recovered, true)).toEqual(recovered);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual(recovered);
    });

    it('preserves the last complete snapshot across repeated partial-empty loads', () => {
        const resolve = extractExternalCalendarResolver(page);
        const cache = new Map();
        const firstComplete = [{ id: 'external-a' }];

        const firstRendered = resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', firstComplete, true);
        expect(firstRendered).toEqual(firstComplete);

        firstRendered.push({ id: 'render-only-mutation' });
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual(firstComplete);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual(firstComplete);
    });

    it('does not promote a partial nonempty load into the completeness cache', () => {
        const resolve = extractExternalCalendarResolver(page);
        const cache = new Map();
        const complete = [{ id: 'external-a' }, { id: 'external-b' }];

        resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', complete, true);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [{ id: 'external-a' }], false))
            .toEqual([{ id: 'external-a' }]);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual(complete);
    });

    it('accepts complete emptiness and a later complete expansion', () => {
        const resolve = extractExternalCalendarResolver(page);
        const cache = new Map();

        resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [{ id: 'external-a' }], true);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], true)).toEqual([]);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual([]);

        const expanded = [{ id: 'external-a' }, { id: 'external-b' }];
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', expanded, true)).toEqual(expanded);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [], false)).toEqual(expanded);
    });

    it('never reuses a complete snapshot from a different source set or team', () => {
        const resolve = extractExternalCalendarResolver(page);
        const cache = new Map();

        resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-a', [{ id: 'external-a' }], true);

        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-1', 'source-set-b', [], false)).toEqual([]);
        expect(resolveWithVerifiedAccess(page, resolve, cache, 'team-2', 'source-set-a', [], false)).toEqual([]);
    });
});

describe('parent-dashboard.html external calendar access boundary', () => {
    it('never rebuilds present canonical grants from stale parentOf metadata', async () => {
        const updateUserProfile = vi.fn();
        const ensureParentTeamAccess = extractAsyncNamedFunction(
            'parent-dashboard.html',
            'ensureParentTeamAccess',
            {
                getUserProfile: vi.fn().mockResolvedValue({
                    parentOf: [
                        { teamId: 'team-a', playerId: 'player-current' },
                        { teamId: 'team-a', playerId: 'player-revoked' },
                        { teamId: 'team-revoked', playerId: 'player-old' }
                    ],
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-current']
                }),
                updateUserProfile,
                resolveCanonicalParentScopeInput
            }
        );

        await ensureParentTeamAccess('parent-1', ['team-a', 'team-revoked'], { strict: true });

        expect(updateUserProfile).not.toHaveBeenCalled();
    });

    it('backfills missing legacy grant fields from exact parentOf links only', async () => {
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const ensureParentTeamAccess = extractAsyncNamedFunction(
            'parent-dashboard.html',
            'ensureParentTeamAccess',
            {
                getUserProfile: vi.fn().mockResolvedValue({
                    parentOf: [{ teamId: 'team-a', playerId: 'player-current' }]
                }),
                updateUserProfile,
                resolveCanonicalParentScopeInput
            }
        );

        await ensureParentTeamAccess('parent-1', ['caller-supplied-team'], { strict: true });

        expect(updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentTeamIds: ['team-a'],
            parentPlayerKeys: ['team-a::player-current']
        });
    });

    it('backfills a missing team field only from exact canonical player keys', async () => {
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const ensureParentTeamAccess = extractAsyncNamedFunction(
            'parent-dashboard.html',
            'ensureParentTeamAccess',
            {
                getUserProfile: vi.fn().mockResolvedValue({
                    parentOf: [
                        { teamId: 'team-a', playerId: 'player-current' },
                        { teamId: 'team-revoked', playerId: 'player-old' }
                    ],
                    parentPlayerKeys: ['team-a::player-current']
                }),
                updateUserProfile,
                resolveCanonicalParentScopeInput
            }
        );

        await ensureParentTeamAccess('parent-1', ['team-a', 'team-revoked'], { strict: true });

        expect(updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentTeamIds: ['team-a']
        });
    });

    it('backfills an empty player field when only team-level canonical evidence exists', async () => {
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const ensureParentTeamAccess = extractAsyncNamedFunction(
            'parent-dashboard.html',
            'ensureParentTeamAccess',
            {
                getUserProfile: vi.fn().mockResolvedValue({
                    parentOf: [
                        { teamId: 'team-a', playerId: 'player-current' },
                        { teamId: 'team-a', playerId: 'player-revoked' }
                    ],
                    parentTeamIds: ['team-a']
                }),
                updateUserProfile,
                resolveCanonicalParentScopeInput
            }
        );

        await ensureParentTeamAccess('parent-1', ['team-a'], { strict: true });

        expect(updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentPlayerKeys: []
        });
    });

    it('drops the private snapshot when current team access is revoked or unverified', () => {
        const resolve = extractExternalCalendarResolver('parent-dashboard.html');
        const cache = new Map();
        const privateImportedEvents = [{ id: 'private-imported-event' }];

        expect(resolve(cache, 'team-1', 'source-set-a', privateImportedEvents, true, true))
            .toEqual(privateImportedEvents);

        expect(resolve(cache, 'team-1', 'source-set-a', [], false, false)).toEqual([]);
        expect(cache.has('team-1')).toBe(false);

        // A later partial source read cannot resurrect events cached before the
        // access failure; a new complete load must establish a fresh snapshot.
        expect(resolve(cache, 'team-1', 'source-set-a', [], false, true)).toEqual([]);
    });

    it('still preserves a complete snapshot when current access is verified and only the source load is partial', () => {
        const resolve = extractExternalCalendarResolver('parent-dashboard.html');
        const cache = new Map();
        const complete = [{ id: 'external-a' }];

        resolve(cache, 'team-1', 'source-set-a', complete, true, true);

        expect(resolve(cache, 'team-1', 'source-set-a', [], false, true)).toEqual(complete);
    });

    it('does not reuse a verified first account snapshot for a second account with the same team and player', () => {
        const resolve = extractExternalCalendarResolver('parent-dashboard.html');
        const getCacheKey = extractNamedFunction('parent-dashboard.html', 'getParentCalendarCacheKey');
        const cache = new Map();
        const teamChildren = [{ playerId: 'player-1' }];
        const firstAccountKey = getCacheKey('account-a', 'team-1', teamChildren);
        const secondAccountKey = getCacheKey('account-b', 'team-1', teamChildren);

        expect(firstAccountKey).not.toBe(secondAccountKey);
        resolve(cache, firstAccountKey, 'source-set-a', [{ id: 'account-a-private-event' }], true, true);

        expect(resolve(cache, secondAccountKey, 'source-set-a', [], false, true)).toEqual([]);
    });

    it('clears all snapshots when the observed auth UID changes or signs out', () => {
        const resolveAuthScope = extractNamedFunction(
            'parent-dashboard.html',
            'resolveParentCalendarCacheAuthScope'
        );
        const cache = new Map([['account-a-key', { events: [{ id: 'private-event' }] }]]);

        expect(resolveAuthScope(cache, 'account-a', 'account-b')).toBe('account-b');
        expect(cache.size).toBe(0);

        cache.set('account-b-key', { events: [{ id: 'other-private-event' }] });
        expect(resolveAuthScope(cache, 'account-b', '')).toBe('');
        expect(cache.size).toBe(0);
    });

    it.each([
        'unauthenticated',
        'functions/unauthenticated',
        'permission-denied',
        'functions/permission-denied',
        'not-found',
        'functions/not-found'
    ])('classifies %s as permanent source or authorization loss', (code) => {
        const isPermanent = extractNamedFunction(
            'parent-dashboard.html',
            'isPermanentCalendarSourceAccessError'
        );

        expect(isPermanent({ code })).toBe(true);
        expect(isPermanent({ code: 'functions/unavailable' })).toBe(false);
    });

    it('clears rather than replays the snapshot after permanent callable source loss', () => {
        const resolve = extractExternalCalendarResolver('parent-dashboard.html');
        const cache = new Map();
        const cacheKey = 'account-a-team-1-player-1';
        const complete = [{ id: 'private-calendar-event' }];

        resolve(cache, cacheKey, 'source-set-a', complete, true, true, false);

        expect(resolve(cache, cacheKey, 'source-set-a', [], false, true, true)).toEqual([]);
        expect(cache.has(cacheKey)).toBe(false);
        expect(resolve(cache, cacheKey, 'source-set-a', [], false, true, false)).toEqual([]);
    });
});

describe('legacy external calendar fallback wiring', () => {
    it('uses the completeness resolver in all four retryable legacy workflows', () => {
        const sources = Object.fromEntries(pages.map((page) => [page, readPage(page)]));

        expect(sources['calendar.html']).toContain('completeCalendarFeedEventsByTeam');
        expect(sources['calendar.html']).toContain('const sourceKey = getCalendarSourceKey(calendarUrls);');
        expect(sources['calendar.html']).toContain('events.slice(storedEventCount),\n                        externalLoadComplete');
        expect(sources['calendar.html']).toContain('onEvents?.([...events, ...previousExternalEvents]);');
        expect(sources['calendar.html']).toContain('renderCalendarCompletenessWarning(calendarLoadIncomplete);');

        expect(sources['edit-schedule.html']).toContain('completeCalendarImportEventsByTeam');
        expect(sources['edit-schedule.html']).toContain('const calendarSourceKey = getCalendarSourceKey(calendarUrls);');
        expect(sources['edit-schedule.html']).toContain('loadedCalendarEvents,\n                externalCalendarLoadComplete');
        expect(sources['edit-schedule.html']).toContain('calendarLoadIncomplete = !externalCalendarLoadComplete;');

        expect(sources['game-plan.html']).toContain('completeCalendarGamesByTeam');
        expect(sources['game-plan.html']).toContain('const calendarSourceKey = getCalendarSourceKey(calendarUrls);');
        expect(sources['game-plan.html']).toContain('loadedCalendarGames,\n                    externalCalendarLoadComplete');
        expect(sources['game-plan.html']).toContain('calendarLoadIncomplete = !externalCalendarLoadComplete;');

        expect(sources['parent-dashboard.html']).toContain('completeParentCalendarEventsByTeam');
        expect(sources['parent-dashboard.html']).toContain('currentTeamAccessVerified = false');
        expect(sources['parent-dashboard.html']).toContain('function getParentCalendarCacheKey(authUid, teamId, teamChildren)');
        expect(sources['parent-dashboard.html']).toContain('return JSON.stringify([normalizedAuthUid, String(teamId || \'\').trim(), playerIds]);');
        expect(sources['parent-dashboard.html']).toContain('const parentCalendarCacheKey = getParentCalendarCacheKey(');
        expect(sources['parent-dashboard.html']).toContain('function syncParentCalendarCacheAuthScope(nextAuthUid)');
        expect(sources['parent-dashboard.html']).toContain('syncParentCalendarCacheAuthScope(updatedUser?.uid)');
        expect(sources['parent-dashboard.html']).toContain('function isPermanentCalendarSourceAccessError(error)');
        expect(sources['parent-dashboard.html']).toContain('externalCalendarSourceAccessLost = externalCalendarSourceAccessLost ||');
        expect(sources['parent-dashboard.html']).toContain('const calendarSourceKey = getCalendarSourceKey(calendarUrls);');
        expect(sources['parent-dashboard.html']).toContain('loadedCalendarTeamEvents,\n                    externalCalendarLoadComplete');
        expect(sources['parent-dashboard.html']).toContain('externalCalendarLoadComplete,\n                    true');
        expect(sources['parent-dashboard.html'].match(/false,\n\s+false\n\s+\);/g)).toHaveLength(2);
        expect(sources['parent-dashboard.html']).toContain("source: 'calendar'");
        expect(sources['parent-dashboard.html']).toContain('if (!externalCalendarLoadComplete) {\n                    parentScheduleIncomplete = true;');
    });
});
