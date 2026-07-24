import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
    new URL('../../.github/workflows/preview-smoke.yml', import.meta.url),
    'utf8'
);

describe('preview-smoke CI workflow', () => {
    it('defers the full smoke while external development owns the PR and reruns on handoff', () => {
        const triggerSection = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
        const changesSection = workflow.slice(workflow.indexOf('  changes:'), workflow.indexOf('  preview-smoke-run:'));
        const gateSection = workflow.slice(workflow.indexOf('  preview-smoke:'));

        expect(triggerSection).toContain('      - unlabeled');
        expect(triggerSection).toContain('      - labeled');
        expect(changesSection).toContain("contains(github.event.pull_request.labels.*.name, 'external-claim')");
        expect(changesSection).toContain('[ "$EXTERNAL_CLAIMED" = "true" ]');
        expect(changesSection).toContain('echo "landing=false" >> "$GITHUB_OUTPUT"');
        expect(changesSection).toContain('[ "$ACTION" = "labeled" ] || [ "$ACTION" = "unlabeled" ]');
        expect(workflow).toContain("format('preview-smoke-label-noop-{0}', github.run_id)");
        expect(gateSection).toContain("'preview-smoke-label-noop' || 'preview-smoke'");
        expect(gateSection).toContain('needs.changes.outputs.landing');
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

        expect(gate).toContain('[ "$IS_SAME_REPOSITORY" != "true" ]');
        expect(changesResultCheck).toBeGreaterThan(-1);
        expect(intentionalSkipCheck).toBeGreaterThan(changesResultCheck);
        expect(gate).not.toContain('success|skipped');
    });
});
