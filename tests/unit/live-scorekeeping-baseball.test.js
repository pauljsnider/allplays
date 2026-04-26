import { describe, expect, it } from 'vitest';
import {
    applyBaseballScorekeepingAction,
    createBaseballLiveState,
    getBaseballPeriodLabel,
    getBaseballSituationSummary,
    isBaseballScorekeepingSport,
    parseBaseballPeriodLabel
} from '../../js/live-scorekeeping-baseball.js';

describe('baseball live scorekeeping helpers', () => {
    it('enables count-based scorekeeping only for baseball and softball', () => {
        expect(isBaseballScorekeepingSport('Baseball')).toBe(true);
        expect(isBaseballScorekeepingSport('softball')).toBe(true);
        expect(isBaseballScorekeepingSport('Basketball')).toBe(false);
        expect(isBaseballScorekeepingSport('Soccer')).toBe(false);
    });

    it('resets the count after a walk and forces runners home', () => {
        const initial = createBaseballLiveState({
            half: 'top',
            balls: 3,
            strikes: 2,
            bases: { first: true, second: true, third: true },
            awayScore: 4
        });

        const result = applyBaseballScorekeepingAction(initial, 'ball');

        expect(result.state.balls).toBe(0);
        expect(result.state.strikes).toBe(0);
        expect(result.state.bases).toEqual({ first: true, second: true, third: true });
        expect(result.state.awayScore).toBe(5);
        expect(result.description).toContain('Walk');
    });

    it('advances outs on a strikeout and resets the count', () => {
        const result = applyBaseballScorekeepingAction(createBaseballLiveState({
            strikes: 2,
            balls: 2,
            outs: 1
        }), 'strike');

        expect(result.state.outs).toBe(2);
        expect(result.state.balls).toBe(0);
        expect(result.state.strikes).toBe(0);
        expect(result.state.half).toBe('top');
    });

    it('advances inning halves and clears bases after the third out', () => {
        const topResult = applyBaseballScorekeepingAction(createBaseballLiveState({
            inning: 1,
            half: 'top',
            outs: 2,
            bases: { first: true, third: true }
        }), 'out');

        expect(topResult.state.outs).toBe(0);
        expect(topResult.state.half).toBe('bottom');
        expect(topResult.state.inning).toBe(1);
        expect(topResult.state.bases).toEqual({ first: false, second: false, third: false });
        expect(getBaseballPeriodLabel(topResult.state)).toBe('B1');

        const bottomResult = applyBaseballScorekeepingAction(createBaseballLiveState({
            inning: 1,
            half: 'bottom',
            outs: 2
        }), 'out');

        expect(getBaseballPeriodLabel(bottomResult.state)).toBe('T2');
    });

    it('updates base occupancy and the batting team score on extra-base hits', () => {
        const result = applyBaseballScorekeepingAction(createBaseballLiveState({
            half: 'bottom',
            bases: { first: true, second: true, third: true },
            homeScore: 2
        }), 'double');

        expect(result.state.homeScore).toBe(4);
        expect(result.state.awayScore).toBe(0);
        expect(result.state.bases).toEqual({ first: false, second: true, third: true });
        expect(result.state.balls).toBe(0);
        expect(result.state.strikes).toBe(0);
    });

    it('parses and summarizes inning-half labels', () => {
        expect(parseBaseballPeriodLabel('B3')).toEqual({ inning: 3, half: 'bottom' });
        expect(getBaseballPeriodLabel({ inning: 4, half: 'top' })).toBe('T4');
        expect(getBaseballSituationSummary({
            inning: 2,
            half: 'bottom',
            balls: 1,
            strikes: 2,
            outs: 1,
            bases: { first: true, third: true }
        })).toBe('B2 1-2, 1 out, 1B/3B');
    });
});
