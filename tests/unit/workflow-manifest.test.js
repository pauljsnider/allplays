import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function repoFileExists(relativePath) {
    return existsSync(new URL(`../../${relativePath}`, import.meta.url));
}

function compactText(value) {
    return String(value || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('workflow manifest', () => {
    it('loads as valid JSON with workflow entries', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));

        expect(Array.isArray(manifest)).toBe(true);
        expect(manifest.length).toBeGreaterThan(0);
        expect(manifest.every((item) => item.id && item.file && item.title)).toBe(true);
    });

    it('ships and indexes the Team Media workflow help page', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'team-media');

        expect(repoFileExists('workflow-team-media.html')).toBe(true);
        expect(workflow).toMatchObject({
            id: 'team-media',
            title: 'Manage Team Media and Albums',
            file: 'workflow-team-media.html'
        });
        expect(workflow.roles).toEqual(expect.arrayContaining(['Parent', 'Coach', 'Admin']));
        expect(workflow.searchText).toContain('Team Media');
        expect(workflow.searchText).toContain('photos');
        expect(workflow.searchText).toContain('video');
    });

    it('ships and indexes the Fees Payments workflow help page', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'fees-payments');
        const helpHtml = readRepoFile('help.html');

        expect(repoFileExists('workflow-fees-payments.html')).toBe(true);
        expect(workflow).toMatchObject({
            id: 'fees-payments',
            title: 'Manage Team Fees and Payments',
            file: 'workflow-fees-payments.html'
        });
        expect(workflow.roles).toEqual(expect.arrayContaining(['Parent', 'Coach', 'Admin']));
        expect(workflow.searchText).toContain('fees');
        expect(workflow.searchText).toContain('Stripe');
        expect(helpHtml).toContain('workflow-fees-payments.html');
        expect(helpHtml).toContain('Manage Team Fees and Payments');
    });

    it('ships and indexes the family sharing workflow help page', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'family-sharing');
        const helpHtml = readRepoFile('help.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(repoFileExists('workflow-family-sharing.html')).toBe(true);
        expect(workflow).toMatchObject({
            id: 'family-sharing',
            title: 'Share a Family Schedule Link',
            file: 'workflow-family-sharing.html'
        });
        expect(workflow.roles).toEqual(['Parent']);
        expect(workflow.searchText).toContain('/app/#/family/:token');
        expect(workflow.searchText).toContain('Share with family');
        expect(helpHtml).toContain('workflow-family-sharing.html');
        expect(helpHtml).toContain('Share a Family Schedule Link');
        expect(appHelpIndex).toContain('"id": "family-sharing"');
        expect(appHelpIndex).toContain('"file": "workflow-family-sharing.html"');
        expect(appHelpIndex).toContain('/app/#/family/:token');
    });

    it('removes stale Game Day practice plan links from generated help indexes', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'game-day');
        const helpHtml = readRepoFile('help.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(workflow.searchText).not.toContain('Plan the next practice from game outcomes');
        expect(workflow.searchText).not.toContain('In the Game Day pre-game rail, use **Plan →**');
        expect(helpHtml).not.toContain('Plan the next practice from game outcomes');
        expect(helpHtml).not.toContain('In the Game Day pre-game rail, use **Plan →**');
        expect(appHelpIndex).not.toContain('Plan the next practice from game outcomes');
        expect(appHelpIndex).not.toContain('In the Game Day pre-game rail, use Plan →');
    });

    it('documents official final score submission in game operations help metadata', () => {
        const helpGameOperations = readRepoFile('help-game-operations.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(helpGameOperations).toContain('submit final score and notes after the game');
        expect(appHelpIndex).toContain('submit final score and notes after the game');
    });

    it('documents offline/manual fee creation as the default fees workflow', () => {
        const html = readRepoFile('workflow-fees-payments.html');
        const chooseYourPath = html.slice(html.indexOf('<h2 id="choose-your-path">'), html.indexOf('<h2 id="step-by-step">'));
        const adminStepByStep = html.slice(html.indexOf('<h3>Admin: Creating and managing fees</h3>'), html.indexOf('<h3>Parent: Viewing and settling a fee</h3>'));

        expect(html).toContain('The current <code>team-fees.html</code> create flow is manual/offline collection only');
        expect(html).toContain('<code>collectionMode: offline_manual</code>');
        expect(html).toContain('Pay</strong> button appears only for online Stripe fee records with an unpaid balance');
        expect(chooseYourPath).toContain('Create a new offline/manual fee batch for roster recipients');
        expect(chooseYourPath).not.toContain('send a payment link to all recipients');
        expect(adminStepByStep).toContain('Save the offline/manual fee records');
        expect(adminStepByStep).toContain('Record offline payments from the manage view');
        expect(adminStepByStep).not.toContain('Generate Payment Link');
    });

    it('regenerates awards workflow help knowledge metadata from the manifest', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'awards-certificates');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const awardsEntry = appHelpIndex.match(/\{\n\s+"id": "awards-certificates",[\s\S]*?\n\s+\}/)?.[0];

        expect(workflow).toMatchObject({
            id: 'awards-certificates',
            title: 'Create and Publish Player Awards and Certificates',
            file: 'workflow-awards-certificates.html',
            summary: 'Design certificates, generate AI player narratives from real game data, and publish awards to families — individually or for the whole team at once.'
        });
        expect(workflow.roles).toEqual(['Coach', 'Admin']);
        expect(awardsEntry).toBeTruthy();
        expect(awardsEntry).toContain('"summary": "Design certificates, generate AI player narratives from real game data, and publish awards to families — individually or for the whole team at once."');
        expect(awardsEntry).toContain('"roles": [\n      "coach",\n      "admin"\n    ]');
        expect(awardsEntry).not.toContain('"id": "workflow-awards-certificates"');
        expect(awardsEntry).not.toContain('"summary": "Workflow Guide"');
        expect(awardsEntry).not.toContain('"parent"');
    });

    it('documents roster staff visibility across workflow and capability metadata', () => {
        const rosterWorkflow = readRepoFile('workflow-roster.html');
        const capabilities = readRepoFile('apps/app/src/data/capabilities.ts');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(rosterWorkflow).toContain('review staff access');
        expect(rosterWorkflow).toContain('Review the <strong>Staff</strong> section');
        expect(capabilities).toContain('Staff visibility');
        expect(appHelpIndex).toContain('review staff access');
        expect(appHelpIndex).toContain('Review the Staff section');
    });

    it('does not advertise roster management to parent-only users', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'roster');
        const helpHtml = readRepoFile('help.html');
        const rosterWorkflow = readRepoFile('workflow-roster.html');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const compactAppHelpIndex = compactText(appHelpIndex);

        expect(workflow.roles).toEqual(['Coach', 'Admin']);
        expect(helpHtml).toContain('<h2 class="text-xl font-extrabold tracking-tight text-slate-900">Build and Maintain Team Roster</h2>');
        expect(helpHtml).toContain('<span class="wf-role-chip">Coach</span> <span class="wf-role-chip">Admin</span>');
        expect(helpHtml).not.toContain('<h2 class="text-xl font-extrabold tracking-tight text-slate-900">Build and Maintain Team Roster</h2>\n            <p class="mt-3 text-sm leading-6 text-slate-600">Use this workflow to keep your team roster accurate, import linked registration rosters, and keep parent access connected.</p>\n            <div class="mt-4 flex flex-wrap gap-2"><span class="wf-role-chip">Parent</span> <span class="wf-role-chip">Coach</span> <span class="wf-role-chip">Admin</span></div>');
        expect(rosterWorkflow).toContain('<div class="wf-roles"><span class="wf-role-chip">Coach</span> <span class="wf-role-chip">Admin</span></div>');
        expect(appHelpIndex).toContain('Who can use this Coach Admin Overview');
        expect(compactAppHelpIndex).toContain('Review, Edit, and Share Postgame Results Use this workflow after a game ends to verify results, clean up postgame details, and share links. Parent Coach Admin Member Open workflow ->');
        expect(compactAppHelpIndex).toContain('Build and Maintain Team Roster Use this workflow to keep your team roster accurate and parent access connected. Coach Admin Open workflow ->');
        expect(compactAppHelpIndex).not.toContain('Build and Maintain Team Roster Use this workflow to keep your team roster accurate and parent access connected. Parent Coach Admin Open workflow ->');
        expect(appHelpIndex).not.toContain('Build and Maintain Team Roster - ALL PLAYS Help ← Back to Help Center Workflow Guide Build and Maintain Team Roster Use this workflow to keep your team roster accurate, review staff access, and keep parent access connected. 10 min read Updated from live product pages On this page Who can use this Parent Coach Admin Overview');
    });
});
