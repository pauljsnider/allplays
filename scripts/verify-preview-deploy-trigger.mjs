import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PREVIEW_WORKFLOW_NAME = 'deploy-preview';
export const PREVIEW_WORKFLOW_PATH = '.github/workflows/deploy-preview.yml';
export const PREVIEW_ARTIFACT_NAME = 'firebase-preview-hosting-bundle';
export const MAX_PREVIEW_ARCHIVE_BYTES = 100 * 1024 * 1024;

function fail(message) {
    throw new Error(`Preview deploy trust check failed: ${message}`);
}

function requirePositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(`${label} must be a positive safe integer.`);
    }
    return value;
}

function requireSha(value, label) {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
        fail(`${label} must be a full lowercase Git commit SHA.`);
    }
    return value;
}

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        fail(`${label} is not valid JSON: ${error.message}`);
    }
}

export function verifyPreviewDeployTrigger({ event, run, pullRequest, artifacts }) {
    const repository = event?.repository?.full_name;
    if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        fail('event repository identity is invalid.');
    }

    const eventRun = event?.workflow_run;
    if (!eventRun || eventRun.name !== PREVIEW_WORKFLOW_NAME) {
        fail(`event must come from ${PREVIEW_WORKFLOW_NAME}.`);
    }
    if (eventRun.event !== 'pull_request' || eventRun.status !== 'completed' || eventRun.conclusion !== 'success') {
        fail('triggering workflow must be a completed successful pull_request run.');
    }

    const runId = requirePositiveInteger(eventRun.id, 'event workflow run ID');
    if (requirePositiveInteger(run?.id, 'API workflow run ID') !== runId) {
        fail('event and API workflow run IDs do not match.');
    }
    if (
        run.name !== PREVIEW_WORKFLOW_NAME
        || run.path !== PREVIEW_WORKFLOW_PATH
        || run.event !== 'pull_request'
        || run.status !== 'completed'
        || run.conclusion !== 'success'
    ) {
        fail('API workflow run identity, path, event, or conclusion is invalid.');
    }
    if (
        eventRun.repository?.full_name !== repository
        || eventRun.head_repository?.full_name !== repository
        || run.repository?.full_name !== repository
        || run.head_repository?.full_name !== repository
    ) {
        fail('triggering workflow and head repository must both match this repository.');
    }

    const eventHeadSha = requireSha(eventRun.head_sha, 'event head SHA');
    const runHeadSha = requireSha(run.head_sha, 'API workflow run head SHA');
    if (eventHeadSha !== runHeadSha) {
        fail('event and API workflow run head SHAs do not match.');
    }

    const eventPullRequests = eventRun.pull_requests;
    if (!Array.isArray(eventPullRequests) || eventPullRequests.length !== 1) {
        fail('triggering workflow must identify exactly one pull request.');
    }
    const prNumber = requirePositiveInteger(eventPullRequests[0]?.number, 'event pull-request number');
    if (requirePositiveInteger(pullRequest?.number, 'API pull-request number') !== prNumber) {
        fail('event and API pull-request numbers do not match.');
    }
    if (
        pullRequest.state !== 'open'
        || pullRequest.base?.repo?.full_name !== repository
        || pullRequest.head?.repo?.full_name !== repository
        || pullRequest.head?.sha !== runHeadSha
        || pullRequest.head?.ref !== run.head_branch
    ) {
        fail('pull request must remain open with a same-repository head matching the triggering run.');
    }

    const namedArtifacts = Array.isArray(artifacts?.artifacts)
        ? artifacts.artifacts.filter((artifact) => artifact?.name === PREVIEW_ARTIFACT_NAME)
        : [];
    if (namedArtifacts.length !== 1) {
        fail(`triggering run must contain exactly one ${PREVIEW_ARTIFACT_NAME} artifact.`);
    }
    const artifact = namedArtifacts[0];
    const artifactId = requirePositiveInteger(artifact.id, 'artifact ID');
    const artifactRunId = requirePositiveInteger(artifact.workflow_run?.id, 'artifact workflow run ID');
    if (artifactRunId !== runId) {
        fail('named artifact does not belong to the triggering run.');
    }
    if (artifact.expired !== false) {
        fail('named artifact is expired.');
    }
    const archiveBytes = requirePositiveInteger(artifact.size_in_bytes, 'artifact archive size');
    if (archiveBytes > MAX_PREVIEW_ARCHIVE_BYTES) {
        fail(`named artifact exceeds ${MAX_PREVIEW_ARCHIVE_BYTES} compressed bytes.`);
    }
    const expectedArchivePath = `/repos/${repository}/actions/artifacts/${artifactId}/zip`;
    try {
        const archiveUrl = new URL(artifact.archive_download_url);
        if (
            archiveUrl.protocol !== 'https:'
            || archiveUrl.username
            || archiveUrl.password
            || archiveUrl.hostname !== 'api.github.com'
            || archiveUrl.port
            || archiveUrl.pathname !== expectedArchivePath
            || archiveUrl.search
            || archiveUrl.hash
        ) {
            fail('named artifact archive URL does not match its verified GitHub artifact ID.');
        }
    } catch (error) {
        if (error?.message?.startsWith('Preview deploy trust check failed:')) throw error;
        fail('named artifact archive URL is invalid.');
    }

    return {
        artifactId,
        headSha: runHeadSha,
        prNumber,
        repository,
        runId
    };
}

function parseCliArgs(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (!key?.startsWith('--') || !value) {
            throw new Error('Expected --event, --run, --pull-request, --artifacts, and --output paths.');
        }
        options[key.slice(2)] = value;
    }
    for (const required of ['event', 'run', 'pull-request', 'artifacts', 'output']) {
        if (!options[required]) {
            throw new Error(`Missing required --${required} path.`);
        }
    }
    return options;
}

function appendWorkflowOutputs(outputPath, result) {
    fs.appendFileSync(
        outputPath,
        `artifact_id=${result.artifactId}\nhead_sha=${result.headSha}\npr_number=${result.prNumber}\n`,
        { encoding: 'utf8', mode: 0o600 }
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const options = parseCliArgs(process.argv.slice(2));
    const result = verifyPreviewDeployTrigger({
        event: readJson(options.event, 'workflow_run event'),
        run: readJson(options.run, 'workflow run response'),
        pullRequest: readJson(options['pull-request'], 'pull-request response'),
        artifacts: readJson(options.artifacts, 'artifact-list response')
    });
    appendWorkflowOutputs(options.output, result);
    console.log(`Verified trusted preview inputs for PR #${result.prNumber}.`);
}
