import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
    new URL('../../.github/workflows/preview-smoke.yml', import.meta.url),
    'utf8'
);
const integrationWorkflow = readFileSync(
    new URL('../../.github/workflows/pr-integration.yml', import.meta.url),
    'utf8'
);

describe('preview-smoke CI workflow', () => {
    it('is called by the consolidated code-head workflow without label-churn runs', () => {
        const childTriggerSection = workflow.slice(
            workflow.indexOf('\non:'),
            workflow.indexOf('\nconcurrency:')
        );
        const triggerSection = integrationWorkflow.slice(
            integrationWorkflow.indexOf('\non:'),
            integrationWorkflow.indexOf('\npermissions:')
        );
        const changesSection = workflow.slice(workflow.indexOf('  changes:'), workflow.indexOf('  preview-smoke-run:'));
        const gateSection = workflow.slice(workflow.indexOf('  preview-smoke:'));

        expect(childTriggerSection).toContain('workflow_call:');
        expect(childTriggerSection).toContain('workflow_dispatch:');
        expect(childTriggerSection).not.toContain('pull_request:');
        expect(triggerSection).toContain('      - synchronize');
        expect(triggerSection).not.toContain('      - unlabeled');
        expect(triggerSection).not.toContain('      - labeled');
        expect(integrationWorkflow).toContain('uses: ./.github/workflows/preview-smoke.yml');
        expect(integrationWorkflow).toContain('name: preview-smoke');
        expect(workflow).toContain(
            'group: preview-smoke-${{ github.event.pull_request.number || github.run_id }}'
        );
        expect(changesSection).toContain("github.event_name == 'workflow_dispatch'");
        expect(workflow.slice(workflow.indexOf('  preview-smoke-run:'), workflow.indexOf('  preview-smoke:')))
            .toContain("github.event_name == 'workflow_dispatch'");
        expect(changesSection).not.toContain('external-claim');
        expect(changesSection).not.toContain('LABEL_NAME');
        expect(gateSection).toContain('name: preview-smoke');
        expect(gateSection).not.toContain('label-noop');
    });

    it('runs smoke only when at least one changed path is not skippable', () => {
        const skippable = workflow.match(/SKIPPABLE='([^']+)'/)?.[1];

        expect(skippable).toBeDefined();
        const pattern = new RegExp(skippable);
        const shouldRun = (paths) => paths.some((path) => !pattern.test(path));

        expect(shouldRun([])).toBe(false);
        expect(shouldRun(['docs/testing.md', 'functions/index.js'])).toBe(false);
        expect(shouldRun(['js/auth.js'])).toBe(true);
        expect(shouldRun(['.github/workflows/preview-smoke.yml'])).toBe(true);
        expect(workflow).not.toContain('[ -z "$CHANGED" ] ||');
    });

    it('fails closed when change detection fails and only accepts an intentional skip', () => {
        const gate = workflow.slice(workflow.indexOf('  preview-smoke:'));
        const changesResultCheck = gate.indexOf('[ "$CHANGES_RESULT" != "success" ]');
        const intentionalSkipCheck = gate.indexOf(
            '[ "$SHOULD_RUN" = "false" ] && [ "$RUN_RESULT" = "skipped" ]'
        );

        expect(gate).toContain(
            "IS_ELIGIBLE_EVENT: ${{ github.event_name == 'workflow_dispatch' || github.event.pull_request.head.repo.full_name == github.repository }}"
        );
        expect(gate).toContain('[ "$IS_ELIGIBLE_EVENT" != "true" ]');
        expect(changesResultCheck).toBeGreaterThan(-1);
        expect(intentionalSkipCheck).toBeGreaterThan(changesResultCheck);
        expect(gate).not.toContain('success|skipped');
    });

    it('does not turn an intentional concurrency cancellation into a required-check failure', () => {
        const gate = workflow.slice(workflow.indexOf('  preview-smoke:'));

        expect(gate).toContain('if: ${{ always() && !cancelled() }}');
    });
});
