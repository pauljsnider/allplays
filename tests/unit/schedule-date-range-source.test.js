import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

function extractSource(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

function buildGetSharedGamesForTeam(deps) {
    const normalizeSource = extractSource(dbSource, 'function normalizeSharedGameSnapshot', 'async function getSharedGamesForTeam');
    const sharedGamesSource = extractSource(dbSource, 'async function getSharedGamesForTeam', 'async function hasSharedGameUsingConfig');
    return new Function(
        'db',
        'collectionGroup',
        'query',
        'where',
        'orderBy',
        'Timestamp',
        'getDocs',
        'isGameWithinDateRange',
        `${normalizeSource}\n${sharedGamesSource}\nreturn getSharedGamesForTeam;`
    )(
        deps.db,
        deps.collectionGroup,
        deps.query,
        deps.where,
        deps.orderBy,
        deps.Timestamp,
        deps.getDocs,
        deps.isGameWithinDateRange
    );
}

describe('schedule date range source contracts', () => {
    it('keeps recurring practice masters in the shared getGames date window path', () => {
        const getGamesSource = extractSource(dbSource, 'export async function getGames', 'export async function getAggregatedStatsForGames');
        const appLoadGamesSource = extractSource(appSource, 'async function loadGames', 'async function loadGameById');

        expect(dbSource).toContain('function recurringPracticeMasterMayOverlapDateRange');
        expect(getGamesSource).toContain('getRecurringPracticeMastersForDateRange(gamesRef, startDate, endDate)');
        expect(getGamesSource).toContain('teamGames = mergeGamesById(teamGames, recurringMasters);');
        expect(appLoadGamesSource).toContain('mapScheduleEventRecords(await getGames(teamId, range))');
        expect(appLoadGamesSource).not.toContain('loadRecurringPracticeMasters');
    });

    it('keeps direct tournament standings reads bounded by pool identity rather than dates', () => {
        const getGamesSource = extractSource(dbSource, 'export async function getGames', 'export async function getAggregatedStatsForGames');
        const targetedSource = extractSource(appSource, 'async function buildTargetedTeamScheduleEvent', 'function resolveMyRsvpNotesByChildForGame');

        expect(getGamesSource).toContain('where("tournament.poolName", "==", tournamentGroup.poolName)');
        expect(getGamesSource).toContain('where("tournament.divisionName", "==", tournamentGroup.divisionName)');
        expect(getGamesSource).toContain('where("tournament.division", "==", tournamentGroup.divisionName)');
        expect(getGamesSource).toContain('if (hasTournamentGroup) throw error;');
        expect(targetedSource).toContain('getTournamentScheduleGroupQuery(loadedGame)');
        expect(targetedSource).toContain('loadGames(teamId, { tournamentGroups: [tournamentGroup] })');
        expect(targetedSource).not.toContain('getTournamentDetailStandingsRange');
        expect(targetedSource).not.toContain('hasTournamentTeamStandingsConfig');
    });

    it('loads all visible tournament groups together and fetches shared history once', () => {
        const getGamesSource = extractSource(dbSource, 'export async function getGames', 'export async function getAggregatedStatsForGames');
        const sharedGamesSource = extractSource(dbSource, 'async function getSharedGamesForTeam', 'async function hasSharedGameUsingConfig');
        const groupedLoadSource = extractSource(appSource, 'async function loadTournamentScheduleStandingsGames', 'async function loadRawTeam');
        const nativeSharedGamesSource = extractSource(
            appSource,
            'async function nativeQuerySharedTournamentScheduleDocuments',
            'async function nativeQueryTournamentScheduleGroupDocuments'
        );

        expect(groupedLoadSource).toContain('loadGames(teamId, { tournamentGroups: [...groups.values()] })');
        expect(groupedLoadSource).not.toContain('.map((tournamentGroup) => loadGames');
        expect(sharedGamesSource).toContain("where('homeTeamId', '==', teamId)");
        expect(sharedGamesSource).toContain("where('awayTeamId', '==', teamId)");
        expect(sharedGamesSource).not.toContain("where('teamIds', 'array-contains', teamId)");
        expect(sharedGamesSource).toContain(': [query(sharedGamesRef, teamConstraint)]');
        expect(nativeSharedGamesSource).toContain("{ fieldPath: 'homeTeamId', op: 'EQUAL' }");
        expect(nativeSharedGamesSource).toContain("{ fieldPath: 'awayTeamId', op: 'EQUAL' }");
        expect(nativeSharedGamesSource).not.toContain("fieldPath: 'teamIds'");
        expect(nativeSharedGamesSource).not.toContain("fieldPath: 'date'");
        expect(nativeSharedGamesSource).not.toContain('orderBy:');
        expect((getGamesSource.match(/getSharedGamesForTeam\(teamId/g) || [])).toHaveLength(1);
        expect(getGamesSource).toContain('getSharedGamesForTeam(teamId, { startDate, endDate, requireComplete: hasTournamentGroup })');
        expect(getGamesSource).toContain('if (hasTournamentGroup) throw error;');
    });

    it('applies the requested date window to scoped shared-game queries without unscoped fallback reads', () => {
        const sharedGamesSource = extractSource(dbSource, 'async function getSharedGamesForTeam', 'async function hasSharedGameUsingConfig');
        const getGamesSource = extractSource(dbSource, 'export async function getGames', 'export async function getAggregatedStatsForGames');

        expect(sharedGamesSource).toContain("where('date', '>=', Timestamp.fromDate(startDate))");
        expect(sharedGamesSource).toContain("where('date', '<=', Timestamp.fromDate(endDate))");
        expect(sharedGamesSource).toContain("where('homeTeamId', '==', teamId)");
        expect(sharedGamesSource).toContain("where('awayTeamId', '==', teamId)");
        expect(sharedGamesSource).not.toContain("where('teamIds', 'array-contains', teamId)");
        expect(sharedGamesSource).toContain('query(sharedGamesRef, teamConstraint, ...orderedDateConstraints)');
        expect(sharedGamesSource).toContain("query(sharedGamesRef, teamConstraint, where('date', '==', null))");
        expect(sharedGamesSource).not.toContain('getDocs(query(sharedGamesRef, ...orderedDateConstraints))');
        expect(sharedGamesSource).not.toContain("getDocs(query(sharedGamesRef, where('date', '==', null)))");
        expect(sharedGamesSource).toContain('.filter((game) => isGameWithinDateRange(game, startDate, endDate))');
        expect(getGamesSource).toContain('getSharedGamesForTeam(teamId, { startDate, endDate, requireComplete: hasTournamentGroup })');
    });

    it('does not fall back to unscoped shared-game collection-group date scans when compound queries reject', async () => {
        const calls = [];
        const collectionGroup = vi.fn((_db, name) => ({ type: 'collectionGroup', name }));
        const where = vi.fn((field, op, value) => ({ type: 'where', field, op, value }));
        const orderBy = vi.fn((field) => ({ type: 'orderBy', field }));
        const query = vi.fn((ref, ...constraints) => ({ ref, constraints }));
        const getDocs = vi.fn(async (queryRef) => {
            calls.push(queryRef);
            throw new Error('missing compound index');
        });
        const getSharedGamesForTeam = buildGetSharedGamesForTeam({
            db: {},
            collectionGroup,
            query,
            where,
            orderBy,
            Timestamp: { fromDate: (date) => ({ date }) },
            getDocs,
            isGameWithinDateRange: () => true
        });

        const games = await getSharedGamesForTeam('team-123', {
            startDate: new Date('2026-07-01T00:00:00Z'),
            endDate: new Date('2026-07-31T23:59:59Z')
        });

        expect(games).toEqual([]);
        expect(getDocs).toHaveBeenCalledTimes(4);
        expect(calls.every((queryRef) => queryRef.constraints.some((constraint) => (
            constraint.type === 'where'
                && ['homeTeamId', 'awayTeamId'].includes(constraint.field)
                && constraint.value === 'team-123'
        )))).toBe(true);
        expect(calls.some((queryRef) => !queryRef.constraints.some((constraint) => (
            constraint.type === 'where'
                && ['homeTeamId', 'awayTeamId'].includes(constraint.field)
        )))).toBe(false);
        expect(calls.map((queryRef) => ({
            membershipField: queryRef.constraints.find((constraint) => (
                constraint.type === 'where' && ['homeTeamId', 'awayTeamId'].includes(constraint.field)
            ))?.field,
            hasDateOrder: queryRef.constraints.some((constraint) => constraint.type === 'orderBy' && constraint.field === 'date'),
            hasExplicitNull: queryRef.constraints.some((constraint) => (
                constraint.type === 'where' && constraint.field === 'date' && constraint.op === '==' && constraint.value === null
            ))
        }))).toEqual([
            { membershipField: 'homeTeamId', hasDateOrder: true, hasExplicitNull: false },
            { membershipField: 'homeTeamId', hasDateOrder: false, hasExplicitNull: true },
            { membershipField: 'awayTeamId', hasDateOrder: true, hasExplicitNull: false },
            { membershipField: 'awayTeamId', hasDateOrder: false, hasExplicitNull: true }
        ]);
    });

    it('keeps complete tournament reads on team indexes so missing-date legacy games remain visible', async () => {
        const calls = [];
        const sharedGameDoc = {
            id: 'shared-1',
            ref: { path: 'tournaments/tournament-1/sharedGames/shared-1' },
            data: () => ({ homeTeamId: 'team-123', awayTeamId: 'team-456', status: 'completed' })
        };
        const getSharedGamesForTeam = buildGetSharedGamesForTeam({
            db: {},
            collectionGroup: vi.fn((_db, name) => ({ type: 'collectionGroup', name })),
            query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
            where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
            orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
            Timestamp: { fromDate: (date) => ({ date }) },
            getDocs: vi.fn(async (queryRef) => {
                calls.push(queryRef);
                const teamConstraint = queryRef.constraints.find((constraint) => constraint.type === 'where');
                return { docs: teamConstraint?.field === 'homeTeamId' ? [sharedGameDoc] : [] };
            }),
            isGameWithinDateRange: () => true
        });

        await expect(getSharedGamesForTeam('team-123', { requireComplete: true })).resolves.toEqual([
            expect.objectContaining({ id: 'shared-1', homeTeamId: 'team-123' })
        ]);
        expect(calls).toHaveLength(2);
        expect(calls.map((queryRef) => queryRef.constraints[0].field)).toEqual([
            'homeTeamId', 'awayTeamId'
        ]);
        expect(calls.every((queryRef) => queryRef.constraints.length === 1)).toBe(true);
        expect(calls.some((queryRef) => queryRef.constraints.some((constraint) => (
            constraint.type === 'orderBy' || constraint.field === 'date'
        )))).toBe(false);
    });
});
