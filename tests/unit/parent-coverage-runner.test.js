import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    createParentCoverageMutationTracker,
    executeParentCoverageCleanup
} from '../smoke/helpers/parent-coverage-runner.js';

const runnerSource = readFileSync('tests/smoke/helpers/parent-coverage-runner.js', 'utf8');
const censusSource = readFileSync('tests/smoke/app-parent-coverage-census.spec.js', 'utf8');

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

        const failures = await executeParentCoverageCleanup({ executeStep, shouldExecuteCleanup: () => true }, steps);

        expect(executeStep).toHaveBeenCalledTimes(3);
        expect(executeStep.mock.calls.every(([, phase]) => phase === 'cleanup')).toBe(true);
        expect(failures.map(({ action, error }) => `${action}: ${error.message}`)).toEqual([
            'restoreControl: first secret failure',
            'restoreControl: last secret failure'
        ]);
    });

    it('runs cleanup only for mutations that completed in execution', async () => {
        const executeStep = vi.fn();
        const steps = [
            { action: 'restoreControl', option: 'completed', mutationId: 'completed' },
            { action: 'restoreControl', option: 'not-started', mutationId: 'not-started' }
        ];
        await executeParentCoverageCleanup({
            executeStep,
            shouldExecuteCleanup: (step) => step.mutationId === 'completed'
        }, steps);
        expect(executeStep).toHaveBeenCalledTimes(1);
        expect(executeStep).toHaveBeenCalledWith(steps[0], 'cleanup');
    });

    it('does not arm destructive cleanup until the declared forward operation completes', () => {
        const tracker = createParentCoverageMutationTracker();
        const cleanup = { action: 'click', mutationId: 'new-message' };
        tracker.record({ action: 'fill', mutationId: 'new-message' });
        expect(tracker.shouldExecute(cleanup)).toBe(false);
        tracker.record({ action: 'click', mutationId: 'new-message', commitMutation: true });
        expect(tracker.shouldExecute(cleanup)).toBe(true);
        tracker.record({ action: 'click', mutationId: 'other', commitMutation: true }, 'cleanup');
        expect(tracker.shouldExecute({ action: 'click', mutationId: 'other' })).toBe(false);
    });

    it('arms upload cleanup before a later save or send can fail', () => {
        const tracker = createParentCoverageMutationTracker();
        tracker.record({
            action: 'uploadSyntheticImage',
            mutationId: 'synthetic-upload',
            commitMutation: true
        });
        expect(tracker.shouldExecute({ action: 'click', mutationId: 'synthetic-upload' })).toBe(true);
    });

    it('restores exactly one pending or accepted peer friendship state', () => {
        expect(runnerSource).toContain("actorCredentials('peer').email");
        expect(runnerSource).toContain("name: 'Cancel request', exact: true");
        expect(runnerSource).toContain("name: 'Remove friend', exact: true");
        expect(runnerSource).toContain('if (visible.length !== 1)');
    });

    it('never writes raw Playwright messages into the uploaded report', () => {
        expect(censusSource).toContain('classifyParentCoverageError(cleanupFailure)');
        expect(censusSource).toContain('classifyParentCoverageError(productError)');
        expect(censusSource).not.toContain('cleanupFailure?.message');
        expect(censusSource).not.toContain('productError?.message');
    });

    it('requires mailbox actions to finish on the workflow-scoped app route', () => {
        expect(runnerSource).toContain('requireAppRoute: true');
        expect(runnerSource).toMatch(/requireAppRoute: true[\s\S]+assertAllowedPage\(page, appBaseUrl, contract\.workflowId\)/);
    });

    it('fails closed on ambiguous entity scopes and mutation targets', () => {
        expect(runnerSource).toContain('await expect(anchors).toHaveCount(1');
        expect(runnerSource).toContain('await expect(target).toHaveCount(1');
        expect(runnerSource).not.toContain("getByText(scopeText, { exact: true }).first()");
    });
});
