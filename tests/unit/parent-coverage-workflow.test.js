import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const source = readFileSync('.github/workflows/parent-coverage-census.yml', 'utf8');
const workflow = parseYaml(source);
const provisionSource = readFileSync('.github/workflows/parent-coverage-provision.yml', 'utf8');
const provisionWorkflow = parseYaml(provisionSource);

describe('parent coverage workflow trust boundary', () => {
    it('is manual serialized and least privilege', () => {
        expect(source).toContain('workflow_dispatch:');
        expect(source).not.toContain('pull_request:');
        expect(source).not.toContain('pull_request_target:');
        expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read', deployments: 'read' });
        expect(workflow.concurrency).toEqual({
            group: 'parent-coverage-census',
            'cancel-in-progress': false
        });
    });

    it('runs only trusted master code with protected credentials', () => {
        const job = workflow.jobs['run-contract'];
        expect(job.if).toBe("github.ref == 'refs/heads/master'");
        expect(job.environment).toEqual({ name: 'production-smoke' });
        const checkout = job.steps.find((step) => step.name === 'Checkout trusted census runner');
        expect(checkout.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
        expect(checkout.with).toEqual({ ref: 'master', 'persist-credentials': false });
        expect(source).not.toContain('actions/checkout@v');
    });

    it('accepts only one exact declarative contract file from the campaign branch', () => {
        const validation = workflow.jobs['run-contract'].steps.find(
            (step) => step.name === 'Validate immutable request'
        ).run;
        expect(validation).toContain('^paulbot/parent-coverage-census-[0-9]{8}$');
        expect(validation).toContain('[[ "$ref_sha" == "$CONTRACT_SHA" ]]');
        expect(validation).toContain("[[ \"$(jq -r '.parents | length' <<<\"$commit_json\")\" == \"1\" ]]");
        expect(validation).toContain("[[ \"$(jq -r '.files | length' <<<\"$commit_json\")\" == \"1\" ]]");
        expect(validation).toContain('[[ "$(jq -r \'.files[0].filename // ""\' <<<"$commit_json")" == "$expected_path" ]]');
        expect(source).toContain('Download declarative contract as untrusted data');
        expect(source).toContain('Validate contract boundary');
    });

    it('does not paste workflow-dispatch inputs directly into shell', () => {
        for (const step of workflow.jobs['run-contract'].steps.filter((candidate) => candidate.run)) {
            expect(step.run).not.toMatch(/\$\{\{\s*inputs\./);
        }
    });

    it('re-audits both parent actors as unprivileged immediately before every run', () => {
        const auditSteps = workflow.jobs['run-contract'].steps.filter(
            (step) => /parent fixture immediately before execution$/.test(step.name)
        );
        expect(auditSteps).toHaveLength(2);
        expect(auditSteps.every((step) => step.env.SMOKE_FIXTURE_MODE === 'audit')).toBe(true);
        expect(auditSteps.every((step) => step.env.SMOKE_REQUIRE_UNPRIVILEGED_PARENT === 'true')).toBe(true);
        expect(auditSteps[0].env.SMOKE_PARENT_EMAIL).toContain('PARENT_CENSUS_PRIMARY_EMAIL');
        expect(auditSteps[1].env.SMOKE_PARENT_EMAIL).toContain('PARENT_CENSUS_PEER_EMAIL');
    });
});

describe('parent coverage provisioning workflow trust boundary', () => {
    it('is manual protected and runs only trusted master code', () => {
        expect(provisionSource).toContain('workflow_dispatch:');
        expect(provisionWorkflow.permissions).toEqual({ contents: 'read' });
        const job = provisionWorkflow.jobs.provision;
        expect(job.environment).toEqual({ name: 'production-smoke' });
        expect(job.if).toBe("github.ref == 'refs/heads/master'");
        const checkout = job.steps.find((step) => step.name === 'Checkout trusted provisioner');
        expect(checkout.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
        expect(checkout.with).toEqual({ ref: 'master', 'persist-credentials': false });
    });

    it('passes dispatch input through the environment rather than shell interpolation', () => {
        for (const step of provisionWorkflow.jobs.provision.steps.filter((candidate) => candidate.run)) {
            expect(step.run).not.toMatch(/\$\{\{\s*inputs\./);
        }
    });

    it('rejects primary and peer fixtures that carry privileged identities or access', () => {
        const identityStep = provisionWorkflow.jobs.provision.steps.find(
            (step) => step.name === 'Validate protected fixture identities'
        );
        expect(identityStep.run).toContain('[[ "$primary" != "$admin" && "$primary" != "$staff" ]]');
        const fixtureSteps = provisionWorkflow.jobs.provision.steps.filter(
            (step) => /parent fixture$/.test(step.name)
        );
        expect(fixtureSteps).toHaveLength(2);
        expect(fixtureSteps.every((step) => step.env.SMOKE_REQUIRE_UNPRIVILEGED_PARENT === 'true')).toBe(true);
    });
});
