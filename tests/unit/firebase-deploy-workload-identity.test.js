import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

function read(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const production = read('.github/workflows/deploy-prod.yml');
const preview = read('.github/workflows/deploy-preview-trusted.yml');

function workflowJobs(source) {
    return Object.values(parseYaml(source).jobs);
}

function expectPinnedActions(workflow) {
    const actions = [...workflow.matchAll(/^\s*uses:\s+([^\s#]+)/gm)].map((match) => match[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
        expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
}

describe('Firebase deploy Workload Identity boundary', () => {
    it('uses only pinned keyless authentication in both credentialed deployers', () => {
        for (const workflow of [production, preview]) {
            expectPinnedActions(workflow);
            expect(workflow).toContain('id-token: write');
            expect(workflow).toMatch(/google-github-actions\/auth@[0-9a-f]{40}/);
            expect(workflow).toContain('workload_identity_provider: ${{ vars.FIREBASE_DEPLOY_WORKLOAD_IDENTITY_PROVIDER }}');
            expect(workflow).toContain('service_account: ${{ vars.FIREBASE_DEPLOY_SERVICE_ACCOUNT }}');
            expect(workflow).toContain('project_id: game-flow-c6311');
            expect(workflow).toContain('create_credentials_file: true');
            expect(workflow).toContain('cleanup_credentials: true');
            expect(workflow).not.toContain('secrets.FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311');
            expect(workflow).not.toMatch(/credentials_json\s*:/i);
            expect(workflow).not.toMatch(/^\s*GOOGLE_APPLICATION_CREDENTIALS\s*:\s*\S+/m);
        }
        expect(production.match(/google-github-actions\/auth@[0-9a-f]{40}/g)).toHaveLength(2);
        expect(preview.match(/google-github-actions\/auth@[0-9a-f]{40}/g)).toHaveLength(1);
    });

    it('keeps raw preview input and dependency preparation in a separate no-OIDC job', () => {
        const archiveCheck = preview.indexOf('python3 scripts/extract-preview-hosting-artifact.py');
        const trustedConfig = preview.indexOf('node scripts/write-firebase-hosting-config.mjs');
        const install = preview.indexOf('firebase-tools@15.24.0');
        const exactHeadCheck = preview.indexOf('name: Re-verify current pull-request head before trusted handoff');
        const handoff = preview.indexOf('name: Upload sanitized trusted deploy handoff');
        const authentication = preview.indexOf('uses: google-github-actions/auth@');
        const deployStep = preview.indexOf('name: Deploy fixed Firebase Hosting preview channel');
        const deploy = preview.indexOf('hosting:channel:deploy "$CURRENT_CHANNEL"');
        const cleanup = preview.indexOf('name: Remove ephemeral Google credential file');
        const comment = preview.indexOf('name: Report preview URL on the still-current pull request');

        expect(archiveCheck).toBeGreaterThan(-1);
        expect(trustedConfig).toBeGreaterThan(archiveCheck);
        expect(install).toBeGreaterThan(trustedConfig);
        expect(exactHeadCheck).toBeGreaterThan(install);
        expect(handoff).toBeGreaterThan(exactHeadCheck);
        expect(authentication).toBeGreaterThan(handoff);
        expect(deploy).toBeGreaterThan(authentication);
        expect(cleanup).toBeGreaterThan(deploy);
        expect(comment).toBeGreaterThan(cleanup);
        const oidcJobs = workflowJobs(preview).filter((job) => job.permissions?.['id-token'] === 'write');
        expect(oidcJobs).toHaveLength(1);
        expect(JSON.stringify(oidcJobs[0])).not.toMatch(/npm (?:ci|install)|extract-preview-hosting-artifact|write-firebase-hosting-config/);
        expect(JSON.stringify(oidcJobs[0])).toMatch(/actions\/download-artifact@[0-9a-f]{40}/);
        expect(preview.slice(authentication, deployStep)).not.toContain('- name:');
        expect(preview.slice(deployStep, cleanup)).toContain('timeout-minutes: 4');
    });

    it('keeps production build and dependency work outside the minimal OIDC deploy job', () => {
        const firestoreDetection = production.indexOf('name: Detect Firestore configuration changes');
        const cliInstall = production.indexOf('name: Install isolated Firebase deploy CLI without OIDC');
        const handoff = production.indexOf('name: Upload trusted production deploy handoff');
        const storageAuth = production.indexOf('name: Authenticate Storage deploy through exact-workflow OIDC');
        const storageDeploy = production.indexOf('name: Deploy Firebase Storage rules when available');
        const storageCleanup = production.indexOf('name: Remove Storage deploy credential');
        const productionAuth = production.indexOf('name: Authenticate production deploy through exact-workflow OIDC');
        const productionDeploy = production.indexOf('name: Deploy Firebase production');

        expect(cliInstall).toBeGreaterThan(firestoreDetection);
        expect(handoff).toBeGreaterThan(cliInstall);
        expect(storageAuth).toBeGreaterThan(handoff);
        expect(storageDeploy).toBeGreaterThan(storageAuth);
        expect(storageCleanup).toBeGreaterThan(storageDeploy);
        expect(productionAuth).toBeGreaterThan(storageCleanup);
        expect(productionDeploy).toBeGreaterThan(productionAuth);
        expect(production.slice(storageAuth, storageDeploy)).not.toContain('run:');
        expect(production.slice(productionAuth, productionDeploy)).not.toContain('run:');
        expect(production.slice(storageDeploy, storageCleanup)).toContain('timeout-minutes: 4');
        expect(production.slice(productionDeploy)).toContain('timeout-minutes: 4');
        const oidcJobs = workflowJobs(production).filter((job) => job.permissions?.['id-token'] === 'write');
        expect(oidcJobs).toHaveLength(1);
        expect(JSON.stringify(oidcJobs[0])).not.toMatch(/npm (?:ci|install)|stage-pages-bundle|write-firebase-hosting-config/);
        expect(JSON.stringify(oidcJobs[0])).toMatch(/actions\/download-artifact@[0-9a-f]{40}/);
    });

    it('keeps rule-changing releases rules-first and skips unchanged rule writes', () => {
        const changedStart = production.indexOf('if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]; then');
        const unchangedStart = production.indexOf('\n          else', changedStart);
        const end = production.indexOf('\n          fi', unchangedStart);
        const changed = production.slice(changedStart, unchangedStart);
        const unchanged = production.slice(unchangedStart, end);

        expect(changed.indexOf('"firestore"')).toBeGreaterThan(-1);
        expect(changed.indexOf('"firestore"')).toBeLessThan(changed.indexOf('"application"'));
        expect(unchanged).toContain('"application"');
        expect(unchanged).not.toContain('"firestore"');
    });
});
