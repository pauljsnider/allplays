import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { SPEC_ONLY_LANE, classifyChangeImpact } from './classify-change-impact.mjs';

const trustedPaulBot = Object.freeze({
    id: 309595148,
    login: 'allplays-paulbot[bot]',
    type: 'Bot'
});

const successDescriptions = Object.freeze({
    full: 'Current-head review, review remediation, and CI passed',
    [SPEC_ONLY_LANE]: 'Spec-only review and required CI passed'
});

function isSha(value) {
    return /^[0-9a-f]{40}$/.test(String(value || ''));
}

function latestByUpdatedAt(values) {
    return [...values].sort((left, right) => (
        Date.parse(left?.updated_at || '') - Date.parse(right?.updated_at || '')
    )).at(-1);
}

function pullAssociationMatches(run, { prNumber, headBranch, headSha }) {
    const pulls = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
    // GitHub returns this association while a PR is open, but may return an
    // empty array after merge. When present, fail closed on ambiguity; when
    // absent, the immutable event/title/branch/SHA/workflow binding below is
    // the durable association.
    return pulls.length === 0 || (
        pulls.length === 1
        && pulls[0]?.number === prNumber
        && pulls[0]?.head?.sha === headSha
        && pulls[0]?.head?.ref === headBranch
        && pulls[0]?.base?.ref === 'master'
    );
}

function matchingWorkflowRuns(runs, { repository, prNumber, headBranch, headSha, path, title }) {
    return (runs?.workflow_runs || []).filter((run) => (
        Number.isInteger(run?.id)
        && run.id > 0
        && run?.status === 'completed'
        && run?.conclusion === 'success'
        && run?.event === 'pull_request'
        && run?.head_sha === headSha
        && run?.head_branch === headBranch
        && run?.head_repository?.full_name === repository
        && run?.path === path
        && run?.display_title === title
        && pullAssociationMatches(run, { prNumber, headBranch, headSha })
    ));
}

function requiredJobsPassed(runJobs, requiredNames) {
    const jobs = Array.isArray(runJobs?.jobs) ? runJobs.jobs : [];
    return requiredNames.every((name) => {
        const namedJobs = jobs.filter((job) => job?.name === name);
        return namedJobs.length === 1
            && namedJobs[0].status === 'completed'
            && namedJobs[0].conclusion === 'success';
    });
}

