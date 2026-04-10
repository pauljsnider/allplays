import { beforeEach, describe, it, expect, vi } from 'vitest';

// Mock firebase.js so the module can be imported without a live Firebase project
vi.mock('../../js/firebase.js', () => ({
    db: {},
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(),
    writeBatch: vi.fn(),
}));

import {
    calculateEarnings,
    formatCents,
    formatRuleLabel,
    formatBreakdownLine,
    getApplicableRulesForGame,
    normalizeStatKey,
    renderIncentivesPanel,
    retireIncentiveRule,
    saveIncentiveRule,
    statKeyLabel,
    toggleIncentiveRule,
} from '../../js/parent-incentives.js';
import * as firebaseModule from '../../js/firebase.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides) {
    return {
        id: 'r1',
        statKey: 'pts',
        type: 'per_unit',
        amountCents: 100,   // $1.00 per point
        threshold: null,
        thresholdOp: null,
        active: true,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── calculateEarnings ───────────────────────────────────────────────────────

describe('calculateEarnings – no cap', () => {
    it('computes per_unit earnings', () => {
        const rules = [makeRule({ statKey: 'pts', amountCents: 100 })];
        const { totalCents, breakdown } = calculateEarnings(rules, { pts: 12 });
        expect(totalCents).toBe(1200);
        expect(breakdown).toHaveLength(1);
        expect(breakdown[0].earned).toBe(1200);
    });

    it('computes threshold (gt) bonus when met', () => {
        const rule = makeRule({ type: 'threshold', amountCents: 200, threshold: 3, thresholdOp: 'gt' });
        expect(calculateEarnings([rule], { pts: 4 }).totalCents).toBe(200);
    });

    it('does not award threshold (gt) bonus when not met', () => {
        const rule = makeRule({ type: 'threshold', amountCents: 200, threshold: 3, thresholdOp: 'gt' });
        expect(calculateEarnings([rule], { pts: 3 }).totalCents).toBe(0);
    });

    it('computes threshold (gte) bonus when exactly met', () => {
        const rule = makeRule({ type: 'threshold', amountCents: 200, threshold: 3, thresholdOp: 'gte' });
        expect(calculateEarnings([rule], { pts: 3 }).totalCents).toBe(200);
    });

    it('accumulates multiple rules', () => {
        const rules = [
            makeRule({ statKey: 'pts', amountCents: 100 }),
            makeRule({ id: 'r2', statKey: 'reb', amountCents: 50 }),
        ];
        const { totalCents } = calculateEarnings(rules, { pts: 10, reb: 6 });
        expect(totalCents).toBe(1300);
    });

    it('skips inactive rules', () => {
        const rules = [
            makeRule({ amountCents: 100 }),
            makeRule({ id: 'r2', active: false, amountCents: 999 }),
        ];
        const { totalCents } = calculateEarnings(rules, { pts: 5 });
        expect(totalCents).toBe(500);
    });

    it('treats missing stat as 0', () => {
        const { totalCents } = calculateEarnings([makeRule({ statKey: 'blk' })], { pts: 10 });
        expect(totalCents).toBe(0);
    });

    it('supports negative (penalty) rules', () => {
        const rule = makeRule({ statKey: 'to', amountCents: -200 });
        const { totalCents } = calculateEarnings([rule], { to: 3 });
        expect(totalCents).toBe(-600);
    });

    it('returns wasCapped=false and uncappedTotalCents equals totalCents when no cap', () => {
        const { totalCents, uncappedTotalCents, wasCapped } = calculateEarnings(
            [makeRule({ amountCents: 100 })], { pts: 5 }
        );
        expect(totalCents).toBe(500);
        expect(uncappedTotalCents).toBe(500);
        expect(wasCapped).toBe(false);
    });
});

describe('rule versioning', () => {
    it('creates a successor rule version when editing', async () => {
        const batch = {
            update: vi.fn(),
            set: vi.fn(),
            commit: vi.fn().mockResolvedValue(),
        };
        firebaseModule.writeBatch.mockReturnValue(batch);
        firebaseModule.doc
            .mockReturnValueOnce({ path: 'users/user-1/incentiveRules/r1', id: 'r1' })
            .mockReturnValueOnce({ path: 'users/user-1/incentiveRules/r2', id: 'r2' });

        const id = await saveIncentiveRule('user-1', {
            id: 'r1',
            teamId: 'team-1',
            playerId: 'player-1',
            statKey: 'pts',
            type: 'per_unit',
            amountCents: 200,
            threshold: null,
            thresholdOp: null,
            active: true,
        });

        expect(id).toBe('r2');
        expect(firebaseModule.writeBatch).toHaveBeenCalledTimes(1);
        expect(batch.update).toHaveBeenCalledTimes(1);
        expect(batch.set).toHaveBeenCalledTimes(1);
        expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it('versions toggles forward instead of mutating the existing rule', async () => {
        const batch = {
            update: vi.fn(),
            set: vi.fn(),
            commit: vi.fn().mockResolvedValue(),
        };
        firebaseModule.writeBatch.mockReturnValue(batch);
        firebaseModule.doc
            .mockReturnValueOnce({ path: 'users/user-1/incentiveRules/r1', id: 'r1' })
            .mockReturnValueOnce({ path: 'users/user-1/incentiveRules/r2', id: 'r2' });

        await toggleIncentiveRule('user-1', makeRule({ id: 'r1', teamId: 'team-1', playerId: 'player-1', active: true }));

        expect(firebaseModule.writeBatch).toHaveBeenCalledTimes(1);
        expect(batch.update).toHaveBeenCalledTimes(1);
        expect(batch.set).toHaveBeenCalledTimes(1);
        expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it('retires a rule by setting its effective end date', async () => {
        firebaseModule.updateDoc.mockResolvedValue();

        await retireIncentiveRule('user-1', 'r1');

        expect(firebaseModule.updateDoc).toHaveBeenCalledTimes(1);
    });
});

describe('calculateEarnings – with per-game cap', () => {
    it('caps earnings when total exceeds maxPerGameCents', () => {
        const rules = [makeRule({ amountCents: 100 })];
        const { totalCents, uncappedTotalCents, wasCapped } = calculateEarnings(rules, { pts: 20 }, 1000);
        expect(totalCents).toBe(1000);
        expect(uncappedTotalCents).toBe(2000);
        expect(wasCapped).toBe(true);
    });

    it('does not cap when earnings are below the cap', () => {
        const rules = [makeRule({ amountCents: 100 })];
        const { totalCents, wasCapped } = calculateEarnings(rules, { pts: 5 }, 1000);
        expect(totalCents).toBe(500);
        expect(wasCapped).toBe(false);
    });

    it('does not cap when earnings exactly equal the cap', () => {
        const rules = [makeRule({ amountCents: 100 })];
        const { totalCents, wasCapped } = calculateEarnings(rules, { pts: 10 }, 1000);
        expect(totalCents).toBe(1000);
        expect(wasCapped).toBe(false);
    });

    it('caps positive earnings before applying penalties', () => {
        const rules = [
            makeRule({ statKey: 'pts', amountCents: 150 }),
            makeRule({ id: 'r2', statKey: 'to', amountCents: -500 }),
        ];
        const { totalCents, uncappedTotalCents, wasCapped } = calculateEarnings(rules, { pts: 10, to: 1 }, 1000);
        expect(totalCents).toBe(500);
        expect(uncappedTotalCents).toBe(1000);
        expect(wasCapped).toBe(true);
    });

    it('cap does not apply to negative (penalty) totals', () => {
        const rule = makeRule({ statKey: 'to', amountCents: -200 });
        const { totalCents, wasCapped } = calculateEarnings([rule], { to: 5 }, 500);
        expect(totalCents).toBe(-1000);  // penalty passes through uncapped
        expect(wasCapped).toBe(false);
    });

    it('cap of 0 clamps any positive earnings to zero', () => {
        const rules = [makeRule({ amountCents: 100 })];
        const { totalCents, wasCapped } = calculateEarnings(rules, { pts: 10 }, 0);
        expect(totalCents).toBe(0);
        expect(wasCapped).toBe(true);
    });

    it('null cap is treated as no cap', () => {
        const rules = [makeRule({ amountCents: 100 })];
        const { totalCents, wasCapped } = calculateEarnings(rules, { pts: 20 }, null);
        expect(totalCents).toBe(2000);
        expect(wasCapped).toBe(false);
    });

    it('caps only positive earnings and then applies penalties', () => {
        const rules = [
            makeRule({ statKey: 'pts', amountCents: 100 }),
            makeRule({ id: 'r2', statKey: 'to', amountCents: -200 }),
        ];
        const { totalCents, uncappedTotalCents, wasCapped } = calculateEarnings(rules, { pts: 20, to: 3 }, 1000);
        expect(totalCents).toBe(400);
        expect(uncappedTotalCents).toBe(1400);
        expect(wasCapped).toBe(true);
    });
});

// ─── formatCents ─────────────────────────────────────────────────────────────

describe('formatCents', () => {
    it('formats positive cents with sign', () => {
        expect(formatCents(150)).toBe('+$1.50');
    });

    it('formats negative cents with sign', () => {
        expect(formatCents(-200)).toBe('-$2.00');
    });

    it('formats without sign when sign=false', () => {
        expect(formatCents(150, { sign: false })).toBe('$1.50');
        expect(formatCents(-200, { sign: false })).toBe('$2.00');
    });

    it('formats zero', () => {
        expect(formatCents(0)).toBe('+$0.00');
    });
});

// ─── normalizeStatKey / statKeyLabel ─────────────────────────────────────────

describe('normalizeStatKey', () => {
    it('maps canonical abbreviations to lowercase keys', () => {
        expect(normalizeStatKey('PTS')).toBe('pts');
        expect(normalizeStatKey('REB')).toBe('reb');
        expect(normalizeStatKey('TO')).toBe('to');
        expect(normalizeStatKey('FOULS')).toBe('fouls');
    });

    it('falls back to lowercase for unknown keys', () => {
        expect(normalizeStatKey('XYZ')).toBe('xyz');
    });
});

describe('statKeyLabel', () => {
    it('returns uppercase label for known keys', () => {
        expect(statKeyLabel('pts')).toBe('PTS');
        expect(statKeyLabel('to')).toBe('TO');
    });

    it('uppercases unknown keys', () => {
        expect(statKeyLabel('xyz')).toBe('XYZ');
    });
});

// ─── formatRuleLabel ─────────────────────────────────────────────────────────

describe('formatRuleLabel', () => {
    it('formats per_unit rule', () => {
        const rule = makeRule({ statKey: 'pts', type: 'per_unit', amountCents: 100 });
        expect(formatRuleLabel(rule)).toBe('PTS: +$1.00 per pts');
    });

    it('formats threshold (gt) rule', () => {
        const rule = makeRule({ statKey: 'reb', type: 'threshold', amountCents: 200, threshold: 3, thresholdOp: 'gt' });
        expect(formatRuleLabel(rule)).toBe('REB > 3 → +$2.00');
    });

    it('formats threshold (gte) rule', () => {
        const rule = makeRule({ statKey: 'ast', type: 'threshold', amountCents: 150, threshold: 5, thresholdOp: 'gte' });
        expect(formatRuleLabel(rule)).toBe('AST ≥ 5 → +$1.50');
    });

    it('formats penalty rule with negative amount', () => {
        const rule = makeRule({ statKey: 'to', type: 'per_unit', amountCents: -200 });
        expect(formatRuleLabel(rule)).toBe('TO: -$2.00 per to');
    });
});

// ─── formatBreakdownLine ─────────────────────────────────────────────────────

describe('formatBreakdownLine', () => {
    it('formats per_unit line', () => {
        const rule = makeRule({ statKey: 'pts', type: 'per_unit', amountCents: 100 });
        const line = formatBreakdownLine({ rule, statValue: 12, earned: 1200 });
        expect(line).toBe('12 PTS × $1.00 = +$12.00');
    });

    it('formats threshold line when met', () => {
        const rule = makeRule({ statKey: 'reb', type: 'threshold', amountCents: 200, threshold: 3, thresholdOp: 'gt' });
        const line = formatBreakdownLine({ rule, statValue: 5, earned: 200 });
        expect(line).toBe('REB > 3: 5 ✓ → +$2.00');
    });

    it('formats threshold line when not met', () => {
        const rule = makeRule({ statKey: 'reb', type: 'threshold', amountCents: 200, threshold: 3, thresholdOp: 'gt' });
        const line = formatBreakdownLine({ rule, statValue: 2, earned: 0 });
        expect(line).toBe('REB > 3: 2 ✗ → +$0.00');
    });
});

describe('getApplicableRulesForGame', () => {
    it('only returns rules active on the game date', () => {
        const applicable = getApplicableRulesForGame([
            makeRule({
                id: 'old',
                createdAt: new Date('2026-03-01T00:00:00Z'),
                effectiveFrom: new Date('2026-03-01T00:00:00Z'),
                effectiveTo: new Date('2026-03-10T00:00:00Z'),
            }),
            makeRule({
                id: 'new',
                amountCents: 200,
                createdAt: new Date('2026-03-10T00:00:00Z'),
                effectiveFrom: new Date('2026-03-10T00:00:00Z'),
                effectiveTo: null,
            }),
        ], new Date('2026-03-05T00:00:00Z'));

        expect(applicable.map(rule => rule.id)).toEqual(['old']);
    });
});

describe('renderIncentivesPanel', () => {
    it('uses full season stats for balances while showing only recent game cards', () => {
        const html = renderIncentivesPanel({
            player: { id: 'p1', name: 'Player One', teamId: 't1' },
            rules: [makeRule({ amountCents: 100 })],
            paidGames: new Map(),
            seasonGameStats: [
                { game: { id: 'g3', opponent: 'Game 3', date: '2026-03-03' }, stats: { pts: 7 } },
                { game: { id: 'g2', opponent: 'Game 2', date: '2026-03-02' }, stats: { pts: 6 } },
                { game: { id: 'g1', opponent: 'Game 1', date: '2026-03-01' }, stats: { pts: 5 } },
            ],
            recentGameStats: [
                { game: { id: 'g3', opponent: 'Game 3', date: '2026-03-03' }, stats: { pts: 7 } },
                { game: { id: 'g2', opponent: 'Game 2', date: '2026-03-02' }, stats: { pts: 6 } },
            ],
            statOptions: [{ key: 'pts', label: 'PTS' }],
            userId: 'u1',
        });

        expect(html).toContain('$18.00');
        expect(html).toContain('Game 3');
        expect(html).toContain('Game 2');
        expect(html).not.toContain('Game 1');
    });

    it('shows a minus sign for negative game totals', () => {
        const html = renderIncentivesPanel({
            player: { id: 'p1', name: 'Player One', teamId: 't1' },
            rules: [makeRule({ statKey: 'to', amountCents: -200 })],
            paidGames: new Map(),
            seasonGameStats: [
                { game: { id: 'g1', opponent: 'Penalty Game', date: '2026-03-01' }, stats: { to: 2 } },
            ],
            recentGameStats: [
                { game: { id: 'g1', opponent: 'Penalty Game', date: '2026-03-01' }, stats: { to: 2 } },
            ],
            statOptions: [{ key: 'to', label: 'TO' }],
            userId: 'u1',
        });

        expect(html).toContain('-$4.00');
    });

    it('uses the rule version active on each game date', () => {
        const html = renderIncentivesPanel({
            player: { id: 'p1', name: 'Player One', teamId: 't1' },
            rules: [
                makeRule({
                    id: 'r1',
                    amountCents: 100,
                    effectiveFrom: new Date('2026-03-01T00:00:00Z'),
                    effectiveTo: new Date('2026-03-10T00:00:00Z'),
                    createdAt: new Date('2026-03-01T00:00:00Z'),
                }),
                makeRule({
                    id: 'r2',
                    amountCents: 200,
                    effectiveFrom: new Date('2026-03-10T00:00:00Z'),
                    effectiveTo: null,
                    createdAt: new Date('2026-03-10T00:00:00Z'),
                }),
            ],
            paidGames: new Map(),
            seasonGameStats: [
                { game: { id: 'g1', opponent: 'Early Game', date: '2026-03-05' }, stats: { pts: 5 } },
                { game: { id: 'g2', opponent: 'Later Game', date: '2026-03-12' }, stats: { pts: 5 } },
            ],
            recentGameStats: [
                { game: { id: 'g1', opponent: 'Early Game', date: '2026-03-05' }, stats: { pts: 5 } },
                { game: { id: 'g2', opponent: 'Later Game', date: '2026-03-12' }, stats: { pts: 5 } },
            ],
            statOptions: [{ key: 'pts', label: 'PTS' }],
            userId: 'u1',
        });

        expect(html).toContain('$15.00');
        expect(html).toContain('+$5.00');
        expect(html).toContain('+$10.00');
    });

    it('escapes breakdown lines before rendering into HTML', () => {
        const html = renderIncentivesPanel({
            player: { id: 'player-1', name: 'Kid', teamId: 'team-1' },
            rules: [makeRule({ statKey: '<img src=x onerror=alert(1)>', amountCents: 100 })],
            paidGames: new Map(),
            seasonGameStats: [{
                game: { id: 'game-1', title: 'Game', date: '2026-03-01T00:00:00Z' },
                stats: { '<img src=x onerror=alert(1)>': 1 },
            }],
            recentGameStats: [{
                game: { id: 'game-1', title: 'Game', date: '2026-03-01T00:00:00Z' },
                stats: { '<img src=x onerror=alert(1)>': 1 },
            }],
            statOptions: [],
            userId: 'parent-1',
            maxPerGameCents: null,
        });

        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;IMG SRC=X ONERROR=ALERT(1)&gt;');
    });
});
