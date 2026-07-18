import { describe, expect, it } from 'vitest';

import {
    buildRecoveryFailureBody,
    planRecoveryIssueReconciliation,
    reconcileRecoveryIssue,
    RECOVERY_ISSUE_AUTHOR,
    RECOVERY_ISSUE_AUTHOR_ID,
    RECOVERY_ISSUE_LABEL,
    RECOVERY_ISSUE_MARKER,
    RECOVERY_ISSUE_TITLE,
    RECOVERY_REPOSITORY
} from '../../scripts/reconcile-firestore-recovery-issue.mjs';

const runUrl = 'https://github.com/pauljsnider/allplays/actions/runs/123';
const runbookUrl = 'https://github.com/pauljsnider/allplays/blob/master/docs/firestore-recovery-runbook.md#health-check-failure';

function managedIssue(overrides = {}) {
    return {
        number: 42,
        title: RECOVERY_ISSUE_TITLE,
        state: 'OPEN',
        body: `${RECOVERY_ISSUE_MARKER}\nmanaged`,
        user: { id: RECOVERY_ISSUE_AUTHOR_ID, login: RECOVERY_ISSUE_AUTHOR, type: 'Bot' },
        labels: [{ name: RECOVERY_ISSUE_LABEL }],
        ...overrides
    };
}

function runReconciliation(verifyResult, issues) {
    const calls = [];
    const executeGh = (args) => {
        calls.push(args);
        return calls.length === 1 ? JSON.stringify({
            total_count: issues.length,
            incomplete_results: false,
            items: issues
        }) : '';
    };
    const result = reconcileRecoveryIssue({
        verifyResult,
        repository: RECOVERY_REPOSITORY,
        runUrl,
        runbookUrl
    }, { executeGh });
    return { calls, result };
}

describe('Firestore recovery issue planning', () => {
    it('does nothing for a healthy run without an open managed incident', () => {
        expect(planRecoveryIssueReconciliation('success', [])).toEqual({
            action: 'none', issueNumber: null, healthy: true
        });
        expect(planRecoveryIssueReconciliation('success', [managedIssue({ state: 'CLOSED' })])).toEqual({
            action: 'none', issueNumber: 42, healthy: true
        });
    });

    it('closes an open incident only after success', () => {
        expect(planRecoveryIssueReconciliation('success', [managedIssue()])).toEqual({
            action: 'close', issueNumber: 42, healthy: true
        });
    });

    it.each(['failure', 'cancelled', 'skipped'])
    ('creates, updates, or reopens a managed incident after %s', (verifyResult) => {
        expect(planRecoveryIssueReconciliation(verifyResult, []).action).toBe('create');
        expect(planRecoveryIssueReconciliation(verifyResult, [managedIssue()]).action).toBe('update');
        expect(planRecoveryIssueReconciliation(
            verifyResult,
            [managedIssue({ state: 'CLOSED' })]
        ).action).toBe('reopen');
    });

    it('treats an exact-title issue from a public user as an untrusted collision', () => {
        expect(() => planRecoveryIssueReconciliation('failure', [managedIssue({
            user: { id: 123, login: 'untrusted-user', type: 'User' }
        })])).toThrow(/not created by github-actions\[bot\].*untrusted issue/);
    });

    it('requires the bot-only label and management marker', () => {
        expect(() => planRecoveryIssueReconciliation('failure', [managedIssue({ labels: [] })]))
            .toThrow(/without the bot-only recovery label/);
        expect(() => planRecoveryIssueReconciliation('failure', [managedIssue({ body: 'copied title' })]))
            .toThrow(/without the managed marker/);
    });

    it('refuses duplicates, malformed issue identity, states, and results', () => {
        expect(() => planRecoveryIssueReconciliation('failure', [managedIssue(), managedIssue({ number: 43 })]))
            .toThrow(/More than one exact/);
        expect(() => planRecoveryIssueReconciliation('failure', [managedIssue({ number: 0 })]))
            .toThrow(/invalid issue number/);
        expect(() => planRecoveryIssueReconciliation('failure', [managedIssue({ state: 'UNKNOWN' })]))
            .toThrow(/invalid state/);
        expect(() => planRecoveryIssueReconciliation('timed_out', []))
            .toThrow(/Unexpected recovery verification result/);
        expect(() => planRecoveryIssueReconciliation('failure', null))
            .toThrow(/must be an array/);
    });
});

