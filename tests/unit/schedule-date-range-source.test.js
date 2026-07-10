import { describe, expect, it } from 'vitest';
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

        expect(groupedLoadSource).toContain('loadGames(teamId, { tournamentGroups: [...groups.values()] })');
        expect(groupedLoadSource).not.toContain('.map((tournamentGroup) => loadGames');
        expect(sharedGamesSource).toContain("where('homeTeamId', '==', teamId)");
        expect(sharedGamesSource).toContain("where('awayTeamId', '==', teamId)");
        expect(sharedGamesSource).toContain("where('teamIds', 'array-contains', teamId)");
        expect((getGamesSource.match(/getSharedGamesForTeam\(teamId/g) || [])).toHaveLength(1);
        expect(getGamesSource).toContain('getSharedGamesForTeam(teamId, { startDate, endDate, requireComplete: hasTournamentGroup })');
        expect(getGamesSource).toContain('if (hasTournamentGroup) throw error;');
    });

    it('applies the requested date window to shared-game queries and their fallback', () => {
        const sharedGamesSource = extractSource(dbSource, 'async function getSharedGamesForTeam', 'async function hasSharedGameUsingConfig');
        const getGamesSource = extractSource(dbSource, 'export async function getGames', 'export async function getAggregatedStatsForGames');

        expect(sharedGamesSource).toContain("where('date', '>=', Timestamp.fromDate(startDate))");
        expect(sharedGamesSource).toContain("where('date', '<=', Timestamp.fromDate(endDate))");
        expect(sharedGamesSource).toContain("where('homeTeamId', '==', teamId)");
        expect(sharedGamesSource).toContain("where('awayTeamId', '==', teamId)");
        expect(sharedGamesSource).toContain("where('teamIds', 'array-contains', teamId)");
        expect(sharedGamesSource).toContain('query(sharedGamesRef, teamConstraint, ...orderedDateConstraints)');
        expect(sharedGamesSource).toContain("query(sharedGamesRef, teamConstraint, where('date', '==', null))");
        expect(sharedGamesSource).toContain('getDocs(query(sharedGamesRef, ...orderedDateConstraints))');
        expect(sharedGamesSource).toContain("getDocs(query(sharedGamesRef, where('date', '==', null)))");
        expect(sharedGamesSource).toContain('.filter((game) => isGameWithinDateRange(game, startDate, endDate))');
        expect(getGamesSource).toContain('getSharedGamesForTeam(teamId, { startDate, endDate, requireComplete: hasTournamentGroup })');
    });
});
