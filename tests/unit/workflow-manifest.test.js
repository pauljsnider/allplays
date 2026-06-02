import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function repoFileExists(relativePath) {
    return existsSync(new URL(`../../${relativePath}`, import.meta.url));
}

describe('workflow manifest', () => {
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

    it('documents roster staff visibility across workflow and capability metadata', () => {
        const rosterWorkflow = readRepoFile('workflow-roster.html');
        const capabilities = readRepoFile('apps/app/src/data/capabilities.ts');
        const appHelpIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');

        expect(rosterWorkflow).toContain('review staff access');
        expect(rosterWorkflow).toContain('Review the <strong>Staff</strong> section');
        expect(capabilities).toContain('Staff visibility');
        expect(appHelpIndex).toContain('review staff access');
        expect(appHelpIndex).toContain('Review the **Staff** section');
    });
});