describe('Firestore recovery issue mutation behavior', () => {
    it('creates one labeled, assigned incident on failure', () => {
        const { calls, result } = runReconciliation('failure', []);
        expect(result).toMatchObject({ action: 'create', healthy: false });
        expect(calls).toHaveLength(2);
        expect(calls[0]).toContain(`q=repo:${RECOVERY_REPOSITORY} is:issue author:app/github-actions in:title "${RECOVERY_ISSUE_TITLE}"`);
        expect(calls[1]).toEqual(expect.arrayContaining([
            'issue', 'create',
            '--assignee', 'pauljsnider',
            '--label', RECOVERY_ISSUE_LABEL,
            '--title', RECOVERY_ISSUE_TITLE
        ]));
        expect(calls[1].at(-1)).toContain(RECOVERY_ISSUE_MARKER);
        expect(calls[1].at(-1)).toContain(runUrl);
    });

    it('updates an existing open incident without adding repetitive comments', () => {
        const { calls } = runReconciliation('failure', [managedIssue()]);
        expect(calls).toHaveLength(2);
        expect(calls[1].slice(0, 4)).toEqual(['issue', 'edit', '42', '--repo']);
    });

    it('reopens, updates, and comments once when failure recurs', () => {
        const { calls } = runReconciliation('cancelled', [managedIssue({ state: 'CLOSED' })]);
        expect(calls.map((call) => call.slice(0, 2))).toEqual([
            ['api', '--method'],
            ['issue', 'reopen'],
            ['issue', 'edit'],
            ['issue', 'comment']
        ]);
    });

    it('closes the exact open managed issue on recovery', () => {
        const { calls, result } = runReconciliation('success', [managedIssue()]);
        expect(result).toMatchObject({ action: 'close', healthy: true });
        expect(calls).toHaveLength(2);
        expect(calls[1]).toEqual(expect.arrayContaining([
            'issue', 'close', '42', '--reason', 'completed'
        ]));
    });

    it('does not mutate anything when recovery is healthy and no incident exists', () => {
        const { calls, result } = runReconciliation('success', []);
        expect(result.action).toBe('none');
        expect(calls).toHaveLength(1);
    });

    it('refuses a repository outside the exact production repository before listing issues', () => {
        let called = false;
        expect(() => reconcileRecoveryIssue({
            verifyResult: 'failure',
            repository: 'attacker/fork',
            runUrl,
            runbookUrl
        }, { executeGh: () => { called = true; } })).toThrow(/only in pauljsnider\/allplays/);
        expect(called).toBe(false);
    });

    it('fails closed on invalid GitHub JSON', () => {
        expect(() => reconcileRecoveryIssue({
            verifyResult: 'failure',
            repository: RECOVERY_REPOSITORY,
            runUrl,
            runbookUrl
        }, { executeGh: () => 'not-json' })).toThrow(/invalid JSON/);
    });

    it('fails closed on incomplete or over-broad GitHub search results', () => {
        for (const response of [
            { total_count: 1, incomplete_results: true, items: [] },
            { total_count: 101, incomplete_results: false, items: [] },
            { total_count: 1, incomplete_results: false, items: [] },
            { total_count: 1, incomplete_results: false, items: null }
        ]) {
            expect(() => reconcileRecoveryIssue({
                verifyResult: 'failure',
                repository: RECOVERY_REPOSITORY,
                runUrl,
                runbookUrl
            }, { executeGh: () => JSON.stringify(response) })).toThrow(/incomplete or invalid/);
        }
    });

    it('builds a marker-protected body with exact evidence links', () => {
        expect(buildRecoveryFailureBody({ verifyResult: 'failure', runUrl, runbookUrl })).toBe([
            RECOVERY_ISSUE_MARKER,
            '',
            'The scheduled Firestore recovery check is failing or did not complete successfully.',
            '',
            `Latest result: failure. Run: ${runUrl}`,
            `Runbook: ${runbookUrl}`
        ].join('\n'));
    });
});
