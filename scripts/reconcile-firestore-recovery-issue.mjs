#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RECOVERY_REPOSITORY = 'pauljsnider/allplays';
export const RECOVERY_ISSUE_TITLE = '[Recovery] Firestore recovery posture is unverified';
export const RECOVERY_ISSUE_MARKER = '<!-- allplays-firestore-recovery-health -->';
export const RECOVERY_ISSUE_ASSIGNEE = 'pauljsnider';
export const RECOVERY_ISSUE_AUTHOR = 'github-actions[bot]';
export const RECOVERY_ISSUE_AUTHOR_ID = 41898282;
export const RECOVERY_ISSUE_LABEL = 'recovery-monitor';

const VERIFY_RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped']);

function required(environment, name) {
    const value = String(environment[name] || '').trim();
    if (!value) throw new Error(`${name} is required to reconcile the recovery incident.`);
    return value;
}

function parseIssueSearch(output) {
    let parsed;
    try {
        parsed = JSON.parse(String(output || ''));
    } catch (error) {
        throw new Error('GitHub returned invalid JSON while searching for recovery incidents.', { cause: error });
    }
    if (
        parsed == null
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
        || !Number.isSafeInteger(parsed.total_count)
        || parsed.total_count < 0
        || parsed.total_count > 100
        || parsed.incomplete_results !== false
        || !Array.isArray(parsed.items)
        || parsed.items.length !== parsed.total_count
    ) {
        throw new Error('GitHub recovery incident search response is incomplete or invalid.');
    }
    return parsed.items;
}

export function planRecoveryIssueReconciliation(verifyResult, issues) {
    if (!VERIFY_RESULTS.has(verifyResult)) {
        throw new Error(`Unexpected recovery verification result: ${verifyResult || '<empty>'}.`);
    }
    if (!Array.isArray(issues)) throw new Error('Recovery issues must be an array.');

    const exactIssues = issues.filter((issue) => issue?.title === RECOVERY_ISSUE_TITLE);
    if (exactIssues.length > 1) {
        throw new Error('More than one exact Firestore recovery incident exists; refusing ambiguous mutation.');
    }

    const issue = exactIssues[0] || null;
    if (issue) {
        if (!Number.isSafeInteger(issue.number) || issue.number < 1) {
            throw new Error('The managed recovery incident has an invalid issue number.');
        }
        const issueState = String(issue.state || '').toUpperCase();
        if (!['OPEN', 'CLOSED'].includes(issueState)) {
            throw new Error('The managed recovery incident has an invalid state.');
        }
        if (
            issue.user?.id !== RECOVERY_ISSUE_AUTHOR_ID
            || issue.user?.type !== 'Bot'
            || issue.user?.login !== RECOVERY_ISSUE_AUTHOR
        ) {
            throw new Error('Exact recovery issue title exists but was not created by github-actions[bot]; refusing to mutate an untrusted issue.');
        }
        if (!Array.isArray(issue.labels) || !issue.labels.some((label) => label?.name === RECOVERY_ISSUE_LABEL)) {
            throw new Error('Exact recovery issue title exists without the bot-only recovery label; refusing to mutate it.');
        }
        if (!String(issue.body || '').includes(RECOVERY_ISSUE_MARKER)) {
            throw new Error('Exact recovery issue title exists without the managed marker; refusing to edit it.');
        }
    }

    if (verifyResult === 'success') {
        return {
            action: String(issue?.state || '').toUpperCase() === 'OPEN' ? 'close' : 'none',
            issueNumber: issue?.number || null,
            healthy: true
        };
    }

    return {
        action: issue == null
            ? 'create'
            : String(issue.state).toUpperCase() === 'CLOSED' ? 'reopen' : 'update',
        issueNumber: issue?.number || null,
        healthy: false
    };
}

export function buildRecoveryFailureBody({ verifyResult, runUrl, runbookUrl }) {
    return [
        RECOVERY_ISSUE_MARKER,
        '',
        'The scheduled Firestore recovery check is failing or did not complete successfully.',
        '',
        `Latest result: ${verifyResult}. Run: ${runUrl}`,
        `Runbook: ${runbookUrl}`
    ].join('\n');
}

