import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBoundedRetry } from '../../js/bounded-retry.js';

describe('startBoundedRetry', () => {
    afterEach(() => vi.useRealTimers());

    it('caps persistent failures and backs off between attempts', async () => {
        vi.useFakeTimers();
        const run = vi.fn().mockRejectedValue(new Error('permission denied'));
        const onError = vi.fn();

        startBoundedRetry({ initialValue: ['team-1'], run, shouldRetry: () => undefined, onError });
        await vi.runAllTimersAsync();

        expect(run).toHaveBeenCalledTimes(3);
        expect(onError).toHaveBeenCalledTimes(3);
    });

    it('does not start overlapping attempts while a read remains stalled', async () => {
        vi.useFakeTimers();
        const run = vi.fn(() => new Promise(() => {}));

        startBoundedRetry({ initialValue: ['team-1'], run, shouldRetry: () => ['team-1'] });
        await vi.advanceTimersByTimeAsync(60_000);

        expect(run).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
