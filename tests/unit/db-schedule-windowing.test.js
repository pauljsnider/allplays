import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function extractFunctionSource(name) {
    const patterns = [
        `function ${name}`,
        `async function ${name}`,
        `export async function ${name}`,
        `export function ${name}`
    ];
    const signature = patterns.find((pattern) => dbSource.includes(pattern));
    expect(signature, `Missing function source for ${name}`).toBeTruthy();
    const start = dbSource.indexOf(signature);
    expect(start).toBeGreaterThanOrEqual(0);
    let parenDepth = 0;
    let bodyStart = -1;
    for (let index = start; index < dbSource.length; index += 1) {
        const char = dbSource[index];
        if (char === '(') parenDepth += 1;
        if (char === ')') {
            parenDepth -= 1;
            continue;
        }
        if (char === '{' && parenDepth === 0) {
            bodyStart = index;
            break;
        }
    }
    expect(bodyStart).toBeGreaterThan(start);

    let depth = 0;
    let end = bodyStart;
    for (; end < dbSource.length; end += 1) {
        const char = dbSource[end];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                end += 1;
                break;
            }
        }
    }

    return dbSource.slice(start, end);
}

describe('db schedule windowing regressions', () => {
    it('preserves recurring series masters when their expanded occurrences overlap the visible window', () => {
        const hasRecurringOccurrenceSource = extractFunctionSource('hasRecurringOccurrenceInDateWindow');
        expect(hasRecurringOccurrenceSource).toContain('item?.isSeriesMaster');
        expect(hasRecurringOccurrenceSource).toContain('item?.recurrence');
        expect(hasRecurringOccurrenceSource).toContain('expandRecurrence(item).some');
        expect(hasRecurringOccurrenceSource).toContain('time >= startMs && time <= endMs');

        const filterScheduleItemsSource = extractFunctionSource('filterScheduleItemsByDateWindow');
        expect(filterScheduleItemsSource).toContain('itemFallsWithinDateWindow(item, options) || hasRecurringOccurrenceInDateWindow(item, options)');
    });

    it('windows shared-game collectionGroup reads before merging them into team schedules', () => {
        const getSharedGamesSource = extractFunctionSource('getSharedGamesForTeam');
        expect(getSharedGamesSource).toContain('const dateConstraints = buildDateWindowConstraints(options);');
        expect(getSharedGamesSource).toContain("orderBy('date')");
        expect(getSharedGamesSource).toContain("where('homeTeamId', '==', teamId), ...windowConstraints");
        expect(getSharedGamesSource).toContain("where('awayTeamId', '==', teamId), ...windowConstraints");
        expect(getSharedGamesSource).toContain("where('teamIds', 'array-contains', teamId), ...windowConstraints");

        const getGamesSource = extractFunctionSource('getGames');
        expect(getGamesSource).toContain('getSharedGamesForTeam(teamId, options)');
        expect(getGamesSource).toContain('buildRecurringSeriesMasterConstraints(options)');
        expect(getGamesSource).toContain('filterScheduleItemsByDateWindow');
    });
});