export function runGh(args) {
    try {
        return execFileSync('gh', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit'],
            timeout: 60 * 1000,
            maxBuffer: 2 * 1024 * 1024
        });
    } catch (error) {
        const reason = error?.code === 'ETIMEDOUT' ? ' The command timed out after one minute.' : '';
        throw new Error(`GitHub recovery incident command failed.${reason}`, { cause: error });
    }
}

export function reconcileRecoveryIssue(
    { verifyResult, repository, runUrl, runbookUrl },
    { executeGh = runGh } = {}
) {
    if (repository !== RECOVERY_REPOSITORY) {
        throw new Error(`Recovery incident reconciliation may run only in ${RECOVERY_REPOSITORY}.`);
    }

    const issueOutput = executeGh([
        'api', '--method', 'GET', 'search/issues',
        '-f', `q=repo:${repository} is:issue author:app/github-actions in:title "${RECOVERY_ISSUE_TITLE}"`,
        '-f', 'per_page=100'
    ]);
    const plan = planRecoveryIssueReconciliation(verifyResult, parseIssueSearch(issueOutput));
    const failureBody = buildRecoveryFailureBody({ verifyResult, runUrl, runbookUrl });

    if (plan.action === 'close') {
        executeGh([
            'issue', 'close', String(plan.issueNumber),
            '--repo', repository,
            '--reason', 'completed',
            '--comment', `Recovery posture verified successfully in ${runUrl}. Closing the managed incident.`
        ]);
    } else if (plan.action === 'create') {
        executeGh([
            'issue', 'create',
            '--repo', repository,
            '--assignee', RECOVERY_ISSUE_ASSIGNEE,
            '--label', RECOVERY_ISSUE_LABEL,
            '--title', RECOVERY_ISSUE_TITLE,
            '--body', failureBody
        ]);
    } else if (plan.action === 'reopen') {
        executeGh(['issue', 'reopen', String(plan.issueNumber), '--repo', repository]);
        executeGh(['issue', 'edit', String(plan.issueNumber), '--repo', repository, '--body', failureBody]);
        executeGh([
            'issue', 'comment', String(plan.issueNumber),
            '--repo', repository,
            '--body', `Recovery posture failed again. Investigate ${runUrl}.`
        ]);
    } else if (plan.action === 'update') {
        executeGh(['issue', 'edit', String(plan.issueNumber), '--repo', repository, '--body', failureBody]);
    }

    return plan;
}

export function reconcileRecoveryIssueFromEnvironment(environment = process.env, dependencies = {}) {
    const verifyResult = required(environment, 'VERIFY_RESULT');
    const repository = required(environment, 'GITHUB_REPOSITORY');
    const serverUrl = required(environment, 'GITHUB_SERVER_URL').replace(/\/+$/, '');
    const runId = required(environment, 'GITHUB_RUN_ID');
    required(environment, 'GH_TOKEN');

    const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
    const runbookUrl = `${serverUrl}/${repository}/blob/master/docs/firestore-recovery-runbook.md#health-check-failure`;
    const result = reconcileRecoveryIssue(
        { verifyResult, repository, runUrl, runbookUrl },
        dependencies
    );

    if (!result.healthy) {
        console.error(`::error title=Firestore recovery health check failed::Result=${verifyResult}. Treat recovery posture as unverified. Inspect ${runUrl} and follow ${runbookUrl}.`);
        const summaryPath = String(environment.GITHUB_STEP_SUMMARY || '').trim();
        if (summaryPath) {
            appendFileSync(summaryPath, [
                '## Firestore recovery posture is unverified',
                '',
                `Verification result: \`${verifyResult}\``,
                '',
                `1. [Inspect the failed health run](${runUrl}).`,
                `2. [Follow the health-check failure runbook](${runbookUrl}).`,
                '3. Do not disable PITR, backup schedules, or delete protection while investigating.',
                '4. Escalate to the production owner if a control is absent, a backup is stale, or OIDC cannot authenticate.',
                ''
            ].join('\n'), { encoding: 'utf8' });
        }
        process.exitCode = 1;
    }

    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        reconcileRecoveryIssueFromEnvironment();
    } catch (error) {
        console.error(`::error title=Recovery incident reconciliation failed::${error?.message || 'Unknown reconciliation failure.'}`);
        process.exitCode = 1;
    }
}
