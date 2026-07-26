import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowPath = '.github/workflows/deploy-candidate-host.yml';
const workflowSource = readFileSync(resolve(process.cwd(), workflowPath), 'utf8');
const workflow = parseYaml(workflowSource);

describe('candidate-host validation workflow', () => {
    it('is manually gated, deny-by-default, and contains one read-only job', () => {
        expect(workflow.on).toHaveProperty('workflow_dispatch');
        expect(workflow.on).not.toHaveProperty('push');
        expect(workflow.permissions).toEqual({});
        expect(Object.keys(workflow.jobs)).toEqual(['validate-candidate-bundle']);

        const validationJob = workflow.jobs['validate-candidate-bundle'];
        expect(validationJob.permissions).toEqual({ contents: 'read' });
        expect(validationJob.permissions?.['id-token']).toBeUndefined();
        expect(validationJob['timeout-minutes']).toBe(15);
    });

    it('builds and validates a production-equivalent credential-free bundle', () => {
        const validationJob = workflow.jobs['validate-candidate-bundle'];
        const validationText = JSON.stringify(validationJob);

        expect(validationText).toContain('npm run app:build');
        expect(validationText).toContain('scripts/stage-pages-bundle.mjs');
        expect(validationText).toContain('scripts/write-firebase-hosting-config.mjs');
        expect(validationText).toContain('$bundle/site/index.html');
        expect(validationText).toContain('$bundle/site/app/index.html');
        expect(validationText).toContain('del(.hosting.site, .functions, .firestore, .storage)');
        expect(validationText).toContain('persist-credentials');
    });

    it('cannot authenticate, publish an artifact handoff, or deploy', () => {
        expect(workflowSource).not.toContain('id-token: write');
        expect(workflowSource).not.toContain('google-github-actions/auth');
        expect(workflowSource).not.toContain('firebase-tools@');
        expect(workflowSource).not.toContain('actions/upload-artifact');
        expect(workflowSource).not.toContain('actions/download-artifact');
        expect(workflowSource).not.toMatch(/\bhosting:channel:deploy\b/);
        expect(workflowSource).not.toMatch(/\bdeploy\s+--only\b/);
        expect(workflowSource).not.toContain('game-flow-c6311');
        expect(workflowSource).not.toContain('allplays.ai');
    });

    it('reports why deployment is disabled', () => {
        expect(workflowSource).toContain(
            'Deployment is intentionally disabled until an isolated integration Firebase project is available.'
        );
    });
});
