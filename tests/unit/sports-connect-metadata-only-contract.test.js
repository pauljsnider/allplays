import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Sports Connect metadata-only product contract', () => {
    it('keeps the workflow guide explicit that provider setup does not fetch live data by itself', () => {
        const workflow = readSource('workflow-registration.html');

        expect(workflow).toContain('Sports Connect live sync is not available today.');
        expect(workflow).toContain('It does not authenticate to Sports Connect, check provider health, or fetch roster/source data.');
        expect(workflow).toContain('Use the roster or schedule import preview only when provider data has already been stored in ALL PLAYS.');
        expect(workflow).toContain('These import previews work from saved snapshots; the disabled Sports Connect refresh control does not fetch new provider data.');
        expect(workflow).toContain('the import button does not pull fresh Sports Connect data immediately');
    });

    it('keeps Edit Team Sports Connect setup metadata-only with no live fetch path', () => {
        const editTeam = readSource('edit-team.html');

        expect(editTeam).toContain('Selecting Sports Connect saves metadata only; it does not fetch live provider data today.');
        expect(editTeam).toContain('Sports Connect metadata-only setup saved');
        expect(editTeam).toContain('No live Sports Connect fetch runs from Edit Team yet');
        expect(editTeam).toContain('Metadata only');
        expect(editTeam).toContain("canRefresh: false,");
        expect(editTeam).toContain('refreshButton.disabled = !capability.canRefresh;');
        expect(editTeam).not.toContain("canRefresh: true,");
        expect(editTeam).not.toContain("state: 'live_connected'");
        expect(editTeam).not.toContain('await syncRegistrationProvider(currentTeamId)');
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
