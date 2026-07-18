import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const production = read('.github/workflows/deploy-prod.yml');
const preview = read('.github/workflows/deploy-preview-trusted.yml');

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
            expect(workflow).not.toContain('credentials_json:');
        }
    });

    it('withholds preview OIDC until all untrusted input checks finish', () => {
        const archiveCheck = preview.indexOf('python3 scripts/extract-preview-hosting-artifact.py');
        const trustedConfig = preview.indexOf('node scripts/write-firebase-hosting-config.mjs');
        const install = preview.indexOf('run: npm ci --ignore-scripts');
        const exactHeadCheck = preview.indexOf('name: Re-verify current pull-request head before credentials');
        const authentication = preview.indexOf('uses: google-github-actions/auth@');
        const deploy = preview.indexOf('hosting:channel:deploy "$CURRENT_CHANNEL"');
        const cleanup = preview.indexOf('name: Remove ephemeral Google credential file');
        const comment = preview.indexOf('name: Report preview URL on verified pull request');

        expect(archiveCheck).toBeGreaterThan(-1);
        expect(trustedConfig).toBeGreaterThan(archiveCheck);
        expect(install).toBeGreaterThan(trustedConfig);
        expect(exactHeadCheck).toBeGreaterThan(install);
        expect(authentication).toBeGreaterThan(exactHeadCheck);
        expect(deploy).toBeGreaterThan(authentication);
        expect(cleanup).toBeGreaterThan(deploy);
        expect(comment).toBeGreaterThan(cleanup);
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
