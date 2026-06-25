import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('edit team registration import', () => {
    it('offers a guarded registration import path with an empty state on team creation', () => {
        const source = readRepoFile('edit-team.html');

        expect(source).toContain('Import from registration system');
        expect(source).toContain('id="team-create-mode-registration"');
        expect(source).toContain('registration-source-select');
        expect(source).toContain('No registration sources are configured yet. Start with a blank team or load provider data before using this import path.');
        expect(source).toContain('registrationMode.disabled = configuredRegistrationTeams.length === 0;');
        expect(source).toContain('registrationMode.setAttribute(\'aria-disabled\', String(registrationMode.disabled));');
        expect(source).toContain('document.querySelector(\'input[name="teamCreateMode"][value="manual"]\')?.click();');
        expect(source).toContain('getConfiguredRegistrationTeams');
    });

    it('persists provider and external team identifiers when importing', () => {
        const source = readRepoFile('edit-team.html');

        expect(source).toContain('season: selectedRegistrationTeam.season || null');
        expect(source).toContain('division: selectedRegistrationTeam.division || null');
        expect(source).toContain('registrationSource:');
        expect(source).toContain('registrationSourcePayload');
        expect(source).toContain('sourceId: selectedRegistrationTeam.sourceId');
        expect(source).toContain('externalTeamName: selectedRegistrationTeam.externalTeamName');
    });

    it('adds editable registration provider fields and documents manual sync behavior', () => {
        const source = readRepoFile('edit-team.html');

        expect(source).toContain('Registration Provider Connection');
        expect(source).toContain('registrationProviderName');
        expect(source).toContain('registrationExternalTeamId');
        expect(source).toContain('registrationCopiedTeamId');
        expect(source).toContain('registrationLastSyncStatus');
        expect(source).toContain('Selecting Sports Connect enables a manual provider pull after this team is saved.');
        expect(source).toContain('Save a Sports Connect provider mapping, then re-import to refresh stored roster snapshots.');
        expect(source).toContain('await syncRegistrationProvider(currentTeamId)');
    });

    it('renders registration provider metadata on the team page', () => {
        const source = readRepoFile('team.html');

        expect(source).toContain('registrationProviderHtml(team, teamId)');
        expect(source).toContain('Registration Provider');
        expect(source).toContain('External Team ID');
        expect(source).toContain('Last Sync Status');
    });

    it('documents the registration import path in the team setup workflow', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'team-setup');

        expect(workflow.summary).toContain('registration system');
        expect(workflow.searchText).toContain('Import from registration system');
        expect(workflow.searchText).toContain('If no sources are configured');
    });

    it('imports getRegistrationSources from db.js and fetches on create-team init', () => {
        const source = readRepoFile('edit-team.html');

        expect(source).toContain('getRegistrationSources');
        expect(source).toContain('getRegistrationSources().then(');
        expect(source).toContain('window.allplaysRegistrationSources = sources');
        expect(source).toContain('configuredRegistrationTeams = getConfiguredRegistrationTeams()');
        expect(source).toContain('populateRegistrationSourcePicker()');
    });

    it('uses getRegistrationSources in db.js to scope registration source reads to the signed-in admin surface', () => {
        const source = readRepoFile('js/db.js');

        expect(source).toContain('export async function getRegistrationSources()');
        expect(source).toContain("where('ownerId', '==', userId)");
        expect(source).toContain("where('adminEmails', 'array-contains', userEmail)");
        expect(source).toContain("getScopedRegistrationSourceDocs('teamId', adminTeamIds)");
        expect(source).toContain("getScopedRegistrationSourceDocs('organizationTeamId', adminTeamIds)");
        expect(source).toContain("where(fieldName, 'in', teamIdsChunk)");
        expect(source).not.toContain('getDocs(collection(db, "registrationSources"))');
    });

    it('adds least-privilege Firestore security rules for the registrationSources collection', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('function canReadRegistrationSource(data)');
        expect(rules).toContain('data.ownerId == request.auth.uid');
        expect(rules).toContain('data.organizationOwnerId == request.auth.uid');
        expect(rules).toContain("request.auth.token.email.lower() in data.get('adminEmails', [])");
        expect(rules).toContain("request.auth.token.email.lower() in data.get('organizationAdminEmails', [])");
        expect(rules).toContain("data.teamId is string && isTeamOwnerOrAdmin(data.teamId)");
        expect(rules).toContain("data.organizationTeamId is string && isTeamOwnerOrAdmin(data.organizationTeamId)");
        expect(rules).toContain('allow get, list: if canReadRegistrationSource(resource.data);');
        expect(rules).toContain('allow write: if isGlobalAdmin();');
        expect(rules).not.toContain('allow read: if isSignedIn();');
    });
});
