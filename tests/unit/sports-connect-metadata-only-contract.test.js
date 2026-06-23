import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Sports Connect manual provider pull product contract', () => {
    it('documents that provider setup can fetch fresh snapshots through the manual pull', () => {
        const workflow = readSource('workflow-registration.html');

        expect(workflow).toContain('can run a manual backend fetch using server-configured credentials');
        expect(workflow).toContain('A successful fetch updates connection state and stores fresh registration source and roster snapshots.');
        expect(workflow).toContain('click <strong>Re-import from Sports Connect</strong>');
        expect(workflow).toContain('These import previews work from saved snapshots; use the manual Sports Connect pull when you need fresh provider data.');
        expect(workflow).toContain('Import previews read saved data only');
        expect(workflow).not.toContain('Sports Connect live sync is not available today.');
        expect(workflow).not.toContain('the disabled Sports Connect refresh control does not fetch new provider data');
        expect(workflow).not.toContain('marks the provider as live connected');
        expect(workflow).not.toContain('Re-import previews saved data only');
    });

    it('keeps Edit Team Sports Connect setup wired to the backend callable', () => {
        const editTeam = readSource('edit-team.html');

        expect(editTeam).toContain('Selecting Sports Connect enables a manual provider pull after this team is saved.');
        expect(editTeam).toContain('Ready to fetch Sports Connect data');
        expect(editTeam).toContain('Sports Connect connected');
        expect(editTeam).toContain('Sports Connect sync failed');
        expect(editTeam).toContain("canRefresh: true,");
        expect(editTeam).toContain('refreshButton.disabled = !capability.canRefresh || !currentTeamId || isUnsavedSportsConnectMapping;');
        expect(editTeam).not.toContain("state: 'live_connected'");
        expect(editTeam).toContain('await syncRegistrationProvider(currentTeamId)');
    });

    it('prevents saved client metadata from choosing the Sports Connect backend endpoint', () => {
        const syncCore = readSource('functions/sports-connect-registration-sync.cjs');

        expect(syncCore).toContain('config.endpointTemplate ||');
        expect(syncCore).toContain('config.registrationSnapshotUrl ||');
        expect(syncCore).toContain('config.baseUrl');
        expect(syncCore).toContain('const accessToken = compactString(config.accessToken || config.token);');
        expect(syncCore).not.toContain('source.syncUrl');
        expect(syncCore).not.toContain('source.registrationSnapshotUrl');
    });
});
