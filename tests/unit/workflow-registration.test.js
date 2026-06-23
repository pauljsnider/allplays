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
    it('documents Sports Connect manual provider pulls before imports', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('the Registration Provider panel stores the provider mapping and can run a manual backend fetch using server-configured credentials.');
        expect(source).toContain('A successful fetch updates connection state and stores fresh registration source and roster snapshots.');
        expect(source).toContain('pull Sports Connect provider snapshots on demand');
        expect(source).toContain('Configuring Sports Connect manual provider pulls');
        expect(source).not.toContain('Sports Connect, the Registration Provider panel currently stores provider metadata only.');
        expect(source).not.toContain('A future connector is required before ALL PLAYS can fetch live Sports Connect data.');
    });

    it('tells admins imports use stored snapshots refreshed by the manual pull', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('<strong>Run a manual provider pull.</strong>');
        expect(source).toContain('click <strong>Re-import from Sports Connect</strong>');
        expect(source).toContain('The backend fetches Sports Connect data using server-configured credentials');
        expect(source).toContain('stores the latest registration source and roster snapshots');
        expect(source).toContain('<strong>Open a stored-snapshot import.</strong>');
        expect(source).toContain('Use the roster or schedule import preview after provider data has been stored in ALL PLAYS.');
        expect(source).toContain('registration roster snapshot, registration source snapshot, registration schedule snapshot, or other loaded provider data is available for this team');
        expect(source).toContain('These import previews work from saved snapshots; use the manual Sports Connect pull when you need fresh provider data.');
        expect(source).toContain('preview table appears from a registration schedule snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('preview table appears from a stored registration roster snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('run <strong>Re-import from Sports Connect</strong>');
        expect(source).not.toContain('The disabled Sports Connect refresh control does not fetch new provider data.');
        expect(source).not.toContain('For roster imports, run <strong>Sync now</strong>');
        expect(source).not.toContain('Re-import previews saved data only');
    });

    it('regenerates help index registration copy for manual Sports Connect provider pulls', () => {
        const helpCenter = readRepoFile('help.html');
        const teamSetup = readRepoFile('workflow-team-setup.html');
        const appIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const capabilities = readRepoFile('apps/app/src/data/capabilities.ts');

        expect(teamSetup).toContain('Configure registration provider metadata');
        expect(teamSetup).toContain('Enter the external Team ID / mapping field, then save the team so the provider card keeps that mapping.');
        expect(teamSetup).toContain('Use <strong>Re-import from Sports Connect</strong> to run a manual backend provider pull using server-configured credentials.');
        expect(teamSetup).toContain('A successful pull stores fresh registration source and roster snapshots and updates connection state.');
        expect(teamSetup).toContain('Open roster or schedule import previews after the provider pull succeeds.');
        expect(teamSetup).not.toContain('any sync notes you want stored with the team');
        expect(teamSetup).not.toContain('A future connector is required before ALL PLAYS can fetch live Sports Connect data.');
        expect(teamSetup).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(teamSetup).not.toContain('The disabled Sports Connect refresh control does not fetch new provider data.');

        expect(helpCenter).toContain('Sports Connect manual pulls');
        expect(helpCenter).toContain('run Sports Connect manual provider pulls');
        expect(helpCenter).not.toContain('sync Sports Connect roster data');
        expect(helpCenter).not.toContain('run backend Sports Connect sync');
        expect(helpCenter).not.toContain('import rosters and schedules through the backend Sports Connect sync workflow');

        const registrationManifest = readHelpManifest().find((item) => item.id === 'registration');
        expect(registrationManifest.summary).toContain('run Sports Connect manual provider pulls');
        expect(registrationManifest.summary).not.toContain('sync Sports Connect roster data');
        expect(registrationManifest.searchText).toContain('Configuring Sports Connect manual provider pulls');
        expect(registrationManifest.searchText).toContain('pull Sports Connect provider snapshots on demand');
        expect(registrationManifest.searchText).toContain('The backend fetches Sports Connect data using server-configured credentials');
        expect(registrationManifest.searchText).not.toContain('Run backend Sports Connect roster sync before roster snapshot imports');
        expect(registrationManifest.searchText).not.toContain('run backend Sports Connect sync');

        expect(appIndex).toContain('run Sports Connect manual provider pulls');
        expect(appIndex).toContain('Configuring Sports Connect manual provider pulls');
        expect(appIndex).toContain('Use the roster or schedule import preview after provider data has been stored in ALL PLAYS.');
        expect(appIndex).toContain('Configure registration provider metadata');
        expect(appIndex).toContain('Use Re-import from Sports Connect to run a manual backend provider pull using server-configured credentials.');
        expect(appIndex).toContain('A successful pull stores fresh registration source and roster snapshots and updates connection state.');
        expect(appIndex).not.toContain('Sync now pulls fresh Sports Connect data through the backend before import preview.');
        expect(appIndex).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
        expect(appIndex).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(appIndex).not.toContain('The disabled Sports Connect refresh control does not fetch new provider data.');

        expect(capabilities).toContain('Sports Connect manual provider pull workflow');
        expect(capabilities).toContain('Sports Connect manual pulls');
        expect(capabilities).not.toContain('Sports Connect metadata import workflow');
        expect(capabilities).not.toContain('Sports Connect sync workflow');
    });
});
