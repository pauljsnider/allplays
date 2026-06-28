import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildGamePlanIntervals } from '../../js/game-plan-intervals.js';

function readGamePlanPage() {
    return readFileSync(new URL('../../game-plan.html', import.meta.url), 'utf8');
}

function extractCreateDefaultGamePlanSource() {
    const source = readGamePlanPage();
    const match = source.match(/function createDefaultGamePlan\(sportName = null\) \{[\s\S]*?\n        \}/);
    expect(match, 'createDefaultGamePlan should exist').toBeTruthy();
    return match[0];
}

function extractRenderSubMatrixBody() {
    const source = readGamePlanPage();
    const match = source.match(/function renderSubMatrix\(\) \{([\s\S]*?)\n        \}\n\n        function getBenchPlayersForInterval/);
    expect(match, 'renderSubMatrix should exist').toBeTruthy();
    return match[1];
}

function extractRenderPlayingTimeSummaryBody() {
    const source = readGamePlanPage();
    const match = source.match(/function renderPlayingTimeSummary\(\) \{([\s\S]*?)\n        \}\n\n        window\.removePlayerFromCell/);
    expect(match, 'renderPlayingTimeSummary should exist').toBeTruthy();
    return match[1];
}

function createElement() {
    return {
        innerHTML: '',
        querySelectorAll() {
            return [];
        }
    };
}

function createDocument() {
    const elements = new Map();
    return {
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, createElement());
            }
            return elements.get(id);
        },
        querySelectorAll() {
            return [];
        }
    };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMinutesForPlayer(summaryHtml, playerName) {
    const pattern = new RegExp(`${escapeRegExp(playerName)}[\\s\\S]*?<div class="text-2xl[^>]*">(\\d+)<\\/div>`);
    const match = summaryHtml.match(pattern);
    expect(match, `minutes should render for ${playerName}`).toBeTruthy();
    return Number(match[1]);
}

function buildHarness(overrides = {}) {
    const createDefaultGamePlanSource = extractCreateDefaultGamePlanSource();
    const renderSubMatrixBody = extractRenderSubMatrixBody();
    const renderPlayingTimeSummaryBody = extractRenderPlayingTimeSummaryBody();
    const document = createDocument();

    ['sub-matrix-header', 'sub-matrix-body', 'playing-time-summary'].forEach((id) => {
        document.getElementById(id);
    });

    const deps = {
        players: [
            { id: 'p1', name: 'Jordan', number: 23 },
            { id: 'p2', name: 'Casey', number: 7 }
        ],
        FORMATIONS: {
            'basketball-5v5': { name: 'Basketball 5v5', positions: [{ id: 'pg', name: 'Point Guard' }] },
            'soccer-9v9': { name: 'Soccer 9v9', positions: [{ id: 'keeper', name: 'Keeper' }] }
        },
        document,
        gamePlan: null,
        buildGamePlanIntervals,
        ...overrides
    };

    const createHarness = new Function('deps', `
        let players = deps.players;
        let gamePlan = deps.gamePlan;
        const FORMATIONS = deps.FORMATIONS;
        const document = deps.document;
        const buildGamePlanIntervals = deps.buildGamePlanIntervals;
        const escapeHtml = (unsafe) => unsafe === null || unsafe === undefined ? '' : String(unsafe)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        let intervalsCache = [];
        const recentAssignments = new Map();
        let draggedPlayerId = null;
        let lastSelectedPlayerId = null;
        let dragSourceCellKey = null;
        const renderPlayerPool = () => {};
        const pushColumnForward = () => {};
        const fillRowWithLastSelected = () => {};
        const getBenchPlayersForInterval = () => [];
        const playerAssignedInInterval = () => false;

        ${createDefaultGamePlanSource}

        function renderSubMatrix() {
${renderSubMatrixBody}
        }

        function renderPlayingTimeSummary() {
${renderPlayingTimeSummaryBody}
        }

        return {
            createDefaultGamePlan,
            renderSubMatrix,
            renderPlayingTimeSummary,
            setGamePlan: (nextGamePlan) => {
                gamePlan = nextGamePlan;
            },
            getDocument: () => document
        };
    `);

    return createHarness(deps);
}

describe('game plan timestamp interval playing time summary', () => {
    it('counts basketball default summary minutes from saved quarter-time lineup keys', () => {
        const harness = buildHarness();
        const gamePlan = harness.createDefaultGamePlan('Basketball');

        gamePlan.lineups['1-4-pg'] = 'p1';
        harness.setGamePlan(gamePlan);
        harness.renderPlayingTimeSummary();

        const summaryHtml = harness.getDocument().getElementById('playing-time-summary').innerHTML;
        expect(extractMinutesForPlayer(summaryHtml, 'Jordan')).toBe(4);
        expect(extractMinutesForPlayer(summaryHtml, 'Casey')).toBe(0);
    });

    it('keeps sub-matrix and summary interval keys aligned for non-basketball single-sub-time plans', () => {
        const harness = buildHarness({
            gamePlan: {
                numPeriods: 2,
                periodDuration: 24,
                subTimes: [12],
                formationId: 'soccer-9v9',
                lineups: {
                    '2-12-keeper': 'p1'
                }
            }
        });

        harness.renderSubMatrix();
        harness.renderPlayingTimeSummary();

        const matrixHtml = harness.getDocument().getElementById('sub-matrix-body').innerHTML;
        const summaryHtml = harness.getDocument().getElementById('playing-time-summary').innerHTML;

        expect(matrixHtml).toContain('data-cell-key="2-12-keeper"');
        expect(matrixHtml).toContain('data-cell-key="2-24-keeper"');
        expect(extractMinutesForPlayer(summaryHtml, 'Jordan')).toBe(12);
    });

    it('creates initial and final real-time soccer segments from substitution timestamps', () => {
        const intervals = buildGamePlanIntervals({
            numPeriods: 2,
            periodDuration: 25,
            subTimes: [7, 14, 21]
        });

        expect(intervals.filter(interval => interval.period === 1).map(interval => ({
            key: interval.key,
            label: interval.label,
            duration: interval.duration
        }))).toEqual([
            { key: '1-7', label: "0-7'", duration: 7 },
            { key: '1-14', label: "7-14'", duration: 7 },
            { key: '1-21', label: "14-21'", duration: 7 },
            { key: '1-25', label: "21-25'", duration: 4 }
        ]);
    });

    it('counts default soccer assignment minutes by actual segment length', () => {
        const harness = buildHarness({
            gamePlan: {
                numPeriods: 2,
                periodDuration: 25,
                subTimes: [7, 14, 21],
                formationId: 'soccer-9v9',
                lineups: {
                    '1-7-keeper': 'p1',
                    '1-25-keeper': 'p2'
                }
            }
        });

        harness.renderSubMatrix();
        harness.renderPlayingTimeSummary();

        const matrixHtml = harness.getDocument().getElementById('sub-matrix-body').innerHTML;
        const summaryHtml = harness.getDocument().getElementById('playing-time-summary').innerHTML;

        expect(matrixHtml).toContain('data-cell-key="1-25-keeper"');
        expect(extractMinutesForPlayer(summaryHtml, 'Jordan')).toBe(7);
        expect(extractMinutesForPlayer(summaryHtml, 'Casey')).toBe(4);
    });
});
