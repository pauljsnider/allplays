import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBoundedRetry } from '../../js/bounded-retry.js';

describe('startBoundedRetry', () => {
    afterEach(() => vi.useRealTimers());

    it('caps persistent failures and backs off between attempts', async () => {
        vi.useFakeTimers();
        const run = vi.fn().mockRejectedValue(new Error('permission denied'));
        const onError = vi.fn();
        const onExhausted = vi.fn();

        startBoundedRetry({
            initialValue: ['team-1'],
            run,
            shouldRetry: () => undefined,
            onError,
            onExhausted
        });
        await vi.runAllTimersAsync();

        expect(run).toHaveBeenCalledTimes(3);
        expect(onError).toHaveBeenCalledTimes(3);
        expect(onExhausted).toHaveBeenCalledWith(['team-1'], expect.any(Error), 3);
    });

    it('does not start overlapping attempts while a read remains stalled', async () => {
        vi.useFakeTimers();
        const run = vi.fn(() => new Promise(() => {}));

        startBoundedRetry({ initialValue: ['team-1'], run, shouldRetry: () => ['team-1'] });
        await vi.advanceTimersByTimeAsync(60_000);

        expect(run).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('carries a partial retry value forward and surfaces it after the final attempt', async () => {
        vi.useFakeTimers();
        const run = vi.fn()
            .mockResolvedValueOnce(['team-2'])
            .mockResolvedValue([]);
        const onExhausted = vi.fn();

        startBoundedRetry({
            initialValue: ['team-1', 'team-2'],
            run,
            shouldRetry: (unknownTeamIds) => unknownTeamIds.length > 0 ? unknownTeamIds : undefined,
            retryDelayMs: () => 100,
            onExhausted
        });
        await vi.runAllTimersAsync();

        expect(run).toHaveBeenNthCalledWith(1, ['team-1', 'team-2'], 1);
        expect(run).toHaveBeenNthCalledWith(2, ['team-2'], 2);
        expect(onExhausted).not.toHaveBeenCalled();
    });

    it('reports repeatedly partial results as unavailable without another retry', async () => {
        vi.useFakeTimers();
        const run = vi.fn().mockResolvedValue(['team-2']);
        const onExhausted = vi.fn();

        startBoundedRetry({
            initialValue: ['team-1', 'team-2'],
            run,
            shouldRetry: (unknownTeamIds) => unknownTeamIds,
            retryDelayMs: () => 100,
            onExhausted
        });
        await vi.runAllTimersAsync();

        expect(run).toHaveBeenCalledTimes(3);
        expect(run).toHaveBeenNthCalledWith(2, ['team-2'], 2);
        expect(run).toHaveBeenNthCalledWith(3, ['team-2'], 3);
        expect(onExhausted).toHaveBeenCalledWith(['team-2'], null, 3);
    });
});
