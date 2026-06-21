import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath) {
    return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

describe('workflow registration guide', () => {
    it('documents Sports Connect as metadata-only instead of a live connection', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('the registration provider fields currently store metadata only');
        expect(source).toContain('They do not create a live Sports Connect connection, authenticate to the provider, or verify connection health in real time.');
        expect(source).toContain('configures Sports Connect metadata, and opens stored-snapshot imports when provider data has already been loaded');
        expect(source).not.toContain('The connection status indicator updates to show: <strong>Connected</strong>, <strong>Not Connected</strong>, or <strong>Error</strong>.');
        expect(source).not.toContain('connection status monitoring, last-sync display, and manual re-import');
        expect(source).not.toContain('configures Sports Connect, and triggers re-imports');
    });

    it('tells admins manual re-import depends on stored snapshots or loaded provider data', () => {
        const source = readRepoFile('workflow-registration.html');

        expect(source).toContain('The button does not pull fresh Sports Connect data immediately.');
        expect(source).toContain('<strong>Open a stored-snapshot import.</strong>');
        expect(source).toContain('registration schedule snapshot, registration roster snapshot, registration source snapshot, or other loaded provider data is already available for this team');
        expect(source).toContain('preview table appears from the stored registration schedule snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('preview table appears from the stored registration roster snapshot or other loaded provider data already saved in ALL PLAYS');
        expect(source).toContain('previous stored snapshot');
        expect(source).not.toContain('Trigger a manual re-import');
        expect(source).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
        expect(source).not.toContain('previous sync');
    });

    it('regenerates help index registration copy to match the metadata-only workflow', () => {
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

        expect(helpCenter).toContain('use stored Sports Connect metadata with manual imports');
        expect(helpCenter).not.toContain('sync with Sports Connect');
        expect(helpCenter).not.toContain('view connection and sync status');

        expect(appIndex).toContain('use stored Sports Connect metadata with manual imports');
        expect(appIndex).toContain('Configure registration provider metadata');
        expect(appIndex).toContain('the registration provider fields currently store metadata only');
        expect(appIndex).toContain('On the provider card, use Sync now to fetch Sports Connect data through the backend and store the latest roster snapshot for import.');
        expect(appIndex).toContain('After Sync now finishes, use the manual re-import entry point only when a roster/schedule snapshot or other provider data is already loaded into ALL PLAYS.');
        expect(appIndex).not.toContain('connection status monitoring');
        expect(appIndex).not.toContain('pull the latest data immediately without waiting for any scheduled sync');
        expect(appIndex).not.toContain('Connect a registration provider (such as Sports Connect) to sync roster and schedule data.');
        expect(appIndex).not.toContain('trigger a fresh sync when needed.');

        expect(capabilities).toContain('Sports Connect metadata import workflow');
        expect(capabilities).not.toContain('Sports Connect sync workflow');
    });
});
