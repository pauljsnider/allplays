import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const securityPolicy = readRepoFile('SECURITY.md');
const issueConfig = parse(readRepoFile('.github/ISSUE_TEMPLATE/config.yml'));
const bugReport = parse(readRepoFile('.github/ISSUE_TEMPLATE/bug-report.yml'));
const dependabot = parse(readRepoFile('.github/dependabot.yml'));
const codeqlSource = readRepoFile('.github/workflows/codeql-passive.yml');
const codeql = parse(codeqlSource);

describe('repository security guardrails', () => {
    it('routes vulnerability reports privately and prohibits sensitive report content', () => {
        expect(securityPolicy).toContain(
            'https://github.com/pauljsnider/allplays/security/advisories/new'
        );
        expect(securityPolicy).toContain('Do not open a public issue');
        expect(securityPolicy).toContain('Invite codes');
        expect(securityPolicy).toContain('information about minors');
        expect(securityPolicy).toContain('[REDACTED_TOKEN]');

        expect(issueConfig.blank_issues_enabled).toBe(true);
        expect(issueConfig.contact_links).toContainEqual(
            expect.objectContaining({
                url: 'https://github.com/pauljsnider/allplays/security/advisories/new'
            })
        );

        const safetyCheckboxes = bugReport.body.find(
            (section) => section.id === 'public-safety'
        );
        expect(safetyCheckboxes.attributes.options).toHaveLength(2);
        expect(
            safetyCheckboxes.attributes.options.every((option) => option.required === true)
        ).toBe(true);
        expect(JSON.stringify(bugReport)).toContain('synthetic or redacted data');
        expect(JSON.stringify(bugReport)).toContain('private vulnerability reporting form');
    });

    it('covers every maintained dependency workspace without opening an unbounded PR queue', () => {
        const configuredUpdates = new Map(
            dependabot.updates.map((update) => [
                `${update['package-ecosystem']}:${update.directory}`,
                update
            ])
        );

        expect([...configuredUpdates.keys()].sort()).toEqual([
            'github-actions:/',
            'npm:/',
            'npm:/apps/app',
            'npm:/functions',
            'npm:/services/chatgpt-mcp'
        ]);

        for (const update of configuredUpdates.values()) {
            expect(update.schedule.interval).toBe('weekly');
            expect(update['open-pull-requests-limit']).toBeLessThanOrEqual(2);
        }
    });

    it('keeps CodeQL advisory, trusted, least-privilege, and immutable', () => {
        expect(codeql.name).toBe('CodeQL passive analysis');
        expect(codeql.permissions).toEqual({});
        expect(codeql.on.push.branches).toEqual(['master']);
        expect(codeql.on).toHaveProperty('schedule');
        expect(codeql.on).toHaveProperty('workflow_dispatch');
        expect(codeql.on).not.toHaveProperty('pull_request');
        expect(codeql.on).not.toHaveProperty('pull_request_target');
        expect(codeql.on).not.toHaveProperty('workflow_run');
        expect(codeql.on).not.toHaveProperty('issue_comment');

        const analyze = codeql.jobs.analyze;
        expect(analyze.permissions).toEqual({
            contents: 'read',
            'security-events': 'write'
        });
        expect(analyze).not.toHaveProperty('environment');

        const checkout = analyze.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
        expect(checkout.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
        expect(checkout.with['persist-credentials']).toBe(false);

        const codeqlSteps = analyze.steps.filter((step) =>
            step.uses?.startsWith('github/codeql-action/')
        );
        expect(codeqlSteps).toHaveLength(2);
        for (const step of codeqlSteps) {
            expect(step.uses).toMatch(/^github\/codeql-action\/(init|analyze)@[0-9a-f]{40}$/);
        }

        expect(codeqlSource).not.toMatch(/^\s*pull_request:/m);
        expect(codeqlSource).not.toContain('secrets.');
        expect(codeqlSource).not.toContain('pull_request_target');
        expect(codeqlSource).not.toContain('workflow_run');
        expect(codeqlSource).not.toMatch(/uses:\s+[^@\s]+@(v\d+|main|master)\b/);
    });
});
