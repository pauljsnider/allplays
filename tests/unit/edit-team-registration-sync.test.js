import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeam() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

describe('edit team Sports Connect registration sync wiring', () => {
    it('wires Sports Connect setup to a manual provider fetch', () => {
        const source = readEditTeam();

        expect(source).toContain('id="registration-refresh-btn"');
        expect(source).toContain('Re-import');
        expect(source).toContain('async function handleRegistrationProviderSync()');
        expect(source).toContain('function getRegistrationProviderCapability(provider, externalTeamId, source = {})');
        expect(source).toContain('manual provider pull after this team is saved');
        expect(source).toContain("state: 'sync_ready'");
        expect(source).toContain("label: 'Ready to fetch Sports Connect data'");
        expect(source).toContain("refreshLabel: 'Re-import from Sports Connect'");
        expect(source).toContain("canRefresh: true");
        expect(source).toContain("syncEnabled: true");
        expect(source).toContain('function getStoredRegistrationSource(team = {})');
        expect(source).toContain('function isCurrentRegistrationProviderMappingSaved(provider, externalTeamId)');
        expect(source).toContain("refreshButton.disabled = !capability.canRefresh || !currentTeamId || isUnsavedSportsConnectMapping;");
        expect(source).toContain('await syncRegistrationProvider(currentTeamId)');
        expect(source).toContain('await refreshRegistrationSourceFromTeam()');
        expect(source).toContain("providerCapability: capability.state");
        expect(source).toContain('syncEnabled: capability.syncEnabled');
        expect(source).toContain('syncRegistrationProvider } from');
        expect(source).toContain('Fetching Sports Connect registration snapshot');
        expect(source).not.toContain('Open roster import to preview changes.');
        expect(source).not.toContain('Manual refresh unavailable');
    });

    it('keeps registration provider capability states explicit for success and failure states', () => {
        const source = readEditTeam();
        const capabilitySource = source.slice(
            source.indexOf('function getRegistrationProviderCapability'),
            source.indexOf('function ensureRegistrationProviderOption')
        );

        [
            "state: 'not_configured'",
            "connectionStatus: 'not_configured'",
            "helpText: 'Choose a provider and team mapping to save registration metadata.'",
            "state: 'metadata_incomplete'",
            "connectionStatus: 'metadata_incomplete'",
            "helpText: 'Add the provider team ID or mapping to finish setup.'",
            "state: 'sync_success'",
            "connectionStatus: 'sync_success'",
            "label: 'Sports Connect connected'",
            "state: 'sync_error'",
            "connectionStatus: 'sync_error'",
            "label: 'Sports Connect sync failed'",
            "state: 'sync_ready'",
            "connectionStatus: 'sync_ready'",
            "label: 'Ready to fetch Sports Connect data'",
            "refreshLabel: 'Re-import from Sports Connect'",
            "state: 'metadata_configured'",
            "label: 'Registration metadata only. No live sync.'"
        ].forEach((snippet) => {
            expect(capabilitySource).toContain(snippet);
        });

        expect(capabilitySource).toContain('canRefresh: true');
        expect(capabilitySource).toContain('syncEnabled: true');
        expect(capabilitySource).not.toContain("state: 'live_connected'");
        expect(capabilitySource).not.toContain("connectionStatus: 'live_connected'");
        expect(capabilitySource).not.toContain('Live connected');
    });

    it('calls the Sports Connect sync callable from the refresh handler and reloads persisted status', () => {
        const source = readEditTeam();
        const syncHandlerSource = source.slice(
            source.indexOf('async function handleRegistrationProviderSync()'),
            source.indexOf('function shouldPreserveRegistrationSyncStatus')
        );

        expect(syncHandlerSource).toContain('const capability = getRegistrationProviderCapability(provider, externalTeamId, currentRegistrationSource || {});');
        expect(syncHandlerSource).toContain('await syncRegistrationProvider(currentTeamId)');
        expect(syncHandlerSource).toContain('await refreshRegistrationSourceFromTeam()');
        expect(syncHandlerSource).toContain('Sports Connect import complete.');
        expect(syncHandlerSource).toContain('Sports Connect import failed:');
        expect(syncHandlerSource).toContain('Fetching Sports Connect registration snapshot');
    });

    it('honors legacy registrationProvider mappings when loading saved sync state', () => {
        const source = readEditTeam();
        const storedSourceHelper = source.slice(
            source.indexOf('function getStoredRegistrationSource(team = {})'),
            source.indexOf('function getRegistrationLastSyncTime(source = {})')
        );
        const populateSource = source.slice(
            source.indexOf('function populateRegistrationProviderFields(team = {})'),
            source.indexOf('function clearRegistrationProviderFields()')
        );
        const refreshSource = source.slice(
            source.indexOf('async function refreshRegistrationSourceFromTeam()'),
            source.indexOf('async function handleRegistrationProviderSync()')
        );

        expect(storedSourceHelper).toContain('team?.registrationSource');
        expect(storedSourceHelper).toContain('team?.registrationProvider');
        expect(populateSource).toContain('currentRegistrationSource = getStoredRegistrationSource(team);');
        expect(refreshSource).toContain('getTeam(currentTeamId, { includeInactive: true })');
        expect(refreshSource).toContain('const storedRegistrationSource = getStoredRegistrationSource(latestTeam || {});');
        expect(refreshSource).toContain('currentRegistrationSource = storedRegistrationSource;');
    });
});
