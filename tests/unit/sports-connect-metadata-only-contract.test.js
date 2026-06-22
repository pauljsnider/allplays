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

    it('keeps Edit Team metadata-only Sports Connect refresh disabled until a live connector marks it available', () => {
        const editTeam = readSource('edit-team.html');

        expect(editTeam).toContain('Selecting Sports Connect saves metadata only; it does not fetch live provider data today.');
        expect(editTeam).toContain("const hasLiveConnection = ['live_connected', 'sync_success'].includes(source?.connectionStatus) && source?.syncEnabled === true;");
        expect(editTeam).toContain("canRefresh: true,");
        expect(editTeam).toContain("canRefresh: false,");
        expect(editTeam).toContain('refreshButton.disabled = !capability.canRefresh;');
        expect(editTeam).toContain('Sports Connect metadata is saved for reference only. Live refresh and re-import require a future provider connector.');
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
