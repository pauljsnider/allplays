import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('workflow registration guide', () => {
    it('documents Sports Connect as metadata-only before imports', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('Sports Connect, the Registration Provider panel currently stores provider metadata only.');
        expect(source).toContain('It does not create a live Sports Connect connection, authenticate to the provider, verify connection health, or pull fresh provider data.');
        expect(source).toContain('Roster and schedule imports require a registration roster snapshot, registration schedule snapshot, or other provider data already loaded for the team.');
        expect(source).toContain('A future connector is required before ALL PLAYS can fetch live Sports Connect data.');
        expect(source).not.toContain('can run a backend manual sync using server-configured credentials for roster/source data');
        expect(source).not.toContain('A successful sync updates the provider status and stores roster/source snapshots');
    });

    it('tells admins imports depend on stored provider data rather than live pulls', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('<strong>Confirm live sync availability.</strong>');
        expect(source).toContain('Sports Connect live sync is not available today.');
        expect(source).toContain('<strong>Open a stored-snapshot import.</strong>');
        expect(source).toContain('registration roster snapshot, registration source snapshot, registration schedule snapshot, or other loaded provider data is available for this team');
        expect(source).toContain('preview table appears from a registration schedule snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('preview table appears from a stored registration roster snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('the import button does not pull fresh Sports Connect data immediately');
        expect(source).not.toContain('The backend fetches Sports Connect data using server-configured credentials');
        expect(source).not.toContain('For roster imports, run <strong>Sync now</strong>');
    });

    it('regenerates help index registration copy to avoid claiming Sports Connect live sync exists', () => {
        const helpCenter = readRepoFile('help.html');
        const teamSetup = readRepoFile('workflow-team-setup.html');
        const appIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const capabilities = readRepoFile('apps/app/src/data/capabilities.ts');

        expect(teamSetup).toContain('Configure registration provider metadata');
        expect(teamSetup).toContain('Enter the external Team ID / mapping field, then save the team so the provider card keeps that mapping.');
        expect(teamSetup).toContain('The provider card stores metadata only today. A future connector is required before ALL PLAYS can fetch live Sports Connect data.');
        expect(teamSetup).toContain('Use the manual re-import entry point only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(teamSetup).not.toContain('any sync notes you want stored with the team');
        expect(teamSetup).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(teamSetup).not.toContain('Use the manual re-import entry point to trigger a fresh sync when needed.');

        expect(helpCenter).toContain('store Sports Connect metadata');
        expect(helpCenter).toContain('preview roster or schedule snapshot imports before committing changes');
        expect(helpCenter).not.toContain('import rosters and schedules through the backend Sports Connect sync workflow');

        expect(appIndex).toContain('store Sports Connect metadata');
        expect(appIndex).toContain('metadata-only provider setup for stored snapshot imports');
        expect(appIndex).toContain('schedule imports require a registration schedule snapshot or other provider data already loaded for the team.');
        expect(appIndex).toContain('Configure registration provider metadata');
        expect(appIndex).toContain('The provider card stores metadata only today; a future connector is required before ALL PLAYS can fetch live Sports Connect data.');
        expect(appIndex).toContain('Use the manual re-import entry point only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(appIndex).not.toContain('Sync now pulls fresh Sports Connect data through the backend before import preview.');
        expect(appIndex).not.toContain('connection status monitoring');
        expect(appIndex).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
        expect(appIndex).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(appIndex).not.toContain('trigger a fresh sync when needed.');

        expect(capabilities).toContain('Sports Connect metadata import workflow');
        expect(capabilities).not.toContain('Sports Connect sync workflow');
    });
});
