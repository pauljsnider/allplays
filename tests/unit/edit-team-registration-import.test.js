import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('edit team registration import', () => {
    it('offers a registration import path with an empty state on team creation', () => {
        const source = readRepoFile('edit-team.html');

        expect(source).toContain('Import from registration system');
        expect(source).toContain('registration-source-select');
        expect(source).toContain('No registration sources are configured yet');
        expect(source).toContain('getConfiguredRegistrationTeams');
    });

    it('persists provider and external team identifiers when importing', () => {
        const source = readRepoFile('edit-team.html');

        expect(source).toContain('season: selectedRegistrationTeam.season || null');
        expect(source).toContain('division: selectedRegistrationTeam.division || null');
        expect(source).toContain('registrationSource:');
        expect(source).toContain('provider: selectedRegistrationTeam.provider');
        expect(source).toContain('sourceId: selectedRegistrationTeam.sourceId');
        expect(source).toContain('externalTeamId: selectedRegistrationTeam.externalTeamId');
        expect(source).toContain('externalTeamName: selectedRegistrationTeam.externalTeamName');
    });

    it('documents the registration import path in the team setup workflow', () => {
        const manifest = JSON.parse(readRepoFile('workflow-manifest.json'));
        const workflow = manifest.find((item) => item.id === 'team-setup');

        expect(workflow.summary).toContain('registration system');
        expect(workflow.searchText).toContain('Import from registration system');
        expect(workflow.searchText).toContain('If no sources are configured');
    });
});
