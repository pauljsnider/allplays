import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeLineupsForGamePlanPlanner } from '../../js/game-plan-interop.js';

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
        textContent: '',
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
    const document = createDocument();

    [
        'selected-game-info',
        'game-details',
        'save-status',
        'save-status-text',
        'save-status-dot',
        'save-status-spinner',
        'save-plan-btn',
        'save-plan-note',
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
            'basketball-5v5': { name: 'Basketball 5v5', positions: [{ id: 'pg', name: 'Point Guard' }] },
            'baseball-diamond': { name: 'Baseball Diamond', positions: [{ id: 'pitcher', name: 'Pitcher' }] },
            'softball-diamond': { name: 'Softball Diamond', positions: [{ id: 'pitcher', name: 'Pitcher' }] }
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
        autoSave: {
            cancel: vi.fn(),
            isPending: vi.fn().mockReturnValue(false),
            scheduleSave: vi.fn()
        },
        console: {
            error: vi.fn()
        },
        normalizeLineupsForGamePlanPlanner,
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
        const autoSave = deps.autoSave;
        const console = deps.console;
        const normalizeLineupsForGamePlanPlanner = deps.normalizeLineupsForGamePlanPlanner;

        ${createDefaultGamePlanSource}

        async function loadGame(game) {
${loadGameBody}
        }

        return {
            loadGame,
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
    it('adds baseball and softball defaults so diamond sports skip the blocked formation step', async () => {
        const { harness, document, deps } = buildHarness({
            currentTeam: { sport: 'Baseball' }
        });

        await harness.loadGame({
            id: 'game-baseball',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z'
        });

        expect(harness.getState().gamePlan).toMatchObject({
            formationId: 'baseball-diamond',
            numPeriods: 7,
            periodDuration: 1,
            periodPrefix: 'I',
            subTimes: []
        });
        expect(document.getElementById('step-lineup').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('step-formation').classList.contains('hidden')).toBe(true);
        expect(deps.renderSubMatrix).toHaveBeenCalledTimes(1);
    });

    it('maps softball teams to the softball diamond defaults', async () => {
        const { harness } = buildHarness({
            currentTeam: { sport: 'Softball' }
        });

        await harness.loadGame({
            id: 'game-softball',
            opponent: 'Panthers',
            date: '2026-04-04T19:00:00.000Z'
        });

        expect(harness.getState().gamePlan).toMatchObject({
            formationId: 'softball-diamond',
            numPeriods: 7,
            periodDuration: 1,
            periodPrefix: 'I',
            subTimes: []
        });
    });

    it('includes baseball and softball formation cards in the chooser markup', () => {
        const source = readGamePlanPage();

        expect(source).toContain('data-formation="baseball-diamond"');
        expect(source).toContain('Baseball Diamond');
        expect(source).toContain('data-formation="softball-diamond"');
        expect(source).toContain('Softball Diamond');
    });

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

    it('isolates gamePlan per game so a subsequent auto-save cannot carry over a previous lineup', async () => {
        const { harness } = buildHarness();

        await harness.loadGame({
            id: 'game-a',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z',
            gamePlan: {
                numPeriods: 2,
                periodDuration: 25,
                subTimes: [7, 14, 21],
                formationId: 'soccer-9v9',
                lineups: { '1-7-keeper': 'player-1' }
            }
        });

        await harness.loadGame({
            id: 'game-b',
            opponent: 'Bears',
            date: '2026-04-05T19:00:00.000Z'
        });

        // The in-memory gamePlan after switching must not contain game-a's lineup
        const { gamePlan } = harness.getState();
        expect(gamePlan.lineups).toEqual({});
        expect(gamePlan.lineups).not.toHaveProperty('1-7-keeper');
        expect(harness.getState().currentGameId).toBe('game-b');
    });

    it('normalizes saved lineup keys through the loadGame harness dependency', async () => {
        const { harness } = buildHarness();

        await harness.loadGame({
            id: 'game-a',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z',
            gamePlan: {
                numPeriods: 2,
                periodDuration: 25,
                subTimes: [7, 14, 21],
                formationId: 'soccer-9v9',
                lineups: { "H1 7'-keeper": 'player-1' }
            }
        });

        expect(harness.getState().gamePlan.lineups).toEqual({
            '1-7-keeper': 'player-1'
        });
    });

    it('cancels any pending auto-save when switching games', async () => {
        const { harness, deps } = buildHarness();

        await harness.loadGame({
            id: 'game-a',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z'
        });

        await harness.loadGame({
            id: 'game-b',
            opponent: 'Bears',
            date: '2026-04-05T19:00:00.000Z'
        });

        // autoSave.cancel should be called once per loadGame call
        expect(deps.autoSave.cancel).toHaveBeenCalledTimes(2);
    });

    it('disables saving for calendar games and shows an explanatory note', async () => {
        const { harness, document } = buildHarness();

        await harness.loadGame({
            id: 'cal-abc123',
            opponent: 'Eagles',
            date: '2026-04-07T19:00:00.000Z',
            isCalendar: true
        });

        const saveButton = document.getElementById('save-plan-btn');
        const saveNote = document.getElementById('save-plan-note');
        expect(saveButton.disabled).toBe(true);
        expect(saveNote.classList.contains('hidden')).toBe(false);
        expect(saveNote.textContent).toMatch(/calendar/i);
    });

    it('enables saving and hides note for regular db games', async () => {
        const { harness, document } = buildHarness();

        await harness.loadGame({
            id: 'game-a',
            opponent: 'Sharks',
            date: '2026-04-04T19:00:00.000Z'
        });

        const saveButton = document.getElementById('save-plan-btn');
        const saveNote = document.getElementById('save-plan-note');
        expect(saveButton.disabled).toBe(false);
        expect(saveNote.classList.contains('hidden')).toBe(true);
    });

    it('shows a read-only save notice for shared tournament games', async () => {
        const { harness, document } = buildHarness();

        await harness.loadGame({
            id: 'shared-game',
            opponent: 'Wolves',
            date: '2026-04-06T19:00:00.000Z',
            isSharedGame: true
        });

        expect(document.getElementById('save-status').className).toContain('bg-amber-50');
        expect(document.getElementById('save-status-text').textContent).toBe('Shared tournament games are read-only');
    });
});
