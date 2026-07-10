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

function extractAppHelpIndexEntry(appHelpIndex, id) {
    return appHelpIndex.match(new RegExp(`\\{\\n    "id": "${id}"[\\s\\S]*?\\n  \\}`))?.[0] || '';
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

    it('routes Getting Started users to the real sign-up and sign-in entry points', () => {
        const html = readRepoFile('workflow-getting-started.html');
        const workflowManifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const helpPortalManifest = extractHelpManifest(readRepoFile('help.html'));
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const gettingStartedHelpEntry = extractAppHelpIndexEntry(appHelpIndex, 'getting-started');
        const workflowManifestEntry = workflowManifest.find((item) => item.id === 'getting-started');
        const helpPortalManifestEntry = helpPortalManifest.find((item) => item.id === 'getting-started');

        expect(html).toContain('href="login.html#signup"');
        expect(html).toContain('href="login.html"');
        expect(html).toContain('>Sign Up</a>');
        expect(html).toContain('>Sign In</a>');
        expect(html).not.toContain('Get Started Now');
        expect(workflowManifestEntry?.searchText).toContain('Open Sign Up to create an account with your activation code');
        expect(workflowManifestEntry?.searchText).not.toContain('Get Started Now');
        expect(helpPortalManifestEntry?.searchText).toContain('Open Sign Up to create an account with your activation code');
        expect(helpPortalManifestEntry?.searchText).not.toContain('Get Started Now');
        expect(gettingStartedHelpEntry).toContain('Open Sign Up to create an account with your activation code');
        expect(gettingStartedHelpEntry).not.toContain('Get Started Now');
    });

    it('keeps the help portal manifest aligned with generated workflow and topic pages', () => {
        const helpHtml = readRepoFile('help.html');
        const workflowManifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const manifest = extractHelpManifest(helpHtml);
        const manifestFiles = manifest.map((item) => item.file).sort();

        expect(manifest.length).toBeGreaterThan(15);
        expect(manifest).toEqual(workflowManifest);
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

    it('keeps the app help index aligned with awards workflow metadata', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.file === 'workflow-awards-certificates.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(workflow).toMatchObject({
            id: 'awards-certificates',
            title: 'Create and Publish Player Awards and Certificates',
            file: 'workflow-awards-certificates.html'
        });
        expect(workflow.roles).toEqual(['Coach', 'Admin']);
        expect(workflow.summary).toContain('Design certificates');
        expect(workflow.summary).toContain('publish awards to families');
        expect(appHelpIndex).toContain('"id": "awards-certificates"');
        expect(appHelpIndex).toContain('"file": "workflow-awards-certificates.html"');
        expect(appHelpIndex).toContain(`"summary": ${JSON.stringify(workflow.summary)}`);
        expect(appHelpIndex).toContain('"roles": [\n      "coach",\n      "admin"\n    ]');
        expect(appHelpIndex).not.toContain('"id": "workflow-awards-certificates"');
        expect(appHelpIndex).not.toContain('"summary": "Workflow Guide"');
    });

    it('keeps scorekeeper tracking access aligned across manifest and app help index', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.file === 'workflow-track-game.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(workflow?.roles).toEqual(['Coach', 'Admin', 'Scorekeeper']);
        expect(appHelpIndex).toContain('"file": "workflow-track-game.html"');
        expect(extractAppHelpIndexEntry(appHelpIndex, 'track-game')).toContain('"scorekeeper"');
    });

    it('keeps Game Day broadcast workflow copy aligned with setup-only support', () => {
        const html = readRepoFile('workflow-game-day.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const gameDayHelpEntry = extractAppHelpIndexEntry(appHelpIndex, 'game-day');

        expect(html).toContain('Open broadcast setup');
        expect(html).toContain('Current streaming support uses external provider/setup tools');
        expect(html).toContain('it does not yet start a native managed broadcast or server-side stream pipeline');
        expect(gameDayHelpEntry).toContain('Open broadcast setup');
        expect(gameDayHelpEntry).toContain('Current streaming support uses external provider/setup tools');
        expect(gameDayHelpEntry).toContain('it does not yet start a native managed broadcast or server-side stream pipeline');
        expect(html).not.toContain('Begin Streaming button');
        expect(html).not.toContain('native camera capture');
        expect(html).not.toContain('Confirm camera/microphone permission is granted');
        expect(gameDayHelpEntry).not.toContain('Begin Streaming button');
        expect(gameDayHelpEntry).not.toContain('native camera capture');
        expect(gameDayHelpEntry).not.toContain('Confirm camera/microphone permission is granted');
    });

    it('keeps communication workflow mention guidance aligned with Watch and Chat help', () => {
        const helpWatchChat = readRepoFile('help-watch-chat.html');
        const workflowCommunication = readRepoFile('workflow-communication.html');
        const workflowManifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const communicationManifest = workflowManifest.find((item) => item.id === 'communication');
        const communicationHelpEntry = extractAppHelpIndexEntry(appHelpIndex, 'communication');
        const indexedText = [communicationManifest?.searchText || '', communicationHelpEntry].join(' ');
        const staleMentionPhrases = [
            '@mention autocomplete',
            'Choose a suggested recipient',
            'Use @ in the composer to open mention autocomplete',
            'Mention notification did not arrive',
            'mentioned user'
        ];

        expect(helpWatchChat).toContain('@ALL PLAYS');
        expect(helpWatchChat).toContain('Use the recipient picker, not @ mentions');

        expect(workflowCommunication).toContain('@ALL PLAYS');
        expect(workflowCommunication).toContain('recipient picker');
        expect(workflowCommunication).toContain('Conversations');
        expect(workflowCommunication).toContain('person and group @ mentions are not supported');

        expect(indexedText).toContain('@ALL PLAYS');
        expect(indexedText).toContain('recipient picker');
        expect(indexedText).toContain('Conversations');
        expect(indexedText).toContain('person and group @ mentions are not supported');

        staleMentionPhrases.forEach((phrase) => {
            expect(workflowCommunication).not.toContain(phrase);
            expect(indexedText).not.toContain(phrase);
        });
    });
});
