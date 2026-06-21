import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('workflow registration guide', () => {
    it('documents Sports Connect backend sync as roster/source-only before imports', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('can run a backend manual sync using server-configured credentials for roster/source data');
        expect(source).toContain('A successful sync updates the provider status and stores roster/source snapshots');
        expect(source).toContain('configures Sports Connect metadata, runs backend sync, and opens snapshot imports after provider data has been loaded');
        expect(source).toContain('schedule imports rely on a registration schedule snapshot or other provider data already loaded for the team');
        expect(source).toContain('Sync now');
        expect(source).not.toContain('These fields currently store metadata only.');
        expect(source).not.toContain('They do not create a live Sports Connect connection, authenticate to the provider, or verify connection health in real time.');
    });

    it('tells admins which imports depend on backend sync versus saved provider data', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('<strong>Sync provider data.</strong>');
        expect(source).toContain('The backend fetches Sports Connect data using server-configured credentials');
        expect(source).toContain('writes the roster/source snapshots used by roster imports and audit metadata');
        expect(source).toContain('<strong>Open a synced-snapshot import.</strong>');
        expect(source).toContain('registration roster snapshot, registration source snapshot, registration schedule snapshot, or other loaded provider data is available for this team');
        expect(source).toContain('preview table appears from a registration schedule snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('preview table appears from the synced registration roster snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('For roster imports, run <strong>Sync now</strong>');
        expect(source).not.toContain('The button does not pull fresh Sports Connect data immediately.');
    });

    it('regenerates help index registration copy to avoid claiming schedule sync comes from the backend helper', () => {
        const helpCenter = readRepoFile('help.html');
        const teamSetup = readRepoFile('workflow-team-setup.html');
        const appIndex = readRepoFile('apps/app/src/lib/helpKnowledgeIndex.ts');
        const capabilities = readRepoFile('apps/app/src/data/capabilities.ts');

        expect(teamSetup).toContain('Configure registration provider metadata');
        expect(teamSetup).toContain('Enter the external Team ID / mapping field, then save the team so the provider card keeps that mapping.');
        expect(teamSetup).toContain('use <strong>Sync now</strong> to fetch Sports Connect data through the backend and store the latest roster snapshot for import');
        expect(teamSetup).toContain('After <strong>Sync now</strong> finishes, use the manual re-import entry point only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(teamSetup).not.toContain('any sync notes you want stored with the team');
        expect(teamSetup).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(teamSetup).not.toContain('Use the manual re-import entry point to trigger a fresh sync when needed.');

        expect(helpCenter).toContain('sync Sports Connect roster data');
        expect(helpCenter).toContain('preview roster or schedule snapshot imports before committing changes');
        expect(helpCenter).not.toContain('import rosters and schedules through the backend Sports Connect sync workflow');
        expect(helpCenter).not.toContain('metadata only');

        expect(appIndex).toContain('sync Sports Connect roster data');
        expect(appIndex).toContain('backend manual sync using server-configured credentials for roster/source data');
        expect(appIndex).toContain('schedule imports rely on a registration schedule snapshot or other provider data already loaded for the team.');
        expect(appIndex).toContain('Configure registration provider metadata');
        expect(appIndex).toContain('On the provider card, use Sync now to fetch Sports Connect data through the backend and store the latest roster snapshot for import.');
        expect(appIndex).toContain('After Sync now finishes, use the manual re-import entry point only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(appIndex).not.toContain('Sync now pulls fresh Sports Connect data through the backend before import preview.');
        expect(appIndex).not.toContain('connection status monitoring');
        expect(appIndex).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
        expect(appIndex).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(appIndex).not.toContain('trigger a fresh sync when needed.');

        expect(capabilities).toContain('Sports Connect sync workflow');
        expect(capabilities).not.toContain('Sports Connect metadata import workflow');
    });
});
