import { describe, expect, it, vi } from 'vitest';

import {
    evaluateCriticalWorkflowHealth,
    verifyCriticalWorkflowHealthFromEnvironment,
    OBSERVABILITY_REF,
    OBSERVABILITY_REPOSITORY
} from '../../scripts/verify-critical-workflow-health.mjs';

const sha = 'a'.repeat(40);
const now = new Date('2030-06-01T12:00:00.000Z');

function run(overrides = {}) {
    return {
        id: 101,
        status: 'completed',
        conclusion: 'success',
        head_sha: sha,
        created_at: '2030-06-01T11:00:00.000Z',
        updated_at: '2030-06-01T11:30:00.000Z',
        ...overrides
    };
}

function response(runs) {
    return { total_count: runs.length, workflow_runs: runs };
}

function healthyInput(overrides = {}) {
    return {
        now,
        masterSha: sha,
        deploy: response([run({ id: 1 })]),
        smoke: response([run({ id: 2 })]),
        recovery: response([run({ id: 3, head_sha: 'b'.repeat(40) })]),
        ...overrides
    };
}

describe('critical workflow health evaluation', () => {
    it('requires current-master deploy and smoke plus a fresh scheduled recovery success', () => {
        expect(evaluateCriticalWorkflowHealth(healthyInput())).toEqual({
            healthy: true,
            signals: [
                { name: 'production-deploy', healthy: true, state: 'success', runId: 1 },
                { name: 'production-smoke', healthy: true, state: 'success', runId: 2 },
                { name: 'firestore-recovery', healthy: true, state: 'success', runId: 3 }
            ]
        });
    });

    it('allows a bounded in-progress deploy without falsely requiring smoke first', () => {
        const result = evaluateCriticalWorkflowHealth(healthyInput({
            deploy: response([run({ id: 4, status: 'in_progress', conclusion: null })]),
            smoke: response([])
        }));
        expect(result.healthy).toBe(true);
        expect(result.signals[0].state).toBe('pending');
        expect(result.signals[1].state).toBe('waiting_for_deploy');
    });

    it('fails on a deploy failure, missing exact smoke, or stale recovery proof', () => {
        expect(evaluateCriticalWorkflowHealth(healthyInput({
            deploy: response([run({ conclusion: 'failure' })])
        })).healthy).toBe(false);
        expect(evaluateCriticalWorkflowHealth(healthyInput({ smoke: response([]) })).healthy).toBe(false);
        const stale = evaluateCriticalWorkflowHealth(healthyInput({
            recovery: response([run({ id: 8, updated_at: '2030-06-01T01:00:00.000Z' })])
        }));
        expect(stale.healthy).toBe(false);
        expect(stale.signals[2].state).toBe('stale');
    });

    it('fails closed on malformed API data and workflow identities', () => {
        expect(() => evaluateCriticalWorkflowHealth(healthyInput({ masterSha: 'main' }))).toThrow(/exact commit SHA/);
        expect(() => evaluateCriticalWorkflowHealth(healthyInput({
            deploy: { total_count: 2, workflow_runs: [run({ id: 0 })] }
        }))).toThrow(/run id is invalid/);
    });
});

describe('critical workflow API boundary', () => {
    it('queries exact workflow files and event types in the production repository', () => {
        const calls = [];
        const executeGh = vi.fn((args) => {
            calls.push(args);
            const file = args.find((arg) => String(arg).includes('/actions/workflows/'));
            return JSON.stringify(file.includes('firestore-recovery-health.yml')
                ? response([run({ id: 3, head_sha: 'b'.repeat(40) })])
                : response([run()]));
        });
        const result = verifyCriticalWorkflowHealthFromEnvironment({
            GITHUB_REPOSITORY: OBSERVABILITY_REPOSITORY,
            GITHUB_REF: OBSERVABILITY_REF,
            GITHUB_SHA: sha,
            GH_TOKEN: 'test-token'
        }, { executeGh, now });
        expect(result.healthy).toBe(true);
        expect(calls).toHaveLength(3);
        expect(calls.map((args) => args.find((arg) => String(arg).startsWith('event='))))
            .toEqual(['event=push', 'event=workflow_run', 'event=schedule']);
    });

    it('refuses forks before making API calls', () => {
        const executeGh = vi.fn();
        expect(() => verifyCriticalWorkflowHealthFromEnvironment({
            GITHUB_REPOSITORY: 'attacker/fork', GITHUB_REF: OBSERVABILITY_REF,
            GITHUB_SHA: sha, GH_TOKEN: 'test-token'
        }, { executeGh, now })).toThrow(/only in pauljsnider\/allplays/);
        expect(executeGh).not.toHaveBeenCalled();
    });

    it('refuses non-master dispatches before making API calls', () => {
        const executeGh = vi.fn();
        expect(() => verifyCriticalWorkflowHealthFromEnvironment({
            GITHUB_REPOSITORY: OBSERVABILITY_REPOSITORY,
            GITHUB_REF: 'refs/heads/feature', GITHUB_SHA: sha, GH_TOKEN: 'test-token'
        }, { executeGh, now })).toThrow(/only from refs\/heads\/master/);
        expect(executeGh).not.toHaveBeenCalled();
    });
});
