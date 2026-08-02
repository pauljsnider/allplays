import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
    createParentCoverageMutationTracker,
    clickAndExpectGoogleAuth,
    executeParentCoverageCleanup,
    resolveParentCoverageInvite
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

    it('fails cleanup on runtime issues raised after restoration begins without retaining raw details', async () => {
        const issues = [];
        const failures = await executeParentCoverageCleanup({
            executeStep: async () => issues.push('private production value'),
            shouldExecuteCleanup: () => true,
            runtimeIssues: () => [...issues]
        }, [{ action: 'click', mutationId: 'cleanup' }]);

        expect(failures).toHaveLength(1);
        expect(failures[0].action).toBe('cleanup-runtime');
        expect(failures[0].error.message).toBe('application runtime issue occurred during cleanup');
        expect(failures[0].error.message).not.toContain('private production value');
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

    it('redeems the exact run-scoped household invite without mailbox access', () => {
        expect(runnerSource).toContain("step.action === 'redeemRunScopedHouseholdInvite'");
        expect(runnerSource).toContain('run-scoped household invite code is unavailable');
        expect(runnerSource).toContain("toMatch(/^#\\/home(?:\\?|$)/)");
        expect(runnerSource).not.toContain('PARENT_CENSUS_MAILBOX_');
        expect(runnerSource).not.toContain('findLatestParentMailboxActionLink');
    });

    it('suppresses navigation aborts only for explicit lifecycle transitions', () => {
        expect(runnerSource).toContain("new Set(['P02', 'P08', 'P37'])");
        expect(runnerSource).toContain('controlledLifecycleClickWorkflows.has(contract.workflowId)');
        expect(runnerSource).toContain('else await target.click()');
    });

    it('fails closed on ambiguous entity scopes and mutation targets', () => {
        expect(runnerSource).toContain('await expect(anchors).toHaveCount(1');
        expect(runnerSource).toContain('await expect(target).toHaveCount(1');
        expect(runnerSource).not.toContain("getByText(scopeText, { exact: true }).first()");
    });

    it('settles Google handoff listeners for both popup and same-tab flows', async () => {
        const page = new EventEmitter();
        page.mainFrame = () => ({ url: () => 'https://accounts.google.com/o/oauth2/auth' });
        const popup = { id: 'popup' };
        await expect(clickAndExpectGoogleAuth(page, {
            click: () => page.emit('popup', popup)
        }, 50)).resolves.toBe(popup);
        expect(page.listenerCount('popup')).toBe(0);
        expect(page.listenerCount('framenavigated')).toBe(0);

        const mainFrame = { url: () => 'https://accounts.google.com/o/oauth2/auth' };
        page.mainFrame = () => mainFrame;
        await expect(clickAndExpectGoogleAuth(page, {
            click: () => page.emit('framenavigated', mainFrame)
        }, 50)).resolves.toBeNull();
        expect(page.listenerCount('popup')).toBe(0);
        expect(page.listenerCount('framenavigated')).toBe(0);
    });

    it('uses a bounded P27 inverse for either pending or accepted household access', () => {
        expect(runnerSource).toContain("name: 'Cancel invite', exact: true");
        expect(runnerSource).toContain("name: 'Revoke access', exact: true");
        expect(runnerSource).toContain('bounded household restoration target is unavailable or ambiguous');
        expect(runnerSource).toContain('assertRelationshipRestored(page, lifecycleEmail');
    });

    it('reloads and verifies every generic or control cleanup postcondition', () => {
        expect(runnerSource).toContain('assertCleanupClickPersisted(page, target');
        expect(runnerSource).toContain('assertCleanupGroupPersisted(');
        expect(runnerSource).toContain('cleanupGroupHasStateCommit(step)');
        expect(runnerSource).toContain('pendingCleanupTargets.set(pendingKey, pending)');
        expect(runnerSource).toContain("page.once('dialog', acceptDialog)");
        expect(runnerSource).toMatch(/withControlledNavigation\(page, \(\) => page\.reload[\s\S]+toEqual\(restoration\.state\)/);
    });

    it('resolves an invite only for its exact purpose-bound team and player target', () => {
        const document = {
            fields: {
                type: { stringValue: 'parent_invite' },
                email: { stringValue: 'lifecycle@example.com' },
                relation: { stringValue: 'Parent census team-redemption' },
                teamId: { stringValue: 'redemption-team' },
                playerId: { stringValue: 'redemption-player' },
                code: { stringValue: 'P08-CODE' },
                used: { booleanValue: false },
                expiresAt: { timestampValue: '2026-08-10T00:00:00.000Z' }
            }
        };
        const resolve = (teamId, playerId) => resolveParentCoverageInvite(
            [document],
            'lifecycle@example.com',
            'team-redemption',
            teamId,
            playerId,
            Date.parse('2026-08-02T00:00:00.000Z')
        );

        expect(resolve('redemption-team', 'redemption-player')).toBe(document);
        expect(resolve('signup-team', 'redemption-player')).toBeUndefined();
        expect(resolve('redemption-team', 'signup-player')).toBeUndefined();
        expect(runnerSource).toContain('PARENT_CENSUS_REDEMPTION_TEAM_ID');
        expect(runnerSource).toContain('PARENT_CENSUS_REDEMPTION_PLAYER_ID');
        expect(runnerSource).toContain('redemptionTeamId === variables.TEAM_ID');
    });
});
