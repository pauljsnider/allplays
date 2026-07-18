#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const OBSERVABILITY_REPOSITORY = 'pauljsnider/allplays';
export const OBSERVABILITY_ISSUE_TITLE = '[Observability] Critical production signals are unhealthy';
export const OBSERVABILITY_ISSUE_MARKER = '<!-- allplays-critical-workflow-health -->';
export const OBSERVABILITY_ISSUE_LABEL = 'security';
const BOT_LOGIN = 'github-actions[bot]';
const BOT_ID = 41898282;
const results = new Set(['success', 'failure', 'cancelled', 'skipped']);

function parseSearch(output) {
    let response;
    try { response = JSON.parse(String(output || '')); } catch (error) {
        throw new Error('GitHub returned invalid observability issue JSON.', { cause: error });
    }
    if (
        !response || typeof response !== 'object' || Array.isArray(response)
        || !Number.isSafeInteger(response.total_count) || response.total_count < 0 || response.total_count > 100
        || response.incomplete_results !== false || !Array.isArray(response.items)
        || response.items.length !== response.total_count
    ) throw new Error('GitHub observability issue search is incomplete or invalid.');
    return response.items;
}

export function planObservabilityIssue(result, issues) {
    if (!results.has(result)) throw new Error(`Unexpected verification result: ${result || '<empty>'}.`);
    if (!Array.isArray(issues)) throw new Error('Observability issues must be an array.');
    const exact = issues.filter((issue) => issue?.title === OBSERVABILITY_ISSUE_TITLE);
    if (exact.length > 1) throw new Error('Multiple exact observability incidents exist; refusing ambiguous mutation.');
    const issue = exact[0] || null;
    if (issue) {
        if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Observability issue number is invalid.');
        if (!['OPEN', 'CLOSED'].includes(String(issue.state || '').toUpperCase())) throw new Error('Observability issue state is invalid.');
        if (issue.user?.id !== BOT_ID || issue.user?.login !== BOT_LOGIN || issue.user?.type !== 'Bot') {
            throw new Error('Exact observability title is not owned by github-actions[bot].');
        }
        if (!Array.isArray(issue.labels) || !issue.labels.some((label) => label?.name === OBSERVABILITY_ISSUE_LABEL)) {
            throw new Error('Managed observability issue is missing its security label.');
        }
        if (!String(issue.body || '').includes(OBSERVABILITY_ISSUE_MARKER)) {
            throw new Error('Managed observability issue is missing its marker.');
        }
    }
    const healthy = result === 'success';
    return {
        healthy,
        issueNumber: issue?.number || null,
        action: healthy
            ? String(issue?.state || '').toUpperCase() === 'OPEN' ? 'close' : 'none'
            : issue == null ? 'create' : String(issue.state).toUpperCase() === 'CLOSED' ? 'reopen' : 'update'
    };
}

function runGh(args) {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 60_000 });
}

export function reconcileObservabilityIssue({ result, repository, runUrl, runbookUrl }, { executeGh = runGh } = {}) {
    if (repository !== OBSERVABILITY_REPOSITORY) throw new Error(`Reconciliation may run only in ${OBSERVABILITY_REPOSITORY}.`);
    const issues = parseSearch(executeGh([
        'api', '--method', 'GET', 'search/issues',
        '-f', `q=repo:${repository} is:issue author:app/github-actions in:title "${OBSERVABILITY_ISSUE_TITLE}"`,
        '-f', 'per_page=100'
    ]));
    const plan = planObservabilityIssue(result, issues);
    const body = [
        OBSERVABILITY_ISSUE_MARKER, '',
        'A scheduled check could not prove that deployment, production smoke, and recovery signals are healthy.', '',
        `Latest result: ${result}. Run: ${runUrl}`,
        `Runbook: ${runbookUrl}`
    ].join('\n');
    if (plan.action === 'create') {
        executeGh(['issue', 'create', '--repo', repository, '--assignee', 'pauljsnider', '--label', OBSERVABILITY_ISSUE_LABEL, '--title', OBSERVABILITY_ISSUE_TITLE, '--body', body]);
    } else if (plan.action === 'update') {
        executeGh(['issue', 'edit', String(plan.issueNumber), '--repo', repository, '--body', body]);
    } else if (plan.action === 'reopen') {
        executeGh(['issue', 'reopen', String(plan.issueNumber), '--repo', repository]);
        executeGh(['issue', 'edit', String(plan.issueNumber), '--repo', repository, '--body', body]);
    } else if (plan.action === 'close') {
        executeGh(['issue', 'close', String(plan.issueNumber), '--repo', repository, '--reason', 'completed', '--comment', `Critical signals recovered in ${runUrl}.`]);
    }
    return plan;
}

export function reconcileFromEnvironment(environment = process.env, dependencies = {}) {
    const required = (name) => {
        const value = String(environment[name] || '').trim();
        if (!value) throw new Error(`${name} is required.`);
        return value;
    };
    const result = required('VERIFY_RESULT');
    const repository = required('GITHUB_REPOSITORY');
    required('GH_TOKEN');
    const server = required('GITHUB_SERVER_URL').replace(/\/+$/, '');
    const runId = required('GITHUB_RUN_ID');
    return reconcileObservabilityIssue({
        result,
        repository,
        runUrl: `${server}/${repository}/actions/runs/${runId}`,
        runbookUrl: `${server}/${repository}/blob/master/docs/observability-runbook.md#critical-workflow-alert`
    }, dependencies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { reconcileFromEnvironment(); } catch (error) {
        console.error(`::error title=Observability incident reconciliation failed::${error?.message || 'Unknown reconciliation failure.'}`);
        process.exitCode = 1;
    }
}
