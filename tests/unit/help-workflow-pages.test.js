import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readRepoFile(relativePath) {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

function listRootPages(prefix) {
    return readdirSync(REPO_ROOT)
        .filter((file) => file.startsWith(prefix) && file.endsWith('.html'))
        .sort();
}

function extractHrefTargets(html) {
    return [...html.matchAll(/href="([^"#?]+\.html)(?:[?#][^"]*)?"/g)].map((match) => match[1]);
}

function extractHeadingIds(html) {
    return [...html.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1]);
}

function extractHelpManifest(html) {
    const manifestText = html.match(/<script id="help-manifest" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    return JSON.parse(manifestText || '[]');
}

describe('help and workflow page inventory', () => {
    it('keeps every workflow page structured for direct navigation and generated TOCs', () => {
        const workflowPages = listRootPages('workflow-');
        expect(workflowPages).toHaveLength(17);

        for (const file of workflowPages) {
            const html = readRepoFile(file);
            const headingIds = extractHeadingIds(html);

            expect(html, `${file} should load shared help context`).toContain('./js/help-context.js?v=1');
            expect(html, `${file} should include the contextual help back link`).toContain('data-help-back-link');
            expect(html, `${file} should expose a desktop TOC container`).toContain('id="workflow-toc"');
            expect(html, `${file} should expose a mobile TOC container`).toContain('id="workflow-mobile-toc"');
            expect(html, `${file} should wrap generated content consistently`).toContain('class="help-workflow-body"');
            expect(headingIds, `${file} should include Overview`).toContain('overview');
            expect(headingIds, `${file} should include Related Workflows`).toContain('related-workflows');
            expect(new Set(headingIds).size, `${file} should not duplicate h2 ids`).toBe(headingIds.length);
            expect(headingIds.length, `${file} should have multiple TOC headings`).toBeGreaterThan(2);
        }
    });

    it('keeps all help and workflow HTML links pointed at real repo pages', () => {
        const pages = ['help.html', ...listRootPages('help-'), ...listRootPages('workflow-')];

        for (const file of pages) {
            const html = readRepoFile(file);
            for (const target of extractHrefTargets(html)) {
                expect(
                    existsSync(resolve(REPO_ROOT, target)),
                    `${file} links to missing page ${target}`
                ).toBe(true);
            }
        }
    });

    it('keeps the help portal manifest aligned with generated workflow and topic pages', () => {
        const helpHtml = readRepoFile('help.html');
        const manifest = extractHelpManifest(helpHtml);
        const manifestFiles = manifest.map((item) => item.file).sort();

        expect(manifest.length).toBeGreaterThan(15);
        expect(manifestFiles).toEqual([
            'help-team-operations.html',
            'workflow-admin-ops.html',
            'workflow-awards-certificates.html',
            'workflow-choose-home-dashboard.html',
            'workflow-communication.html',
            'workflow-fees-payments.html',
            'workflow-game-day.html',
            'workflow-getting-started.html',
            'workflow-join-team.html',
            'workflow-live-tracker.html',
            'workflow-live-watch-replay.html',
            'workflow-postgame.html',
            'workflow-registration.html',
            'workflow-roster.html',
            'workflow-schedule.html',
            'workflow-team-media.html',
            'workflow-team-setup.html',
            'workflow-track-game.html'
        ]);

        for (const item of manifest) {
            expect(item.id, `${item.file} should have a manifest id`).toBeTruthy();
            expect(item.title, `${item.file} should have a title`).toBeTruthy();
            expect(item.summary, `${item.file} should have a summary`).toBeTruthy();
            expect(item.roles?.length, `${item.file} should list roles`).toBeGreaterThan(0);
            expect(existsSync(resolve(REPO_ROOT, item.file)), `${item.file} should exist`).toBe(true);
        }
    });
});
