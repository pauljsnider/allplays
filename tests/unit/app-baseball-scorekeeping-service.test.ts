import { describe, expect, it } from 'vitest';
import { applyWalk, createBaseballLiveState } from '../../apps/app/src/lib/sportScoring/baseballScorekeepingService.ts';

describe('app baseball scorekeeping service', () => {
    it('scores one run and keeps bases loaded when walking with loaded bases', () => {
        const result = applyWalk(createBaseballLiveState({
            half: 'top',
            balls: 3,
            strikes: 2,
            bases: { first: true, second: true, third: true },
            awayScore: 4,
            homeScore: 2
        }));

        expect(result.state.awayScore).toBe(5);
        expect(result.state.homeScore).toBe(2);
        expect(result.state.bases).toEqual({ first: true, second: true, third: true });
        expect(result.description).toBe('Walk, 1 run scored');
    });

    it('forces a runner from first to second without scoring', () => {
        const result = applyWalk(createBaseballLiveState({
            bases: { first: true, second: false, third: false },
            homeScore: 1,
            awayScore: 0
        }));

        expect(result.state.bases).toEqual({ first: true, second: true, third: false });
        expect(result.state.homeScore).toBe(1);
        expect(result.state.awayScore).toBe(0);
    });

    it('keeps the runner on third when the walk does not force home', () => {
        const result = applyWalk(createBaseballLiveState({
            bases: { first: false, second: false, third: true },
            homeScore: 1,
            awayScore: 0
        }));

        expect(result.state.bases).toEqual({ first: true, second: false, third: true });
        expect(result.state.homeScore).toBe(1);
        expect(result.state.awayScore).toBe(0);
    });

    it('resets balls and strikes after a walk', () => {
        const result = applyWalk(createBaseballLiveState({ balls: 3, strikes: 2 }));

        expect(result.state.balls).toBe(0);
        expect(result.state.strikes).toBe(0);
    });
});
