import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowDirectory = resolve(process.cwd(), '.github/workflows');
const workflowNames = readdirSync(workflowDirectory)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();

function readWorkflow(name) {
    const source = readFileSync(join(workflowDirectory, name), 'utf8');
    return { name, source, workflow: parseYaml(source) };
}

function runScripts(workflow) {
    return Object.values(workflow.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .map((step) => step.run)
        .filter((run) => typeof run === 'string');
}

const firebaseLiveDeploy = /(?:\bnode\s+"?\$[^"\n]*firebase[^"\n]*"?|\bnpx\s+firebase|\bfirebase)\s+deploy\b/;
const firebasePreviewDeploy = /(?:\bnode\s+"?\$[^"\n]*firebase[^"\n]*"?|\bnpx\s+firebase|\bfirebase)\s+hosting:channel:deploy\b/;

describe('Firebase deployment workflow policy', () => {
    it('allows live-channel Firebase deploy commands only in deploy-prod.yml', () => {
        const liveDeployers = workflowNames
            .map(readWorkflow)
            .filter(({ workflow }) => runScripts(workflow).some((run) => firebaseLiveDeploy.test(run)))
            .map(({ name }) => name);

        expect(liveDeployers).toEqual(['deploy-prod.yml']);
    });

    it('allows preview-channel deploy commands only in deploy-preview-trusted.yml', () => {
        const previewDeployers = workflowNames
            .map(readWorkflow)
            .filter(({ workflow }) => runScripts(workflow).some((run) => firebasePreviewDeploy.test(run)))
            .map(({ name }) => name);

        expect(previewDeployers).toEqual(['deploy-preview-trusted.yml']);
    });

    it('keeps the candidate workflow credential-free and validation-only', () => {
        const candidate = readWorkflow('deploy-candidate-host.yml');

        expect(candidate.workflow.permissions).toEqual({});
        expect(candidate.source).not.toContain('id-token: write');
        expect(candidate.source).not.toContain('google-github-actions/auth');
        expect(candidate.source).not.toContain('game-flow-c6311');
        expect(candidate.source).not.toContain('firebase-tools@');
        for (const run of runScripts(candidate.workflow)) {
            expect(run).not.toMatch(firebaseLiveDeploy);
            expect(run).not.toMatch(firebasePreviewDeploy);
        }
    });
});
