#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const OBSERVABILITY_REPOSITORY = 'pauljsnider/allplays';
export const OBSERVABILITY_REF = 'refs/heads/master';
export const monitoredWorkflows = Object.freeze({
    deploy: 'deploy-prod.yml',
    smoke: 'post-deploy-smoke.yml',
    recovery: 'firestore-recovery-health.yml'
});
const maxPendingMs = 60 * 60 * 1000;
const maxRecoveryAgeMs = 9 * 60 * 60 * 1000;
const allowedStatuses = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']);

function assertRun(run) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('Workflow run entry is invalid.');
    if (!Number.isSafeInteger(run.id) || run.id < 1) throw new Error('Workflow run id is invalid.');
    if (!allowedStatuses.has(run.status)) throw new Error('Workflow run status is invalid.');
    if (run.conclusion != null && typeof run.conclusion !== 'string') throw new Error('Workflow run conclusion is invalid.');
    if (!/^[0-9a-f]{40}$/.test(String(run.head_sha || ''))) throw new Error('Workflow run head SHA is invalid.');
    const timestamp = Date.parse(run.updated_at || run.created_at);
    if (!Number.isFinite(timestamp)) throw new Error('Workflow run timestamp is invalid.');
    return { ...run, timestamp };
}

function normalizeRuns(response) {
    if (
        response == null
        || typeof response !== 'object'
        || Array.isArray(response)
        || !Number.isSafeInteger(response.total_count)
        || response.total_count < 0
        || !Array.isArray(response.workflow_runs)
        || response.workflow_runs.length > 20
        || response.total_count < response.workflow_runs.length
    ) {
        throw new Error('GitHub workflow run response is incomplete or invalid.');
    }
    return response.workflow_runs.map(assertRun);
}

function evaluateExactRun(name, runs, masterSha, nowMs) {
    const run = runs.find((candidate) => candidate.head_sha === masterSha);
    if (!run) return { name, healthy: false, state: 'missing', runId: null };
    const ageMs = nowMs - run.timestamp;
    if (ageMs < -5 * 60 * 1000) return { name, healthy: false, state: 'future_timestamp', runId: run.id };
    if (run.status !== 'completed') {
        return {
            name,
            healthy: ageMs <= maxPendingMs,
            state: ageMs <= maxPendingMs ? 'pending' : 'stalled',
            runId: run.id
        };
    }
    return {
        name,
        healthy: run.conclusion === 'success',
        state: run.conclusion === 'success' ? 'success' : `completed_${run.conclusion || 'unknown'}`,
        runId: run.id
    };
}

function evaluateRecovery(runs, nowMs) {
    const run = runs[0];
    if (!run) return { name: 'firestore-recovery', healthy: false, state: 'missing', runId: null };
    const ageMs = nowMs - run.timestamp;
    if (ageMs < -5 * 60 * 1000) {
        return { name: 'firestore-recovery', healthy: false, state: 'future_timestamp', runId: run.id };
    }
    if (run.status !== 'completed') {
        return {
            name: 'firestore-recovery',
            healthy: ageMs <= maxPendingMs,
            state: ageMs <= maxPendingMs ? 'pending' : 'stalled',
            runId: run.id
        };
    }
    const healthy = run.conclusion === 'success' && ageMs <= maxRecoveryAgeMs;
    return {
        name: 'firestore-recovery',
        healthy,
        state: run.conclusion !== 'success'
            ? `completed_${run.conclusion || 'unknown'}`
            : ageMs > maxRecoveryAgeMs ? 'stale' : 'success',
        runId: run.id
    };
}

export function evaluateCriticalWorkflowHealth({ now = new Date(), masterSha, deploy, smoke, recovery }) {
    if (!/^[0-9a-f]{40}$/.test(String(masterSha || ''))) throw new Error('Master SHA must be an exact commit SHA.');
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    if (!Number.isFinite(nowMs)) throw new Error('Current time is invalid.');

    const deploySignal = evaluateExactRun('production-deploy', normalizeRuns(deploy), masterSha, nowMs);
    let smokeSignal;
    if (deploySignal.state === 'pending') {
        smokeSignal = { name: 'production-smoke', healthy: true, state: 'waiting_for_deploy', runId: null };
    } else {
        smokeSignal = evaluateExactRun('production-smoke', normalizeRuns(smoke), masterSha, nowMs);
        if (deploySignal.state.startsWith('completed_') && smokeSignal.state === 'completed_skipped') {
            smokeSignal = { ...smokeSignal, state: 'blocked_by_failed_deploy' };
        }
    }
    const recoverySignal = evaluateRecovery(normalizeRuns(recovery), nowMs);
    const signals = [deploySignal, smokeSignal, recoverySignal];
    return { healthy: signals.every((signal) => signal.healthy), masterSha, signals };
}

