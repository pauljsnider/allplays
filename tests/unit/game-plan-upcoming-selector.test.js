import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readGamePlanPage() {
    return readFileSync(new URL('../../game-plan.html', import.meta.url), 'utf8');
}

function extractFunctionSource(source, functionName) {
    const start = source.indexOf(`function ${functionName}`);
    expect(start, `${functionName} should exist`).toBeGreaterThanOrEqual(0);

    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }

    throw new Error(`Could not extract ${functionName}`);
}

function buildHarness() {
    const source = readGamePlanPage();
    const graceConstantMatch = source.match(/const GAME_PLAN_SELECTABLE_GRACE_MS = [^;]+;/);
    expect(graceConstantMatch, 'GAME_PLAN_SELECTABLE_GRACE_MS should exist').not.toBeNull();
    const getGamePlanGameDateSource = extractFunctionSource(source, 'getGamePlanGameDate');
    const isGamePlanSelectableGameSource = extractFunctionSource(source, 'isGamePlanSelectableGame');

    return new Function(`
        ${graceConstantMatch[0]}
        ${getGamePlanGameDateSource}
        ${isGamePlanSelectableGameSource}
        return { getGamePlanGameDate, isGamePlanSelectableGame };
    `)();
}

describe('game plan upcoming selector', () => {
    it('filters completed and past games before sorting nearest upcoming first', () => {
        const { isGamePlanSelectableGame, getGamePlanGameDate } = buildHarness();
        const now = new Date('2026-07-02T12:00:00.000Z');
        const games = [
            { id: 'completed-recent', status: 'completed', date: '2026-07-02T11:30:00.000Z' },
            { id: 'past-scheduled', status: 'scheduled', date: '2026-07-01T18:00:00.000Z' },
            { id: 'future-later', status: 'scheduled', date: '2026-07-05T18:00:00.000Z' },
            { id: 'future-next', status: 'scheduled', date: { toDate: () => new Date('2026-07-03T18:00:00.000Z') } }
        ];

        const selectorGames = games
            .filter((game) => isGamePlanSelectableGame(game, now))
            .sort((a, b) => getGamePlanGameDate(a) - getGamePlanGameDate(b));

        expect(selectorGames.map((game) => game.id)).toEqual(['future-next', 'future-later']);
    });

    it('keeps scheduled games selectable during the game-day grace window', () => {
        const { isGamePlanSelectableGame } = buildHarness();
        const now = new Date('2026-07-02T12:00:00.000Z');

        expect(isGamePlanSelectableGame({
            id: 'recent-scheduled-game',
            status: 'scheduled',
            date: '2026-07-02T10:00:00.000Z'
        }, now)).toBe(true);

        expect(isGamePlanSelectableGame({
            id: 'old-scheduled-game',
            status: 'scheduled',
            date: '2026-07-02T08:59:59.000Z'
        }, now)).toBe(false);
    });

    it('keeps still-active live games even if their start time has passed', () => {
        const { isGamePlanSelectableGame } = buildHarness();
        const now = new Date('2026-07-02T12:00:00.000Z');

        expect(isGamePlanSelectableGame({
            id: 'live-game',
            status: 'scheduled',
            liveStatus: 'live',
            date: '2026-07-02T11:00:00.000Z'
        }, now)).toBe(true);
    });

    it('does not render completed-game labels in the upcoming game options', () => {
        const source = readGamePlanPage();

        expect(source).not.toContain("g.status === 'completed' ? ' (Completed)' ");
        expect(source).toContain('.filter(g => isGamePlanSelectableGame(g))');
        expect(source).toContain('return aDate - bDate;');
    });
});
