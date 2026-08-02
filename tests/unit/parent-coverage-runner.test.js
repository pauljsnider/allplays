import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { executeParentCoverageCleanup } from '../smoke/helpers/parent-coverage-runner.js';

const runnerSource = readFileSync('tests/smoke/helpers/parent-coverage-runner.js', 'utf8');

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

    it('requires mailbox actions to finish on the workflow-scoped app route', () => {
        expect(runnerSource).toContain('requireAppRoute: true');
        expect(runnerSource).toMatch(/requireAppRoute: true[\s\S]+assertAllowedPage\(page, appBaseUrl, contract\.workflowId\)/);
    });
});
