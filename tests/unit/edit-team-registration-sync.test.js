import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditTeam() {
    return readFileSync(new URL('../../edit-team.html', import.meta.url), 'utf8');
}

function readDb() {
    return readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
}

function readFunctions() {
    return readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
}

function readSportsConnectSyncCore() {
    return readFileSync(new URL('../../functions/sports-connect-registration-sync.cjs', import.meta.url), 'utf8');
}

describe('edit team Sports Connect registration sync wiring', () => {
    it('keeps Sports Connect metadata wiring while manual sync remains disabled', () => {
        const source = readEditTeam();
        const dbSource = readDb();
        const functionsSource = readFunctions();
        const coreSource = readSportsConnectSyncCore();

        expect(source).toContain('syncRegistrationProvider } from');
        expect(source).toContain('id="registration-refresh-btn"');
        expect(source).toContain('function handleRegistrationProviderSync()');
        expect(source).toContain('await syncRegistrationProvider(currentTeamId)');
        expect(source).toContain('function hasUnsavedRegistrationSyncChanges(provider, externalTeamId)');
        expect(source).toContain('function getRegistrationProviderCapability(provider, externalTeamId, source = {})');
        expect(source).toContain("['live_connected', 'sync_success'].includes(source?.connectionStatus) && source?.syncEnabled === true");
        expect(source).toContain('Sports Connect live sync is unavailable until a connector is added.');
        expect(source).toContain("state: 'metadata_configured'");
        expect(source).toContain("state: 'live_connected'");
        expect(source).toContain("canRefresh: false");
        expect(source).toContain("syncEnabled: false");
        expect(source).toContain("canRefresh: true");
        expect(source).toContain("syncEnabled: true");
        expect(source).toContain("refreshButton.disabled = !capability.canRefresh;");
        expect(source).toContain("if (!capability.canRefresh) {");
        expect(source).toContain("providerCapability: capability.state");
        expect(source).toContain('syncEnabled: capability.syncEnabled');
        expect(source).toContain('Open roster import to preview changes.');
        expect(source).not.toContain('Manual refresh unavailable');

        expect(dbSource).toContain("httpsCallable(functions, 'syncRegistrationProvider')");
        expect(functionsSource).toContain('exports.syncRegistrationProvider = functions.https.onCall');
        expect(functionsSource).toContain('buildSportsConnectTeamUpdate');
        expect(coreSource).toContain('registrationRosterSnapshot');
        expect(coreSource).not.toContain('source.syncUrl');
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
            "label: isSportsConnect ? 'Metadata saved; live sync unavailable' : 'Registration metadata only. No live sync.'",
            "? 'Sports Connect metadata is saved for reference only. Live refresh and re-import require a future provider connector.'",
            "state: 'live_connected'",
            "connectionStatus: 'live_connected'",
            "canRefresh: true",
            "syncEnabled: true"
        ].forEach((snippet) => {
            expect(capabilitySource).toContain(snippet);
        });

        expect(capabilitySource).toContain("const hasLiveConnection = ['live_connected', 'sync_success'].includes(source?.connectionStatus) && source?.syncEnabled === true;");
        expect(capabilitySource).toContain("if (hasProvider && hasLiveConnection) {");
        expect(capabilitySource).toContain('canRefresh: false');
        expect(capabilitySource).toContain('syncEnabled: false');
    });

    it('does not call the Sports Connect sync callable when refresh is unavailable', () => {
        const source = readEditTeam();
        const syncHandlerSource = source.slice(
            source.indexOf('async function handleRegistrationProviderSync()'),
            source.indexOf('function buildRegistrationSourcePayload()')
        );

        expect(syncHandlerSource).toContain('if (!currentTeamId || button.disabled) return;');
        expect(syncHandlerSource).toContain('const capability = getRegistrationProviderCapability(provider, externalTeamId, currentRegistrationSource || {});');
        expect(syncHandlerSource).toContain('if (!capability.canRefresh) {');
        expect(syncHandlerSource).toContain('renderRegistrationConnectionStatus(currentRegistrationSource || {});');
        expect(syncHandlerSource).toContain("document.getElementById('registration-connection-help').textContent = capability.helpText;");
        expect(syncHandlerSource).toContain('return;');
        expect(syncHandlerSource.indexOf('return;')).toBeLessThan(syncHandlerSource.indexOf('await syncRegistrationProvider(currentTeamId)'));
    });
});
