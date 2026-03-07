import { describe, it, expect, vi } from 'vitest';

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
}));

import {
    calculateEarnings,
    formatCents,
    formatRuleLabel,
    formatBreakdownLine,
    normalizeStatKey,
    statKeyLabel,
} from '../../js/parent-incentives.js';

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
