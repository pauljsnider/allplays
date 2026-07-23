import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowPath = '.github/workflows/deploy-candidate-host.yml';
const workflowSource = readFileSync(resolve(process.cwd(), workflowPath), 'utf8');
const workflow = parseYaml(workflowSource);

describe('candidate-host deployment workflow', () => {
    it('is manually gated and targets only the fixed candidate Hosting site', () => {
        expect(workflow.on).toHaveProperty('workflow_dispatch');
        expect(workflow.on).not.toHaveProperty('push');

        const deployJob = workflow.jobs['deploy-candidate'];
        expect(deployJob.environment).toBe('candidate-host');
        expect(workflowSource).toContain('.hosting.site = "game-flow-c6311"');
        expect(workflowSource).toContain('--project game-flow-c6311');
        expect(workflowSource).toContain('--only hosting');
        expect(workflowSource).not.toContain('allplays.ai');
        expect(workflowSource).not.toMatch(/\b(dns|domain:|functions|firestore|storage)\s+deploy\b/i);
    });

    it('prepares executable tooling outside the OIDC-capable deploy job', () => {
        const prepareJob = workflow.jobs['prepare-candidate-artifact'];
        const deployJob = workflow.jobs['deploy-candidate'];
        const prepareText = JSON.stringify(prepareJob);
        const deployText = JSON.stringify(deployJob);

        expect(prepareText).toContain('npm run app:build');
        expect(prepareText).toContain('scripts/stage-pages-bundle.mjs');
        expect(prepareText).toContain('scripts/write-firebase-hosting-config.mjs');
        expect(deployText).toContain('$bundle/site/index.html');
        expect(deployText).toContain('$bundle/site/app/index.html');
        expect(prepareText).toContain('firebase-tools@15.24.0');
        expect(prepareText).toContain('$bundle/firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js');
        expect(deployText).not.toMatch(/npm (?:ci|install)/);
        expect(deployText).toContain('$bundle/firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js');
        expect(prepareJob.permissions?.['id-token']).toBeUndefined();
        expect(deployJob.permissions?.['id-token']).toBe('write');
        expect(deployText).not.toMatch(/stage-pages-bundle|write-firebase-hosting-config/);
    });

    it('validates the explicit Hosting-only handoff before authentication', () => {
        const validation = workflowSource.indexOf('name: Validate candidate target and artifact before OIDC');
        const authentication = workflowSource.indexOf('name: Authenticate candidate Hosting deploy through OIDC');
        const deployment = workflowSource.indexOf('name: Deploy candidate Firebase Hosting site');

        expect(validation).toBeGreaterThan(-1);
        expect(authentication).toBeGreaterThan(validation);
        expect(deployment).toBeGreaterThan(authentication);
        expect(workflowSource.slice(validation, authentication)).toContain('.hosting.site == "game-flow-c6311"');
        expect(workflowSource.slice(validation, authentication)).toContain('has("functions") | not');
        expect(workflowSource.slice(validation, authentication)).toContain('has("firestore") | not');
        expect(workflowSource.slice(validation, authentication)).toContain('has("storage") | not');
        expect(workflowSource).not.toMatch(/credentials_json\s*:/i);
    });

    it('smokes and reports the candidate origin only after deployment succeeds', () => {
        const smokeJob = workflow.jobs['smoke-candidate'];
        const smokeText = JSON.stringify(smokeJob);

        expect(smokeJob.needs).toBe('deploy-candidate');
        expect(smokeJob.permissions).toEqual({ contents: 'read' });
        expect(smokeJob.permissions?.['id-token']).toBeUndefined();
        expect(smokeJob.env.CANDIDATE_HOST_URL).toBe('https://game-flow-c6311.web.app');
        expect(smokeJob.env.ALLPLAYS_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY)
            .toBe('${{ vars.APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY }}');
        expect(smokeText).toContain('echo \\"Testing candidate origin: $CANDIDATE_HOST_URL\\"');
        expect(smokeText).toContain('npm run smoke:candidate-host -- \\"$CANDIDATE_HOST_URL\\"');
    });
});
