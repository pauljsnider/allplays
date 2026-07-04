import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStatTrackingService } from '../../apps/app/src/lib/statTrackingService.ts';

// ALL PLAYS has three independent stat-tracking implementations that must agree on
// which stat column represents "points" for a given team's config: the mobile
// beta tracker (js/track-basketball.js), the live game monitor (js/live-tracker.js),
// and the React app's "standard tracker" (apps/app/src/lib/statTrackingService.ts).
// They were never consolidated (see architecture review) because doing so safely
// is a much larger effort than fits in one pass — this suite instead pins the one
// invariant that actually matters across all three: given the same
// statTrackerConfig, do they identify the same column as the scoring column?
//
// This caught a real bug during authoring: statTrackingService.ts ignored a
// team's configured `scoringColumn` entirely (unlike both legacy trackers, which
// respect it via getConfiguredPointsColumn()), so a custom scoring column name
// would fail to update the live score in the React app's tracker only.

function extractFunction(source, functionName, fileLabel) {
    const signature = `function ${functionName}`;
    const start = source.indexOf(signature);
    if (start === -1) {
        throw new Error(`Could not find ${functionName} in ${fileLabel}`);
    }

    let paramsDepth = 0;
    let bodyStart = -1;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') paramsDepth += 1;
        if (char === ')') paramsDepth = Math.max(0, paramsDepth - 1);
        if (char === '{' && paramsDepth === 0) {
            bodyStart = index;
            break;
        }
    }
    if (bodyStart === -1) {
        throw new Error(`Could not find ${functionName} body start in ${fileLabel}`);
    }

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(start, index + 1);
        }
    }

    throw new Error(`Could not extract ${functionName} from ${fileLabel}`);
}

function runFunction(scriptParts, hookNames, contextValues = {}) {
    const context = vm.createContext({
        ...contextValues,
        globalThis: {}
    });
    const hookAssignments = hookNames.map((name) => `${name}: typeof ${name} === 'function' ? ${name} : undefined`).join(', ');
    vm.runInContext(scriptParts.join('\n'), context);
    vm.runInContext(`globalThis.__testHooks = { ${hookAssignments} };`, context);
    return context.globalThis.__testHooks;
}

function legacyIsPointsColumn(relativePath, currentConfig, statKey) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const hooks = runFunction([
        extractFunction(source, 'getConfiguredPointsColumn', relativePath),
        extractFunction(source, 'isPointsColumn', relativePath)
    ], ['isPointsColumn'], { currentConfig });

    return hooks.isPointsColumn(statKey);
}

function createDependencies() {
    return {
        db: {},
        doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
        setDoc: vi.fn(async () => undefined),
        deleteDoc: vi.fn(async () => undefined),
        increment: vi.fn((value) => ({ __increment: value })),
        adjustGameScore: vi.fn(async () => undefined)
    };
}

async function reactTrackerCreditsAsScore(statConfig, statKey) {
    const dependencies = createDependencies();
    const service = createStatTrackingService({
        statConfig,
        initialScore: { homeScore: 0, awayScore: 0 },
        dependencies
    });

    await service.recordEvent('team-1', 'game-1', {
        text: `#4 Alex ${statKey} +5`,
        playerName: 'Alex',
        playerNumber: '4',
        teamSide: 'home',
        undoData: {
            type: 'stat',
            playerId: 'player-1',
            statKey,
            value: 5,
            isOpponent: false
        }
    }, { uid: 'coach-1' });

    return service.getCurrentScore().homeScore === 5;
}

describe('stat-tracking scoring-column parity across all three trackers', () => {
    const scenarios = [
        {
            label: 'default basketball config with no custom scoringColumn',
            config: { columns: ['PTS', 'REB', 'AST'] },
            scoringKey: 'PTS',
            nonScoringKey: 'REB'
        },
        {
            label: 'soccer-style config using GOALS as the default scoring column',
            config: { columns: ['GOALS', 'ASSISTS', 'FOULS'] },
            scoringKey: 'GOALS',
            nonScoringKey: 'ASSISTS'
        },
        {
            label: 'a team with a renamed custom scoring column configured',
            config: { columns: ['SCORE', 'REB', 'AST'], scoringColumn: 'SCORE' },
            scoringKey: 'SCORE',
            nonScoringKey: 'REB'
        },
        {
            label: 'a custom scoring column in a different case than the config columns entry',
            config: { columns: ['Score', 'Reb', 'Ast'], scoringColumn: 'score' },
            scoringKey: 'Score',
            nonScoringKey: 'Reb'
        }
    ];

    it.each(scenarios)('$label', async ({ config, scoringKey, nonScoringKey }) => {
        const trackBasketballScores = legacyIsPointsColumn('../../js/track-basketball.js', config, scoringKey);
        const liveTrackerScores = legacyIsPointsColumn('../../js/live-tracker.js', config, scoringKey);
        const reactTrackerScores = await reactTrackerCreditsAsScore(config, scoringKey);

        expect({ trackBasketballScores, liveTrackerScores, reactTrackerScores }).toEqual({
            trackBasketballScores: true,
            liveTrackerScores: true,
            reactTrackerScores: true
        });

        const trackBasketballIgnoresOther = !legacyIsPointsColumn('../../js/track-basketball.js', config, nonScoringKey);
        const liveTrackerIgnoresOther = !legacyIsPointsColumn('../../js/live-tracker.js', config, nonScoringKey);
        const reactTrackerIgnoresOther = !(await reactTrackerCreditsAsScore(config, nonScoringKey));

        expect({ trackBasketballIgnoresOther, liveTrackerIgnoresOther, reactTrackerIgnoresOther }).toEqual({
            trackBasketballIgnoresOther: true,
            liveTrackerIgnoresOther: true,
            reactTrackerIgnoresOther: true
        });
    });
});
