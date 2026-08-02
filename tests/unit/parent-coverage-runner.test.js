import { describe, expect, it, vi } from 'vitest';
import { executeParentCoverageCleanup } from '../smoke/helpers/parent-coverage-runner.js';

describe('parent coverage cleanup execution', () => {
    it('attempts every restoration and retains every cleanup failure', async () => {
        const executeStep = vi.fn()
            .mockRejectedValueOnce(new Error('first secret failure'))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('last secret failure'));
        const steps = [
            { action: 'restoreControl', option: 'first' },
            { action: 'restoreControl', option: 'second' },
            { action: 'restoreControl', option: 'third' }
        ];

        const failures = await executeParentCoverageCleanup({ executeStep }, steps);

        expect(executeStep).toHaveBeenCalledTimes(3);
        expect(executeStep.mock.calls.every(([, phase]) => phase === 'cleanup')).toBe(true);
        expect(failures.map(({ action, error }) => `${action}: ${error.message}`)).toEqual([
            'restoreControl: first secret failure',
            'restoreControl: last secret failure'
        ]);
    });
});
