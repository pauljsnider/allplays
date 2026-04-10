import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readGamePlanPage() {
    return readFileSync(new URL('../../game-plan.html', import.meta.url), 'utf8');
}

function extractLoadGameBody() {
    const source = readGamePlanPage();
    const match = source.match(/async function loadGame\(game\) \{([\s\S]*?)\n        \}\n\n        function renderPlayerPool/);
    expect(match, 'loadGame should exist').toBeTruthy();
    return match[1];
}

function extractCreateDefaultGamePlanSource() {
    const source = readGamePlanPage();
    const match = source.match(/function createDefaultGamePlan\(sportName = null\) \{[\s\S]*?\n        \}/);
    expect(match, 'createDefaultGamePlan should exist').toBeTruthy();
    return match[0];
}

function extractSavePlanBody() {
    const source = readGamePlanPage();
    const match = source.match(/document\.getElementById\('save-plan-btn'\)\?\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n        \}\);/);
    expect(match, 'save-plan handler should exist').toBeTruthy();
    return match[1];
}

function createClassList() {
    const classes = new Set(['hidden']);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name)
    };
}

function createElement() {
    return {
        classList: createClassList(),
        value: '',
        innerHTML: '',
        disabled: false,
        title: ''
    };
}

function createDocument() {
    const elements = new Map();
    return {
        elements,
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, createElement());
            }
            return elements.get(id);
        }
    };
}

function buildHarness(overrides = {}) {
    const createDefaultGamePlanSource = extractCreateDefaultGamePlanSource();
    const loadGameBody = extractLoadGameBody();
    const savePlanBody = extractSavePlanBody();
    const document = createDocument();

    [
        'selected-game-info',
        'game-details',
        'save-plan-btn',
        'num-periods',
        'period-duration',
        'sub-times-input',
        'planning-wizard',
        'step-formation',
        'step-periods',
        'step-lineup'
    ].forEach((id) => document.getElementById(id));

    const deps = {
        currentTeamId: 'team-1',
        currentTeam: { sport: 'Soccer' },
        gamePlan: {
            numPeriods: 2,
            periodDuration: 25,
            subTimes: [7, 14, 21],
            formationId: null,
            lineups: {}
        },
        FORMATIONS: {
            'soccer-9v9': { name: 'Soccer 9v9', positions: [{ id: 'keeper', name: 'Keeper' }] },
            'basketball-5v5': { name: 'Basketball 5v5', positions: [{ id: 'pg', name: 'Point Guard' }] }
        },
        document,
        recentAssignments: new Map([['stale-key', Date.now()]]),
        intervalsCache: ['stale'],
        lastSelectedPlayerId: 'old-player',
        dragSourceCellKey: '1-7-keeper',
        formatDate: () => 'Apr 4, 2026',
        formatTime: () => '7:00 PM',
        renderSubTimesDisplay: vi.fn(),
        renderPlayerPool: vi.fn(),
        renderSubMatrix: vi.fn(),
        renderPlayingTimeSummary: vi.fn(),
        updatePlanSummary: vi.fn(),
        updateGame: vi.fn().mockResolvedValue(undefined),
        alert: vi.fn(),
        console: {
            error: vi.fn()
        },
        ...overrides
    };

    const createHarness = new Function('deps', `
        let currentTeamId = deps.currentTeamId;
        let currentGameId = null;
        let currentGame = null;
        let currentTeam = deps.currentTeam;
        let lastSelectedPlayerId = deps.lastSelectedPlayerId;
        let intervalsCache = deps.intervalsCache;
        const recentAssignments = deps.recentAssignments;
        let dragSourceCellKey = deps.dragSourceCellKey;
        let gamePlan = deps.gamePlan;
        const FORMATIONS = deps.FORMATIONS;
        const document = deps.document;
        const formatDate = deps.formatDate;
        const formatTime = deps.formatTime;
        const renderSubTimesDisplay = deps.renderSubTimesDisplay;
        const renderPlayerPool = deps.renderPlayerPool;
        const renderSubMatrix = deps.renderSubMatrix;
        const renderPlayingTimeSummary = deps.renderPlayingTimeSummary;
        const updatePlanSummary = deps.updatePlanSummary;
        const updateGame = deps.updateGame;
        const alert = deps.alert;
        const console = deps.console;

        ${createDefaultGamePlanSource}

        async function loadGame(game) {
${loadGameBody}
        }

        async function clickSave() {
${savePlanBody}
        }

        return {
            loadGame,
            clickSave,
            getState: () => ({
                currentGameId,
                currentGame,
                gamePlan,
                lastSelectedPlayerId,
                intervalsCache,
                dragSourceCellKey
            })
        };
    `);

    return { deps, document, harness: createHarness(deps) };
}

describe('game plan game switching', () => {
    it('clears saved lineup assignments when switching to a game without a plan', async () => {
        const { harness, deps } = buildHarness();

        await harness.loadGame({
            id: 'game-a',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z',
            gamePlan: {
                numPeriods: 2,
                periodDuration: 25,
                subTimes: [7, 14, 21],
                formationId: 'soccer-9v9',
                lineups: {
                    '1-7-keeper': 'player-1'
                }
            }
        });

        await harness.loadGame({
            id: 'game-b',
            opponent: 'Bears',
            date: '2026-04-05T19:00:00.000Z'
        });

        expect(harness.getState().currentGameId).toBe('game-b');
        expect(harness.getState().gamePlan.lineups).toEqual({});
        expect(harness.getState().gamePlan.formationId).toBe('soccer-9v9');
        expect(harness.getState().lastSelectedPlayerId).toBeNull();
        expect(harness.getState().intervalsCache).toEqual([]);
        expect(harness.getState().dragSourceCellKey).toBeNull();
        expect(deps.recentAssignments.size).toBe(0);
        expect(deps.renderSubMatrix).toHaveBeenCalledTimes(2);
    });

    it('saves the switched game without carrying over the previous game lineup payload', async () => {
        const { harness, deps } = buildHarness();

        await harness.loadGame({
            id: 'game-a',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z',
            gamePlan: {
                numPeriods: 2,
                periodDuration: 25,
                subTimes: [7, 14, 21],
                formationId: 'soccer-9v9',
                lineups: {
                    '1-7-keeper': 'player-1'
                }
            }
        });

        await harness.loadGame({
            id: 'game-b',
            opponent: 'Bears',
            date: '2026-04-05T19:00:00.000Z'
        });

        await harness.clickSave();

        expect(deps.updateGame).toHaveBeenCalledWith('team-1', 'game-b', {
            gamePlan: expect.objectContaining({
                formationId: 'soccer-9v9',
                lineups: {}
            })
        });
        expect(deps.updateGame.mock.calls[0][2].gamePlan.lineups).not.toHaveProperty('1-7-keeper');
    });
});
