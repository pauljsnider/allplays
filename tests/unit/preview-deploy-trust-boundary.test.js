import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
    MAX_PREVIEW_ARCHIVE_BYTES,
    verifyPreviewDeployTrigger
} from '../../scripts/verify-preview-deploy-trigger.mjs';
import { stagePagesBundle } from '../../scripts/stage-pages-bundle.mjs';
import { writeFirebaseHostingConfig } from '../../scripts/write-firebase-hosting-config.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pullRequestWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'deploy-preview.yml'),
    'utf8'
);
const previewRequestWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'pr-preview.yml'),
    'utf8'
);
const trustedWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'deploy-preview-trusted.yml'),
    'utf8'
);
const postDeploySmokeWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'post-deploy-smoke.yml'),
    'utf8'
);
const scheduledProdSmokeWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'scheduled-prod-smoke.yml'),
    'utf8'
);
const extendedProductionSmoke = fs.readFileSync(
    path.join(repoRoot, 'tests', 'smoke', 'app-authenticated-extended.spec.js'),
    'utf8'
);
const imageWriteProductionSmoke = fs.readFileSync(
    path.join(repoRoot, 'tests', 'smoke', 'app-authenticated-image-writes.spec.js'),
    'utf8'
);
const trustBoundaryRunbook = fs.readFileSync(
    path.join(repoRoot, 'docs', 'preview-deploy-trust-boundary.md'),
    'utf8'
);
const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
const tempDirectories = [];

function validTriggerFixture() {
    const repository = 'pauljsnider/allplays';
    const runId = 29647460622;
    const prNumber = 4032;
    const headSha = 'dc655278753f7cdd3c7b3f4f9bc54deff999cdc4';
    return {
        event: {
            repository: { full_name: repository },
            workflow_run: {
                id: runId,
                name: 'pr-preview',
                display_title: `PR preview #${prNumber} @ ${headSha}`,
                event: 'workflow_dispatch',
                status: 'completed',
                conclusion: 'success',
                head_sha: 'ed4cc306a66cdf31c5672b965ebffc452bcbad2d',
                repository: { full_name: repository },
                head_repository: { full_name: repository },
                pull_requests: []
            }
        },
        run: {
            id: runId,
            name: 'pr-preview',
            display_title: `PR preview #${prNumber} @ ${headSha}`,
            path: '.github/workflows/pr-preview.yml',
            event: 'workflow_dispatch',
            status: 'completed',
            conclusion: 'success',
            head_sha: 'ed4cc306a66cdf31c5672b965ebffc452bcbad2d',
            head_branch: 'master',
            repository: { full_name: repository },
            head_repository: { full_name: repository }
        },
        pullRequest: {
            number: prNumber,
            state: 'open',
            draft: false,
            base: { repo: { full_name: repository } },
            head: {
                repo: { full_name: repository },
                ref: 'security/payment-authority-followup',
                sha: headSha
            }
        },
        artifacts: {
            artifacts: [{
                id: 50001,
                name: 'firebase-preview-hosting-bundle',
                expired: false,
                size_in_bytes: 1024,
                archive_download_url: 'https://api.github.com/repos/pauljsnider/allplays/actions/artifacts/50001/zip',
                workflow_run: { id: runId }
            }]
        }
    };
}

function makeTempDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'allplays-preview-trust-'));
    tempDirectories.push(directory);
    return directory;
}

function createZip(archivePath, entries) {
    const python = String.raw`
import json, os, stat, zipfile
entries = json.loads(os.environ['PREVIEW_ZIP_ENTRIES'])
with zipfile.ZipFile(os.environ['PREVIEW_ZIP_PATH'], 'w', zipfile.ZIP_DEFLATED) as archive:
    for entry in entries:
        if entry.get('type') == 'symlink':
            info = zipfile.ZipInfo(entry['name'])
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, entry.get('content', 'index.html'))
        else:
            archive.writestr(entry['name'], entry.get('content', 'content'))
`;
    const result = spawnSync('python3', ['-c', python], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PREVIEW_ZIP_ENTRIES: JSON.stringify(entries),
            PREVIEW_ZIP_PATH: archivePath
        }
    });
    expect(result.status, result.stderr).toBe(0);
}

function zipDirectory(sourcePath, archivePath) {
    const python = String.raw`
import os, zipfile
source = os.environ['PREVIEW_ZIP_SOURCE']
with zipfile.ZipFile(os.environ['PREVIEW_ZIP_PATH'], 'w', zipfile.ZIP_DEFLATED) as archive:
    for root, directories, files in os.walk(source):
        directories.sort()
        files.sort()
        for name in files:
            path = os.path.join(root, name)
            archive.write(path, os.path.relpath(path, source).replace(os.sep, '/'))
`;
    const result = spawnSync('python3', ['-c', python], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PREVIEW_ZIP_PATH: archivePath,
            PREVIEW_ZIP_SOURCE: sourcePath
        }
    });
    expect(result.status, result.stderr).toBe(0);
}

