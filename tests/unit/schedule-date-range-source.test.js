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
        expect(appLoadGamesSource).toContain('() => Promise.resolve(getGames(teamId, range))');
        expect(appSource).not.toContain('async function loadRecurringPracticeMasters');
    });
});
