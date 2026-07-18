import { describe, expect, it } from 'vitest';

import {
    OBSERVABILITY_ISSUE_LABEL,
    OBSERVABILITY_ISSUE_MARKER,
    OBSERVABILITY_ISSUE_TITLE,
    OBSERVABILITY_REPOSITORY,
    planObservabilityIssue,
    reconcileObservabilityIssue
} from '../../scripts/reconcile-observability-issue.mjs';

function managedIssue(overrides = {}) {
    return {
        number: 42,
        title: OBSERVABILITY_ISSUE_TITLE,
        state: 'OPEN',
        body: `${OBSERVABILITY_ISSUE_MARKER}\nmanaged`,
        user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
        labels: [{ name: OBSERVABILITY_ISSUE_LABEL }],
        ...overrides
    };
}

describe('observability incident reconciliation', () => {
    it('creates, updates, reopens, and closes only the managed incident', () => {
        expect(planObservabilityIssue('failure', []).action).toBe('create');
        expect(planObservabilityIssue('cancelled', [managedIssue()]).action).toBe('update');
        expect(planObservabilityIssue('skipped', [managedIssue({ state: 'CLOSED' })]).action).toBe('reopen');
        expect(planObservabilityIssue('success', [managedIssue()]).action).toBe('close');
        expect(planObservabilityIssue('success', []).action).toBe('none');
    });

    it('fails closed on duplicate, user-owned, unlabelled, or unmarked collisions', () => {
        expect(() => planObservabilityIssue('failure', [managedIssue(), managedIssue({ number: 43 })])).toThrow(/Multiple exact/);
        expect(() => planObservabilityIssue('failure', [managedIssue({ user: { id: 1, login: 'person', type: 'User' } })])).toThrow(/not owned/);
        expect(() => planObservabilityIssue('failure', [managedIssue({ labels: [] })])).toThrow(/security label/);
        expect(() => planObservabilityIssue('failure', [managedIssue({ body: 'copied' })])).toThrow(/marker/);
    });

    it('creates one content-bounded issue and refuses fork mutations', () => {
        const calls = [];
        const executeGh = (args) => {
            calls.push(args);
            return calls.length === 1
                ? JSON.stringify({ total_count: 0, incomplete_results: false, items: [] })
                : '';
        };
        const plan = reconcileObservabilityIssue({
            result: 'failure', repository: OBSERVABILITY_REPOSITORY,
            runUrl: 'https://github.com/pauljsnider/allplays/actions/runs/1',
            runbookUrl: 'https://github.com/pauljsnider/allplays/blob/master/docs/observability-runbook.md'
        }, { executeGh });
        expect(plan.action).toBe('create');
        expect(calls[1]).toEqual(expect.arrayContaining([
            'issue', 'create', '--label', OBSERVABILITY_ISSUE_LABEL,
            '--title', OBSERVABILITY_ISSUE_TITLE
        ]));
        expect(calls[1].at(-1)).toContain(OBSERVABILITY_ISSUE_MARKER);

        expect(() => reconcileObservabilityIssue({
            result: 'failure', repository: 'attacker/fork', runUrl: 'x', runbookUrl: 'y'
        }, { executeGh })).toThrow(/only in pauljsnider\/allplays/);
    });
});
