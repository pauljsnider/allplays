import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeam() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

describe('edit team Sports Connect registration sync wiring', () => {
    it('shows Sports Connect setup as metadata-only and keeps manual fetch unavailable', () => {
        const source = readEditTeam();

        expect(source).toContain('id="registration-refresh-btn"');
        expect(source).toContain('Metadata only');
        expect(source).toContain('function handleRegistrationProviderSync()');
        expect(source).toContain('function getRegistrationProviderCapability(provider, externalTeamId, source = {})');
        expect(source).toContain('Sports Connect live sync is unavailable until a connector is added.');
        expect(source).toContain("state: 'metadata_configured'");
        expect(source).toContain("label: isSportsConnect ? 'Sports Connect metadata-only setup saved' : 'Registration metadata only. No live sync.'");
        expect(source).toContain('No live Sports Connect fetch runs from Edit Team yet');
        expect(source).toContain("canRefresh: false");
        expect(source).toContain("syncEnabled: false");
        expect(source).toContain("refreshButton.disabled = !capability.canRefresh;");
        expect(source).toContain("refreshButton.textContent = capability.refreshLabel || 'Metadata only';");
        expect(source).toContain("providerCapability: capability.state");
        expect(source).toContain('syncEnabled: capability.syncEnabled');
        expect(source).not.toContain('syncRegistrationProvider } from');
        expect(source).not.toContain('await syncRegistrationProvider(currentTeamId)');
        expect(source).not.toContain("state: 'live_connected'");
        expect(source).not.toContain('Live connected');
        expect(source).not.toContain("canRefresh: true");
        expect(source).not.toContain("syncEnabled: true");
        expect(source).not.toContain('Fetching Sports Connect registration snapshot');
        expect(source).not.toContain('Open roster import to preview changes.');
        expect(source).not.toContain('Manual refresh unavailable');
    });

    it('keeps registration provider capability states explicit for metadata-only providers', () => {
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
            "state: 'metadata_configured'",
            "connectionStatus: 'metadata_configured'",
            "label: isSportsConnect ? 'Sports Connect metadata-only setup saved' : 'Registration metadata only. No live sync.'",
            "? 'Sports Connect metadata is saved only in ALL PLAYS. No live Sports Connect fetch runs from Edit Team yet; refresh and re-import require a future provider connector.'",
            "refreshLabel: 'Metadata only'"
        ].forEach((snippet) => {
            expect(capabilitySource).toContain(snippet);
        });

        expect(capabilitySource).toContain('canRefresh: false');
        expect(capabilitySource).toContain('syncEnabled: false');
        expect(capabilitySource).not.toContain("state: 'live_connected'");
        expect(capabilitySource).not.toContain("connectionStatus: 'live_connected'");
        expect(capabilitySource).not.toContain('Live connected');
        expect(capabilitySource).not.toContain('canRefresh: true');
        expect(capabilitySource).not.toContain('syncEnabled: true');
    });

    it('does not call the Sports Connect sync callable from the refresh handler', () => {
        const source = readEditTeam();
        const syncHandlerSource = source.slice(
            source.indexOf('function handleRegistrationProviderSync()'),
            source.indexOf('function buildRegistrationSourcePayload()')
        );

        expect(syncHandlerSource).toContain('const capability = getRegistrationProviderCapability(provider, externalTeamId, currentRegistrationSource || {});');
        expect(syncHandlerSource).toContain('renderRegistrationConnectionStatus(currentRegistrationSource || {});');
        expect(syncHandlerSource).toContain("document.getElementById('registration-connection-help').textContent = capability.helpText;");
        expect(syncHandlerSource).not.toContain('syncRegistrationProvider');
        expect(syncHandlerSource).not.toContain('Syncing');
        expect(syncHandlerSource).not.toContain('Fetching Sports Connect registration snapshot');
    });
});
