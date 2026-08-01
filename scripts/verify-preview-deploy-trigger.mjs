import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PREVIEW_WORKFLOW_NAME = 'pr-preview';
export const PREVIEW_WORKFLOW_PATH = '.github/workflows/pr-preview.yml';
export const PREVIEW_ARTIFACT_NAME = 'firebase-preview-hosting-bundle';
export const MAX_PREVIEW_ARCHIVE_BYTES = 100 * 1024 * 1024;
const PREVIEW_DISPLAY_TITLE_PATTERN = /^PR preview #([1-9][0-9]*) @ ([0-9a-f]{40})$/;

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
    if (eventRun.event !== 'workflow_dispatch' || eventRun.status !== 'completed' || eventRun.conclusion !== 'success') {
        fail('triggering workflow must be a completed successful workflow_dispatch run.');
    }

    const runId = requirePositiveInteger(eventRun.id, 'event workflow run ID');
    if (requirePositiveInteger(run?.id, 'API workflow run ID') !== runId) {
        fail('event and API workflow run IDs do not match.');
    }
    if (
        run.name !== PREVIEW_WORKFLOW_NAME
        || run.path !== PREVIEW_WORKFLOW_PATH
        || run.event !== 'workflow_dispatch'
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

    const eventRunSha = requireSha(eventRun.head_sha, 'event workflow SHA');
    const apiRunSha = requireSha(run.head_sha, 'API workflow run SHA');
    if (eventRunSha !== apiRunSha) {
        fail('event and API workflow run head SHAs do not match.');
    }

    if (eventRun.display_title !== run.display_title) {
        fail('event and API workflow display titles do not match.');
    }
    const displayIdentity = PREVIEW_DISPLAY_TITLE_PATTERN.exec(eventRun.display_title || '');
    if (!displayIdentity) {
        fail('workflow display title must bind one pull request and exact head SHA.');
    }
    const prNumber = requirePositiveInteger(Number(displayIdentity[1]), 'display-title pull-request number');
    const previewHeadSha = requireSha(displayIdentity[2], 'display-title pull-request head SHA');
    if (requirePositiveInteger(pullRequest?.number, 'API pull-request number') !== prNumber) {
        fail('event and API pull-request numbers do not match.');
    }
    if (
        pullRequest.state !== 'open'
        || pullRequest.draft !== false
        || pullRequest.base?.repo?.full_name !== repository
        || pullRequest.head?.repo?.full_name !== repository
        || pullRequest.head?.sha !== previewHeadSha
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
    const expectedArchiveUrl = `https://api.github.com${expectedArchivePath}`;
    if (artifact.archive_download_url !== expectedArchiveUrl) {
        fail('named artifact archive URL does not exactly match its verified GitHub artifact ID.');
    }

    return {
        artifactId,
        headSha: previewHeadSha,
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