export function formatCriticalWorkflowSummary(result) {
    const lines = [
        '## Critical workflow health',
        '',
        `- evaluated master: \`${result.masterSha}\``,
        ...result.signals.map((signal) => `- ${signal.name}: **${signal.state}**${signal.runId ? ` (run ${signal.runId})` : ''}`)
    ];
    const smokeSignal = result.signals.find((signal) => signal.name === 'production-smoke');
    const deploySignal = result.signals.find((signal) => signal.name === 'production-deploy');
    if (smokeSignal?.state === 'blocked_by_failed_deploy') {
        lines.push(`- remediation: fix failed production-deploy run ${deploySignal.runId}; production-smoke is blocked until deployment succeeds`);
    }
    return [...lines, ''].join('\n');
}

function required(environment, name) {
    const value = String(environment[name] || '').trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

export function runGh(args) {
    return execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024
    });
}

function loadWorkflowRuns(repository, workflowFile, event, executeGh) {
    let parsed;
    try {
        parsed = JSON.parse(executeGh([
            'api', '--method', 'GET', `repos/${repository}/actions/workflows/${workflowFile}/runs`,
            '-f', 'branch=master', '-f', `event=${event}`, '-F', 'per_page=20'
        ]));
    } catch (error) {
        throw new Error(`Unable to load ${workflowFile} runs.`, { cause: error });
    }
    return parsed;
}

function loadCurrentMasterSha(repository, executeGh) {
    let parsed;
    try {
        parsed = JSON.parse(executeGh([
            'api', '--method', 'GET', `repos/${repository}/git/ref/heads/master`
        ]));
    } catch (error) {
        throw new Error('Unable to resolve the current master ref.', { cause: error });
    }
    const sha = String(parsed?.object?.sha || '');
    if (parsed?.ref !== OBSERVABILITY_REF || parsed?.object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(sha)) {
        throw new Error('Current master ref response is invalid.');
    }
    return sha;
}

export function verifyCriticalWorkflowHealthFromEnvironment(environment = process.env, dependencies = {}) {
    const repository = required(environment, 'GITHUB_REPOSITORY');
    const ref = required(environment, 'GITHUB_REF');
    required(environment, 'GH_TOKEN');
    if (repository !== OBSERVABILITY_REPOSITORY) {
        throw new Error(`Critical workflow verification may run only in ${OBSERVABILITY_REPOSITORY}.`);
    }
    if (ref !== OBSERVABILITY_REF) {
        throw new Error(`Critical workflow verification may run only from ${OBSERVABILITY_REF}.`);
    }
    const executeGh = dependencies.executeGh || runGh;
    const masterSha = loadCurrentMasterSha(repository, executeGh);
    const result = evaluateCriticalWorkflowHealth({
        now: dependencies.now || new Date(),
        masterSha,
        deploy: loadWorkflowRuns(repository, monitoredWorkflows.deploy, 'push', executeGh),
        smoke: loadWorkflowRuns(repository, monitoredWorkflows.smoke, 'workflow_run', executeGh),
        recovery: loadWorkflowRuns(repository, monitoredWorkflows.recovery, 'schedule', executeGh)
    });

    console.log(JSON.stringify(result));
    const summaryPath = String(environment.GITHUB_STEP_SUMMARY || '').trim();
    if (summaryPath) {
        appendFileSync(summaryPath, formatCriticalWorkflowSummary(result), { encoding: 'utf8' });
    }
    if (!result.healthy) process.exitCode = 1;
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        verifyCriticalWorkflowHealthFromEnvironment();
    } catch (error) {
        console.error(`::error title=Critical workflow verification failed::${error?.message || 'Unknown verification failure.'}`);
        process.exitCode = 1;
    }
}