function writeFile(filePath, contents = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

function extractZip(entries) {
    const directory = makeTempDirectory();
    const archivePath = path.join(directory, 'artifact.zip');
    const destinationPath = path.join(directory, 'site');
    createZip(archivePath, entries);
    const result = spawnSync('python3', [
        path.join(repoRoot, 'scripts', 'extract-preview-hosting-artifact.py'),
        '--archive', archivePath,
        '--destination', destinationPath
    ], { encoding: 'utf8' });
    return { destinationPath, result };
}

afterEach(() => {
    while (tempDirectories.length) {
        fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
    }
});

describe('preview deployment workflow trust boundary', () => {
    it('keeps pull-request code completely outside the credentialed deploy job', () => {
        expect(pullRequestWorkflow).toContain('permissions: {}');
        expect(pullRequestWorkflow).not.toMatch(/\$\{\{\s*secrets\./);
        expect(pullRequestWorkflow).not.toContain('FIREBASE_SERVICE_ACCOUNT');
        expect(pullRequestWorkflow).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
        expect(pullRequestWorkflow).not.toContain('hosting:channel:deploy');
        expect(pullRequestWorkflow).not.toContain('write-firebase-hosting-config');
        expect(pullRequestWorkflow).not.toMatch(/^\s+\w[\w-]*:\s+write\s*$/m);
        expect(pullRequestWorkflow).toContain('name: firebase-preview-hosting-bundle');
        expect(pullRequestWorkflow).toContain('include-hidden-files: true');
        expect(pullRequestWorkflow).toContain('workflow_call:');
        expect(pullRequestWorkflow).not.toContain('pull_request:');
        expect(pullRequestWorkflow).not.toContain('  unit-tests:');
        expect(pullRequestWorkflow).not.toContain('external-claim');
    });

    it('builds the untrusted preview artifact only after an exact-head manual dispatch', () => {
        const parsedPreviewRequestWorkflow = parseYaml(previewRequestWorkflow);

        expect(previewRequestWorkflow).toContain('name: pr-preview');
        expect(previewRequestWorkflow).toContain('workflow_dispatch:');
        expect(parsedPreviewRequestWorkflow['run-name']).toBe(
            'PR preview #${{ inputs.pr_number }} @ ${{ inputs.head_sha }}'
        );
        expect(previewRequestWorkflow).toContain('group: pr-preview-${{ inputs.pr_number }}');
        expect(previewRequestWorkflow).toContain('cancel-in-progress: true');
        expect(previewRequestWorkflow).toContain('uses: ./.github/workflows/deploy-preview.yml');
    });

    it('runs the credentialed deploy only from trusted default-branch code', () => {
        const parsedTrustedWorkflow = parseYaml(trustedWorkflow);
        const classifyScript = parsedTrustedWorkflow.jobs['classify-trigger'].steps[0].run;

        expect(trustedWorkflow).toContain('workflow_run:');
        expect(trustedWorkflow).toContain('      - pr-preview');
        expect(trustedWorkflow).toContain('classify-trigger:');
        expect(trustedWorkflow).toContain('preview_ready: ${{ steps.classify.outputs.preview_ready }}');
        expect(trustedWorkflow).toContain('pull-requests: read');
        expect(trustedWorkflow).toContain('Preview dispatch is not bound to the current ready same-repository PR head.');
        expect(trustedWorkflow).toContain('actions/workflows/pr-integration.yml/runs');
        expect(trustedWorkflow).toContain('-f event=pull_request');
        expect(trustedWorkflow).toContain('-f status=success');
        expect(trustedWorkflow).toContain('-f head_sha="$expected_head_sha"');
        expect(classifyScript).toContain('actions/runs/$integration_run_id/jobs?filter=latest&per_page=100');
        expect(classifyScript).toContain('.name == "mobile-build"');
        expect(classifyScript).toContain('.name == "preview-smoke"');
        expect(classifyScript).toContain('.conclusion == "success"');
        expect(classifyScript).toContain('No exact-head pr-integration run has successful mobile-build and preview-smoke jobs.');
        expect(trustedWorkflow).toContain('WORKFLOW_DISPLAY_TITLE: ${{ github.event.workflow_run.display_title }}');
        expect(trustedWorkflow).toContain('Expected exactly one preview bundle');
        expect(trustedWorkflow).toContain("needs.classify-trigger.outputs.preview_ready == 'true'");
        expect(trustedWorkflow).toContain('name: firebase-preview-trusted');
        expect(trustedWorkflow).toContain('ref: ${{ github.event.repository.default_branch }}');
        expect(trustedWorkflow).toContain('persist-credentials: false');
        expect(trustedWorkflow).not.toContain('refs/pull/');
        expect(trustedWorkflow).not.toContain('github.event.workflow_run.head_sha');
        expect(trustedWorkflow).toMatch(/actions\/download-artifact@[0-9a-f]{40}/);
        expect(trustedWorkflow).not.toContain('hosting:channel:delete');
        expect(trustedWorkflow).not.toContain('hosting:channel:list');
        expect(trustedWorkflow).toContain('actions/runs/$WORKFLOW_RUN_ID/artifacts?per_page=100');
        expect(trustedWorkflow).toContain('actions/artifacts/$ARTIFACT_ID/zip');
        expect(trustedWorkflow).toContain('scripts/extract-preview-hosting-artifact.py');
        expect(trustedWorkflow).toContain('node scripts/write-firebase-hosting-config.mjs "$FIREBASE_PREVIEW_STAGE/site"');
        expect(trustedWorkflow).toContain('CURRENT_CHANNEL: pr-${{ needs.prepare-preview.outputs.pr_number }}');
        expect(trustedWorkflow).toContain('node "$firebase_cli" hosting:channel:deploy "$CURRENT_CHANNEL" --project game-flow-c6311');
        expect(trustedWorkflow).not.toContain('--no-authorized-domains');
        expect(trustedWorkflow).toContain('preview_deploy_hit_auth_domain_sync_error()');
        expect(trustedWorkflow).toContain('refusing to report a partially functional preview');
        expect(trustedWorkflow).toContain('find "$bundle/site" -type l');
        expect(trustedWorkflow).not.toContain('find "$bundle" -type l');
    });

    it('rejects a successful integration workflow whose stable jobs were only skipped', () => {
        const parsedTrustedWorkflow = parseYaml(trustedWorkflow);
        const classifyScript = parsedTrustedWorkflow.jobs['classify-trigger'].steps[0].run;
        const skippedDraftJobs = {
            jobs: [
                { name: 'mobile-build', status: 'completed', conclusion: 'skipped' },
                { name: 'preview-smoke', status: 'completed', conclusion: 'skipped' }
            ]
        };
        const successfulReadyJobs = {
            jobs: [
                { name: 'mobile-build', status: 'completed', conclusion: 'success' },
                { name: 'preview-smoke', status: 'completed', conclusion: 'success' }
            ]
        };
        const stableJobsSucceeded = ({ jobs }) => ['mobile-build', 'preview-smoke'].every(
            (name) => jobs.filter((job) => (
                job.name === name && job.status === 'completed' && job.conclusion === 'success'
            )).length === 1
        );

        expect(classifyScript).toContain('integration_jobs_succeeded=false');
        expect(classifyScript).toContain('if [ "$integration_jobs_succeeded" != "true" ]');
        expect(stableJobsSucceeded(skippedDraftJobs)).toBe(false);
        expect(stableJobsSucceeded(successfulReadyJobs)).toBe(true);
    });

    it('serializes trusted deployments by PR across different requested heads', () => {
        const parsedTrustedWorkflow = parseYaml(trustedWorkflow);
        const deployConcurrency = parsedTrustedWorkflow.jobs['deploy-preview'].concurrency;
        const firstRequest = validTriggerFixture();
        const secondRequest = validTriggerFixture();
        secondRequest.event.workflow_run.display_title =
            'PR preview #4032 @ 1111111111111111111111111111111111111111';
        const prNumberFromTitle = (title) => /^PR preview #(\d+) @ [0-9a-f]{40}$/.exec(title)?.[1];
        const resolveGroup = (request) => deployConcurrency.group.replace(
            '${{ needs.prepare-preview.outputs.pr_number }}',
            prNumberFromTitle(request.event.workflow_run.display_title)
        );

        expect(deployConcurrency).toEqual({
            group: 'trusted-preview-pr-${{ needs.prepare-preview.outputs.pr_number }}',
            'cancel-in-progress': true
        });
        expect(resolveGroup(firstRequest)).toBe('trusted-preview-pr-4032');
        expect(resolveGroup(secondRequest)).toBe(resolveGroup(firstRequest));
    });

    it('rechecks the exact pull-request head immediately before deploy and comment writes', () => {
        const deployStepIndex = trustedWorkflow.indexOf('name: Deploy fixed Firebase Hosting preview channel');
        const preDeployCheckIndex = trustedWorkflow.indexOf('firebase-preview-pre-deploy-pr.json');
        const deployWriteIndex = trustedWorkflow.indexOf('hosting:channel:deploy "$CURRENT_CHANNEL"');
        const commentStepIndex = trustedWorkflow.indexOf('name: Report preview URL on the still-current pull request');
        const commentDiscoveryIndex = trustedWorkflow.indexOf('comment_id="$(gh api --paginate');
        const preCommentCheckIndex = trustedWorkflow.indexOf('firebase-preview-pre-comment-pr.json');
        const commentWriteIndex = trustedWorkflow.indexOf('issues/comments/$comment_id');

        expect(preDeployCheckIndex).toBeGreaterThan(deployStepIndex);
        expect(deployWriteIndex).toBeGreaterThan(preDeployCheckIndex);
        expect(
            trustedWorkflow.slice(preDeployCheckIndex, deployWriteIndex)
        ).toContain('jq -e \'.state == "closed"\'');
        expect(
            trustedWorkflow.slice(preDeployCheckIndex, deployWriteIndex)
        ).toContain('skip_preview "The pull request closed before the trusted preview write');
        expect(preCommentCheckIndex).toBeGreaterThan(commentStepIndex);
        expect(preCommentCheckIndex).toBeGreaterThan(commentDiscoveryIndex);
        expect(commentWriteIndex).toBeGreaterThan(preCommentCheckIndex);
        expect(trustedWorkflow).toMatch(/recheck_current_head\n\s+if ! deploy_preview_channel/);
        expect(trustedWorkflow.slice(preCommentCheckIndex, commentWriteIndex)).toContain(
            'node scripts/verify-preview-deploy-trigger.mjs'
        );
        expect(trustedWorkflow.slice(preCommentCheckIndex, commentWriteIndex)).toContain(
            'grep -Fxq "head_sha=$EXPECTED_HEAD_SHA"'
        );
        expect(trustedWorkflow.slice(preCommentCheckIndex, commentWriteIndex)).toContain(
            'grep -Fxq "artifact_id=$EXPECTED_ARTIFACT_ID"'
        );
        expect(trustedWorkflow).toContain('Preview for commit `%s`: %s');
        expect(trustedWorkflow.match(/verify-preview-deploy-trigger\.mjs/g).length).toBeGreaterThanOrEqual(5);
    });

    it('keeps raw artifact validation and dependency installation outside the OIDC job', () => {
        const triggerIndex = trustedWorkflow.indexOf('node scripts/verify-preview-deploy-trigger.mjs');
        const downloadIndex = trustedWorkflow.indexOf('actions/artifacts/$ARTIFACT_ID/zip');
        const extractionIndex = trustedWorkflow.indexOf('python3 scripts/extract-preview-hosting-artifact.py');
        const configIndex = trustedWorkflow.indexOf('node scripts/write-firebase-hosting-config.mjs');
        const installIndex = trustedWorkflow.indexOf('firebase-tools@15.24.0');
        const recheckIndex = trustedWorkflow.indexOf('name: Re-verify current pull-request head before trusted handoff');
        const handoffIndex = trustedWorkflow.indexOf('name: Upload sanitized trusted deploy handoff');
        const credentialIndex = trustedWorkflow.indexOf('uses: google-github-actions/auth@');
        const deployIndex = trustedWorkflow.indexOf('hosting:channel:deploy');
        const cleanupIndex = trustedWorkflow.indexOf('name: Remove ephemeral Google credential file');
        const commentIndex = trustedWorkflow.indexOf('name: Report preview URL on the still-current pull request');

        expect(triggerIndex).toBeGreaterThan(-1);
        expect(downloadIndex).toBeGreaterThan(triggerIndex);
        expect(extractionIndex).toBeGreaterThan(downloadIndex);
        expect(configIndex).toBeGreaterThan(extractionIndex);
        expect(installIndex).toBeGreaterThan(configIndex);
        expect(recheckIndex).toBeGreaterThan(installIndex);
        expect(handoffIndex).toBeGreaterThan(recheckIndex);
        expect(credentialIndex).toBeGreaterThan(handoffIndex);
        expect(deployIndex).toBeGreaterThan(credentialIndex);
        expect(cleanupIndex).toBeGreaterThan(deployIndex);
        expect(commentIndex).toBeGreaterThan(cleanupIndex);
        expect(trustedWorkflow.slice(cleanupIndex, commentIndex)).toContain('if: always()');
        expect(trustedWorkflow.slice(0, credentialIndex)).toContain('permissions:\n      actions: read\n      contents: read\n      pull-requests: read');
        expect(trustedWorkflow.slice(credentialIndex)).not.toContain('npm install');
        expect(trustedWorkflow).toContain('id-token: write');
        expect(trustedWorkflow).toContain('workload_identity_provider: ${{ vars.FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER }}');
        expect(trustedWorkflow).toContain('service_account: ${{ vars.FIREBASE_DEPLOY_SERVICE_ACCOUNT }}');
        expect(trustedWorkflow).toContain('cleanup_credentials: true');
        expect(trustedWorkflow).not.toContain('secrets.FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311');
        expect(gitignore).toContain('gha-creds-*.json');
    });

    it('pins every third-party action used by both preview workflows', () => {
        for (const workflow of [
            pullRequestWorkflow,
            trustedWorkflow,
            postDeploySmokeWorkflow,
            scheduledProdSmokeWorkflow
        ]) {
            const uses = [...workflow.matchAll(/^\s*uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
            expect(uses.length).toBeGreaterThan(0);
            for (const action of uses) {
                expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
            }
        }
    });

    it('keeps production smoke credentials in a protected trusted environment', () => {
        for (const workflow of [postDeploySmokeWorkflow, scheduledProdSmokeWorkflow]) {
            expect(workflow).toContain('name: production-smoke');
            expect(workflow).toContain('permissions:\n  contents: read');
            expect(workflow).toContain('persist-credentials: false');
            expect(workflow).toContain('SMOKE_AUTH_EMAIL: ${{ secrets.SMOKE_AUTH_EMAIL }}');
            expect(workflow).toContain('SMOKE_AUTH_PASSWORD: ${{ secrets.SMOKE_AUTH_PASSWORD }}');
            expect(workflow).toContain('SMOKE_STAFF_EMAIL: ${{ secrets.SMOKE_STAFF_EMAIL }}');
            expect(workflow).toContain('SMOKE_STAFF_PASSWORD: ${{ secrets.SMOKE_STAFF_PASSWORD }}');
            expect(workflow).toContain('SMOKE_PARENT_EMAIL: ${{ secrets.SMOKE_PARENT_EMAIL }}');
            expect(workflow).toContain('SMOKE_PARENT_PASSWORD: ${{ secrets.SMOKE_PARENT_PASSWORD }}');
            expect(workflow).not.toContain('pull_request:');
            expect(workflow).not.toMatch(/^\s+\w[\w-]*:\s+write\s*$/m);
        }
        expect(postDeploySmokeWorkflow).toContain("github.event.workflow_run.head_branch == 'master'");
        expect(postDeploySmokeWorkflow).toContain('workflows:\n      - deploy-prod');
        expect(scheduledProdSmokeWorkflow).toContain('ref: master');
    });

    it('limits scheduled production browser smoke to one nightly run', () => {
        expect(scheduledProdSmokeWorkflow).toContain("cron: '23 7 * * *'");
        expect(scheduledProdSmokeWorkflow).not.toContain("cron: '*/15 * * * *'");
        expect(scheduledProdSmokeWorkflow).toContain('cancel-in-progress: false');
        expect(scheduledProdSmokeWorkflow).toContain(
            'SMOKE_EXTENDED_WRITES: ${{ vars.SMOKE_EXTENDED_WRITES_ENABLED }}'
        );
        expect(scheduledProdSmokeWorkflow).not.toContain("SMOKE_EXTENDED_WRITES: '1'");
    });

    it('verifies and removes chat notifications in the same reversible smoke workflow', () => {
        const staffWorkflowStart = extendedProductionSmoke.indexOf(
            "test('staff smoke writes are deterministic and removed after validation'"
        );
        const parentWorkflowStart = extendedProductionSmoke.indexOf(
            "test('parent smoke writes restore or remove every touched record'"
        );
        const staffWorkflow = extendedProductionSmoke.slice(staffWorkflowStart, parentWorkflowStart);

        expect(staffWorkflowStart).toBeGreaterThanOrEqual(0);
        expect(parentWorkflowStart).toBeGreaterThan(staffWorkflowStart);
        expect(staffWorkflow).toContain("recordType: 'chat-notification'");
        expect(staffWorkflow).toContain('`users/${parentRestSession.localId}/notificationInbox`');
        expect(staffWorkflow).toContain("category: 'liveChat'");
        expect(staffWorkflow).toContain('body: chatText');
        const notificationAssertion = staffWorkflow.indexOf('const messageDeepLink');
        const cleanupCall = staffWorkflow.indexOf('await runSmokeCleanup(runId, cleanupTasks)');
        expect(notificationAssertion).toBeGreaterThanOrEqual(0);
        expect(cleanupCall).toBeGreaterThan(notificationAssertion);
    });

    it('keeps production image writes isolated and always schedules cleanup', () => {
        const staffWorkflowStart = extendedProductionSmoke.indexOf(
            "test('staff smoke writes are deterministic and removed after validation'"
        );
        const imageWorkflowStart = imageWriteProductionSmoke.indexOf(
            "test('staff image upload is persisted and removed after validation'"
        );
        const profileImageWorkflowStart = imageWriteProductionSmoke.indexOf(
            "test('profile image paths accept authenticated storage and document writes'"
        );
        const parentWorkflowStart = extendedProductionSmoke.indexOf(
            "test('parent smoke writes restore or remove every touched record'"
        );
        const staffWorkflow = extendedProductionSmoke.slice(staffWorkflowStart, parentWorkflowStart);
        const imageWorkflow = imageWriteProductionSmoke.slice(imageWorkflowStart, profileImageWorkflowStart);
        const profileImageWorkflow = imageWriteProductionSmoke.slice(profileImageWorkflowStart);
        const reconciliationWorkflow = imageWriteProductionSmoke.slice(
            imageWriteProductionSmoke.indexOf('async function reconcileDedicatedImageFixture'),
            imageWorkflowStart
        );

        expect(staffWorkflowStart).toBeGreaterThanOrEqual(0);
        expect(parentWorkflowStart).toBeGreaterThan(staffWorkflowStart);
        expect(imageWorkflowStart).toBeGreaterThanOrEqual(0);
        expect(profileImageWorkflowStart).toBeGreaterThan(imageWorkflowStart);
        expect(staffWorkflow).toContain('section[aria-label="Manage schedule tools"]');
        expect(staffWorkflow).toContain("locator('button[aria-controls]').first()");
        expect(staffWorkflow).toContain('manageSchedule.click({ timeout: 25_000 })');
        expect(staffWorkflow).toContain("toHaveAttribute('aria-expanded', 'true'");
        expect(staffWorkflow).not.toContain('input[type="file"][accept="image/*"]');
        expect(imageWriteProductionSmoke).not.toContain("test.describe.configure({ mode: 'serial' })");
        expect(scheduledProdSmokeWorkflow).toContain('tests/smoke/app-authenticated-image-writes.spec.js');
        expect(imageWorkflow).toContain("recordType: 'team-media'");
        expect(imageWorkflow).toContain('input[type="file"][accept="image/*"]');
        expect(imageWorkflow).toContain("getByText('Uploaded', { exact: true })");
        expect(imageWorkflow).toContain("getByText('Media item deleted.')");
        expect(imageWorkflow).toContain('await runSmokeCleanup(runId, cleanupTasks)');
        expect(profileImageWorkflow).toContain('profile-photos/users/${staffRestSession.localId}/');
        expect(profileImageWorkflow).toContain('profile-photos/teams/${config.teamId}/players/${config.playerId}/');
        expect(imageWriteProductionSmoke).toContain("import { randomUUID } from 'node:crypto';");
        expect(imageWriteProductionSmoke).toContain("const attemptNonce = randomUUID().replace(/-/g, '');");
        expect(profileImageWorkflow).toContain('players/${config.playerId}/private/profile');
        expect(profileImageWorkflow).toContain('allowMissing: true');
        expect(profileImageWorkflow).toContain('removeIfCreated: true');
        expect(profileImageWorkflow).toContain('cleanupRestSession: staffRestSession');
        expect(profileImageWorkflow).toContain('restSession: parentRestSession');
        expect(imageWriteProductionSmoke).toContain('SMOKE_PARENT_EMAIL: config.parentEmail');
        expect(profileImageWorkflow).toContain('uploadFirebaseStorageObject(');
        expect(profileImageWorkflow).toContain('patchFirestoreDocumentFields(');
        expect(profileImageWorkflow).toContain('createFirestoreDocument(');
        expect(imageWriteProductionSmoke).toContain('deleteFirestoreDocument(');
        expect(imageWriteProductionSmoke).toContain('Object.keys(createdDocument.fields || {})');
        expect(reconciliationWorkflow).toContain('Existing fixture metadata is a real');
        expect(reconciliationWorkflow).toContain('isEmptyFirestoreDocument(cleanupDocument)');
        expect(reconciliationWorkflow).toContain('updateTime: cleanupDocument.updateTime');
        expect(reconciliationWorkflow).not.toContain('deleteFirebaseStorageObject(');
        expect(profileImageWorkflow).toContain('restoreImageFieldsIfUnchanged(');
        expect(profileImageWorkflow).toContain('await reconcileDedicatedImageFixture(target)');
        expect(imageWriteProductionSmoke).toContain('isAbandonedSmokeImageValue');
        expect(imageWriteProductionSmoke).toContain('must have an empty ${fieldName} baseline');
        expect(imageWriteProductionSmoke).toContain('restoreFirestoreDocumentFields(');
        expect(imageWriteProductionSmoke).toContain('{ updateTime: currentDocument.updateTime }');
        expect(profileImageWorkflow).toContain('deleteFirebaseStorageObject(');
        expect(profileImageWorkflow.indexOf('patchFirestoreDocumentFields(')).toBeLessThan(
            profileImageWorkflow.indexOf('uploadFirebaseStorageObject(')
        );
        expect(profileImageWorkflow.indexOf('restoreImageFieldsIfUnchanged(documentState)')).toBeLessThan(
            profileImageWorkflow.indexOf('deleteFirebaseStorageObject(')
        );
        expect(profileImageWorkflow.slice(
            profileImageWorkflow.indexOf('deleteFirebaseStorageObject(')
        )).not.toContain('restoreImageFieldsIfUnchanged(documentState)');
        expect(profileImageWorkflow).toContain(
            'const safeDocumentPhotoUrl = `https://allplays.ai/img/logo_small.png?smoke=${attemptNonce}`;'
        );
        expect(profileImageWorkflow).not.toContain('firebasestorage.googleapis.com');
        expect(profileImageWorkflow).toContain('photoUrl: { stringValue: safeDocumentPhotoUrl }');
        expect(profileImageWorkflow).toContain('await runSmokeCleanup(runId, cleanupTasks)');
    });

    it('documents the keyless credential and exact-head operational contract', () => {
        expect(trustBoundaryRunbook).toContain('must remain absent');
        expect(trustBoundaryRunbook).toContain('firebase-preview-trusted');
        expect(trustBoundaryRunbook).toContain('production-smoke');
        expect(trustBoundaryRunbook).toContain('SMOKE_AUTH_EMAIL');
        expect(trustBoundaryRunbook).toContain('protected/default-branch-only deployment policy');
        expect(trustBoundaryRunbook).toContain('serialized and cancelable per PR');
        expect(trustBoundaryRunbook).toContain('immediately before the Firebase channel write');
        expect(trustBoundaryRunbook).toContain('Any new commit invalidates prior review evidence.');
        expect(trustBoundaryRunbook).toContain('Cloud Audit Logs for the old key ID');
        expect(trustBoundaryRunbook).toContain('Workload Identity Federation');
        expect(trustBoundaryRunbook).toContain('FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER');
        expect(trustBoundaryRunbook).toContain('FIREBASE_DEPLOY_SERVICE_ACCOUNT');
        expect(trustBoundaryRunbook).toContain('exact workflow_ref');
        expect(trustBoundaryRunbook).toContain('allplaysPreviewAuthDomainUpdater');
        expect(trustBoundaryRunbook).toContain('`firebaseauth.configs.get` and `firebaseauth.configs.update`');
        expect(trustBoundaryRunbook).toContain('Do not replace it with Identity Platform Admin');
    });
});

describe('preview deployment trigger verification', () => {
    it('accepts an exact same-repository run, pull request head, and named artifact', () => {
        expect(verifyPreviewDeployTrigger(validTriggerFixture())).toEqual({
            artifactId: 50001,
            headSha: 'dc655278753f7cdd3c7b3f4f9bc54deff999cdc4',
            prNumber: 4032,
            repository: 'pauljsnider/allplays',
            runId: 29647460622
        });
    });

    it('rejects fork identity, stale pull-request heads, and unsuccessful runs', () => {
        const forkFixture = validTriggerFixture();
        forkFixture.run.head_repository.full_name = 'attacker/allplays';
        expect(() => verifyPreviewDeployTrigger(forkFixture)).toThrow(/head repository must both match/);

        const staleFixture = validTriggerFixture();
        staleFixture.pullRequest.head.sha = '1111111111111111111111111111111111111111';
        expect(() => verifyPreviewDeployTrigger(staleFixture)).toThrow(/head matching the triggering run/);

        const failedFixture = validTriggerFixture();
        failedFixture.event.workflow_run.conclusion = 'failure';
        expect(() => verifyPreviewDeployTrigger(failedFixture)).toThrow(/completed successful/);
    });

    it('rejects duplicate, expired, cross-run, and oversized named artifacts', () => {
        const duplicateFixture = validTriggerFixture();
        duplicateFixture.artifacts.artifacts.push({ ...duplicateFixture.artifacts.artifacts[0], id: 50002 });
        expect(() => verifyPreviewDeployTrigger(duplicateFixture)).toThrow(/exactly one/);

        const expiredFixture = validTriggerFixture();
        expiredFixture.artifacts.artifacts[0].expired = true;
        expect(() => verifyPreviewDeployTrigger(expiredFixture)).toThrow(/expired/);

        const crossRunFixture = validTriggerFixture();
        crossRunFixture.artifacts.artifacts[0].workflow_run.id += 1;
        expect(() => verifyPreviewDeployTrigger(crossRunFixture)).toThrow(/does not belong/);

        const oversizedFixture = validTriggerFixture();
        oversizedFixture.artifacts.artifacts[0].size_in_bytes = MAX_PREVIEW_ARCHIVE_BYTES + 1;
        expect(() => verifyPreviewDeployTrigger(oversizedFixture)).toThrow(/exceeds/);
    });

    it('binds the archive URL to the verified GitHub host, repository, and artifact ID', () => {
        for (const archiveUrl of [
            'https://api.github.com/repos/attacker/allplays/actions/artifacts/50001/zip',
            'https://api.github.com/repos/pauljsnider/allplays/actions/artifacts/99999/zip',
            'https://api.github.com.evil.example/repos/pauljsnider/allplays/actions/artifacts/50001/zip',
            'https://:@api.github.com/repos/pauljsnider/allplays/actions/artifacts/50001/zip',
            'https://@api.github.com/repos/pauljsnider/allplays/actions/artifacts/50001/zip',
            'https://api.github.com/repos/pauljsnider/allplays/actions/artifacts/50001/zip?redirect=evil'
        ]) {
            const fixture = validTriggerFixture();
            fixture.artifacts.artifacts[0].archive_download_url = archiveUrl;
            expect(() => verifyPreviewDeployTrigger(fixture)).toThrow(/archive URL/);
        }
    });
});

describe('preview Hosting archive validation', () => {
    const requiredEntries = [
        { name: '.nojekyll', content: '' },
        { name: 'index.html', content: '<html>legacy</html>' },
        { name: 'app/index.html', content: '<html>app</html>' }
    ];

    it('extracts a bounded regular-file Hosting tree', () => {
        const { destinationPath, result } = extractZip([
            ...requiredEntries,
            { name: 'js/app.js', content: 'console.log("preview")' }
        ]);

        expect(result.status, result.stderr).toBe(0);
        expect(fs.readFileSync(path.join(destinationPath, 'app', 'index.html'), 'utf8')).toContain('app');
        expect(result.stdout).toContain('Validated and extracted 4 Hosting files');
    });

    it('rejects traversal paths', () => {
        const traversal = extractZip([...requiredEntries, { name: '../escape.txt', content: 'escape' }]);
        expect(traversal.result.status).not.toBe(0);
        expect(traversal.result.stderr).toContain('ambiguous or traversing path');
    });

    it('rejects archive symlinks', () => {
        const symlink = extractZip([...requiredEntries, {
            name: 'linked-index.html',
            type: 'symlink',
            content: 'index.html'
        }]);
        expect(symlink.result.status).not.toBe(0);
        expect(symlink.result.stderr).toContain('symlink or special file');
    });

    it('rejects Firebase deploy configuration from the artifact', () => {
        const config = extractZip([...requiredEntries, { name: 'firebase.json', content: '{}' }]);
        expect(config.result.status).not.toBe(0);
        expect(config.result.stderr).toContain('forbidden root path firebase.json');
    });

    it('rejects unexpected hidden deployment configuration', () => {
        const hiddenConfig = extractZip([...requiredEntries, { name: '.firebaserc', content: '{}' }]);
        expect(hiddenConfig.result.status).not.toBe(0);
        expect(hiddenConfig.result.stderr).toContain('unexpected hidden path .firebaserc');
    });

    it('cannot follow a destination-directory symlink inserted after emptiness validation', () => {
        const directory = makeTempDirectory();
        const archivePath = path.join(directory, 'artifact.zip');
        const destinationPath = path.join(directory, 'site');
        const escapePath = path.join(directory, 'escape');
        createZip(archivePath, [
            ...requiredEntries,
            { name: 'js/app.js', content: 'console.log("must stay contained")' }
        ]);

        const python = String.raw`
import importlib.util
import os
from pathlib import Path

module_path = Path(os.environ['PREVIEW_EXTRACTOR_PATH'])
spec = importlib.util.spec_from_file_location('preview_extractor', module_path)
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)

archive = Path(os.environ['PREVIEW_ZIP_PATH'])
destination = Path(os.environ['PREVIEW_DESTINATION_PATH'])
escape = Path(os.environ['PREVIEW_ESCAPE_PATH'])
original_ensure = extractor.ensure_empty_destination

def inject_symlink_after_validation(path):
    original_ensure(path)
    escape.mkdir()
    (path / 'js').symlink_to(escape, target_is_directory=True)

extractor.ensure_empty_destination = inject_symlink_after_validation
try:
    extractor.extract_archive(archive, destination)
except extractor.ArtifactValidationError as error:
    if (escape / 'app.js').exists():
        raise SystemExit('extractor wrote through the injected directory symlink')
    print(error)
else:
    raise SystemExit('extractor accepted an injected directory symlink')
`;
        const result = spawnSync('python3', ['-c', python], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PREVIEW_DESTINATION_PATH: destinationPath,
                PREVIEW_ESCAPE_PATH: escapePath,
                PREVIEW_EXTRACTOR_PATH: path.join(repoRoot, 'scripts', 'extract-preview-hosting-artifact.py'),
                PREVIEW_ZIP_PATH: archivePath,
                PYTHONDONTWRITEBYTECODE: '1'
            }
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('without following links');
        expect(fs.existsSync(path.join(escapePath, 'app.js'))).toBe(false);
    });

    it('requires the exact staged Hosting artifact shape', () => {
        const missingApp = extractZip(requiredEntries.filter((entry) => entry.name !== 'app/index.html'));
        expect(missingApp.result.status).not.toBe(0);
        expect(missingApp.result.stderr).toContain('missing required Hosting files: app/index.html');

        const unpublishedClaim = extractZip([
            ...requiredEntries,
            { name: '.well-known/assetlinks.json', content: '[]' }
        ]);
        expect(unpublishedClaim.result.status).not.toBe(0);
        expect(unpublishedClaim.result.stderr).toContain('unpublished public association claim');
    });

    it('accepts the real stage-to-ZIP shape and generates config only from trusted source', () => {
        const directory = makeTempDirectory();
        const trustedRoot = path.join(directory, 'trusted-default-branch');
        const stagedSite = path.join(directory, 'staged-site');
        const archivePath = path.join(directory, 'artifact.zip');
        const extractedSite = path.join(directory, 'extracted-site');
        const generatedConfig = path.join(directory, 'trusted-preview.generated.json');
        const originalSiteKey = process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY;
        const originalEnforcement = process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY;

        writeFile(path.join(trustedRoot, 'index.html'), '<html><head></head><body>legacy</body></html>');
        writeFile(path.join(trustedRoot, 'apps', 'app', 'dist', 'index.html'), '<html><head></head><body>app</body></html>');
        writeFile(path.join(trustedRoot, '.well-known', 'apple-app-site-association'), '{"placeholder":true}');
        writeFile(path.join(trustedRoot, '.well-known', 'assetlinks.json'), '[]');
        writeFile(path.join(trustedRoot, 'firebase.json'), JSON.stringify({
            hosting: {
                site: 'game-flow-c6311',
                public: '.',
                ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
                headers: [
                    {
                        source: '**',
                        headers: [
                            { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
                            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
                        ]
                    },
                    {
                        source: '/widget-scoreboard.html',
                        headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" }]
                    }
                ]
            }
        }));

        try {
            process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY = 'public-preview-site-key_123';
            process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY = 'true';
            stagePagesBundle(stagedSite, { rootDir: trustedRoot });
        } finally {
            if (originalSiteKey === undefined) delete process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY;
            else process.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY = originalSiteKey;
            if (originalEnforcement === undefined) delete process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY;
            else process.env.ALLPLAYS_APP_CHECK_ENFORCEMENT_READY = originalEnforcement;
        }

        expect(fs.existsSync(path.join(stagedSite, '.well-known', 'apple-app-site-association'))).toBe(false);
        expect(fs.existsSync(path.join(stagedSite, '.well-known', 'assetlinks.json'))).toBe(false);
        expect(fs.existsSync(path.join(stagedSite, 'firebase.json'))).toBe(false);

        zipDirectory(stagedSite, archivePath);
        const extraction = spawnSync('python3', [
            path.join(repoRoot, 'scripts', 'extract-preview-hosting-artifact.py'),
            '--archive', archivePath,
            '--destination', extractedSite
        ], { encoding: 'utf8' });
        expect(extraction.status, extraction.stderr).toBe(0);

        writeFirebaseHostingConfig(extractedSite, generatedConfig, { rootDir: trustedRoot });
        const config = JSON.parse(fs.readFileSync(generatedConfig, 'utf8'));
        expect(config.hosting.site).toBe('game-flow-c6311');
        expect(config.hosting.public).toBe(path.resolve(extractedSite));
        expect(config.hosting.ignore).not.toContain('**/.*');
        expect(fs.existsSync(path.join(extractedSite, 'firebase.json'))).toBe(false);
        expect(JSON.parse(
            fs.readFileSync(path.join(extractedSite, '.well-known', 'allplays-runtime-config.json'), 'utf8')
        )).toMatchObject({
            appCheck: {
                enabled: true,
                recaptchaEnterpriseSiteKey: 'public-preview-site-key_123',
                isTokenAutoRefreshEnabled: true
            }
        });
    });
});
