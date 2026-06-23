import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

function readHelpManifest() {
    const helpCenter = readRepoFile('help.html');
    const match = helpCenter.match(/<script id="help-manifest" type="application\/json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    return JSON.parse(match[1]);
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

        expect(source).toContain('<strong>Review metadata-only support.</strong>');
        expect(source).toContain('Sports Connect live sync is not available today.');
        expect(source).toContain('The provider panel stores the selected provider and external Team ID only, so saved snapshots can be matched to the right ALL PLAYS team.');
        expect(source).toContain('Until a connector exists, this setup does not authenticate to Sports Connect, check provider health, show live connection health, refresh snapshots, or fetch roster/source data.');
        expect(source).toContain('<strong>Open a stored-snapshot import.</strong>');
        expect(source).toContain('Use the roster or schedule import preview only when provider data has already been stored in ALL PLAYS.');
        expect(source).toContain('registration roster snapshot, registration source snapshot, registration schedule snapshot, or other loaded provider data is available for this team');
        expect(source).toContain('These import previews work from saved snapshots; the disabled Sports Connect refresh control does not fetch new provider data.');
        expect(source).toContain('preview table appears from a registration schedule snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('preview table appears from a stored registration roster snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('the import button does not pull fresh Sports Connect data immediately');
        expect(source).not.toContain('Click <strong>Re-import from Sports Connect</strong> only when provider data has already been stored in ALL PLAYS.');
        expect(source).not.toContain('The backend fetches Sports Connect data using server-configured credentials');
        expect(source).not.toContain('For roster imports, run <strong>Sync now</strong>');
        expect(source).not.toContain('Connected/Not Connected/Error');
        expect(source).not.toContain('marks the provider as live connected');
        expect(source).not.toContain('Re-import previews saved data only');
    });

    it('regenerates help index registration copy to avoid claiming Sports Connect live sync exists', () => {
        const helpCenter = readRepoFile('help.html');
        const teamSetup = readRepoFile('workflow-team-setup.html');
        const appIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const capabilities = readRepoFile('apps/app/src/data/capabilities.ts');

        expect(teamSetup).toContain('Configure registration provider metadata');
        expect(teamSetup).toContain('Enter the external Team ID / mapping field, then save the team so the provider card keeps that mapping.');
        expect(teamSetup).toContain('The provider card stores metadata only today. A future connector is required before ALL PLAYS can fetch live Sports Connect data.');
        expect(teamSetup).toContain('Use roster or schedule import previews only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(teamSetup).toContain('The disabled Sports Connect refresh control does not fetch new provider data.');
        expect(teamSetup).not.toContain('any sync notes you want stored with the team');
        expect(teamSetup).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(teamSetup).not.toContain('Use the manual re-import entry point to trigger a fresh sync when needed.');

        expect(helpCenter).toContain('store Sports Connect metadata');
        expect(helpCenter).toContain('preview roster or schedule snapshot imports before committing changes');
        expect(helpCenter).not.toContain('sync Sports Connect roster data');
        expect(helpCenter).not.toContain('run backend Sports Connect sync');
        expect(helpCenter).not.toContain('import rosters and schedules through the backend Sports Connect sync workflow');

        const registrationManifest = readHelpManifest().find((item) => item.id === 'registration');
        expect(registrationManifest.summary).toContain('store Sports Connect metadata');
        expect(registrationManifest.summary).not.toContain('sync Sports Connect roster data');
        expect(registrationManifest.searchText).toContain('Configure Sports Connect metadata before stored snapshot imports');
        expect(registrationManifest.searchText).toContain('metadata-only import previews disabled refresh');
        expect(registrationManifest.searchText).not.toContain('Run backend Sports Connect roster sync before roster snapshot imports');
        expect(registrationManifest.searchText).not.toContain('run backend Sports Connect sync');

        expect(appIndex).toContain('store Sports Connect metadata');
        expect(appIndex).toContain('Configuring Sports Connect as metadata-only provider setup');
        expect(appIndex).toContain('Roster and schedule imports require a registration roster snapshot, registration schedule snapshot, or other provider data already loaded for the team.');
        expect(appIndex).toContain('Configure registration provider metadata');
        expect(appIndex).toContain('The provider card stores metadata only today. A future connector is required before ALL PLAYS can fetch live Sports Connect data.');
        expect(appIndex).toContain('Use roster or schedule import previews only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(appIndex).toContain('The disabled Sports Connect refresh control does not fetch new provider data.');
        expect(appIndex).not.toContain('A successful sync updates the provider status and stores roster/source snapshots');
        expect(appIndex).not.toContain('Sync now pulls fresh Sports Connect data through the backend before import preview.');
        expect(appIndex).not.toContain('connection status monitoring');
        expect(appIndex).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
        expect(appIndex).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(appIndex).not.toContain('trigger a fresh sync when needed.');

        expect(capabilities).toContain('Sports Connect metadata import workflow');
        expect(capabilities).toContain('Sports Connect metadata');
        expect(capabilities).not.toContain('Sports Connect sync');
        expect(capabilities).not.toContain('Sports Connect sync workflow');
    });
});