export function evaluateProductionValidationReuse({
    repository,
    mergeSha,
    pulls,
    mergeCommit,
    headCommit,
    pullFiles,
    prFastRuns,
    prIntegrationRuns,
    runJobs,
    statuses
}) {
    if (!repository || !isSha(mergeSha)) {
        return { reusable: false, reason: 'invalid repository or production SHA' };
    }

    const matchingPulls = (Array.isArray(pulls) ? pulls : []).filter((pull) => (
        pull?.state === 'closed'
        && pull?.merged_at
        && pull?.merge_commit_sha === mergeSha
        && pull?.base?.ref === 'master'
        && pull?.base?.repo?.full_name === repository
        && pull?.head?.repo?.full_name === repository
    ));
    if (matchingPulls.length !== 1) {
        return { reusable: false, reason: 'production SHA is not bound to exactly one merged same-repository PR' };
    }

    const pull = matchingPulls[0];
    const prNumber = Number(pull.number);
    const headSha = String(pull?.head?.sha || '');
    const headBranch = String(pull?.head?.ref || '');
    if (!Number.isInteger(prNumber) || prNumber <= 0 || !isSha(headSha) || !headBranch) {
        return { reusable: false, reason: 'merged PR identity is incomplete' };
    }
    if (mergeCommit?.sha !== mergeSha || headCommit?.sha !== headSha
        || !isSha(mergeCommit?.tree?.sha) || mergeCommit.tree.sha !== headCommit?.tree?.sha) {
        return { reusable: false, reason: 'production tree differs from the reviewed PR head' };
    }

    const fileRows = Array.isArray(pullFiles) ? pullFiles : [];
    const fileNames = fileRows.map((file) => file?.filename).filter((name) => typeof name === 'string');
    const uniqueFileNames = [...new Set(fileNames)];
    if (!Number.isInteger(pull?.changed_files)
        || pull.changed_files <= 0
        || fileRows.length !== pull.changed_files
        || uniqueFileNames.length !== pull.changed_files) {
        return { reusable: false, reason: 'complete merged PR file inventory is unavailable' };
    }
    const impactPaths = fileRows.flatMap((file) => [file?.filename, file?.previous_filename])
        .filter((name) => typeof name === 'string');
    const impact = classifyChangeImpact(impactPaths).lane;

    const runIdentity = { repository, prNumber, headBranch, headSha };
    const fastRun = matchingWorkflowRuns(prFastRuns, {
        ...runIdentity,
        path: '.github/workflows/pr-fast.yml',
        title: `pr-fast #${prNumber} -> master @ ${headSha}`
    }).find((run) => requiredJobsPassed(
        runJobs?.[run.id],
        ['change-impact', 'unit-tests', 'cache-bust-guard', 'app-quality']
    ));
    const integrationRun = matchingWorkflowRuns(prIntegrationRuns, {
        ...runIdentity,
        path: '.github/workflows/pr-integration.yml',
        title: `pr-integration #${prNumber} -> master @ ${headSha}`
    }).find((run) => requiredJobsPassed(
        runJobs?.[run.id],
        impact === SPEC_ONLY_LANE
            ? ['change-impact', 'mobile-build', 'preview-smoke']
            : [
                'change-impact',
                'regression-integration / firebase-rules-deploy-guard',
                'regression-integration / roster-chat-media-replay-smoke',
                'mobile-build',
                'preview-smoke'
            ]
    ));
    if (!fastRun || !integrationRun) {
        return { reusable: false, reason: 'exact PR-bound workflows and required jobs are incomplete' };
    }

    const expectedTarget = `https://github.com/${repository}/pull/${prNumber}`;
    const trustedStatusHistory = (Array.isArray(statuses) ? statuses : []).filter((status) => (
        status?.context === 'paulbot-review-gate'
        && status?.creator?.id === trustedPaulBot.id
        && status?.creator?.login === trustedPaulBot.login
        && status?.creator?.type === trustedPaulBot.type
        && status?.target_url === expectedTarget
    ));
    const paulBotStatus = latestByUpdatedAt(trustedStatusHistory);
    if (paulBotStatus?.state !== 'success' || paulBotStatus?.description !== successDescriptions[impact]) {
        return { reusable: false, reason: 'trusted PR-bound PaulBot approval is missing' };
    }

    const workflowCompletedAt = Math.max(
        Date.parse(fastRun.updated_at || ''),
        Date.parse(integrationRun.updated_at || '')
    );
    if (!Number.isFinite(workflowCompletedAt) || Date.parse(paulBotStatus.updated_at || '') < workflowCompletedAt) {
        return { reusable: false, reason: 'PaulBot approval predates exact-head workflow completion' };
    }

    return {
        reusable: true,
        reason: 'identical production tree has exact PR-bound workflow and trusted PaulBot validation',
        prNumber,
        headSha,
        impact
    };
}

function parseArgs(args) {
    const parsed = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument ${key || ''}`.trim());
        parsed[key.slice(2)] = value;
    }
    return parsed;
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = parseArgs(process.argv.slice(2));
    const result = evaluateProductionValidationReuse({
        repository: args.repository,
        mergeSha: args['merge-sha'],
        pulls: readJson(args.pulls),
        mergeCommit: readJson(args['merge-commit']),
        headCommit: readJson(args['head-commit']),
        pullFiles: readJson(args['pull-files']),
        prFastRuns: readJson(args['pr-fast-runs']),
        prIntegrationRuns: readJson(args['pr-integration-runs']),
        runJobs: readJson(args['run-jobs']),
        statuses: readJson(args.statuses)
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}
