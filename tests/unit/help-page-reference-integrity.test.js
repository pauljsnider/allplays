import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../..');

function readRepoFile(relativePath) {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

function extractReferenceRows(html) {
    return [...html.matchAll(/<tr><td class="px-4 py-3 font-mono">([^<]+\.html)<\/td><td class="px-4 py-3">([^<]+)<\/td><td class="px-4 py-3">([^<]+)<\/td><\/tr>/g)].map((match) => ({
        file: match[1],
        features: match[2],
        roles: match[3]
    }));
}

describe('help page reference integrity', () => {
    it('keeps the file-by-file page reference discoverable from help center', () => {
        const helpHtml = readRepoFile('help.html');
        expect(helpHtml).toContain('id="help-page-reference-link"');
        expect(helpHtml).toContain("pageReferenceLink.href = buildWorkflowHref('help-page-reference.html');");
        expect(helpHtml).toContain('View file-by-file page reference');
    });

    it('lists only shipped html files in help-page-reference.html', () => {
        const referenceHtml = readRepoFile('help-page-reference.html');
        expect(referenceHtml).toContain('data-help-back-link');
        expect(referenceHtml).toContain('./js/help-context.js?v=1');

        const referenceRows = extractReferenceRows(referenceHtml);
        const referencedFiles = referenceRows.map((row) => row.file);

        expect(referencedFiles).toContain('edit-schedule.html');
        expect(referencedFiles).toContain('live-game.html');
        expect(referencedFiles).toContain('help-page-reference.html');

        referencedFiles.forEach((file) => {
            expect(existsSync(resolve(REPO_ROOT, file)), `${file} should exist in the repo`).toBe(true);
        });

        const requiredUserFacingPages = new Set([
            'certificates.html',
            'check-admin-status.html',
            'registration.html',
            'team-fees.html',
            'team-media.html'
        ]);
        const expectedUserFacingPages = readdirSync(REPO_ROOT)
            .filter((file) => requiredUserFacingPages.has(file))
            .sort();

        expect(expectedUserFacingPages).toEqual([
            'certificates.html',
            'check-admin-status.html',
            'registration.html',
            'team-fees.html',
            'team-media.html'
        ]);

        expectedUserFacingPages.forEach((file) => {
            expect(referencedFiles, `${file} should be listed in help-page-reference.html`).toContain(file);
        });
    });

    it('keeps the schedule workflow steps in one continuous ordered list', () => {
        const workflowHtml = readRepoFile('workflow-schedule.html');
        const workflowSection = workflowHtml.match(/<h2 id="step-by-step-workflow">Step-by-Step Workflow<\/h2>([\s\S]*?)<h2 id="common-questions">/)[1];

        expect(workflowSection.match(/<ol class="ml-6 list-decimal space-y-4">/g)).toHaveLength(1);
        expect(workflowSection.match(/<\/ol>/g)).toHaveLength(1);
        expect(workflowSection.match(/^<li>$/gm)).toHaveLength(11);
    });
});
